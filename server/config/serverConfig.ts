const os = require("os");

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

const LOCAL_IP = getLocalIp();
const FRONTEND_PORT = process.env.FRONTEND_PORT || 5173;

const FRONTEND_ORIGINS = [
  `http://localhost:${FRONTEND_PORT}`,
  `http://127.0.0.1:${FRONTEND_PORT}`,
  `http://${LOCAL_IP}:${FRONTEND_PORT}`,
];

module.exports = {
  LOCAL_IP,
  FRONTEND_ORIGINS,
};
