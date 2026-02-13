const express = require("express");
const multer = require("multer");
const cors = require("cors");
const morgan = require("morgan");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const path = require("path");
const http = require("http");
const fs = require("fs");
const sseClients = {}; // key = filename, value = array of res objects
const presetsFile = path.join(__dirname, "presets.json");
const chokidar = require("chokidar");
const { Server } = require("socket.io");

ffmpeg.setFfmpegPath(ffmpegStatic);

const app = express();
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

const ROOT = __dirname;
const UPLOADS_DIR = path.join(ROOT, "uploads");
const CONVERTED_DIR = path.join(ROOT, "converted");
const OUTPUT_METADATA_DIR = path.join(ROOT, "output_metadata");
const watchFolder = "C:/Users/asus tuf a15/Documents/Project/Work/ArcX/Project/Ignis-Transcode/server/hotfolder";

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // React dev server
    methods: ["GET", "POST"]
  }
});

[UPLOADS_DIR, CONVERTED_DIR, OUTPUT_METADATA_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const HOTFILES_JSON = path.join(ROOT, "hotfiles.json");

let hotFiles = [];

if (fs.existsSync(HOTFILES_JSON)) {
  hotFiles = JSON.parse(fs.readFileSync(HOTFILES_JSON, "utf-8"));
}

function saveHotFiles() {
  fs.writeFileSync(HOTFILES_JSON, JSON.stringify(hotFiles, null, 2));
}


const watcher = chokidar.watch(watchFolder, {
  persistent: true,
  ignoreInitial: true, // don't trigger for already existing files
});

watcher.on("add", (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if ([".mp4", ".mov", ".avi", ".mkv"].includes(ext)) {
    const fileObj = {
      fileName: path.basename(filePath),
      filePath,
      addedAt: new Date().toISOString(),
    };

    // store in memory + persist
    hotFiles.unshift(fileObj);
    saveHotFiles();

    io.emit("newVideo", fileObj);
  }
});

app.get("/api/hotfiles", (req, res) => {
  res.json(hotFiles);
});



io.on("connection", (socket) => {
  console.log("✅ React connected to WebSocket");
});

// Supported formats
const allowedFormats = ["mp4", "avi", "mov", "mkv", "webm"];

// Multer storage
const upload = multer({
  dest: UPLOADS_DIR,
  // const tenGigabytesInBytes = ;
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB
  fileFilter: (req, file, cb) => {
    // allow any input file type
    cb(null, true);
  },
});

// Metadata
const FILES_JSON = path.join(ROOT, "files.json");
let filesMeta = {};
if (fs.existsSync(FILES_JSON)) {
  filesMeta = JSON.parse(fs.readFileSync(FILES_JSON, "utf-8"));
}
function saveMeta() {
  fs.writeFileSync(FILES_JSON, JSON.stringify(filesMeta, null, 2));
}

function formatDate(date) {
  const now = new Date(date);
  // Get the individual time components
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  // Format each component with a leading zero if needed
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = seconds.toString().padStart(2, '0');

  // Combine the parts into the final string
  const timeString = `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
  return timeString;
}

// Progress & process tracking
const progressMap = {};
const processMap = {};

// Serve converted files
app.use("/converted", express.static(CONVERTED_DIR));

// Health
app.get("/api/health", (_, res) => res.json({ ok: true }));

// Convert endpoint
app.post("/api/convert", upload.single("video"), (req, res) => {
  // return res.status(200).json({sample: req});
  const { outputFormat, frameRate, audioCodec, videoCodec } = req.body; // e.g., "avi"
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (!outputFormat || !allowedFormats.includes(outputFormat))
    return res.status(400).json({ error: "Invalid output format" });

  const inputPath = req.file.path;
  const baseName = path.parse(req.file.originalname).name;
  const outName = `${baseName}-${Date.now()}.${outputFormat}`;
  const outputPath = path.join(CONVERTED_DIR, outName);

  const startTime = Date.now();
  progressMap[outName] = 0;

  const pendingFile = {
    originalName: req.file.originalname,
    convertedName: outName,
    convertedUrl: `/converted/${outName}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    startTime: formatDate(new Date(startTime)),
    completedTime: null,
    elapsed: null,
    duration: null,
    ratio: null,
    progress: 0,
  };

  res.json(pendingFile);

  // ffprobe to get duration
  ffmpeg.ffprobe(inputPath, (err, metadata) => {
    if (err) {
      fs.unlink(inputPath, () => { });
      delete progressMap[outName];
      return;
    }

    const durationSec = metadata.format.duration;
    let ffmpegProc;
    const command = ffmpeg(inputPath)
      .videoCodec(videoCodec)
      .fps(Number(frameRate))
      .audioCodec(audioCodec)
      .format(outputFormat);

            // Add faststart flag if output is mp4
      if (outputFormat === "mp4") {
        command.outputOptions(["-movflags +faststart"]);
      }
      command.on("start", (cmdline) => {
        // `command` spawns a child process internally; capture it here
        ffmpegProc = command.ffmpegProc || command._childProcess;
        processMap[outName] = ffmpegProc;
        console.log("FFmpeg started:", cmdline);
        console.log("FFmpeg started:", processMap);
      })
      .on("progress", (progress) => {
        if (progress.timemark && durationSec) {
          const [hh, mm, ssRaw] = progress.timemark.split(":");
          const ss = parseFloat(ssRaw);
          const seconds = parseInt(hh) * 3600 + parseInt(mm) * 60 + ss;
          const pct = Math.min(100, (seconds / durationSec) * 100);
          progressMap[outName] = Number(pct.toFixed(2));
        }
      })
      .on("end", () => {
        const endTime = Date.now();
        fs.unlink(inputPath, () => {});
        progressMap[outName] = 100;

        const elapsedSec = (endTime - startTime) / 1000;
        const ratio = durationSec > 0 ? (durationSec / elapsedSec).toFixed(2) : null;

        // ffprobe the converted file and build report
        ffmpeg.ffprobe(outputPath, (err, metadata) => {

          let metadataFilePath = null;
          let report = '';
          if (!err) {
            const format = metadata.format || {};
            const streams = metadata.streams || [];
            report = buildReport(outputPath, format, streams, fs.statSync(outputPath).size);

            metadataFilePath = path.join(OUTPUT_METADATA_DIR, `${outName}.txt`);
            fs.writeFileSync(metadataFilePath, report, "utf-8");
          }

          filesMeta[outName] = {
            ...pendingFile,
            completedTime: formatDate(new Date(endTime)),
            elapsed: elapsedSec,
            duration: durationSec,
            ratio: ratio ? `1:${ratio}` : null,
            progress: 100,
            metadataFile: metadataFilePath ? `/converted/${outName}.txt` : null,
            sampleMetaData: metadata,
            sampleMetaFile: report,
          };

          saveMeta();
          delete processMap[outName];
        });
      })

      // .on("end", () => {
      //   const endTime = Date.now();
      //   fs.unlink(inputPath, () => { });
      //   progressMap[outName] = 100;

      //   const elapsedSec = (endTime - startTime) / 1000;
      //   const ratio = durationSec > 0 ? (durationSec / elapsedSec).toFixed(2) : null;

      //   filesMeta[outName] = {
      //     ...pendingFile,
      //     completedTime: formatDate(new Date(endTime)),
      //     elapsed: elapsedSec,
      //     duration: durationSec,
      //     ratio: ratio ? `1:${ratio}` : null,
      //     progress: 100,
      //   };
      //   saveMeta();
      //   delete processMap[outName];
      // })
      .on("error", (err) => {
        fs.unlink(inputPath, () => { });
        delete progressMap[outName];
        delete processMap[outName];
      })
      .save(outputPath);

  });
});

