const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const presetsFile = path.join(__dirname, "..", "presets.json");

router.get("/presets", (req, res) => {
  fs.readFile(presetsFile, "utf8", (err, data) => {
    if (err) return res.status(500).json({ error: "Failed to load presets" });
    try {
      res.json(JSON.parse(data));
    } catch {
      res.status(500).json({ error: "Invalid presets format" });
    }
  });
});

module.exports = router;
