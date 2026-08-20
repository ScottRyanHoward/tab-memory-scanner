// lib/embeddings.js
// Generates text embeddings fully on-device using transformers.js with a
// small MiniLM model (~25MB, cached after first download). Nothing is
// sent to any server — this is the whole point of the project.

import { pipeline } from './transformers.min.js'; // vendored, see README

let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
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
