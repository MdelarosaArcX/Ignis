// server/services/fileEvents.js
const clients = [];
const { FRONTEND_ORIGINS } = require("../config/serverConfig");

function registerSSE(req, res) {
  const origin = req.headers.origin;

  // ✅ Dynamically allow known origins ONLY
  if (FRONTEND_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  // ✅ Preflight support (Firefox)
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  res.flushHeaders?.();

  clients.push(res);
  console.log("📡 SSE client connected:", origin);

  req.on("close", () => {
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
    console.log("❌ SSE client disconnected");
  });
}

function broadcastFileUpdate(message = "refresh") {
  clients.forEach((res) => {
    try {
      res.write(`data: ${message}\n\n`);
    } catch (err) {
      console.error("SSE send failed:", err);
    }
  });
}

module.exports = { registerSSE, broadcastFileUpdate };
