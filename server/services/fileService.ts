// services/fileService.js
const fs = require("fs");
const path = require("path");
const { OUTPUT_DIR, FILES_JSON } = require("../config/paths");
const {
  formatFileSize,
  formatDurationPretty,
  calculateBitsPixelFrame,
} = require("../utils/formatters");

let filesMeta = {};
if (fs.existsSync(FILES_JSON)) {
  try {
    filesMeta = JSON.parse(fs.readFileSync(FILES_JSON, "utf-8"));
  } catch (e) {
    console.error("⚠️ Failed to parse files.json:", e.message);
    filesMeta = {};
  }
}

function saveMeta() {
  try {
    fs.writeFileSync(FILES_JSON, JSON.stringify(filesMeta, null, 2));
  } catch (err) {
    console.error("⚠️ Failed to save files.json:", err.message);
  }
}

/**
 * 🧹 Clean invalid or empty metadata entries
 */
// function cleanInvalidMeta() {
//   let removed = 0;
//   for (const key of Object.keys(filesMeta)) {
//     const entry = filesMeta[key];
//     if (
//       !entry ||
//       !entry.id ||
//       !entry.input ||
//       Object.keys(entry.input).length === 0 ||
//       !entry.output ||
//       Object.keys(entry.output).length === 0
//     ) {
//       delete filesMeta[key];
//       removed++;
//     }
//   }
//   if (removed > 0) {
//     console.log(`🧹 Removed ${removed} invalid entries from filesMeta`);
//     saveMeta();
//   }
// }

/**
 * GET /api/files
 * Returns list of converted files, excluding invalid entries
 */

function removeAllCompleted(req, res) {
  const meta = Object.values(filesMeta).filter((fileMeta) => fileMeta.status === 'completed');

  try {
    meta.forEach(file => {
        file.status = "done";
    });
    saveMeta();
    res.json({ 'status': 'ok' })
  } catch {
    res.status(500).json({ error: "Failed to list files" });
  }
}

function removeFile(req, res) {
  const meta = Object.values(filesMeta).find((fileMeta) => fileMeta.id === req.body.id);
  try {
    console.log(meta.id);
    meta.status = 'done';
    saveMeta();
    res.json({ 'status': 'ok' })
  } catch {
    res.status(500).json({ error: "Failed to list files" });
  }
}

function handleListFiles(req, res) {
  try {
    // 🧹 Clean invalid entries first
    // cleanInvalidMeta();

    const list = Object.values(filesMeta)
      .filter((meta) => meta && meta.id && meta.status !== 'idle' && meta.status !== 'done')
      .map((meta) => ({
        id: meta.id,
        uploadedAt: meta.uploadedAt,
        input: meta.input || {},
        output: meta.output || {},
        startTime: meta.startTime,
        completedTime: meta.completedTime,
        elapsed: meta.elapsed,
        ratio: meta.ratio,
        progress: meta.progress ?? 0,
        convertedName: meta.convertedName,
        convertedUrl: meta.convertedUrl,
        duration: meta.duration,
        priority: meta.priority ?? 3,
        settings: meta.settings,
        status: meta.status || inferStatus(meta),
      }));

    // Sort: queued/processing first, then completed (by date desc)
    list.sort((a, b) => {
      const order = ["processing", "queued", "completed"];
      const idxA = order.indexOf(a.status);
      const idxB = order.indexOf(b.status);
      if (idxA !== idxB) return idxA - idxB;
      const timeA = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const timeB = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return timeB - timeA;
    });

    res.json(list);
  } catch (err) {
    console.error("Failed to list files:", err);
    res.status(500).json({ error: "Failed to list files" });
  }
}

/**
 * Infer a status if missing
 */
function inferStatus(meta) {
  if (meta.progress && meta.progress < 100) return "processing";
  if (meta.output?.fileName && fs.existsSync(path.join(OUTPUT_DIR, meta.output.fileName)))
    return "completed";
  return meta.status || "queued";
}


/**
 * Build metadata report file (.txt)
 */
function buildReport(filePath, format, streams, fileSize) {
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStreams = streams.filter((s) => s.codec_type === "audio");
  const textStreams = streams.filter((s) => s.codec_type === "subtitle");

  const overallBitrateKbps = format.bit_rate
    ? (format.bit_rate / 1000).toFixed(2)
    : "Unknown";
  const bitrateMode = format.bit_rate ? "Variable" : "Unknown";

  let cabac = "N/A";
  if (videoStream?.codec_name === "h264") {
    cabac = videoStream.profile?.toLowerCase().includes("baseline")
      ? "No"
      : "Yes";
  }

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
Bits/(Pixel*Frame)                       : ${calculateBitsPixelFrame(videoStream, format)}

`;

  audioStreams.forEach((a, idx) => {
    report += `Audio #${idx + 1}
Format                                   : ${a.codec_name || "N/A"}
Format/Info                              : ${a.codec_long_name || "N/A"}
Duration                                 : ${formatDurationPretty(
      a.duration || format.duration
    )}
Channel(s)                               : ${a.channels || "N/A"}
Sampling rate                            : ${a.sample_rate || "N/A"}

`;
  });

  textStreams.forEach((t, idx) => {
    report += `Text #${idx + 1}
Format                                   : ${t.codec_name || "N/A"}
Language                                 : ${t.tags?.language || "und"}

`;
  });

  return report;
}

module.exports = { saveMeta, filesMeta, handleListFiles, buildReport, removeFile, removeAllCompleted };
