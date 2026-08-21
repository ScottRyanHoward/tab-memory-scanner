// content.js
// Runs on every page. Waits until the user has been on the page a while
// (so we don't capture drive-by tabs), then extracts readable text and
// sends it to the background service worker for storage + embedding.

const MIN_DWELL_MS = 3000; // must be on page this long before we capture (filters drive-by tabs)
const startTime = Date.now();

let captured = false;

function extractReadableText() {
  // Lightweight readability heuristic: prefer <article>, fall back to
  // largest text-dense block, strip nav/footer/script/style noise.
  const clone = document.cloneNode(true);
  clone.querySelectorAll('script,style,nav,footer,header,noscript,iframe,svg').forEach(el => el.remove());

  const article = clone.querySelector('article');
  const root = article || clone.body;
  if (!root) return '';

  const text = root.innerText || '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 20000); // cap length
}

function getReferrerTabInfo() {
  return {
    referrer: document.referrer || null
  };
}

function capturePage() {
  if (captured) return;
  if (document.visibilityState !== 'visible') return;

  captured = true;
  const payload = {
    type: 'PAGE_CAPTURE',
    url: location.href,
    title: document.title,
    text: extractReadableText(),
    referrer: getReferrerTabInfo().referrer,
    capturedAt: new Date().toISOString()
  };

  chrome.runtime.sendMessage(payload).catch(() => {
    // background worker may be asleep on first call; MV3 wakes it automatically
  });
}

// Capture on dwell timer
setTimeout(capturePage, MIN_DWELL_MS);

// Also capture right before the tab closes/unloads, in case dwell timer
// didn't fire yet but there's meaningful content already
window.addEventListener('pagehide', () => {
  if (!captured && Date.now() - startTime > 2000) {
    capturePage();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // re-arm capture if user comes back to a long-idle tab
    setTimeout(capturePage, MIN_DWELL_MS);
  }
});
