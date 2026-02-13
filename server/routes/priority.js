const express = require("express");
const { saveMeta, filesMeta } = require("../services/fileService");
const { sortQueue, pendingQueue, saveQueue } = require("../services/ffmpegService"); // ⬅️ import these

const router = express.Router();

/**
 * Update job priority (affects queue too)
 */
router.post("/priority/:id", (req, res) => {
  try {
    const { id } = req.params; // id = output file name like "video.mp4"
    console.log('id');
    console.log(id);
    const { priority } = req.body;

    const newPriority = Number(priority);
    if (isNaN(newPriority)) {
      return res.status(400).json({ error: "Invalid priority value" });
    }

    // 🔍 Find the meta key by output file name
    const metaKey = Object.keys(filesMeta).find(
      (k) => filesMeta[k]?.id === id
    );

    if (!metaKey) {
      console.warn(`⚠️ No meta found for output file: ${id}`);
      return res.status(404).json({ error: "Job not found" });
    }

    // ✅ Update meta priority
    filesMeta[metaKey].priority = newPriority;
    saveMeta();

    // ✅ Update pending queue (if present)
    const queuedJob = pendingQueue.find((q) => q.key === metaKey);
    if (queuedJob) {
      queuedJob.priority = newPriority;
      sortQueue();
      saveQueue();
    }

    console.log(`🔁 Priority updated for ${id} (metaKey: ${metaKey}) → ${newPriority}`);
    res.json({ ok: true, id: id, priority: newPriority });
  } catch (err) {
    console.error("Failed to update priority:", err.message);
    res.status(500).json({ error: "Failed to update priority" });
  }
});


module.exports = router;
