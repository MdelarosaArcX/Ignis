// ffmpegService.js (improved)
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { detectGPU } = require("../utils/gpuDetect");
const {
  INPUT_DIR,
  INPUT_METADATA_DIR,
  OUTPUT_DIR,
  OUTPUT_METADATA_DIR,
  allowedFormats,
} = require("../config/paths");

const {
  formatDate,
  formatFileSize,
  formatDurationPretty,
  calculateBitsPixelFrame,
} = require("../utils/formatters");
const { saveMeta, filesMeta, buildReport } = require("./fileService");

ffmpeg.setFfmpegPath(ffmpegStatic);

// maps and simple concurrency control
const progressMap = {};
const processMap = {};
const sseClients = {};
const conversionRetries = {};
const stoppedMap = {}; // 👈 add this

// very simple semaphore/queue
let runningCount = 0;
const maxConcurrent = Number(process.env.FFMPEG_MAX_CONCURRENT) || 2;
const pendingQueue = [];

// helper: enqueue a conversion task
function enqueueConversion(taskFn) {
  return new Promise((resolve, reject) => {
    const runOrQueue = () => {
      runningCount++;
      taskFn()
        .then((r) => {
          runningCount--;
          resolve(r);
          // kick next
          if (pendingQueue.length) {
            const nxt = pendingQueue.shift();
            setImmediate(nxt);
          }
        })
        .catch((err) => {
          runningCount--;
          reject(err);
          if (pendingQueue.length) {
            const nxt = pendingQueue.shift();
            setImmediate(nxt);
          }
        });
    };

    if (runningCount < maxConcurrent) runOrQueue();
    else pendingQueue.push(runOrQueue);
  });
}

// parse "30000/1001" style fps safely
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

function normalizeCodecs(outputFormat, requestedVideoCodec, requestedAudioCodec, processor) {
  const gpuVendor = detectGPU(); // "nvidia"|"amd"|"intel"|"unknown"
  let videoCodec = requestedVideoCodec ? requestedVideoCodec.toLowerCase() : null;
  const preferGPU = processor !== "cpu";

  if (["mpegts", "mp4", "avi"].includes(outputFormat)) {
    if (preferGPU) {
      if (gpuVendor === "nvidia") {
        // if user explicitly asked libx265, attempt hevc_nvenc else h264_nvenc
        videoCodec = videoCodec === "libx265" ? "hevc_nvenc" : "h264_nvenc";
      } else if (gpuVendor === "amd") {
        videoCodec = "h264_amf";
      } else if (gpuVendor === "intel") {
        videoCodec = "h264_qsv";
      } else {
        videoCodec = videoCodec === "libx265" ? "libx265" : "libx264";
      }
    } else {
      videoCodec = videoCodec === "libx265" ? "libx265" : "libx264";
    }
  }

  return { videoCodec, audioCodec: requestedAudioCodec || "aac" };
}

function getQualityOptions(quality, videoCodec) {
  let preset = "medium";
  let crf = 23;
  const isGPU = !!(videoCodec && (videoCodec.includes("nvenc") || videoCodec.includes("qsv") || videoCodec.includes("amf")));

  switch ((quality || "").toLowerCase()) {
    case "highest":
      preset = isGPU ? "p5" : "veryslow";
      crf = isGPU ? 19 : 18;
      break;
    case "high":
      preset = isGPU ? "p4" : "slow";
      crf = isGPU ? 21 : 20;
      break;
    case "medium":
      preset = isGPU ? "p2" : "medium";
      crf = 23;
      break;
    case "low":
      preset = isGPU ? "p1" : "fast";
      crf = isGPU ? 28 : 28;
      break;
    default:
      preset = isGPU ? "p2" : "medium";
      crf = 23;
  }

  return { preset, crf };
}

