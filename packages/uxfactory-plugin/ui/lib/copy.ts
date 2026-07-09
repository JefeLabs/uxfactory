/**
 * copy — clipboard with a text-selection fallback. The fallback is
 * load-bearing: Figma's plugin iframe does not reliably grant clipboard
 * permission, so on failure we select the <code> element's contents so the
 * user can hit ⌘C (spec 2026-07-09-worker-cli-supervision §4).
 */
export function selectText(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function copyText(text: string, fallbackElementId: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => selectText(fallbackElementId));
  } else {
    selectText(fallbackElementId);
  }
}
