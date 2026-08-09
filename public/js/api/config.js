/* Which backend this page is talking to.
 *
 * When served by server.js these are overwritten by whatever /api/health
 * reports, so .env is the single source of truth. The values below only matter
 * when the page is hosted somewhere static and calls the provider directly. */

// Wire format. 'openai' covers NVIDIA NIM, OpenRouter, Together, vLLM and
// OpenAI; 'anthropic' is the Claude Messages API.
export let format = 'openai';
export let MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1';
export let providerName = 'nvidia';

// Direct mode only. Edit alongside the three above if you host the page
// without server.js and want a different provider.
export let DIRECT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// True when served by server.js with a key in .env — the request is then
// proxied through our own origin and the key never enters the browser.
export let serverMode = false;
export const setServerMode = v => { serverMode = v; };

// Direct mode only: the key typed into the box under Settings.
export let apiKey = '';
export const setApiKey = v => { apiKey = v; };

// Direct mode only: which key that box is asking for. Keyed by the provider
// /api/health reports, so the hint follows .env.
export const KEY_HINT = {
  nvidia: 'NVIDIA API key (nvapi-…)',
  gemini: 'Gemini API key (AIza…)',
  anthropic: 'Anthropic API key (sk-ant-…)'
};

// Adopt whatever .env selected, so the page never disagrees with the proxy.
export function adoptServerInfo(info) {
  if (info.format) format = info.format;
  if (info.model) MODEL = info.model;
  if (info.provider) providerName = info.provider;
}
