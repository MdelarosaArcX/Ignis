// ffmpegService.js (persistent queue + live priority + auto resume)
const ffmpeg = require("fluent-ffmpeg");
const ignisConfig = require("../config/ignisconfig.json");
// const ffmpegStatic = require("ffmpeg-static");
const ffmpegStatic = "C:\\ffmpeg\\bin\\ffmpeg.exe";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
// const { detectGPU } = require("../utils/gpuDetect");
const {
  listGPUs,
  waitForFreeGpu,
  releaseGpu,
  detectGPUVendor,
} = require("../utils/gpuDetect");

const { execSync } = require("child_process");
const {
  INPUT_DIR,
  INPUT_METADATA_DIR,
  OUTPUT_DIR,
  OUTPUT_METADATA_DIR,
  allowedFormats,
} = require("../config/paths");
const { formatDate, formatFileSize } = require("../utils/formatters");
const { saveMeta, filesMeta, buildReport } = require("./fileService");

ffmpeg.setFfmpegPath(ffmpegStatic);

const progressMap = {};
const processMap = {};
const sseClients = {};
const stoppedMap = {};

let runningCount = 0;
let maxConcurrent = 1;

function computeConcurrency() {
  const mode = ignisConfig.systemLoadMode;
  const gpuCount = listGPUs().length;
  const cpuCount = require("os").cpus().length;

  switch (mode) {
    case 1:
      maxConcurrent = 1;
      break;

    case 2:
      // 1 job per physical processor type
      const cpuJobs =
        ignisConfig.limits.mode2.maxCPUJobs === "auto"
          ? Math.max(1, Math.floor(cpuCount / 4))
          : Number(ignisConfig.limits.mode2.maxCPUJobs);

      const gpuJobs =
        ignisConfig.limits.mode2.maxGPUJobs === "auto"
          ? gpuCount
          : Number(ignisConfig.limits.mode2.maxGPUJobs);

      maxConcurrent = cpuJobs + gpuJobs;
      break;

    case 3:
      // GPU only
      maxConcurrent = listGPUs().length;
      break;

    case 4:
      // CPU only
      maxConcurrent = Math.max(1, Math.floor(cpuCount / 4));
      break;

    case 5:
      // CPU pinned core mode
      maxConcurrent = 1; // one job with pinned cores
      break;

    default:
      maxConcurrent = 1;
  }

  console.log(
    "🔥 System Load Mode =",
    mode,
    " → maxConcurrent =",
    maxConcurrent
  );
}

computeConcurrency();

let pendingQueue = [];

execSync(`attrib +R +S +H "${INPUT_DIR}"`);
execSync(`attrib +R +S +H "${INPUT_METADATA_DIR}"`);

function lockFileWindows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    execSync(`attrib +R +S +H "${filePath}"`);
    console.log(`🔒 Locked (read-only): ${filePath}`);
  } catch (err) {
    console.warn("⚠️ Failed to lock file:", filePath, err.message);
  }
}

function unlockFileWindows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    execSync(`attrib -R -S -H "${filePath}"`);
    console.log(`🔓 Unlocked: ${filePath}`);
  } catch (err) {
    console.warn("⚠️ Failed to unlock file:", filePath, err.message);
  }
}

// === Persistent queue storage ===
const QUEUE_FILE = path.join(__dirname, "../queue.json");
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      pendingQueue = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"));
      console.log(`📂 Restored ${pendingQueue.length} queued job(s)`);
    }
  } catch (e) {
    console.warn("⚠️ Failed to load queue:", e.message);
  }
}
function saveQueue() {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(pendingQueue, null, 2));
  } catch (e) {
    console.warn("⚠️ Failed to save queue:", e.message);
  }
}

// === Priority helpers ===
function sortQueue() {
  // Lower number = higher priority
  pendingQueue.sort((a, b) => {
    const pa = a.priority ?? 3;
    const pb = b.priority ?? 3;
    if (pa !== pb) return pa - pb; // smaller number first
    return 0; // stable sort if equal
  });
  saveQueue();
}

// === Queue manager (fixed queuing + auto resume) ===
function enqueueJob(metaKey, taskFn, priority = 3) {
  const existing = pendingQueue.find((q) => q.key === metaKey);
  if (!existing) {
    pendingQueue.push({ key: metaKey, taskFn, priority });
    console.log(`🕓 Queued job: ${metaKey} (priority: ${priority})`);
    const meta = filesMeta[metaKey];
    if (meta) {
      meta.status = "queued";
      meta.priority = priority;
      saveMeta();
    }
    sortQueue();
    saveQueue();
  } else {
    // ✅ Update priority dynamically if already in queue
    existing.priority = priority;
    sortQueue();
  }

  processNext(); // try to start next if slots available
}

async function processNext() {
  // respect max concurrency
  if (runningCount >= maxConcurrent) return;

  // pick next job
  const next = pendingQueue.shift();
  if (!next) return;

  const { key, taskFn, priority } = next;
  const meta = filesMeta[key];
  if (!meta) {
    console.warn(`⚠️ Meta missing for ${key}, skipping`);
    return processNext();
  }

  runningCount++;
  saveQueue();

  meta.status = "processing";
  saveMeta();
  console.log(`🚀 Starting job: ${key} (${priority})`);

  try {
    await taskFn();
    // meta.status = "completed";
    // meta.progress = 100;
    // meta.completedTime = formatDate(Date.now());
    // console.log(`✅ Completed job: ${key}`);
  } catch (err) {
    meta.status = "error";
    meta.ratio = "Failed";
    meta.progress = 0;
    meta.error = err.message;
    saveMeta();
    console.error(`❌ Failed job: ${key}: ${err.message}`);
  }

  saveMeta();
  runningCount--;

  // wait 1 tick before processing next queued job
  setImmediate(() => processNext());
}

