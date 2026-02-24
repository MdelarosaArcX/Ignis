const express = require("express");
const { handleListFiles, removeFile, removeAllCompleted } = require("../services/fileService");

const router = express.Router();
router.get("/files", handleListFiles);
router.post("/removeData", removeFile);
router.post("/removeAllCompleted", removeAllCompleted);

module.exports = router;
