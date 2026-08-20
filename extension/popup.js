// popup.js
const input = document.getElementById('search');
const resultsEl = document.getElementById('results');

let debounceTimer = null;

input.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const query = input.value;
  debounceTimer = setTimeout(() => runSearch(query), 250);
});

async function runSearch(query) {
  if (!query.trim()) {
    resultsEl.innerHTML = '<div class="empty">Start typing to search your browsing memory</div>';
    return;
  }

  resultsEl.innerHTML = '<div class="empty">Searching…</div>';

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'SEARCH_QUERY', query });
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty">Search error: ${escapeHtml(String(err && err.message || err))}</div>`;
    return;
  }

  if (response?.error) {
    resultsEl.innerHTML = `<div class="empty">Search error: ${escapeHtml(response.error)}</div>`;
    return;
  }
  renderResults(response?.results || []);
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = '<div class="empty">No matches yet</div>';
    return;
  }

  resultsEl.innerHTML = '';
  for (const r of results) {
    const div = document.createElement('div');
    div.className = 'result';
    div.innerHTML = `
      <div class="result-title">${escapeHtml(r.title || r.url)}</div>
      <div class="result-meta">${new Date(r.capturedAt).toLocaleString()} · ${escapeHtml(new URL(r.url).hostname)}</div>
      <div class="result-snippet">${escapeHtml(r.snippet)}…</div>
    `;
    div.addEventListener('click', () => chrome.tabs.create({ url: r.url }));
    resultsEl.appendChild(div);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