// === Utility functions ===
function parseFrameRate(avg) {
  if (!avg) return null;
  if (typeof avg === "number") return avg;
  if (typeof avg !== "string") return null;
  const parts = avg.split("/");
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (!isNaN(num) && !isNaN(den) && den !== 0) return num / den;
  }
  const n = Number(avg);
  return isNaN(n) ? null : n;
}
function normalizeCodecs(
  outputFormat,
  requestedVideoCodec,
  requestedAudioCodec,
  processor
) {
  const gpuVendor = detectGPUVendor(); // ✅ multi-GPU-safe vendor detection
  let videoCodec = requestedVideoCodec
    ? requestedVideoCodec.toLowerCase()
    : null;
  const preferGPU = processor && processor.toLowerCase() !== "cpu";

  // --- Supported containers ---
  const containerCompatibility = {
    mp4: ["h264", "hevc", "x264", "x265", "libx264", "libx265"],
    mkv: ["h264", "hevc", "x264", "x265", "libx264", "libx265"],
    avi: ["h264", "x264", "libx264"], // ✅ AVI does NOT support HEVC
    mpegts: ["h264", "hevc", "x264", "x265", "libx264", "libx265"], // ✅ allow both
  };

  const supported = containerCompatibility[outputFormat] || ["h264"];

  // --- Detect codec family ---
  const codecFamily = videoCodec
    ? videoCodec.includes("265") || videoCodec.includes("hevc")
      ? "hevc"
      : "h264"
    : "h264";

  // --- Enforce compatibility ---
  if (videoCodec && !supported.some((c) => videoCodec.includes(c))) {
    console.warn(
      `⚠️ ${videoCodec} not supported in .${outputFormat}, switching to ${
        codecFamily === "hevc" ? "HEVC" : "H.264"
      }`
    );
    videoCodec = codecFamily === "hevc" ? "libx265" : "libx264";
  }

  // --- Map vendor to GPU encoders ---
  const gpuMap = {
    nvidia: { h264: "h264_nvenc", hevc: "hevc_nvenc" },
    amd: { h264: "h264_amf", hevc: "hevc_amf" },
    intel: { h264: "h264_qsv", hevc: "hevc_qsv" },
  };

  // --- Choose best encoder ---
  if (preferGPU && gpuVendor !== "unknown") {
    const codecMap = gpuMap[gpuVendor] || {};
    videoCodec =
      codecMap[codecFamily] ||
      (codecFamily === "hevc" ? "hevc_nvenc" : "h264_nvenc");
  } else {
    // CPU fallback
    videoCodec = codecFamily === "hevc" ? "libx265" : "libx264";
  }

  // --- Audio codec ---
  const audioCodec =
    requestedAudioCodec && requestedAudioCodec !== "none"
      ? requestedAudioCodec
      : outputFormat === "avi"
      ? "mp3"
      : "aac";

  return {
    videoCodecNorm: videoCodec,
    audioCodecNorm: audioCodec,
  };
}

function getQualityOptions(quality, videoCodec) {
  const codec = (videoCodec || "").toLowerCase();
  const isGPU =
    codec.includes("nvenc") || codec.includes("qsv") || codec.includes("amf");

  let preset = "medium";
  let crf = 23;

  switch ((quality || "").toLowerCase()) {
    case "highest":
      preset = isGPU ? "slow" : "veryslow";
      crf = 18;
      break;
    case "high":
      preset = "slow";
      crf = 20;
      break;
    case "medium":
      preset = "medium";
      crf = 23;
      break;
    case "low":
      preset = "fast";
      crf = 28;
      break;
    default:
      preset = isGPU ? "medium" : "medium";
      crf = 23;
  }

  return { preset, crf };
}

// === Core ffmpeg runner ===
// Helper: parse resolution string (accepts "1920:1080", "3840x2160", "1920x1080", "3840:2160")
function parseResolution(res) {
  if (!res) return { w: 1920, h: 1080 };
  const parts = res.includes(":") ? res.split(":") : res.split("x");
  const w = Number(parts[0]) || 1920;
  const h = Number(parts[1]) || 1080;
  return { w, h };
}

// Helper: pick dynamic bitrate values (kbit/s)
function getDynamicBitrate({ width, height, fps = 30, codec = "h264" }) {
  const is4K = width >= 3840 || height >= 2160;
  const is1080 = width >= 1920 && height >= 1080 && !is4K;
  const is720 = width >= 1280 && height >= 720 && !is1080 && !is4K;
  const lowerFpsScale = fps > 50 ? 1.35 : 1.0; // boost for high-frame-rate
  let base;

  codec = (codec || "").toLowerCase();

  // Base recommendations (kbit/s)
  if (is4K) {
    if (codec.includes("265") || codec.includes("hevc")) base = 14000; // HEVC
    else base = 18000; // H.264 good tradeoff for TS-friendly size
  } else if (is1080) {
    if (codec.includes("265") || codec.includes("hevc")) base = 5000;
    else base = 8000;
  } else if (is720) {
    if (codec.includes("265") || codec.includes("hevc")) base = 3000;
    else base = 4000;
  } else {
    base = 3000;
  }

  base = Math.round(base * lowerFpsScale);

  const minrate = Math.round(base * 0.75);
  const maxrate = Math.round(base * 1.5);
  const bufsize = Math.round(base * 2.5);

  return { bitrate: base, minrate, maxrate, bufsize };
}

function getTotalFrames(inputPath) {
  return new Promise((resolve) => {
    const cmd =
      `ffprobe -v error -select_streams v:0 ` +
      `-count_frames -show_entries stream=nb_read_frames ` +
      `-of default=nokey=1:noprint_wrappers=1 "${inputPath}"`;

    exec(cmd, (err, stdout) => {
      if (err) return resolve(0);
      const frames = parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(frames) ? frames : 0);
    });
  });
}

