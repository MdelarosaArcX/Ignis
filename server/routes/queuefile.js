const express = require("express");
const path = require("path");
const fs = require("fs");
const { filesMeta, saveMeta } = require("../services/fileService");
const { INPUT_DIR } = require("../config/paths");

const router = express.Router();

router.post("/queuefile", (req, res) => {
  const { filename, size, key, settings } = req.body;
  if (!filename || !key) return res.status(400).json({ error: "Missing filename or key" });

  const safeKey = key.toLowerCase();
  const existing = filesMeta[safeKey];

  // Prevent duplicate queue entries
  if (existing && ["queued", "processing"].includes(existing.status)) {
    return res.json({ message: "Already queued", key: safeKey });
  }

  const meta = filesMeta[safeKey] || {
    id: safeKey,
    uploadedAt: new Date().toISOString(),
    input: {
      fileName: filename,
      url: path.join(INPUT_DIR, filename),
      metaData: null,
      size,
    },
    output: {},
    progress: 0,
  };

  meta.status = "queued";
  meta.settings = settings || {};
  saveMeta();

  console.log(`📥 Queued large file for later transcode: ${filename}`);
  res.json({ message: "File queued successfully", key: safeKey });
});

module.exports = router;
