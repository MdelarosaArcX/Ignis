const chokidar = require("chokidar");
const fs = require("fs");
const path = require("path");
const ffmpegService = require("./ffmpegService");
const paths = require("../config/paths");
const { broadcastFileUpdate } = require("./fileEvents");
const { saveMeta, filesMeta } = require("./fileService");
const { formatDate } = require("../utils/formatters");
const { exec } = require("child_process");
const { execSync } = require("child_process");

let watchers = [];

/** ✅ Read all watchfolders from hotfiles.json */
function getHotfolders() {
  try {
    if (!fs.existsSync(paths.HOTFILES_JSON)) return {};
    const data = fs.readFileSync(paths.HOTFILES_JSON, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("❌ Failed to read hotfiles.json:", err);
    return {};
  }
}

/** ✅ Checks if file is locked or still being written */
function isFileLocked(filePath) {
  try {
    const fd = fs.openSync(filePath, "r+");
    fs.closeSync(fd);
    return false;
  } catch (err) {
    if (["EBUSY", "EPERM", "EACCES"].includes(err.code)) return true;
    return false;
  }
}

/** ✅ Wait until file is stable (not changing and not locked) */
async function waitForFileReady(filePath, rate = 5) {
  return new Promise((resolve) => {
    let lastSize = 0;
    let stableCount = 0;

    const interval = rate * 1000;

    const check = () => {
      if (!fs.existsSync(filePath)) return resolve(false);
      try {
        const stats = fs.statSync(filePath);
        const size = stats.size;
        const locked = isFileLocked(filePath);

        if (locked || size !== lastSize) {
          stableCount = 0;
        } else {
          stableCount++;
        }

        lastSize = size;

        if (stableCount >= 2 && !locked) return resolve(true);
        setTimeout(check, interval);
      } catch {
        setTimeout(check, interval);
      }
    };

    setTimeout(check, interval);
  });
}

// ✅ Ensure hidden .processing folder exists per watch folder
function ensureHiddenProcessingFolder(watchFolder) {
  const processingDir = path.join(watchFolder, ".processing");
  if (!fs.existsSync(processingDir)) {
    fs.mkdirSync(processingDir, { recursive: true });
    // Hide it (Windows only)
    if (process.platform === "win32") {
      execSync(`attrib +R +S +H "${processingDir}"`);
      console.log(`📁 Created hidden folder: ${processingDir}`);
    }
  }
  return processingDir;
}

/** ✅ Prepare metadata and queue file for transcoding */
async function handleFile(filePath, folderConfig) {
  const { outputFolder, errorFolder, transcodeSetting, watchFolder } =
    folderConfig;
  const fileName = path.basename(filePath);
  const baseName = path.parse(fileName).name;
  const ext =
    transcodeSetting?.outputFormat && transcodeSetting.outputFormat !== ""
      ? transcodeSetting.outputFormat === "mpegts"
        ? "ts"
        : transcodeSetting.outputFormat
      : path.extname(fileName).slice(1) || "mp4";

  // Wait until file exists and is stable
  const ready = await waitForFileReady(filePath, 1); // check every 1 sec
  if (!ready) {
    console.warn(`⚠️ File not ready or missing: ${filePath}`);
    return;
  }

  // Generate unique safeKey
  let nextId = 1;
  const existingIds = Object.values(filesMeta)
    .map((f) => parseInt(f.numericId))
    .filter((n) => !isNaN(n));
  if (existingIds.length > 0) nextId = Math.max(...existingIds) + 1;
  let safeKey = `file_${nextId}`;

  console.log(
    `🔑 [${path.basename(watchFolder)}] safeKey for ${fileName}: ${safeKey}`
  );

  const existingMeta = filesMeta[safeKey];
  if (existingMeta) {
    const status = existingMeta.status;
    if (["error", "pending"].includes(status)) {
      const oldOut = existingMeta.output?.url;
      if (oldOut && fs.existsSync(oldOut)) fs.unlinkSync(oldOut);
    } else if (status === "completed") {
      let counter = 1;
      let newKey = `${safeKey}(${counter})`;
      while (filesMeta[newKey]) counter++, (newKey = `${safeKey}(${counter})`);
      safeKey = newKey;
    } else if (["queued", "processing"].includes(status)) {
      console.log(`⏭️ Skipping ${fileName} (already ${status})`);
      return;
    }
  }

  // Determine output filename
  let outputFileName = `${baseName}.${ext}`;
  let outputPath = path.join(outputFolder, outputFileName);
  let counter = 1;
  while (fs.existsSync(outputPath)) {
    outputFileName = `${baseName}(${counter}).${ext}`;
    outputPath = path.join(outputFolder, outputFileName);
    counter++;
  }

  // Create metadata folder
  const outputMetaDir = path.join(outputFolder, "metadata");
  fs.mkdirSync(outputMetaDir, { recursive: true });
  const outputMetaFile = path.join(
    outputMetaDir,
    `${path.parse(outputFileName).name}.txt`
  );

  // Save metadata
  filesMeta[safeKey] = {
    id: safeKey,
    numericId: nextId,
    sourceFolderId: path.basename(watchFolder),
    uploadedAt: new Date().toISOString(),
    input: { fileName, url: filePath },
    output: {
      fileName: outputFileName,
      url: outputPath,
      metaDataUrl: outputMetaFile,
      metaDataName: path.basename(outputMetaFile),
    },
    startTime: formatDate(Date.now()),
    completedTime: "-",
    elapsed: "",
    ratio: "Queued",
    progress: 0,
    status: "queued",
    priority: 3,
    settings: transcodeSetting,
  };
  saveMeta();

  // --- Make unique temporary filename with timestamp ---
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");

  // Step 1: rename in-place in input folder
  const tempInputFile = path.join(
    path.dirname(filePath),
    `${baseName}_tmp_${timestamp}${path.extname(fileName)}`
  );

  try {
    fs.renameSync(filePath, tempInputFile);
  } catch (err) {
    console.error(
      "❌ Failed to rename input file to temporary name:",
      err.message
    );
    return;
  }

  // Step 2: move to hidden .processing folder
  const processingDir = ensureHiddenProcessingFolder(watchFolder);
  const finalPath = path.join(processingDir, path.basename(tempInputFile));

  try {
    fs.renameSync(tempInputFile, finalPath);
    console.log(`🚚 Moved to hidden folder: ${finalPath}`);
  } catch (err) {
    console.error("❌ Failed to move file to hidden folder:", err.message);
    return;
  }

  // Update path for FFmpeg
  const originalPath = filePath;
  filePath = finalPath;

  // Queue FFmpeg job
  await ffmpegService.enqueueHotfolderJob({
    id: safeKey,
    input: filePath,
    originalInput: originalPath,
    output: outputPath,
    settings: transcodeSetting,
    errorFolder,
  });
}

/** ✅ Process existing files when server starts */
async function processExistingFiles(folderConfig) {
  const { watchFolder, watchdogRate } = folderConfig;
  if (!fs.existsSync(watchFolder)) return;
  const files = fs
    .readdirSync(watchFolder)
    .filter((f) => /\.(mp4|mov|avi|mkv|ts)$/i.test(f))
    .map((f) => path.join(watchFolder, f));

  if (files.length > 0)
    console.log(`📂 Found ${files.length} existing files in ${watchFolder}`);

  for (const file of files) {
    await waitForFileReady(file, watchdogRate);
    await handleFile(file, folderConfig);
  }
}

/** ✅ Start watchers for all hotfolders */
function startWatching() {
  const hotfolders = getHotfolders();

  watchers.forEach((w) => w.close());
  watchers = [];

  Object.entries(hotfolders).forEach(([id, folder]) => {
    const { watchFolder, watchdogRate } = folder;
    if (!watchFolder || !fs.existsSync(watchFolder)) {
      console.warn(`⚠️ Watch folder not found: ${watchFolder}`);
      return;
    }

    console.log(`👁️ Watching folder ${id}: ${watchFolder}`);

    // Watcher setup
    const watcher = chokidar.watch(watchFolder, {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: false,
    });

    watcher.on("add", async (filePath) => {
      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase();

      // Ignore temp files already created by our renaming
      if (fileName.includes("_tmp_")) return;

      // Only watch video files
      if (!/\.(mp4|mov|avi|mkv|ts)$/i.test(ext)) return;

      console.log(`📥 [${id}] Detected new file: ${fileName}`);

      // Wait until file is stable on disk
      const ready = await waitForFileReady(filePath, watchdogRate);
      if (!ready) {
        console.warn(`⚠️ File not ready or missing: ${filePath}`);
        return;
      }

      await handleFile(filePath, folder);
      broadcastFileUpdate(`new-file:${fileName}`);

      // const fileName = path.basename(filePath);
      // const ext = path.extname(fileName).toLowerCase();
      // if (!/\.(mp4|mov|avi|mkv|ts)$/i.test(ext)) return;

      // console.log(`📥 [${id}] Detected new file: ${fileName}`);
      // await waitForFileReady(filePath, watchdogRate);
      // await handleFile(filePath, folder);
      // broadcastFileUpdate(`new-file:${fileName}`);
    });

    watcher.on("error", (err) =>
      console.error(`❌ Watchfolder ${id} error:`, err)
    );

    watchers.push(watcher);

    // Also handle files already in the folder at startup
    processExistingFiles(folder);
  });
}

/** ✅ Reload watchers when hotfiles.json changes */
// fs.watchFile(paths.HOTFILES_JSON, { interval: 2000 }, () => {
//   console.log("🔄 hotfiles.json changed — reloading watchers...");
//   startWatching();
// });

// ✅ Auto-reload watchers when hotfiles.json changes
// fs.watchFile(paths.HOTFILES_JSON, { interval: 2000 }, (curr, prev) => {
//   if (curr.mtime !== prev.mtime) {
//     console.log("🔄 hotfiles.json changed — reloading watchers...");
//     startWatching(); // re-reads latest transcodeSetting, GPU/CPU etc.
//   }
// });
const configWatcher = chokidar.watch(paths.HOTFILES_JSON, { ignoreInitial: true });
configWatcher.on("change", () => {
  console.log("🔁 hotfiles.json updated — reloading watchers...");
  startWatching();
});

/** ✅ Export for use in server.js */
module.exports = { startWatching };
