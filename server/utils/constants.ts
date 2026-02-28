const path = require("path");

const ROOT = path.join(__dirname, "..");

const UPLOADS_DIR = path.join(ROOT, "uploads");
const CONVERTED_DIR = path.join(ROOT, "converted");
const OUTPUT_METADATA_DIR = path.join(ROOT, "output_metadata");
const FILES_JSON = path.join(ROOT, "files.json");

const allowedFormats = ["mp4", "avi", "mov", "mkv", "webm"];

module.exports = {
  ROOT,
  UPLOADS_DIR,
  CONVERTED_DIR,
  OUTPUT_METADATA_DIR,
  FILES_JSON,
  allowedFormats,
};
