# Tab Memory

Ask questions about everything you've browsed and get AI answers grounded in
the pages you actually read. Your history is captured, embedded, and retrieved
**locally**; answering the question uses the Anthropic API, so an API key is
**required** — add your own in Settings after installing.

## How it works

1. **Capture** — a content script watches each page. After you've spent
   ~3 seconds on it, it extracts the readable text and sends it to the
   background service worker.
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
tab-memory-scanner/
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
│       ├── sql-wasm.js        # vendored + committed (regen: vendor-deps.js)
│       ├── sql-wasm.wasm      # vendored + committed
│       └── transformers.min.js # vendored + committed
├── scripts/
│   └── vendor-deps.js      # maintainer tool: re-fetch + patch the vendored libs
├── package.json
└── README.md
```

## Install

**Requirements:** Google Chrome (or any Chromium browser). No build step and no
Node.js needed — the WASM libraries are committed to the repo, so you just get
the files and load them.

1. **Get the code.** Clone the repo (or download the ZIP from GitHub via
   **Code → Download ZIP** and unzip it):

   ```bash
   git clone https://github.com/ScottRyanHoward/tab-memory-scanner.git
   ```

2. **Load the extension in Chrome.**
   1. Open `chrome://extensions`
   2. Enable **Developer mode** (top-right toggle)
   3. Click **Load unpacked**
   4. Select the `extension/` folder

The extension icon should appear in your toolbar. (If you don't see it, click
the puzzle-piece icon and pin **Tab Memory**.)

> **Maintainers:** the libraries in `extension/lib/` are pre-vendored and
> committed. To refresh them, run `node scripts/vendor-deps.js`, which re-fetches
> sql.js and transformers.js and re-applies the ES-module patch. End users don't
> need this.

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
of the embedding model** — after that everything runs locally and fast. Visit a
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
