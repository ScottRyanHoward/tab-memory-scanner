// lib/llm.js
// RAG answer layer: given a question and the most relevant pages from the
// user's browsing history, ask Claude to synthesize a grounded answer.
//
// NOTE ON PRIVACY: this is the one part of the extension that leaves the
// machine. When the user asks a question, the text of the retrieved pages is
// sent to the Anthropic API to generate the answer. Embedding, storage, and
// retrieval all remain local. The API key is the user's own, stored in
// chrome.storage.local and never hardcoded here.
//
// We call the Messages API over raw fetch rather than the @anthropic-ai/sdk
// because this extension has no bundler — it loads plain ES modules directly.
// The `anthropic-dangerous-direct-browser-access` header is required for
// browser-context requests to the API.

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const DEFAULT_MODEL = 'claude-opus-5';
const MAX_CHARS_PER_PAGE = 2000; // cap context per page to control token cost

const SYSTEM_PROMPT =
  "You answer questions about the user's own web browsing history. You are given " +
  "excerpts from pages they actually visited. Answer using ONLY those excerpts. " +
  "Be concise and direct. When a fact comes from a page, cite it inline by its " +
  "number, like [1] or [2]. If the excerpts don't contain enough to answer, say " +
  "you couldn't find anything relevant in their history — never invent details or " +
  "URLs.";

/**
 * @param {{ question: string, pages: Array<{url,title,text,capturedAt}>, apiKey: string, model?: string }} opts
 * @returns {Promise<string>} the answer text
 */
export async function answerQuestion({ question, pages, apiKey, model }) {
  const context = pages
    .map((p, i) => {
      const body = (p.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PER_PAGE);
      return `[${i + 1}] ${p.title || p.url}\nURL: ${p.url}\nVisited: ${p.capturedAt}\n${body}`;
    })
    .join('\n\n---\n\n');

  const userContent =
    `Here are the most relevant pages from my browsing history:\n\n${context}\n\n` +
    `---\n\nQuestion: ${question}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      // Keep answers snappy: shallow thinking is plenty for grounded Q&A.
      output_config: { effort: 'low' }
    })
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || '';
    } catch { /* non-JSON error body */ }
    throw new Error(`Anthropic API ${res.status}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  const answer = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  return answer || "I couldn't produce an answer from your history.";
}
