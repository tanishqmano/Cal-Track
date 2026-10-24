'use strict';

/**
 * Which model answers, and in which wire format.
 *
 * Two formats. `anthropic` is the Messages API; `openai` is the
 * /chat/completions shape that NVIDIA NIM, OpenRouter, Together, vLLM and
 * OpenAI itself all speak. The page asks /api/health which one is live and
 * formats its requests to match, so switching backends is a .env edit.
 *
 * `fallback` is a second model on the same key, tried once when the first is
 * overloaded or out of quota. Capacity and free-tier allowances are counted per
 * model, so the second is usually up when the first is not. Set the
 * *_FALLBACK_MODEL variable to "none" to turn it off.
 */

const { pick } = require('./env');

const PROVIDERS = {
  nvidia: {
    format: 'openai',
    url: (pick('NVIDIA_BASE_URL') || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '') + '/chat/completions',
    keyName: 'NVIDIA_API_KEY',
    key: pick('NVIDIA_API_KEY'),
    model: pick('NVIDIA_MODEL') || 'nvidia/llama-3.3-nemotron-super-49b-v1',
    fallback: pick('NVIDIA_FALLBACK_MODEL'),
    headers: k => ({ authorization: 'Bearer ' + k })
  },
  // Google publishes an OpenAI-compatible front door for Gemini, so it rides
  // the same wire format as the others — no third adapter in the page.
  gemini: {
    format: 'openai',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyName: 'GEMINI_API_KEY',
    key: pick('GEMINI_API_KEY'),
    model: pick('GEMINI_MODEL') || 'gemini-3.5-flash-lite',
    // On by default, unlike the others. Gemini answers "This model is currently
    // experiencing high demand" often enough to fail most days, and the hosted
    // service only sees variables added by hand in the Render dashboard.
    fallback: pick('GEMINI_FALLBACK_MODEL') || 'gemini-3.1-flash-lite',
    headers: k => ({ authorization: 'Bearer ' + k })
  },
  anthropic: {
    format: 'anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    keyName: 'ANTHROPIC_API_KEY',
    key: pick('ANTHROPIC_API_KEY'),
    model: pick('ANTHROPIC_MODEL') || 'claude-sonnet-4-6',
    fallback: pick('ANTHROPIC_FALLBACK_MODEL'),
    headers: k => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' })
  }
};

const PROVIDER_NAME = PROVIDERS[pick('AI_PROVIDER')] ? pick('AI_PROVIDER') : 'nvidia';
const provider = PROVIDERS[PROVIDER_NAME];
const API_KEY = provider.key;

// Off when unset, when set to "none", or when it names the main model again.
const FALLBACK_MODEL = provider.fallback && provider.fallback.toLowerCase() !== 'none' && provider.fallback !== provider.model
  ? provider.fallback
  : '';

module.exports = { PROVIDERS, PROVIDER_NAME, provider, API_KEY, FALLBACK_MODEL };