// single ffmpeg runner that returns a Promise and emits progress via progressMap + sse
function runFfmpeg({
  inputPath,
  outputPath,
  outputFormat,
  videoCodec,
  audioCodec,
  frameRate,
  resolution,
  preset,
  crf,
  safeKey,
}) {
  return new Promise((resolve, reject) => {
    const durationSec = Number(filesMeta[safeKey]?.input?.duration) || 0;
    const isGPU = !!(videoCodec && (videoCodec.includes("nvenc") || videoCodec.includes("qsv") || videoCodec.includes("amf")));
    const threads = Math.max(1, Math.floor(os.cpus().length / 2)); // avoid using all cores
    let codecOption = `-crf ${crf}`;

    if (isGPU) codecOption = `-cq ${crf}`;

    const cmd = ffmpeg(inputPath)
      .videoCodec(videoCodec || "libx264")
      .audioCodec(audioCodec || "aac")
      .format(outputFormat)
      .outputOptions([`-preset ${preset}`, codecOption, "-pix_fmt yuv420p", `-threads ${threads}`].concat(
        outputFormat === "mp4" ? ["-movflags +faststart"] : []
      ));

    if (frameRate) {
      const fpsVal = Number(frameRate) || parseFloat(frameRate);
      if (!Number.isNaN(fpsVal)) cmd.fps(fpsVal);
    }

    if (resolution && typeof resolution === "string" && resolution.includes("x")) {
      cmd.outputOptions(["-s", resolution]);
    }

    let childProc = null;
    cmd
      .on("start", (cmdline) => {
        // store the child process reference
        childProc = cmd.ffmpegProc || cmd._childProcess || null;
        processMap[safeKey] = childProc;
        console.log("[ffmpeg] start:", cmdline);
      })
      .on("progress", (progress) => {
        // progress.timemark looks like "00:01:23.45"
        if (progress.timemark && durationSec) {
          const parts = (progress.timemark || "0:0:0").split(":");
          const hh = Number(parts[0] || 0);
          const mm = Number(parts[1] || 0);
          const ss = Number(parts[2] || 0);
          const seconds = hh * 3600 + mm * 60 + ss;
          const pct = Math.min(100, (seconds / durationSec) * 100);
          progressMap[safeKey] = Number(pct.toFixed(2));
          const clients = sseClients[safeKey] || [];
          clients.forEach((r) => {
            try {
              r.write(`data: ${progressMap[safeKey]}\n\n`);
            } catch (e) {}
          });
        }
      })
      .on("error", (err, stdout, stderr) => {
        console.error("[ffmpeg] error:", err && err.message);
        delete processMap[safeKey];
        delete progressMap[safeKey];
        reject(err || new Error("ffmpeg failed"));
      })
      .on("end", () => {
        // finished writing file
        progressMap[safeKey] = 100;
        delete processMap[safeKey];
        resolve();
      })
      .save(outputPath);
  });
}

/**
 * handleConvert - receives form data and enqueues/starts conversion
 */
