# Tab Memory

Semantic search — and AI answers — over everything you've browsed. Capture,
embedding, and search are fully local. An **optional** AI answer layer (ask a
question, get a synthesized answer from your history) uses the Anthropic API;
it's off until you add your own API key in Settings.

## How it works

1. **Capture** — a content script watches each page. After you've spent
   ~8 seconds on it (configurable), it extracts the readable text and
   sends it to the background service worker.
2. **Embed** — the background worker runs the text through a small local
   embedding model (`Xenova/all-MiniLM-L6-v2` via transformers.js, ~25MB,
   downloaded once and cached by the browser) to get a semantic vector.
3. **Store** — the page (URL, title, text, timestamp, referrer, vector)
   is saved into a SQLite database (via sql.js/WASM) that's persisted in
   IndexedDB, so it survives browser restarts.
4. **Search** — typing in the popup or new-tab page embeds your query the
   same way and ranks stored pages by cosine similarity, so you can find
   "that article about mitochondria" without remembering the title or URL.

Everything runs in-browser. No server, no API keys, no network calls
except the one-time model download.

## Project structure

```
tab-memory/
├── extension/
│   ├── manifest.json       # MV3 manifest
│   ├── content.js          # runs on every page, extracts + sends text
│   ├── background.js       # service worker: capture, embed, search
│   ├── popup.html/.js      # quick search popup
│   ├── newtab.html         # full-page search (reuses popup.js)
│   ├── icons/              # extension icons (add your own 16/48/128 png)
│   └── lib/
│       ├── db.js              # sql.js + IndexedDB persistence
│       ├── embeddings.js      # transformers.js wrapper + cosine similarity
│       ├── sql-wasm.js        # vendored (run scripts/vendor-deps.js)
│       ├── sql-wasm.wasm      # vendored
│       └── transformers.min.js # vendored
├── scripts/
│   └── vendor-deps.js      # downloads the two vendored libraries
├── package.json
└── README.md
```

## Setup

```bash
git clone <your-repo>
cd tab-memory
node scripts/vendor-deps.js   # downloads sql.js + transformers.js into extension/lib
```

Then load it as an unpacked extension:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

Browse a few pages, wait ~10 seconds on each, then click the extension
icon (or open a new tab) and search.

## MVP scope (what's here)

- [x] Chrome MV3 extension, single browser for now
- [x] Readable-text extraction (basic heuristic, not full Readability.js)
- [x] Local embeddings, no network calls after first model download
- [x] SQLite storage persisted via IndexedDB
- [x] Semantic search in popup + new-tab override

## Cut for v1 — roadmap

- **Better extraction** — swap the heuristic for a real Readability.js
  port for cleaner text on messy sites.
- **Cross-device sync** — optional, opt-in sync via a file the user
  controls (e.g. a folder synced by Dropbox/Syncthing), keeping the
  "you control your data" principle.
- **"Why you opened it" capture** — prompt/allow a quick note on tab
  close, and capture tab lineage (opener → child tabs) for context.
- **Tab tree visualization** — see your browsing sessions as a graph,
  not just a flat search list.
- **Firefox support** — MV3 support in Firefox is closeby; mostly a
  manifest tweak once the Chrome version is solid.
- **Vector index at scale** — swap the naive in-memory cosine scan for
  something like `hnswlib-wasm` once you have tens of thousands of pages.
- **Private-browsing / domain exclusion list** — let users blocklist
  sensitive domains (banking, health) from ever being captured.

## AI answers (optional)

The popup works like an AI prompt: ask a question ("what was that page about
car parts?") and it retrieves the most relevant pages from your history, then
asks Claude to synthesize a grounded answer with citations.

- Open **Settings** (⚙ in the popup) and paste your own Anthropic API key
  (from console.anthropic.com). The key is stored in `chrome.storage.local`
  on this machine only.
- Pick a model — Opus 5 (best), Sonnet 5 (balanced), or Haiku 4.5
  (fastest/cheapest for quick history questions).
- **This is the one feature that sends data off-device:** when you ask a
  question, the text of the matching pages is sent to the Anthropic API to
  generate the answer. Clear the key to disable it. Everything else stays local.

## Privacy notes

- All storage is local (IndexedDB). Capture, embedding, and search never leave
  your machine.
- The embedding model downloads once from Hugging Face's CDN via
  transformers.js, then is cached.
- The AI answer layer (above) is the only feature that transmits page content,
  and only to the Anthropic API, and only when you've added a key and asked a
  question.
- Worth adding early: a visible "paused" toggle and a domain exclusion
  list before wider use, since capturing page text by default is
  sensitive even when local-only.
