// @ts-nocheck
// utils/cleanInputs.js
const fs = require("fs");
const path = require("path");
const { filesMeta } = require("../services/fileService");
const { UPLOADS_DIR, INPUT_DIR } = require("../config/paths");

/**
 * 🧹 Generic cleaner for a given directory
 */
function cleanDirectory(dirName, label) {
  try {
    if (!fs.existsSync(dirName)) return { deletedCount: 0, deleted: [] };

    const allFiles = fs.readdirSync(dirName);
    const tracked = Object.entries(filesMeta).map(([key, meta]) => ({
      fileName: path.basename(meta.input?.url || ""),
      status: meta.status || "unknown",
    }));

    const trackedNames = tracked.map((t) => t.fileName);
    let deleted = [];

    for (const file of allFiles) {
      const filePath = path.join(dirName, file);

      const trackedEntry = tracked.find((t) => t.fileName === file);
      const isTracked = !!trackedEntry;
      const isIdle = trackedEntry?.status === "idle";

      // 🧠 Delete if file not tracked OR tracked but idle
      if (!isTracked || isIdle) {
        try {
          fs.unlinkSync(filePath);
          deleted.push(file);
          console.log(`🧹 [${label}] Deleted: ${file} (${isTracked ? "idle" : "orphan"})`);
        } catch (err) {
          console.warn(`⚠️ [${label}] Failed to delete ${file}:`, err.message);
        }
      }
    }

    console.log(`🧽 [${label}] Cleanup complete — deleted ${deleted.length} file(s).`);
    return { deletedCount: deleted.length, deleted };
  } catch (err) {
    console.error(`❌ [${label}] Cleanup failed:`, err);
    return { error: err.message };
  }
}

/**
 * 🧹 Clean orphaned files in uploads directory
 */
function cleanOrphanedUploads() {
  return cleanDirectory(UPLOADS_DIR, "Uploads");
}

/**
 * 🧹 Clean orphaned files in input directory
 */
function cleanOrphanedInputs() {
  return cleanDirectory(INPUT_DIR, "Inputs");
}

module.exports = {
  cleanOrphanedUploads,
  cleanOrphanedInputs,
};
