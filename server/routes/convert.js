const express = require("express");
const multer = require("multer");
const { UPLOADS_DIR } = require("../utils/constants");
const { handleConvert, handleStop, handleProgress, handleEnqueue } = require("../services/ffmpegService");

const router = express.Router();
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 100 * 1024 * 1024 * 1024 } });

router.post("/convert", upload.single("video"), handleConvert);
router.post("/stop/:filename", handleStop);
router.post("/enqueue", handleEnqueue); // 👈 new route
router.get("/progress/:filename", handleProgress);

module.exports = router;