function runFfmpeg({
  inputPath,
  outputPath,
  outputFormat,
  videoCodecNorm,
  audioCodecNorm,
  frameRate,
  resolution,
  preset,
  crf,
  safeKey,
  vbrcbr,
}) {
  return new Promise(async (resolve, reject) => {
    const meta = filesMeta[safeKey];
    const durationSec = Number(meta?.input?.duration) || 0;
    const mode = ignisConfig.systemLoadMode;

    const totalFrames =
      Number(meta?.input?.totalFrames) || (await getTotalFrames(inputPath));

    if (meta && totalFrames > 0) {
      meta.input.totalFrames = totalFrames;
      saveMeta();
    }

    let gpu = null;
    let gpuVendor = "cpu";
    let gpuId = null;

    const usingGPUEncoder = (videoCodecNorm || "").includes("nvenc");

    // --------------------------------------------------
    // MODE ENFORCEMENT
    // --------------------------------------------------
    if (mode === 3 && !usingGPUEncoder) {
      return reject(new Error("GPU-only mode: CPU encoder not allowed."));
    }

    const cpuOnly = mode === 4 || mode === 5;

    if (!cpuOnly && usingGPUEncoder) {
      gpu = await waitForFreeGpu();
      gpuVendor = gpu.vendor;
      gpuId = gpu.id;
      console.log(`🎞 Using GPU ${gpuId}: ${gpu.name}`);
    } else {
      console.log("🧠 CPU job — no GPU required.");
    }

    // --------------------------------------------------
    // THREAD / CORE HANDLING
    // --------------------------------------------------
    const totalCpus = os.cpus().length;
    let threads = Math.max(1, Math.floor(totalCpus / 2));

    let pinCores = null;
    if (mode === 5 && ignisConfig.cpuPinning.enabled) {
      pinCores = ignisConfig.cpuPinning.cores;
      threads = pinCores.length;
      console.log("📌 CPU Core Pinning active:", pinCores);
    }

    if ((videoCodecNorm || "").includes("libx265")) {
      threads = Math.min(threads, 8);
      console.log(`🧠 Limiting threads (${threads}) for libx265`);
    }

    // --------------------------------------------------
    // BITRATE CALCULATION
    // --------------------------------------------------
    const parsedRes = parseResolution(resolution || "1920:1080");
    const fpsNum = Number(frameRate) || 30;

    const { bitrate, minrate, maxrate, bufsize } = getDynamicBitrate({
      width: parsedRes.w,
      height: parsedRes.h,
      fps: fpsNum,
      codec: videoCodecNorm,
    });

    const rcMode = (vbrcbr || "vbr").toLowerCase();

    const startTime = Date.now();
    const scale = resolution || "1920:1080";

    // --------------------------------------------------
    // BUILD FFMPEG COMMAND
    // --------------------------------------------------
    const cmd = ffmpeg(inputPath);

    // GPU decode
    if (!cpuOnly && gpuVendor === "nvidia") {
      cmd.inputOptions(["-hwaccel cuda", `-hwaccel_device ${gpuId}`]);
      if (usingGPUEncoder) {
        cmd.outputOptions([`-gpu ${gpuId}`]);
      }
    }

    cmd.videoCodec(videoCodecNorm || "libx264");
    cmd.audioCodec(audioCodecNorm || "aac");
    cmd.format(outputFormat);

    const ffmpegOutputOptions = [];

    // --------------------------------------------------
    // STREAM MAPPING
    // --------------------------------------------------
    if (outputFormat === "mp4") {
      ffmpegOutputOptions.push("-map 0:v");
      ffmpegOutputOptions.push("-map 0:a?");
      ffmpegOutputOptions.push("-map 0:s?");
    } else {
      ffmpegOutputOptions.push("-map 0");
    }

    // --------------------------------------------------
    // RATE CONTROL (SINGLE SOURCE OF TRUTH)
    // --------------------------------------------------
    if (usingGPUEncoder) {
      if (rcMode === "cbr") {
        ffmpegOutputOptions.push("-rc cbr");
        ffmpegOutputOptions.push(`-b:v ${bitrate}k`);
        ffmpegOutputOptions.push(`-minrate ${bitrate}k`);
        ffmpegOutputOptions.push(`-maxrate ${bitrate}k`);
        const buf = bitrate * 2;
        const mux = Math.round(bitrate * 1.25);

        ffmpegOutputOptions.push(`-b:v ${bitrate}k`);
        ffmpegOutputOptions.push(`-minrate ${bitrate}k`);
        ffmpegOutputOptions.push(`-maxrate ${bitrate}k`);
        ffmpegOutputOptions.push(`-bufsize ${buf}k`);

        if (outputFormat === "mpegts" || outputFormat === "ts") {
          ffmpegOutputOptions.push(`-muxrate ${mux}k`);
          ffmpegOutputOptions.push("-muxdelay 0");
          ffmpegOutputOptions.push("-muxpreload 0");
        }
      } else {
        ffmpegOutputOptions.push(
          outputFormat === "mp4" ? "-rc vbr_hq" : "-rc vbr"
        );
        ffmpegOutputOptions.push(`-b:v ${bitrate}k`);
        ffmpegOutputOptions.push(`-maxrate ${maxrate}k`);
        ffmpegOutputOptions.push(`-bufsize ${bufsize}k`);

        if (outputFormat === "mp4" && crf !== undefined && crf !== "") {
          ffmpegOutputOptions.push(`-cq ${crf}`);
        }
      }
    } else {
      if (crf !== undefined && crf !== "") {
        ffmpegOutputOptions.push(`-crf ${crf}`);
      }
    }

    // --------------------------------------------------
    // FILTERS
    // --------------------------------------------------
    ffmpegOutputOptions.push(`-vf yadif,format=yuv420p,scale=${scale}`);
    ffmpegOutputOptions.push("-pix_fmt yuv420p");
    ffmpegOutputOptions.push("-c:s copy");

    // --------------------------------------------------
    // GOP / TS STABILITY
    // --------------------------------------------------
    if (outputFormat === "mpegts" || outputFormat === "ts") {
      const gop = Math.max(1, Math.round(fpsNum * 2));
      ffmpegOutputOptions.push(`-g ${gop}`);
      ffmpegOutputOptions.push(`-force_key_frames expr:gte(t,n_forced*2)`);
      ffmpegOutputOptions.push("-muxdelay 0");
      ffmpegOutputOptions.push("-muxpreload 0");
    }

    if (preset) ffmpegOutputOptions.push(`-preset ${preset}`);
    ffmpegOutputOptions.push(`-threads ${threads}`);

    if (pinCores) {
      const affinity = pinCores.join(",");
      ffmpegOutputOptions.push(`-affinity ${affinity}`);
      console.log("📌 Applied CPU affinity:", affinity);
    }

    cmd.outputOptions(ffmpegOutputOptions);

    if (outputFormat === "mp4") {
      cmd.outputOptions(["-movflags +faststart", "-sn"]);
    }

    if (frameRate) cmd.fps(Number(frameRate));

    // --------------------------------------------------
    // META + EVENTS (UNCHANGED)
    // --------------------------------------------------
    meta.startTime = formatDate(startTime);
    meta.ratio = "Pending";
    saveMeta();

    cmd
      .on("start", (cmdline) => {
        console.log("[ffmpeg] start:", cmdline);
        processMap[safeKey] = cmd.ffmpegProc || cmd._childProcess || null;
      })
      .on("progress", (progress) => {
        // if (!durationSec) return;
        // const [h, m, s] = progress.timemark.split(":").map(Number);
        // const seconds = h * 3600 + m * 60 + s;
        // const pct = Math.min(100, (seconds / durationSec) * 100);
        // const rounded = Number(pct.toFixed(2));

        // progressMap[safeKey] = rounded;
        // if (meta) {
        //   meta.progress = rounded;
        //   meta.status = rounded >= 100 ? "completed" : "processing";
        //   if (rounded % 5 === 0) saveMeta();
        // }

        // try {
        //   const { broadcastFileUpdate } = require("./fileEvents");
        //   broadcastFileUpdate(`progress:${safeKey}:${rounded}`);
        // } catch (_) {}

        let pct = 0;

        if (totalFrames && progress.frames) {
          pct = (progress.frames / totalFrames) * 100;
        } else if (durationSec && progress.timemark) {
          const [h, m, s] = progress.timemark.split(":").map(Number);
          const seconds = h * 3600 + m * 60 + s;
          pct = (seconds / durationSec) * 100;
        } else {
          return;
        }

        const rounded = Math.min(100, Number(pct.toFixed(2)));

        progressMap[safeKey] = rounded;
        meta.progress = rounded;
        meta.status = rounded >= 100 ? "completed" : "processing";

        if (Math.floor(rounded) % 5 === 0) saveMeta();

        try {
          const { broadcastFileUpdate } = require("./fileEvents");
          broadcastFileUpdate(`progress:${safeKey}:${rounded}`);
        } catch (_) {}
      })
      .on("error", (err, stdout, stderr) => {
        releaseGpu(gpuId);
        console.log(`🔴 Released GPU ${gpuId} due to error`);
        console.error("[ffmpeg] error:", err.message);
        console.error(stderr || "");
        delete processMap[safeKey];
        reject(err);
      })
      .on("end", () => {
        releaseGpu(gpuId);
        console.log(`🟢 Released GPU ${gpuId}`);
        console.log("✅ FFmpeg finished successfully");
        delete processMap[safeKey];
        progressMap[safeKey] = 100;
        meta.progress = 100;
        meta.priority = 0;
        meta.status = "completed";
        meta.completedTime = formatDate(Date.now());
        meta.elapsed = (Date.now() - startTime) / 1000;
        meta.ratio =
          meta.input.duration > 0
            ? `1:${(
                meta.input.duration /
                ((Date.now() - startTime) / 1000)
              ).toFixed(2)}`
            : null;
        try {
          unlockFileWindows(meta.input.url);
        } catch (err) {
          console.warn("⚠️ Failed to unlock input:", err.message);
        }
        saveMeta();
        resolve();
      })
      .save(outputPath);
  });
}