// SSE progress
app.get("/api/progress/:filename", (req, res) => {



  const { filename } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // register client
  if (!sseClients[filename]) sseClients[filename] = [];
  sseClients[filename].push(res);



  const sendProgress = () => {
    const pct = progressMap[filename] ?? 0;
    res.write(`data: ${pct}\n\n`);
    if (pct === 0) {
      clearInterval(interval);
      res.end();
    }
    if (pct >= 100) {
      clearInterval(interval);
      res.end();
    }
  };

  const interval = setInterval(sendProgress, 500);



  req.on("close", () => {
    clearInterval(interval);
    sseClients[filename] = sseClients[filename].filter(r => r !== res);
  });
  
});



// Stop endpoint

app.post("/api/stop/:filename", (req, res) => {
  const { filename } = req.params;
  const proc = processMap[filename];
  const filePath = path.join(CONVERTED_DIR, filename);

  if (!proc) return res.status(404).json({ error: "Process not found" });

  proc.on("exit", () => {
    fs.unlink(filePath, (err) => {
      if (err) console.warn("Failed to delete file:", filePath, err);
    });
  });

  proc.kill();


  delete processMap[filename];
  delete progressMap[filename];

  if (filesMeta[filename]) {
    filesMeta[filename].progress = 0;
    filesMeta[filename].completedTime = null;
    saveMeta();
  }

  res.json({ ok: true });
});

