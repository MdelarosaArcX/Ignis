// routes/hotfiles.js
const express = require("express");
const fs = require("fs");
const paths = require("../config/paths");
const { getHotFiles } = require("../services/hotfolder");

const router = express.Router();

// ✅ GET current hotfolder settings
router.get("/hotfiles", (req, res) => {
  try {
    if (fs.existsSync(paths.HOTFILES_JSON)) {
      const data = JSON.parse(fs.readFileSync(paths.HOTFILES_JSON, "utf-8"));
      return res.json(data);
    } else {
      return res.json({});
    }
  } catch (err) {
    console.error("❌ Failed to read hotfiles.json:", err);
    res.status(500).json({ error: "Failed to read hotfiles.json" });
  }
});

// ✅ POST: save hotfolder settings dynamically
router.post("/hotfiles/save", (req, res) => {
  try {
    const incoming = req.body; // e.g. { "1": { ...data... } }

    let data = {};
    if (fs.existsSync(paths.HOTFILES_JSON)) {
      data = JSON.parse(fs.readFileSync(paths.HOTFILES_JSON, "utf-8"));
    }

    // merge incoming folder into existing
    Object.keys(incoming).forEach((key) => {
      data[key] = incoming[key];
    });

    fs.writeFileSync(paths.HOTFILES_JSON, JSON.stringify(data, null, 2), "utf-8");
    // console.log("✅ Updated hotfiles.json:", data);

    res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Failed to save hotfolder settings:", err);
    res.status(500).json({ error: "Failed to save hotfolder settings" });
  }
});

module.exports = router;
