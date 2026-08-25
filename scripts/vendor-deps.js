// scripts/vendor-deps.js
//
// Vendors EVERYTHING the extension needs at runtime so nothing is downloaded
// from a third party on first use — the extension is fully self-contained and
// the only network call it ever makes is the Anthropic answer request.
//
//   node scripts/vendor-deps.js
//
// What it fetches:
//   - sql.js (SQLite/WASM)               -> extension/lib/
//   - transformers.js (embeddings lib)   -> extension/lib/
//   - onnxruntime-web WASM backend       -> extension/lib/ort/
//   - the MiniLM embedding model         -> extension/models/Xenova/all-MiniLM-L6-v2/
//
// MV3 forbids loading remote *code*, and we additionally don't want any remote
// *downloads* at runtime, so all of the above live inside the extension. The
// model + runtime are large (~42MB) but committed, so end users just load the
// unpacked extension — no build step, no first-run downloads.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const TF_VERSION = '2.17.2';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/@xenova/transformers@${TF_VERSION}/dist/`;
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/`;
const MODEL_DIR = `extension/models/${MODEL_ID}`;

const files = [
  // Core libraries
  { url: 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js', out: 'extension/lib/sql-wasm.js' },
  { url: 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.wasm', out: 'extension/lib/sql-wasm.wasm' },
  { url: `${ORT_BASE}transformers.min.js`, out: 'extension/lib/transformers.min.js' },

  // onnxruntime-web WASM backend (single-threaded SIMD + non-SIMD fallback).
  // We run onnx with numThreads=1, so the threaded builds are never requested.
  { url: `${ORT_BASE}ort-wasm-simd.wasm`, out: 'extension/lib/ort/ort-wasm-simd.wasm' },
  { url: `${ORT_BASE}ort-wasm.wasm`, out: 'extension/lib/ort/ort-wasm.wasm' },

  // MiniLM model files (quantized ONNX + tokenizer/config). Loaded locally so
  // the first embedding does not hit HuggingFace.
  { url: `${HF_BASE}config.json`, out: `${MODEL_DIR}/config.json` },
  { url: `${HF_BASE}tokenizer.json`, out: `${MODEL_DIR}/tokenizer.json` },
  { url: `${HF_BASE}tokenizer_config.json`, out: `${MODEL_DIR}/tokenizer_config.json` },
  { url: `${HF_BASE}special_tokens_map.json`, out: `${MODEL_DIR}/special_tokens_map.json` },
  { url: `${HF_BASE}onnx/model_quantized.onnx`, out: `${MODEL_DIR}/onnx/model_quantized.onnx` }
];

for (const { url, out } of files) {
  console.log(`Fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, buf);
  console.log(`  -> ${out} (${buf.length} bytes)`);
}

// sql.js ships a UMD build meant to be loaded as a classic script. Our MV3
// background worker is a `type: module` service worker that does
// `import initSqlJs from './sql-wasm.js'`, so we have to make the UMD file a
// valid ES module. Two edits are needed:
//   1. Add a real default export so the import resolves.
//   2. ES modules run in strict mode, where the bundle's bare
//      `module = undefined;` assignment throws "module is not defined".
//      Declaring it with `var` keeps sql.js's intent (module stays undefined so
//      emscripten won't clobber the export) while being strict-mode safe.
const SQL_JS = 'extension/lib/sql-wasm.js';
let sqlSrc = await readFile(SQL_JS, 'utf8');
if (!sqlSrc.includes('var module = undefined;')) {
  sqlSrc = sqlSrc.replace('module = undefined;', 'var module = undefined;');
}
if (!sqlSrc.includes('export default initSqlJs;')) {
  sqlSrc += '\n// --- Added by vendor-deps.js: expose ESM default export for MV3 module workers ---\nexport default initSqlJs;\n';
}
await writeFile(SQL_JS, sqlSrc);
console.log(`Patched ${SQL_JS} for ESM (default export + strict-mode-safe module).`);

console.log('Done. The extension is fully self-contained — no runtime downloads.');
