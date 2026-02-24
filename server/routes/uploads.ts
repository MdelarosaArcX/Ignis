// routes/uploads.js
const express = require("express");
const router = express.Router();
const { cleanOrphanedUploads, cleanOrphanedInputs } = require("../utils/cleanInputs");

/**
 * GET /api/uploads/cleanup
 * Deletes orphan or idle files from UPLOADS_DIR and INPUT_DIR
 */
router.get("/cleanup", (req, res) => {
  try {
    const uploadsResult = cleanOrphanedUploads();
    const inputsResult = cleanOrphanedInputs();

    res.json({
      success: true,
      message: "Cleanup completed successfully.",
      uploads: uploadsResult,
      inputs: inputsResult,
    });
  } catch (err) {
    console.error("❌ Cleanup route failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
