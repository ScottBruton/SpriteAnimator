#!/usr/bin/env node
/**
 * react-native-gesture-handler on web calls setPointerCapture during pointermove and expects
 * silent failure; Chromium throws InvalidStateError instead (e.g. timeline keyframe drags).
 * Wrap those calls in try/catch after each install.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(
  root,
  'node_modules',
  'react-native-gesture-handler',
  'lib',
  'module',
  'web',
  'tools',
  'PointerEventManager.js',
);

if (!fs.existsSync(file)) {
  console.warn('[patch-rngh] PointerEventManager.js not found; skip');
  process.exit(0);
}

let src = fs.readFileSync(file, 'utf8');
if (src.includes('/* ess-pointer-capture-guard */')) {
  process.exit(0);
}

const needle = 'target.setPointerCapture(';
if (!src.includes(needle)) {
  console.warn('[patch-rngh] setPointerCapture call not found; skip');
  process.exit(0);
}

src = src.replaceAll(
  /([ \t]*)(target\.setPointerCapture\([^;]+;)/g,
  '$1try { /* ess-pointer-capture-guard */ $2 } catch (_) { /* InvalidStateError on web */ }',
);

fs.writeFileSync(file, src);
console.log('[patch-rngh] wrapped setPointerCapture in try/catch');
