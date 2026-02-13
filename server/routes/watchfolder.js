const express = require("express");
const { setWatchFolder, getWatchFolder } = require("../config/paths");
const { restartHotfolder } = require("../services/hotfolder");

module.exports = (io) => {
  const router = express.Router();

  router.get("/watchfolder", (req, res) => {
    res.json({ watchFolder: getWatchFolder() });
  });

  router.post("/watchfolder", (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: "Missing folderPath" });

    setWatchFolder(folderPath);
    restartHotfolder(io);
    res.json({ success: true, watchFolder: folderPath });
  });

  return router;
};