// List all files
app.get("/api/files", (req, res) => {
  fs.readdir(CONVERTED_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: err.message });

    const list = files.map((filename) => {
      const stats = fs.statSync(path.join(CONVERTED_DIR, filename));
      const meta = filesMeta[filename] || {};
      return {
        originalName: meta.originalName || filename.replace(/-\d+\.\w+$/, ".mp4"),
        convertedName: filename,
        convertedUrl: `/converted/${filename}`,
        size: stats.size,
        uploadedAt: meta.uploadedAt || stats.mtime,
        startTime: meta.startTime ?? null,
        completedTime: meta.completedTime ?? null,
        elapsed: meta.elapsed ?? null,
        duration: meta.duration ?? null,
        ratio: meta.ratio ?? null,
        progress: meta.progress ?? (progressMap[filename] ?? 0),
        metaData: meta.sampleMetaFile,
      };
    });

    res.json(list);
  });
});

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';

  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(2)} ${units[i]}`;
}

function formatDurationPretty(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  let result = '';
  if (hrs > 0) result += `${hrs} h `;
  if (mins > 0) result += `${mins} min `;
  if (secs > 0) result += `${secs} s`;

  return result.trim();
}

function calculateBitsPixelFrame(videoStream, format) {
  if (!videoStream.bit_rate || !videoStream.avg_frame_rate || !videoStream.width || !videoStream.height) {
    return "N/A";
  }

  const [num, den] = videoStream.avg_frame_rate.split("/").map(Number);
  const frameRate = den ? num / den : num;
  const bitrate = parseInt(format.bit_rate, 10); // in bps
  const width = videoStream.width;
  const height = videoStream.height;

  const bitsPerPixelFrame = bitrate / (frameRate * width * height);
  return bitsPerPixelFrame.toFixed(4); // usually shown with 4 decimals
}

// Extract metadata endpoint
app.post("/api/metadata", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const filePath = req.file.path;

  ffmpeg.ffprobe(filePath, (err, metadata) => {
    if (err) {
      fs.unlink(filePath, () => {});
      return res.status(500).json({ error: "Failed to read metadata" });
    }

    const format = metadata.format || {};
    const streams = metadata.streams || [];

    const videoStream = streams.find((s) => s.codec_type === "video");
    const audioStreams = streams.filter((s) => s.codec_type === "audio");
    const textStreams = streams.filter((s) => s.codec_type === "subtitle");

    // --- Build Report ---
    const report = buildReport(filePath, format, streams, req.file.size)

    // Save to file
    fs.writeFileSync("example.txt", report);
    console.log("example.txt created");

    // Send JSON response too
    const result = {
      videoStream,
      duration: parseFloat(format.duration / 60).toFixed(0),
      filename: req.file.originalname,
      videoCodec: videoStream?.codec_long_name || "unknown",
      audioCodec: audioStreams.map((a) => a.codec_long_name || "unknown"),
      subtitles: textStreams.map((t) => t.codec_name || "unknown"),
      frameRate: videoStream ? `${eval(videoStream.avg_frame_rate)} fps` : null,
      resolution: videoStream
        ? `${videoStream.width}x${videoStream.height}`
        : null,
      size: formatFileSize(req.file.size),
      all: metadata,
      metaData: report,
    };

    fs.unlink(filePath, () => {}); // optional cleanup
    res.json(result);
  });
});


app.get("/api/presets", (req, res) => {
  fs.readFile(presetsFile, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading presets.json:", err);
      return res.status(500).json({ error: "Failed to load presets" });
    }
    try {
      const presets = JSON.parse(data);
      res.json(presets);
    } catch (parseErr) {
      console.error("Invalid JSON in presets.json:", parseErr);
      res.status(500).json({ error: "Invalid presets format" });
    }
  });
});

function buildReport(filePath, format, streams, fileSize) {
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStreams = streams.filter((s) => s.codec_type === "audio");
  const textStreams = streams.filter((s) => s.codec_type === "subtitle");

  const overallBitrateKbps = format.bit_rate
    ? (format.bit_rate / 1000).toFixed(2)
    : "Unknown";
  const bitrateMode = format.bit_rate ? "Variable" : "Unknown";

  // CABAC check
  let cabac = "N/A";
  if (videoStream?.codec_name === "h264") {
    cabac =
      videoStream.profile &&
      videoStream.profile.toLowerCase().includes("baseline")
        ? "No"
        : "Yes";
  }

  const lossyCodecs = ["h264", "hevc", "vp9", "av1", "mpeg4", "aac", "mp3"];

  let scanOrder = "Unknown";
  if (videoStream?.field_order === "tt") scanOrder = "Top Field First";
  if (videoStream?.field_order === "bb") scanOrder = "Bottom Field First";

  // --- Build Report ---
  let report = `General
