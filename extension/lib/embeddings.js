// lib/embeddings.js
// Generates text embeddings fully on-device using transformers.js with a small
// MiniLM model. The model weights AND the onnxruntime-web WASM backend are
// vendored inside the extension (see scripts/vendor-deps.js), so embedding
// never touches the network — no HuggingFace, no jsDelivr, nothing.

import { pipeline, env } from './transformers.min.js'; // vendored, see README

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// Load everything from files packaged in the extension. Setting
// allowRemoteModels=false means a failed local load errors instead of silently
// falling back to a network fetch — so if anything is misconfigured, it fails
// loudly rather than phoning home.
env.allowRemoteModels = false;                                        // never fetch from HuggingFace
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');               // -> models/Xenova/all-MiniLM-L6-v2/...
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('lib/ort/'); // local onnxruntime-web binaries

// onnxruntime-web defaults to a multi-threaded WASM build that uses
// Atomics.wait for cross-thread sync. Atomics.wait blocks the calling thread,
// which is forbidden on a service worker's main thread ("Atomics.wait cannot be
// called in this context"). Force the single-threaded backend to avoid it.
env.backends.onnx.wasm.numThreads = 1;

let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    console.log('[tab-memory] loading local embedding model…');
    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      quantized: true, // load onnx/model_quantized.onnx (the vendored weights)
      progress_callback: (p) => {
        if (p && p.status) {
          console.log(`[tab-memory] model ${p.status}${p.file ? ' ' + p.file : ''}`);
        }
      }
    }).then(
      (extractor) => { console.log('[tab-memory] embedding model ready'); return extractor; },
      (err) => { extractorPromise = null; console.error('[tab-memory] model load failed', err); throw err; }
    );
  }
  return extractorPromise;
}

export async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // vectors are already normalized by the extractor, so dot product
  // alone approximates cosine similarity
  return dot;
}
