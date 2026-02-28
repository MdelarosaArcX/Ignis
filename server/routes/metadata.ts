const express = require("express");
const multer = require("multer");
const { UPLOADS_DIR } = require("../utils/constants");
const { handleMetadata } = require("../services/ffmpegService");

const router = express.Router();
const upload = multer({ dest: UPLOADS_DIR });

router.post("/metadata", upload.single("video"), handleMetadata);

module.exports = router;
