// gpuDetect.js (NVIDIA-only version)
const { execSync } = require("child_process");

let gpuBusy = new Map(); // Track busy GPUs

/**
 * Detect NVIDIA GPUs only (via nvidia-smi)
 */
function listGPUs() {
  try {
    const gpus = [];

    const output = execSync(
      'nvidia-smi --query-gpu=index,name --format=csv,noheader'
    )
      .toString()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of output) {
      const [id, name] = line.split(",").map((s) => s.trim());
      gpus.push({
        id: Number(id),
        name,
        vendor: "nvidia",
      });
    }

    if (gpus.length === 0) {
      console.log("⚠️ No NVIDIA GPUs detected");
    } else {
      console.log("🧠 Detected NVIDIA GPUs:", gpus);
    }

    return gpus;
  } catch (err) {
    console.error("❌ Failed to detect NVIDIA GPUs:", err.message);
    return [];
  }
}

/**
 * Detect primary GPU vendor (always NVIDIA if found)
 */
function detectGPUVendor() {
  const gpus = listGPUs();
  return gpus.length > 0 ? "nvidia" : "unknown";
}

/**
 * GPU reservation map
 */
function reserveGpu(id) {
  gpuBusy.set(id, true);
}

function releaseGpu(id) {
  gpuBusy.set(id, false);
}

function isGpuFree(id) {
  return !gpuBusy.get(id);
}

/**
 * Select an available NVIDIA GPU
 * Round-robin auto scheduling
 */
async function waitForFreeGpu() {
  const gpus = listGPUs();
  if (gpus.length === 0) {
    return { id: 0, name: "NO_GPU", vendor: "unknown" };
  }

  while (true) {
    for (const gpu of gpus) {
      if (isGpuFree(gpu.id)) {
        reserveGpu(gpu.id);
        console.log(`🎬 Reserved GPU ${gpu.id}: ${gpu.name}`);
        return gpu;
      }
    }

    console.log("⏳ All GPUs busy (NVIDIA), retrying in 3s...");
    await new Promise((r) => setTimeout(r, 3000));
  }
}

module.exports = {
  listGPUs,
  detectGPUVendor,
  waitForFreeGpu,
  reserveGpu,
  releaseGpu,
};
