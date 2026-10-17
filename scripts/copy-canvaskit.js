#!/usr/bin/env node
/**
 * Copies the CanvasKit WASM binary that React Native Skia needs on web into `public/`
 * so that Expo's web server / static export serves it at `/canvaskit.wasm`.
 * Runs automatically via the `postinstall` script.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'node_modules', 'canvaskit-wasm', 'bin', 'full', 'canvaskit.wasm');
const destDir = path.join(root, 'public');
const dest = path.join(destDir, 'canvaskit.wasm');

if (!fs.existsSync(src)) {
  console.warn('[copy-canvaskit] canvaskit.wasm not found at', src);
  process.exit(0);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-canvaskit] copied canvaskit.wasm ->', path.relative(root, dest));