Complete name                            : ${filePath}
Format                                   : ${format.format_long_name || "Unknown"}
File size                                : ${formatFileSize(fileSize)}
Duration                                 : ${formatDurationPretty(format.duration)}
Overall bit rate mode                    : ${bitrateMode}
Overall bit rate                         : ${overallBitrateKbps} kbps

Video
Format                                   : ${videoStream?.codec_name || "N/A"}
Format/Info                              : ${videoStream?.codec_long_name || "N/A"}
Format profile                           : ${videoStream?.profile || "N/A"}
Format settings, CABAC                   : ${cabac}
Width                                    : ${videoStream?.width || "N/A"}
Height                                   : ${videoStream?.height || "N/A"}
Frame rate                               : ${videoStream?.r_frame_rate || "N/A"}
Scan order                               : ${scanOrder}
Bits/(Pixel*Frame)                       : ${calculateBitsPixelFrame(videoStream, format)}

`;

  // Audio
  audioStreams.forEach((a, idx) => {
    report += `Audio #${idx + 1}
Format                                   : ${a.codec_name || "N/A"}
Format/Info                              : ${a.codec_long_name || "N/A"}
Duration                                 : ${formatDurationPretty(a.duration || format.duration)}
Compression mode                         : ${lossyCodecs.includes(a.codec_name) ? "Lossy" : "Lossless"}
Channel(s)                               : ${a.channels || "N/A"}
Sampling rate                            : ${a.sample_rate || "N/A"}

`;
  });

  // Subtitles
  textStreams.forEach((t, idx) => {
    report += `Text #${idx + 1}
Format                                   : ${t.codec_name || "N/A"}
Language                                 : ${t.tags?.language || "und"}

`;
  });

  return report;
}



// const PORT = process.env.PORT || 3001;
// app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
const PORT = process.env.PORT || 3001;
// ❌ Wrong: app.listen(PORT, ...)
server.listen(PORT, () => {
  console.log(`Server + Socket.IO running on http://localhost:${PORT}`);
});