// === Conversion entry point ===
function handleConvert(req, res) {
  try {
    const {
      outputFormat,
      frameRate,
      audioCodec,
      videoCodec,
      processor,
      quality,
      key,
      resolution,
      outputFileName,
      priority = 3,
      vbrcbr = "vbr",
    } = req.body;

    if (!outputFormat || !allowedFormats.includes(outputFormat))
      return res.status(400).json({ error: "Invalid output format" });

    const safeKey = key.toLowerCase();
    const meta = filesMeta[safeKey];
    if (!meta) return res.status(400).json({ error: "Metadata not found" });

    // fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    // fs.mkdirSync(OUTPUT_METADATA_DIR, { recursive: true });

    const ext = outputFormat === "mpegts" ? "ts" : outputFormat;
    const outName = `${outputFileName}`;
    const outputPath = path.join(OUTPUT_DIR, outName);

    // just update the meta and mark as ready (no ffmpeg yet)
    meta.output = { fileName: outName, url: OUTPUT_DIR + `${outName}` };
    meta.status = "ready";
    meta.priority = priority;
    // meta.startTime = formatDate(Date.now()),
    (meta.dateStarted = Date.now()),
      (meta.settings = {
        outputFormat,
        frameRate,
        audioCodec,
        videoCodec,
        processor,
        quality,
        resolution,
        outputFileName,
        vbrcbr,
      });
    saveMeta();

    // ✅ Return immediately
    // res.json({ key: safeKey, status: "ready" });
    res.json(meta);
  } catch (e) {
    console.error("handleConvert error:", e.message);
    res.status(500).json({ error: e.message });
  }
}