function handleConvert(req, res) {
  try {
    const {
      outputFormat,
      frameRate,
      audioCodec: reqAudio,
      videoCodec: reqVideo,
      processor,
      quality,
      key,
      resolution,
      outputFileName,
    } = req.body;

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!outputFormat || !allowedFormats.includes(outputFormat))
      return res.status(400).json({ error: "Invalid output format" });

    const safeKey = (key || "").toLowerCase();
    if (!safeKey) return res.status(400).json({ error: "Missing metadata key. Call handleMetadata first." });

    const meta = filesMeta[safeKey];
    if (!meta) return res.status(400).json({ error: "Metadata key not found." });

    // ensure output folders exist
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(OUTPUT_METADATA_DIR, { recursive: true });

    const inputPath = path.resolve(req.file.path); // multer's tmp path
    if (!fs.existsSync(inputPath)) return res.status(500).json({ error: "Uploaded temp file missing" });

    const fileExt = outputFormat === "mpegts" ? "ts" : outputFormat;
    const outName = `${outputFileName}.${fileExt}`;
    const outputPath = path.join(OUTPUT_DIR, outName);

    // check already exists
    if (fs.existsSync(outputPath)) {
      return res.status(409).json({ error: `A file named "${outName}" already exists.` });
    }

    // decide codecs and quality
    const { videoCodec, audioCodec } = normalizeCodecs(outputFormat, reqVideo, reqAudio, processor);
    const { preset, crf } = getQualityOptions(quality, videoCodec || "");

    // initialize progress & meta
    const startTime = Date.now();
    progressMap[safeKey] = 0;

    Object.assign(meta, {
      output: {
        fileName: outName,
        url: `/transcoded/output/${outName}`,
        metaData: null,
        metaDataUrl: null,
        report: null,
        videoCodec: null,
      },
      startTime: formatDate(startTime),
      settings: { outputFormat, frameRate, audioCodec, videoCodec, processor, quality, resolution },
      progress: 0,
    });

    // immediately respond so frontend knows job accepted
    res.json(meta);

    // enqueue actual conversion so we don't block
    enqueueConversion(async () => {
      try {
        // probe to get duration if possible (prefer metadata stored in filesMeta.input)
        let durationSec = Number(meta.input?.duration) || 0;
        if (!durationSec) {
          try {
            const probe = await new Promise((resolveProbe, rejectProbe) =>
              ffmpeg.ffprobe(inputPath, (err, data) => (err ? rejectProbe(err) : resolveProbe(data)))
            );
            durationSec = probe?.format?.duration || durationSec;
          } catch (e) {
            console.warn("ffprobe probe failed:", e && e.message);
          }
        }
        // store duration in meta if available
        meta.duration = durationSec;
        saveMeta();

        // run primary conversion
        await runFfmpeg({
          inputPath,
          outputPath,
          outputFormat,
          videoCodec,
          audioCodec,
          frameRate,
          resolution,
          preset,
          crf,
          safeKey,
        });

        // after success, probe output and write metadata & report
        let metadataOutput = null;
        try {
          metadataOutput = await new Promise((resolveP, rejectP) =>
            ffmpeg.ffprobe(outputPath, (err, data) => (err ? rejectP(err) : resolveP(data)))
          );
        } catch (err) {
          console.warn("ffprobe output failed:", err && err.message);
        }

        let report = "";
        let metadataFilePath = null;
        try {
          report = buildReport(outputPath, metadataOutput?.format || {}, metadataOutput?.streams || [], fs.statSync(outputPath).size);
          metadataFilePath = path.join(OUTPUT_METADATA_DIR, `${outputFileName}.txt`);
          fs.writeFileSync(metadataFilePath, report, "utf-8");
        } catch (e) {
          console.warn("Failed to write metadata/report:", e && e.message);
        }

        const outputVideoStream = (metadataOutput?.streams || []).find((s) => s.codec_type === "video") || null;
        const outputVideoCodec = outputVideoStream?.codec_long_name || outputVideoStream?.codec_name || "unknown";

        // finalize meta
        Object.assign(filesMeta[safeKey], {
          output: {
            fileName: outName,
            url: `/transcoded/output/${outName}`,
            metaData: metadataOutput,
            metaDataUrl: metadataFilePath ? metadataFilePath : null,
            metaDataName: `${outputFileName}.txt`,
            report: report || null,
            videoCodec: outputVideoCodec,
          },
          convertedName: outName,
          convertedUrl: `/transcoded/output/${outName}`,
          completedTime: formatDate(Date.now()),
          elapsed: (Date.now() - startTime) / 1000,
          duration: durationSec,
          ratio: durationSec > 0 ? `1:${(durationSec / ((Date.now() - startTime) / 1000)).toFixed(2)}` : null,
          progress: 100,
        });
        saveMeta();

        // keep the original uploaded file if you need it for retries or delete based on policy.
        // fs.unlink(inputPath, () => {});
      } catch (err) {
        console.error("[convert] failed:", err && err.message);

        if (stoppedMap[key]) {
          console.log("🚫 Conversion stopped manually — skipping retry.");
          delete stoppedMap[key];
          return;
        }
        // if GPU encoder and not retried yet -> retry once with libx264
        const usedGPU = !!(videoCodec && (videoCodec.includes("nvenc") || videoCodec.includes("qsv") || videoCodec.includes("amf")));
        if (usedGPU && !conversionRetries[safeKey]) {
          conversionRetries[safeKey] = 1;
          console.warn("GPU encoder failed, retrying with libx264...");



          try {
            await runFfmpeg({
              inputPath,
              outputPath,
              outputFormat,
              videoCodec: "libx264",
              audioCodec,
              frameRate,
              resolution,
              preset: "medium",
              crf,
              safeKey,
            });

            // probe & write metadata similar to success branch
            let metadataOutput = null;
            try {
              metadataOutput = await new Promise((resolveP, rejectP) =>
                ffmpeg.ffprobe(outputPath, (err, data) => (err ? rejectP(err) : resolveP(data)))
              );
            } catch (err2) {
              console.warn("ffprobe after retry failed:", err2 && err2.message);
            }
            let report = "";
            let metadataFilePath = null;
            try {
              report = buildReport(outputPath, metadataOutput?.format || {}, metadataOutput?.streams || [], fs.statSync(outputPath).size);
              metadataFilePath = path.join(OUTPUT_METADATA_DIR, `${outputFileName}.txt`);
              fs.writeFileSync(metadataFilePath, report, "utf-8");
            } catch (e) {
              console.warn("Failed to write metadata/report after retry:", e && e.message);
            }
            const outputVideoStream = (metadataOutput?.streams || []).find((s) => s.codec_type === "video") || null;
            const outputVideoCodec = outputVideoStream?.codec_long_name || outputVideoStream?.codec_name || "unknown";

            // const ratio = durationSec > 0 ? (durationSec / elapsedSec).toFixed(2) : null;

            Object.assign(filesMeta[safeKey], {
              output: {
                fileName: outName,
                url: `/transcoded/output/${outName}`,
                metaData: metadataOutput,
                metaDataUrl: metadataFilePath ? metadataFilePath : null,
                metaDataName: `${outputFileName}.txt`,
                report: report || null,
                videoCodec: outputVideoCodec,
              },
              convertedName: outName,
              convertedUrl: `/transcoded/output/${outName}`,
              completedTime: formatDate(Date.now()),
              elapsed: (Date.now() - startTime) / 1000,
              duration: filesMeta[safeKey]?.duration || null,
              // ratio: ratio ? `1:${ratio}` : null,
              progress: 100,
            });
            saveMeta();
          } catch (retryErr) {
            console.error("[retry] failed:", retryErr && retryErr.message);
            filesMeta[safeKey].progress = 0;
            filesMeta[safeKey].error = retryErr && retryErr.message;
            saveMeta();
            delete processMap[safeKey];
            delete progressMap[safeKey];
          }
        } else {
          filesMeta[safeKey].progress = 0;
          filesMeta[safeKey].error = err && err.message;
          saveMeta();
          delete processMap[safeKey];
          delete progressMap[safeKey];
        }
      }
    }).catch((qErr) => {
      // enqueue conversion failure (rare path)
      console.error("enqueueConversion error:", qErr && qErr.message);
      if(filesMeta[safeKey]) {
        filesMeta[safeKey].progress = 0;
        filesMeta[safeKey].error = qErr && qErr.message;
        saveMeta();
      }
      delete processMap[safeKey];
      delete progressMap[safeKey];
    });
  } catch (ex) {
    console.error("handleConvert exception:", ex && ex.message);
    return res.status(500).json({ error: ex && ex.message });
  }
}

