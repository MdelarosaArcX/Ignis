const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

// const { initHotfolder } = require("./services/hotfolder");
const convertRoutes = require("./routes/convert");
const metadataRoutes = require("./routes/metadata");
const fileRoutes = require("./routes/files");
const { filesMeta } = require("./services/fileService");
const presetsRoutes = require("./routes/presets");
const healthRoutes = require("./routes/health");
const hotfilesRoutes = require("./routes/hotfiles");


const {
  UPLOADS_DIR,
  INPUT_DIR,
  OUTPUT_DIR,
  INPUT_METADATA_DIR,
  OUTPUT_METADATA_DIR,
  TRANSCODE_DIR,
} = require("./config/paths");
const queuefileRoutes = require("./routes/queuefile");
const priorityRoutes = require("./routes/priority");
const uploadRoutes = require("./routes/uploads");
const { startWatching } = require("./services/watchHotfolder");
const fileUpdateClients = [];
const {
  cleanOrphanedUploads,
  cleanOrphanedInputs,
} = require("./utils/cleanInputs");
const { registerSSE } = require("./services/fileEvents");
const { LOCAL_IP, FRONTEND_ORIGINS } = require("./config/serverConfig");

const hotfilesPath = path.join(__dirname, "./hotfiles.json");

let hotfilesConfig = JSON.parse(fs.readFileSync(hotfilesPath, "utf8"));

// ---------------------------------------------------------
// ⭐ ADD THIS: Get this server's local IP address
// ---------------------------------------------------------
// function getLocalIp() {
//   const interfaces = os.networkInterfaces();
//   for (const name in interfaces) {
//     const ifaceList = interfaces[name];
//     if (!ifaceList) continue;

//     for (const iface of ifaceList) {
//       if (iface.family === "IPv4" && !iface.internal) {
//         return iface.address;  // e.g., "10.0.0.31"
//       }
//     }
//   }
//   return "127.0.0.1";
// }
// const localIp = getLocalIp();
console.log("📡 Local server IP detected:", LOCAL_IP);
const app = express();
// app.use(cors({
//   origin: FRONTEND_ORIGIN,
//   credentials: true,
//   methods: ["GET", "POST", "OPTIONS"],
//   allowedHeaders: ["Content-Type"],
// }));

app.use(
  cors({
    origin: function (origin, callback) {
      // allow server-to-server & curl
      if (!origin) return callback(null, true);

      if (FRONTEND_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      console.warn("❌ Blocked CORS origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(morgan("dev"));
app.use(express.json());
app.get("/api/file-updates/", registerSSE);

// // ensure folders exist
// [UPLOADS_DIR, INPUT_DIR, OUTPUT_DIR, OUTPUT_METADATA_DIR, INPUT_METADATA_DIR, TRANSCODE_DIR].forEach((d) =>
//   fs.mkdirSync(d, { recursive: true })
// );
[
  UPLOADS_DIR,
  INPUT_DIR,
  OUTPUT_DIR,
  OUTPUT_METADATA_DIR,
  INPUT_METADATA_DIR,
  TRANSCODE_DIR,
].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// routes
app.use("/api", healthRoutes);
app.use("/api", convertRoutes);
app.use("/api", metadataRoutes);
app.use("/api", fileRoutes);
app.use("/api", presetsRoutes);
app.use("/api", hotfilesRoutes);
app.use("/api", queuefileRoutes);
app.use("/api", priorityRoutes);
app.use("/api", uploadRoutes);
const ignisConfig = require("./config/ignisconfig.json");

app.get("/api/config", (req, res) => {
  applyProcessorRulesAndSave();

  res.json(ignisConfig);
  console.log("ignisConfig");
  console.log(ignisConfig);
});
function applyProcessorRulesAndSave() {
  const modeKey = `mode${ignisConfig.systemLoadMode}`;
  const activeMode = ignisConfig.limits[modeKey];

  console.log("Applying CPU/GPU rules using", modeKey, activeMode);

  Object.keys(hotfilesConfig).forEach((key) => {
    const transcode = hotfilesConfig[key].transcodeSetting;

    if (activeMode.allowGPU === false) {
      transcode.processor = "cpu";
    }

    if (activeMode.allowCPU === false) {
      transcode.processor = "gpu";
    }
  });

  // Write back to disk
  fs.writeFileSync(
    hotfilesPath,
    JSON.stringify(hotfilesConfig, null, 2),
    "utf8"
  );

  console.log("Hotfiles.json updated successfully!");
}

app.use("/transcoded", express.static(TRANSCODE_DIR));
app.use("/transcoded/input", express.static(INPUT_DIR));
app.use("/transcoded/output", express.static(OUTPUT_DIR));

// serve converted files
// app.use("/converted", express.static(CONVERTED_DIR));

// socket.io + hotfolder
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: FRONTEND_ORIGINS } });
// initHotfolder(io);

const watchfolderRoutes = require("./routes/watchfolder")(io);
// ✅ Run cleanup at startup
cleanOrphanedUploads();
cleanOrphanedInputs();

app.use("/api", watchfolderRoutes);
startWatching();

const PORT = process.env.PORT || 3001;
// server.listen(PORT, "0.0.0.0", () =>
//   console.log(`🚀 Server + Socket.IO running at http://${LOCAL_IP}:${PORT}`)
// );

const relativePath = "example.txt";
const fullPath = path.join(__dirname, relativePath);
console.log(fullPath);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
