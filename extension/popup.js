// popup.js — AI-prompt interface over your browsing history (RAG).
const input = document.getElementById('ask');
const answerEl = document.getElementById('answer');
const sourcesEl = document.getElementById('sources');

document.getElementById('settings-link').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    ask(input.value);
  }
});

async function ask(query) {
  if (!query.trim()) return;

  answerEl.innerHTML = '<div class="empty">Thinking…</div>';
  sourcesEl.innerHTML = '';

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'ASK', query });
  } catch (err) {
    showError(String(err && err.message || err));
    return;
  }

  if (!response || response.error) {
    showError(response?.error || 'No response from the extension.');
    return;
  }

  renderAnswer(response.answer || '', response.sources || []);
}

function renderAnswer(answer, sources) {
  answerEl.classList.remove('error');
  answerEl.textContent = answer || 'No answer.';

  if (!sources.length) {
    sourcesEl.innerHTML = '';
    return;
  }

  sourcesEl.innerHTML = '<div class="label">Sources</div>';
  sources.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'source';
    let host = s.url;
    try { host = new URL(s.url).hostname; } catch { /* keep raw url */ }
    div.innerHTML =
      `<span class="idx">[${i + 1}]</span>` +
      `${escapeHtml(s.title || host)} <span class="host">· ${escapeHtml(host)}</span>`;
    div.addEventListener('click', () => chrome.tabs.create({ url: s.url }));
    sourcesEl.appendChild(div);
  });
}

function showError(msg) {
  answerEl.className = 'error';
  answerEl.textContent = msg;
  sourcesEl.innerHTML = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
