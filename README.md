# Tab Memory

Ask questions about everything you've browsed and get AI answers grounded in
the pages you actually read. Your history is captured, embedded, and searched
**locally**; answering the question uses the Anthropic API, so an API key is
**required** — add your own in Settings after installing.

## How it works

1. **Capture** — a content script watches each page. After you've spent
   ~3 seconds on it (configurable), it extracts the readable text and
   sends it to the background service worker.
2. **Embed** — the background worker runs the text through a small local
   embedding model (`Xenova/all-MiniLM-L6-v2` via transformers.js, ~25MB,
   downloaded once and cached by the browser) to get a semantic vector.
3. **Store** — the page (URL, title, text, timestamp, referrer, vector)
   is saved into a SQLite database (via sql.js/WASM) that's persisted in
   IndexedDB, so it survives browser restarts.
4. **Retrieve** — when you ask a question in the popup, it's embedded the same
   way and the most semantically similar pages are ranked by cosine similarity.
   This retrieval step is fully local.
5. **Answer** — the top matching pages are sent to Claude (via the Anthropic
   API), which writes a grounded answer with citations back to the source pages.
   This is the only step that uses the network beyond the one-time model
   download, and the reason an API key is required (see
   [AI answers](#ai-answers)).

Capture, embedding, storage, and retrieval run entirely in-browser — no server,
no account. Generating the answer is the sole exception.

## Project structure

```
tab-memory/
├── extension/
│   ├── manifest.json       # MV3 manifest
│   ├── content.js          # runs on every page, extracts + sends text
│   ├── background.js       # service worker: capture, embed, retrieve, answer
│   ├── popup.html/.js      # ask-a-question popup
│   ├── options.html/.js    # settings: API key + model
│   ├── icons/              # extension icons (16/48/128, included)
│   └── lib/
│       ├── db.js              # sql.js + IndexedDB persistence
│       ├── embeddings.js      # transformers.js wrapper + cosine similarity
│       ├── llm.js             # Anthropic Messages API call (AI answers)
│       ├── sql-wasm.js        # vendored (run scripts/vendor-deps.js)
│       ├── sql-wasm.wasm      # vendored
│       └── transformers.min.js # vendored
├── scripts/
│   └── vendor-deps.js      # downloads + patches the vendored libraries
├── package.json
└── README.md
```

## Install

**Requirements:** Google Chrome (or any Chromium browser) and Node.js (only to
fetch the vendored libraries once).

1. **Get the code and vendor the libraries.** The WASM libraries (sql.js and
   transformers.js) aren't committed — MV3 forbids loading remote code, so they
   must live locally. Fetch them once:

   ```bash
   git clone <your-repo>
   cd tab-memory
   node scripts/vendor-deps.js
   ```

   This downloads `sql-wasm.js`, `sql-wasm.wasm`, and `transformers.min.js` into
   `extension/lib/` and patches sql.js so it loads as an ES module.

2. **Load the extension in Chrome.**
   1. Open `chrome://extensions`
   2. Enable **Developer mode** (top-right toggle)
   3. Click **Load unpacked**
   4. Select the `extension/` folder

The extension icon should appear in your toolbar. (If you don't see it, click
the puzzle-piece icon and pin **Tab Memory**.)

## Using it

### 1. Add your API key (required)

Answering questions uses Claude, so you need an Anthropic API key:

1. Click the extension icon, then **⚙ Settings** (top-right of the popup).
2. Paste your API key (create one at
   [console.anthropic.com](https://console.anthropic.com/settings/keys)).
3. Choose a model — **Opus 5** (best), **Sonnet 5** (balanced), or
   **Haiku 4.5** (fastest/cheapest for quick questions) — and click **Save**.

The key is stored in `chrome.storage.local` on this machine only. Without it,
the popup will tell you to add one.

### 2. Build up some history

Just browse. A content script captures the readable text of each page after you
spend ~3 seconds on it. **The first capture triggers a one-time ~25 MB download
of the embedding model** — after that everything is local and instant. Visit a
handful of pages (give each a few seconds) so there's something to draw on.

### 3. Ask

Click the extension icon, type a question, and press **Enter**, e.g.
*"what was that page about car parts?"* You'll get a written answer with
numbered citations linking to the source pages you can click to reopen.

Ask handles broad, conversational, and category questions — *"what did I look
up about cars?"* will surface a Subaru page even though it never says the word
"car." It pulls your closest-matching pages by meaning and lets Claude judge
relevance, so you don't need the exact wording that appears on the page.

### Troubleshooting

- **"No Anthropic API key set"** — add your key in ⚙ Settings (step 1 above).
- **"I couldn't find anything relevant…"** — you may not have captured the page
  yet. Make sure you actually spent a few seconds on it while browsing, then try
  rephrasing the question.
- **Model download / first answer is slow** — the ~25 MB embedding model
  downloads once on first use; subsequent questions are fast (the Anthropic call
  itself takes a moment, less so with Haiku).
- **Re-vendoring** — if `extension/lib/` is missing files, re-run
  `node scripts/vendor-deps.js`.

## What's here

- [x] Chrome MV3 extension, single browser for now
- [x] Readable-text extraction (basic heuristic, not full Readability.js)
- [x] Local embeddings, no network calls for capture/retrieval after first
      model download
- [x] SQLite storage persisted via IndexedDB
- [x] Local semantic retrieval (ranked by meaning) feeding the answer
- [x] AI answers (RAG over your history via the Anthropic API, bring-your-own-key)

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

## AI answers

The popup is an AI prompt: ask a question ("what was that page about car
parts?") and it retrieves the most relevant pages from your history, then asks
Claude to synthesize a grounded answer with citations.

- Open **Settings** (⚙ in the popup) and paste your own Anthropic API key
  (from console.anthropic.com). The key is stored in `chrome.storage.local`
  on this machine only.
- Pick a model — Opus 5 (best), Sonnet 5 (balanced), or Haiku 4.5
  (fastest/cheapest for quick history questions).
- **Answering sends data off-device:** the text of the matching pages is sent
  to the Anthropic API to generate the answer. This is required to use the
  extension. Everything else — capture, embedding, storage, retrieval — stays
  local.

## Privacy notes

- All storage is local (IndexedDB). Capture, embedding, and retrieval never
  leave your machine.
- The embedding model downloads once from Hugging Face's CDN via
  transformers.js, then is cached.
- Generating an answer is the only step that transmits page content, and only
  to the Anthropic API — the text of the pages retrieved for your question is
  sent on each ask.
- Worth adding early: a visible "paused" toggle and a domain exclusion
  list before wider use, since capturing page text by default is
  sensitive even when stored locally.
