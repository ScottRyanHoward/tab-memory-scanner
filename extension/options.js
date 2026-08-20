// options.js — load/save settings in chrome.storage.local.
const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const statusEl = document.getElementById('status');

const DEFAULT_MODEL = 'claude-opus-5';

async function load() {
  const { anthropicApiKey, anthropicModel } =
    await chrome.storage.local.get(['anthropicApiKey', 'anthropicModel']);
  if (anthropicApiKey) apiKeyEl.value = anthropicApiKey;
  modelEl.value = anthropicModel || DEFAULT_MODEL;
}

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    anthropicApiKey: apiKeyEl.value.trim(),
    anthropicModel: modelEl.value
  });
  statusEl.textContent = 'Saved ✓';
  setTimeout(() => { statusEl.textContent = ''; }, 2000);
});

load();
