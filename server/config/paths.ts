// server/config/paths.js
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");

// 🔹 Base folders
const TRANSCODE_DIR = path.join(ROOT, "transcoded");
const INPUT_DIR = path.join(TRANSCODE_DIR, "input");
const HOTFOLDER_DIR = path.join(ROOT, "hotfolder");

// ✅ Load dynamic settings
const SETTINGS_PATH = path.join(ROOT, "settings.json");
let userSettings: any = {};
try {
  if (fs.existsSync(SETTINGS_PATH)) {
    userSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } else {
    console.warn("⚠️ settings.json not found, using default output folder");
  }
} catch (err) {
  console.error("❌ Failed to read settings.json:", err.message);
  userSettings = {};
}

// ✅ Determine dynamic output path (fallback to default)
const OUTPUT_DIR =
  userSettings.outputPath && userSettings.outputPath.trim() !== ""
    ? path.resolve(userSettings.outputPath)
    : path.join(TRANSCODE_DIR, "output");

// ✅ Ensure output and metadata folders exist
try {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUTPUT_DIR, "metadata"), { recursive: true });
  console.log(`📁 Using output folder: ${OUTPUT_DIR}`);
} catch (err) {
  console.error("❌ Failed to create output folder:", err.message);
}

// ✅ Derived paths
const INPUT_METADATA_DIR = path.join(INPUT_DIR, "metadata");
const OUTPUT_METADATA_DIR = path.join(OUTPUT_DIR, "metadata");

// ✅ Add this line:
const UPLOADS_DIR = path.join(ROOT, "uploads");

const FILES_JSON = path.join(ROOT, "files.json");
const HOTFILES_JSON = path.join(ROOT, "hotfiles.json");

// 🔹 Default watch folder (for hotfolder.js)
let WATCH_FOLDER = path.join(HOTFOLDER_DIR); // watch input folder by default

function setWatchFolder(newPath) {
  WATCH_FOLDER = newPath;
}

function getWatchFolder() {
  return WATCH_FOLDER;
}

const allowedFormats = ["mp4", "avi", "mov", "mkv", "webm", "ts", "mpegts"];

module.exports = {
  ROOT,
  TRANSCODE_DIR,
  INPUT_DIR,
  OUTPUT_DIR,
  INPUT_METADATA_DIR,
  OUTPUT_METADATA_DIR,
  UPLOADS_DIR,
  FILES_JSON,
  HOTFILES_JSON,
  allowedFormats,
  getWatchFolder,
  setWatchFolder,
};