/**
 * SSE progress endpoint
 */
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

/**
 * Stop a running conversion
 */
function handleStop(req, res) {
  const { filename } = req.params;
  const key = (filename || "").toLowerCase();
  const proc = processMap[key];
  const fileMeta = filesMeta[key] || {};

  if (!proc) return res.status(404).json({ error: "Process not found" });

  console.log("🛑 Stopping process:", key);

  // Try to kill ffmpeg (force kill, cross-platform)
  try {
    stoppedMap[key] = true; // 👈 mark this job as manually stopped
    if (process.platform === "win32") {
      const { exec } = require("child_process");
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
  const inputFilePath = fileMeta.input?.fileName ? path.join(INPUT_DIR, fileMeta.input.fileName) : null;

  // Even if output is not yet in meta, try constructing possible name
  const outputFileName =
    fileMeta.output?.fileName ||
    (fileMeta.settings?.outputFileName ? `${fileMeta.settings.outputFileName}.${fileMeta.settings.outputFormat || "mp4"}` : null);

  const outputFilePath = outputFileName ? path.join(OUTPUT_DIR, outputFileName) : null;

  const inputMetaPath = fileMeta.input?.metaDataName ? path.join(INPUT_METADATA_DIR, fileMeta.input.metaDataName) : null;
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
    [inputFilePath, outputFilePath, inputMetaPath, outputMetaPath].forEach((p) => {
      console.log('filePath === '+p);
      if (p && typeof p === "string" && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          console.log("🗑️ Deleted:", p);
        } catch (err) {
          console.warn("❌ Failed to delete:", p, err.message);
        }
      }
    });

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




/**
 * handleMetadata - accept upload, probe and record metadata (keeps uploaded file path)
 */
function handleMetadata(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    // Ensure folders
    fs.mkdirSync(INPUT_DIR, { recursive: true });
    fs.mkdirSync(INPUT_METADATA_DIR, { recursive: true });

    const originalName = req.file.originalname;
    const safeBaseName = path.parse(originalName).name.replace(/\s+/g, "_");
    // Move to input folder so it's persistent (or you can keep the multer tmp path)
    const inputDest = path.join(INPUT_DIR, `${originalName}`);
    fs.renameSync(req.file.path, inputDest);

    ffmpeg.ffprobe(inputDest, (err, probe) => {
      if (err) {
        // cleanup
        try {
          fs.unlinkSync(inputDest);
        } catch (e) {}
        return res.status(500).json({ error: "Failed to read metadata" });
      }

      const format = probe.format || {};
      const streams = probe.streams || [];
      const videoStream = streams.find((s) => s.codec_type === "video");
      const audioStreams = streams.filter((s) => s.codec_type === "audio");
      const textStreams = streams.filter((s) => s.codec_type === "subtitle");

      const report = buildReport(inputDest, format, streams, req.file.size || 0);
      const metaPath = path.join(INPUT_METADATA_DIR, `${safeBaseName}.txt`);
      try {
        fs.writeFileSync(metaPath, report, "utf-8");
      } catch (e) {
        console.warn("Failed to write input metadata report:", e && e.message);
      }

      const key = `${safeBaseName}-${Date.now()}`.toLowerCase();
      filesMeta[key] = {
        id: key,
        uploadedAt: new Date().toISOString(),
        input: {
          fileName: originalName,
          url: inputDest,
          metaData: probe,
          metaDataUrl: metaPath,
          metaDataName: `${safeBaseName}.txt`,
          report,
          frameRate: videoStream ? parseFrameRate(videoStream.avg_frame_rate) : null,
          resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
          duration: format.duration || null,
          size: formatFileSize(req.file.size || 0),
          videoCodec: videoStream?.codec_long_name || videoStream?.codec_name || "unknown",
          audioCodec:
            audioStreams.length > 0 ? (audioStreams[0].codec_long_name || audioStreams[0].codec_name || "unknown") : "N/A",
        },
        output: {
          fileName: null,
          url: null,
          metaData: null,
          metaDataUrl: null,
          metaDataName: null,
          report: null,
          videoCodec: null,
        },
        startTime: null,
        completedTime: null,
        elapsed: null,
        ratio: null,
        progress: 0,
      };

      saveMeta();

      // return metadata and key to frontend
      res.json({
        videoStream,
        duration: parseFloat(format.duration / 60).toFixed(0),
        filename: req.file.originalname,
        videoCodec: videoStream?.codec_long_name || "unknown",
        audioCodec: audioStreams.map((a) => a.codec_long_name || "unknown"),
        subtitles: textStreams.map((t) => t.codec_name || "unknown"),
        frameRate: videoStream ? `${parseFrameRate(videoStream.avg_frame_rate)} fps` : null,
        frameRateVal: videoStream ? `${parseFrameRate(videoStream.avg_frame_rate)}` : null,
        resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
        size: formatFileSize(req.file.size),
        all: probe,
        metaData: report,
        key,

        // return them to frontend too
        inputMetadata: probe,
        inputMetadataReport: report,
      });
    });
  } catch (ex) {
    console.error("handleMetadata exception:", ex && ex.message);
    return res.status(500).json({ error: ex && ex.message });
  }
}

module.exports = { handleConvert, handleProgress, handleStop, handleMetadata };