function handleEnqueue(req, res) {
  try {
    const { key } = req.body;
    const meta = filesMeta[key];
    if (!meta) return res.status(404).json({ error: "Job not found" });

    const {
      outputFormat,
      audioCodec,
      videoCodec,
      processor,
      quality,
      resolution,
      outputFileName,
    } = meta.settings;
    const inputPath = meta.input.url;
    const ext = outputFormat === "mpegts" ? "ts" : outputFormat;
    const outputPath = path.join(OUTPUT_DIR, `${outputFileName}`);
    const { videoCodecNorm, audioCodecNorm } = normalizeCodecs(
      outputFormat,
      videoCodec,
      audioCodec,
      processor
    );
    const { preset, crf } = getQualityOptions(quality, videoCodecNorm);
    // const startTime = Date.now();
    meta.status = "queued";
    meta.ratio = "Queued";
    saveMeta();

    res.json({ key, status: "queued" });

    // enqueue after response ends
    setImmediate(() => {
      const task = async () => {
        try {
          console.log(`▶️ Starting ${key}`);
          meta.status = "processing";

          // meta.startTime = formatDate(startTime);
          saveMeta();

          await runFfmpeg({
            inputPath,
            outputPath,
            outputFormat,
            videoCodecNorm,
            audioCodecNorm,
            frameRate: meta.settings.frameRate,
            resolution,
            preset,
            crf,
            safeKey: key,
            vbrcbr: meta.settings.vbrcbr,
          });

          let metadataOutput = null;
          try {
            metadataOutput = await new Promise((resolveP, rejectP) =>
              ffmpeg.ffprobe(outputPath, (err, data) =>
                err ? rejectP(err) : resolveP(data)
              )
            );
          } catch (err2) {
            console.warn("ffprobe after retry failed:", err2 && err2.message);
          }

          let report = "";
          let metadataFilePath = null;
          try {
            report = buildReport(
              outputPath,
              metadataOutput?.format || {},
              metadataOutput?.streams || [],
              fs.statSync(outputPath).size
            );
            metadataFilePath = path.join(
              OUTPUT_METADATA_DIR,
              `${outputFileName}.txt`
            );
            fs.writeFileSync(metadataFilePath, report, "utf-8");
          } catch (e) {
            console.warn(
              "Failed to write metadata/report after retry:",
              e && e.message
            );
          }

          const outputVideoStream =
            (metadataOutput?.streams || []).find(
              (s) => s.codec_type === "video"
            ) || null;
          const outputVideoCodec =
            outputVideoStream?.codec_long_name ||
            outputVideoStream?.codec_name ||
            "unknown";

          meta.output.metaData = metadataOutput;
          meta.output.metaDataUrl = outputPath ? outputPath : null;
          meta.output.metaDataName = `${outputFileName}.txt`;
          meta.output.report = report || null;
          meta.output.videoCodec = outputVideoCodec;
          meta.status = "completed";
          meta.completedTime = formatDate(Date.now());
          meta.priority = 0;
          meta.progress = 100;
          saveMeta();
          console.log(`✅ Finished ${key}`);
        } catch (err) {
          meta.status = "error";
          meta.error = err.message;
          saveMeta();
          console.error(`❌ Failed ${key}:`, err.message);
        }
      };
      enqueueJob(key, task, meta.priority || 3);
    });
  } catch (e) {
    console.error("handleEnqueue error:", e.message);
    res.status(500).json({ error: e.message });
  }
}

