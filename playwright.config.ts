/** Shared settings for the runtime-health suite (tests/e2e/run.mjs). Plain data: no @playwright/test runner is installed. */
export default {
  baseURL: process.env.COSMOS_URL ?? 'http://localhost:5173/',
  viewport: { width: 1280, height: 720 },
  chromePaths: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Users/dhruv/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  ],
  // Same headless GPU flags as tools/shot.mjs.
  gpuArgs: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  lockDir: 'C:/Projects/Cosmos/.work/shot-locks',
  slots: Number(process.env.SHOT_SLOTS ?? 2),
  outDir: '.work/health',
  smokeStops: ['sol:earth', 'sol:moon', 'sol:mars', 'sol:jupiter', 'sol:saturn'],
  travelTimeoutMs: 25000,
  settleMs: 1000,
  perfFrames: 60,
};
