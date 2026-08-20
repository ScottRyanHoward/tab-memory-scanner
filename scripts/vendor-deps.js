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

import { writeFile, readFile } from 'node:fs/promises';

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

console.log('Done. The MiniLM model itself downloads lazily on first use and is cached by the browser.');