function handleProgress(req, res) {
  const { filename } = req.params;
  const key = (filename || "").toLowerCase();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();

  if (!sseClients[key]) sseClients[key] = [];
  sseClients[key].push(res);

  const sendProgress = () => {
    const pct = progressMap[key] ?? filesMeta[key]?.progress ?? 0;
    try {
      res.write(`data: ${pct}\n\n`);
    } catch (e) {}
    if (pct >= 100) {
      res.end();
    }
  };

  sendProgress();
  const interval = setInterval(() => {
    const pct = progressMap[key] ?? filesMeta[key]?.progress ?? 0;
    try {
      res.write(`data: ${pct}\n\n`);
    } catch (e) {}
    if (pct >= 100) {
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on("close", () => {
    clearInterval(interval);
    sseClients[key] = (sseClients[key] || []).filter((r) => r !== res);
  });
}

function handleStop(req, res) {
  const { filename } = req.params;
  const key = (filename || "").toLowerCase();
  const proc = processMap[key];
  const fileMeta = filesMeta[key] || {};

  if (!proc) {
    delete filesMeta[key];
    saveMeta();
    return res.status(404).json({ error: "Process not found" });
  }
  console.log("🛑 Stopping process:", key);

  // Try to kill ffmpeg (force kill, cross-platform)
  try {
    stoppedMap[key] = true; // 👈 mark this job as manually stopped
    if (process.platform === "win32") {
      
      exec(`taskkill /pid ${proc.pid} /T /F`, (err) => {
        if (err) console.warn("Windows force kill failed:", err.message);
      });
    } else {
      proc.kill("SIGKILL");
    }
  } catch (err) {
    console.warn("Failed to kill process:", err.message);
  }

  // Mark progress stopped immediately
  delete processMap[key];
  delete progressMap[key];

  // Build all possible related file paths
  const inputFilePath = fileMeta.input?.fileName ? fileMeta.input.url : null;

  // Even if output is not yet in meta, try constructing possible name
  const outputFileName =
    fileMeta.output?.fileName ||
    (fileMeta.settings?.outputFileName
      ? `${fileMeta.settings.outputFileName}.${
          fileMeta.settings.outputFormat || "mp4"
        }`
      : null);

  const outputFilePath = outputFileName
    ? path.join(OUTPUT_DIR, outputFileName)
    : null;

  const inputMetaPath = fileMeta.input?.metaData
    ? fileMeta.input?.metaDataUrl
    : null;
  const outputMetaPath = fileMeta.output?.metaDataName
    ? path.join(OUTPUT_METADATA_DIR, fileMeta.output.metaDataName)
    : outputFileName
    ? path.join(OUTPUT_METADATA_DIR, path.parse(outputFileName).name + ".txt")
    : null;

  // Remove meta entry
  if (filesMeta[key]) {
    delete filesMeta[key];
    saveMeta();
  }

  // Cleanup files after short delay (to let FFmpeg release file locks)
  setTimeout(() => {
    [inputFilePath, outputFilePath, inputMetaPath, outputMetaPath].forEach(
      (p) => {
        console.log("filePath === " + p);
        if (p && typeof p === "string" && fs.existsSync(p)) {
          try {
            unlockFileWindows(p);
            fs.unlinkSync(p);
            console.log("🗑️ Deleted:", p);
          } catch (err) {
            console.warn("❌ Failed to delete:", p, err.message);
          }
        }
      }
    );

    // Remove meta entry
    if (filesMeta[key]) {
      delete filesMeta[key];
      saveMeta();
    }

    // 👇 close any open SSE streams
    if (sseClients[key]) {
      sseClients[key].forEach((resClient) => {
        try {
          resClient.write(`data: ${0}\n\n`);
          resClient.end();
        } catch (e) {}
      });
      delete sseClients[key];
      console.log("🔌 Closed SSE connections for:", key);
    }

    console.log("✅ Stop cleanup complete for:", key);
  }, 800); // small delay so ffmpeg fully closes file handles

  res.json({ ok: true });
}

// === Update Priority API ===
function handlePriority(req, res) {
  try {
    const { filename } = req.params;
    const { priority } = req.body;

    if (priority == null || isNaN(priority))
      return res.status(400).json({ error: "Invalid priority value" });

    const key = filename.toLowerCase();
    const meta = filesMeta[key];
    if (!meta) return res.status(404).json({ error: "File not found" });

    // update meta
    meta.priority = priority;
    saveMeta();

    // update queued job (if exists)
    const queued = pendingQueue.find((q) => q.key === key);
    if (queued) {
      queued.priority = priority;
      sortQueue();
      saveQueue();
    }

    console.log(`🔁 Updated priority for ${key} → ${priority}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update priority:", err.message);
    res.status(500).json({ error: "Failed to update priority" });
  }
}

// === Priority API ===
function handlePriorityUpdate(req, res) {
  const { id, level } = req.body;
  if (!filesMeta[id]) return res.status(404).json({ error: "Job not found" });
  filesMeta[id].priority = level;
  saveMeta();

  const job = pendingQueue.find((q) => q.key === id);
  if (job) {
    job.priority = level;
    sortQueue();
  }
  res.json({ ok: true });
}

// === Metadata ===
function handleMetadata(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    fs.mkdirSync(INPUT_DIR, { recursive: true });
    fs.mkdirSync(INPUT_METADATA_DIR, { recursive: true });
    const now = new Date();

    const formattedInt = parseInt(
      (now.getMonth() + 1).toString().padStart(2, "0") + // MM
        now.getDate().toString().padStart(2, "0") + // DD
        now.getFullYear().toString() + // YYYY
        now.getHours().toString().padStart(2, "0") + // HH (24hr)
        now.getMinutes().toString().padStart(2, "0") + // mm
        now.getSeconds().toString().padStart(2, "0") // mm
    );

    const originalName = req.file.originalname;
    const safeBase = path.parse(originalName).name.replace(/\s+/g, "_");
    const ext = path.extname(originalName);
    // ✅ Always make a unique name if file already exists
    let uniqueName = safeBase + "-" + formattedInt;
    let inputDest = path.join(INPUT_DIR, uniqueName + ext);
    let counter = 1;

    while (fs.existsSync(inputDest)) {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      uniqueName = `${base}(${counter})${ext}`;
      inputDest = path.join(INPUT_DIR, uniqueName + ext);
      counter++;
    }

    try {
      // ✅ Copy file to avoid Windows rename errors
      fs.copyFileSync(req.file.path, inputDest);
      fs.unlinkSync(req.file.path);
    } catch (err) {
      console.error("⚠️ Copy failed, attempting rename:", err.message);
      try {
        fs.renameSync(req.file.path, inputDest);
      } catch (err2) {
        console.error("❌ Rename also failed:", err2.message);
        return res.status(500).json({ error: "Failed to move uploaded file" });
      }
    }

    ffmpeg.ffprobe(inputDest, (err, probe) => {
      if (err)
        return res.status(500).json({ error: "Failed to probe metadata" });
      const format = probe.format || {};
      const streams = probe.streams || [];
      const videoStream = streams.find((s) => s.codec_type === "video");
      const audioStreams = streams.filter((s) => s.codec_type === "audio");
      const textStreams = streams.filter((s) => s.codec_type === "subtitle");

      const report = buildReport(
        inputDest,
        format,
        streams,
        req.file.size || 0
      );
      const metaPath = path.join(INPUT_METADATA_DIR, `${uniqueName}.txt`);
      fs.writeFileSync(metaPath, report, "utf-8");
      const frameRate = videoStream
        ? `${parseFrameRate(videoStream.avg_frame_rate)} fps`
        : null;
      const frameRateVal = videoStream
        ? `${parseFrameRate(videoStream.avg_frame_rate)}`
        : null;
      const resolution = videoStream
        ? `${videoStream.width}x${videoStream.height}`
        : null;

      // const key = `${uniqueName}`.toLowerCase();

      let nextId = 1;
      const existingIds = Object.values(filesMeta)
        .map((f) => parseInt(f.numericId))
        .filter((n) => !isNaN(n));
      if (existingIds.length > 0) nextId = Math.max(...existingIds) + 1;
      let safeKey = `file_${nextId}`;

      // console.log(
      //   `🔑 [${path.basename(watchFolder)}] safeKey for ${fileName}: ${safeKey}`
      // );

      const existingMeta = filesMeta[safeKey];
      if (existingMeta) {
        const status = existingMeta.status;
        if (["error", "pending"].includes(status)) {
          const oldOut = existingMeta.output?.url;
          if (oldOut && fs.existsSync(oldOut)) fs.unlinkSync(oldOut);
        } else if (status === "completed") {
          let counter = 1;
          let newKey = `${safeKey}(${counter})`;
          while (filesMeta[newKey])
            counter++, (newKey = `${safeKey}(${counter})`);
          safeKey = newKey;
        } else if (["queued", "processing"].includes(status)) {
          console.log(`⏭️ Skipping ${fileName} (already ${status})`);
          return;
        }
      }
      filesMeta[safeKey] = {
        id: safeKey,
        numericId: nextId,
        uploadedAt: new Date().toISOString(),
        input: {
          fileName: originalName,
          url: inputDest,
          metaData: probe,
          metaDataUrl: metaPath,
          duration: format.duration || null,
          size: formatFileSize(req.file.size || 0),
          videoCodec: videoStream?.codec_long_name || "unknown",
          audioCodec: audioStreams[0]?.codec_long_name || "unknown",
          report,
          frameRate,
          frameRateVal,
          resolution,
        },
        output: {},
        progress: 0,
        priority: 3,
        status: "idle",
      };
      saveMeta();

      // res.json({ key, probe, metaPath });
      // return metadata and key to frontend
      lockFileWindows(inputDest);
      res.json({
        videoStream,
        duration: parseFloat(format.duration / 60).toFixed(0),
        filename: req.file.originalname,
        videoCodec: videoStream?.codec_long_name || "unknown",
        audioCodec: audioStreams.map((a) => a.codec_long_name || "unknown"),
        subtitles: textStreams.map((t) => t.codec_name || "unknown"),
        frameRate,
        frameRateVal,
        resolution,
        size: formatFileSize(req.file.size),
        all: probe,
        metaData: report,
        key: safeKey,

        // return them to frontend too
        inputMetadata: probe,
        inputMetadataReport: report,
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// === Auto resume on startup ===
// === Auto resume on startup ===
loadQueue();
for (const [key, meta] of Object.entries(filesMeta)) {
  if (["processing", "queued"].includes(meta.status) && meta.progress < 100) {
    const outName =
      meta.output?.fileName ||
      `${meta.settings?.outputFileName || key}.${
        meta.settings?.outputFormat || "mp4"
      }`;
    const outPath = path.join(OUTPUT_DIR, outName);

    // 🧹 Remove old incomplete file if it exists
    if (fs.existsSync(outPath)) {
      try {
        fs.unlinkSync(outPath);
        console.log(`🧹 Deleted incomplete output for ${key}`);
      } catch (err) {
        console.warn(`⚠️ Could not delete old output for ${key}:`, err.message);
      }
    }

    // 🔁 Reset to queue for re-processing
    meta.status = "queued";
    meta.progress = 0;
    meta.ratio = "Queued";
    console.log("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
    console.log(meta.input.url);
    saveMeta();

    enqueueJob(
      key,
      async () => {
        console.log(`⏯️ Resuming ${key} after restart`);
        const {
          outputFormat,
          audioCodec,
          videoCodec,
          processor,
          quality,
          resolution,
          outputFileName,
        } = meta.settings;
        const inputPath = meta.input.metaData.format.filename;
        const ext = outputFormat === "mpegts" ? "ts" : outputFormat;
        const outputPath = meta.output.url;
        const { videoCodecNorm, audioCodecNorm } = normalizeCodecs(
          outputFormat,
          videoCodec,
          audioCodec,
          processor
        );
        const { preset, crf } = getQualityOptions(quality, videoCodecNorm);

        await runFfmpeg({
          inputPath,
          outputPath,
          outputFormat,
          videoCodecNorm,
          audioCodecNorm,
          frameRate: meta.settings.frameRate,
          resolution,
          preset,
          crf,
          safeKey: key,
          vbrcbr: meta.settings.vbrcbr,
        });

        meta.status = "completed";
        meta.progress = 100;
        meta.completedTime = formatDate(Date.now());
        saveMeta();
      },
      meta.priority || 3
    );
  }
}

async function enqueueHotfolderJob({
  id,
  input,
  originalInput,
  output,
  settings,
  errorFolder,
}) {
  // ✅ Use provided id (safeKey) from watchHotfolder.js instead of recomputing from input path
  const safeKey = (id || path.parse(path.basename(input)).name).toLowerCase();

  console.log(`🔥 [Hotfolder] Queuing job for: ${safeKey}`);

  // Ensure meta entry exists
  if (!filesMeta[safeKey]) filesMeta[safeKey] = { id: safeKey };
  const meta = filesMeta[safeKey];

  const outputFormat =
    settings.outputFormat === "ts" ? "mpegts" : settings.outputFormat || "mp4";
  const { videoCodecNorm, audioCodecNorm } = normalizeCodecs(
    outputFormat,
    settings.videoCodec,
    settings.audioCodec,
    settings.processor
  );
  const { preset, crf } = getQualityOptions(settings.quality, videoCodecNorm);

  // ✅ Make sure metadata folders exist
  const inputMetaDir = path.join(path.dirname(originalInput), "metadata");
  const outputMetaDir = path.join(path.dirname(output), "metadata");
  fs.mkdirSync(inputMetaDir, { recursive: true });
  fs.mkdirSync(outputMetaDir, { recursive: true });

  // const inputBase = path.parse(input).name;
  const outputBase = path.parse(output).name;
  const inputMetaPath = path.join(inputMetaDir, `${outputBase}.txt`);
  const outputMetaPath = path.join(outputMetaDir, `${outputBase}.txt`);

  const task = async () => {
    const startTime = Date.now();
    try {
      console.log(`🎬 [Hotfolder] Starting job: ${safeKey}`);

      // ✅ Probe input metadata
      const inputProbe = await new Promise((resolve, reject) =>
        ffmpeg.ffprobe(input, (err, data) =>
          err ? reject(err) : resolve(data)
        )
      );
      const format = inputProbe.format || {};
      const streams = inputProbe.streams || [];
      const vStream = streams.find((s) => s.codec_type === "video");
      const report = buildReport(
        input,
        format,
        streams,
        fs.statSync(input).size
      );

      const frameRate = vStream
        ? `${parseFrameRate(vStream.avg_frame_rate)} fps`
        : null;
      const frameRateVal = vStream
        ? `${parseFrameRate(vStream.avg_frame_rate)}`
        : null;
      const resolution = vStream ? `${vStream.width}x${vStream.height}` : null;
      fs.writeFileSync(inputMetaPath, report, "utf-8");

      meta.input.metaData = inputProbe;
      meta.input.metaDataUrl = inputMetaPath;
      meta.input.report = report;
      meta.input.frameRate = frameRate;
      meta.input.frameRateVal = frameRateVal;
      meta.input.resolution = resolution;
      meta.input.duration = format.duration
        ? Number(format.duration).toFixed(2)
        : "";
      meta.input.size = format.size
        ? `${(format.size / (1024 * 1024)).toFixed(2)} MB`
        : "";
      meta.input.videoCodec = vStream ? vStream.codec_long_name : "unknown";

      meta.status = "processing";
      meta.progress = 0;
      meta.startTime = formatDate(startTime);
      saveMeta();

      // ✅ Run FFmpeg with correct key
      await runFfmpeg({
        inputPath: input,
        outputPath: output,
        outputFormat,
        videoCodecNorm,
        audioCodecNorm,
        frameRate: settings.frameRate,
        resolution,
        preset,
        crf,
        safeKey, // this ensures progressMap uses the right unique key
        vbrcbr: settings.vbrcbr,
      });

      // ✅ After successful transcode
      const elapsedSec = (Date.now() - startTime) / 1000;
      const ratio = meta.input.duration
        ? `1:${(meta.input.duration / elapsedSec).toFixed(2)}`
        : "N/A";

      let outputProbe = null;
      try {
        outputProbe = await new Promise((resolve, reject) =>
          ffmpeg.ffprobe(output, (err, data) =>
            err ? reject(err) : resolve(data)
          )
        );
      } catch (probeErr) {
        console.warn("⚠️ Output probe failed:", probeErr.message);
      }

      const oFormat = outputProbe?.format || {};
      const oStreams = outputProbe?.streams || [];
      const oVideo = oStreams.find((s) => s.codec_type === "video");
      const oCodec = oVideo ? oVideo.codec_long_name : "unknown";
      const oReport = buildReport(
        output,
        oFormat,
        oStreams,
        fs.statSync(output).size
      );
      fs.writeFileSync(outputMetaPath, oReport, "utf-8");

      meta.output.metaData = outputProbe;
      meta.output.metaDataUrl = outputMetaPath;
      meta.output.metaDataName = path.basename(outputMetaPath);
      meta.output.report = oReport;
      meta.output.videoCodec = oCodec;

      meta.status = "completed";
      meta.progress = 100;
      meta.completedTime = formatDate(Date.now());
      meta.elapsed = `${elapsedSec.toFixed(1)}s`;
      meta.ratio = ratio;
      meta.priority = 0;
      saveMeta();

      console.log(`✅ [Hotfolder] Finished ${safeKey} (${ratio})`);

      // 🧹 Delete input after success
      if (fs.existsSync(input)) {
        fs.unlinkSync(input);
        console.log(`🗑️ Deleted input file: ${input}`);
      }

      // ✅ Notify frontend
      try {
        const { broadcastFileUpdate } = require("./fileEvents");
        broadcastFileUpdate(`progress:${safeKey}:100`);
      } catch (e) {
        console.warn("⚠️ Could not broadcast update:", e.message);
      }
    } catch (err) {
      console.error(`❌ [Hotfolder] Job failed: ${err.message}`);
      try {
        const dest = path.join(errorFolder, path.basename(input));
        fs.renameSync(input, dest);
        console.log(`⚠️ Moved failed file to: ${dest}`);
      } catch (moveErr) {
        meta.ratio = "Failed";
        meta.progress = 0;
        saveMeta();
        console.error(`⚠️ Failed to move to error folder: ${moveErr.message}`);
      }
      meta.ratio = "Failed";
      meta.progress = 0;
      meta.status = "error";
      meta.error = err.message;
      saveMeta();
    }
  };

  enqueueJob(safeKey, task, 3);
}

if (pendingQueue.length) console.log("Resuming queued jobs...");
processNext();

module.exports = {
  handleConvert,
  handleProgress,
  handleStop,
  sortQueue,
  saveQueue,
  handleMetadata,
  handlePriorityUpdate,
  handleEnqueue,
  pendingQueue,
  enqueueJob, // ⬅️ add this
  runFfmpeg,
  normalizeCodecs,
  getQualityOptions,
  enqueueHotfolderJob,
};
