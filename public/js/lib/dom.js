/* The two things every rendering module needs. */

export const $ = id => document.getElementById(id);

// Everything user- or model-supplied goes through this before it reaches
// innerHTML, so neither can inject markup.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
