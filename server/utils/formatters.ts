function formatDate(date) {
  const now = new Date(date);
  const h = now.getHours().toString().padStart(2, "0");
  const m = now.getMinutes().toString().padStart(2, "0");
  const s = now.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(2)} ${units[i]}`;
}

function formatDurationPretty(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  let result = "";
  if (hrs > 0) result += `${hrs} h `;
  if (mins > 0) result += `${mins} min `;
  if (secs > 0) result += `${secs} s`;
  return result.trim();
}

function calculateBitsPixelFrame(videoStream, format) {
  if (!videoStream?.bit_rate || !videoStream.avg_frame_rate || !videoStream.width || !videoStream.height) {
    return "N/A";
  }
  const [num, den] = videoStream.avg_frame_rate.split("/").map(Number);
  const frameRate = den ? num / den : num;
  const bitrate = parseInt(format.bit_rate, 10);
  const { width, height } = videoStream;
  const bppf = bitrate / (frameRate * width * height);
  return bppf.toFixed(4);
}

module.exports = { formatDate, formatFileSize, formatDurationPretty, calculateBitsPixelFrame };
