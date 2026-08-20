// scripts/vendor-deps.js
//
// MV3 extensions can't fetch code from a CDN at runtime (violates the
// remote-code policy), so sql.js and transformers.js need to be vendored
// as local files inside extension/lib/. Run this once after cloning:
//
//   node scripts/vendor-deps.js
//
// It just fetches the built browser bundles and writes them locally.
// If your network blocks npm/unpkg, download these manually instead:
//   - sql.js:          https://github.com/sql-js/sql.js/releases (sql-wasm.js + sql-wasm.wasm)
//   - transformers.js: https://github.com/xenova/transformers.js/releases (dist build)

import { writeFile } from 'node:fs/promises';

const files = [
  {
    url: 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js',
    out: 'extension/lib/sql-wasm.js'
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.wasm',
    out: 'extension/lib/sql-wasm.wasm'
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js',
    out: 'extension/lib/transformers.min.js'
  }
];

for (const { url, out } of files) {
  console.log(`Fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  console.log(`  -> ${out} (${buf.length} bytes)`);
}

console.log('Done. The MiniLM model itself downloads lazily on first use and is cached by the browser.');
