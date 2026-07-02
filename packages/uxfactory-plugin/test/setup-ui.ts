/**
 * jsdom shims for Radix UI primitives (ToggleGroup, RadioGroup).
 * Registered via setupFiles in vitest.config.ts.
 *
 * Guard every shim with `typeof window !== "undefined"` so this file is
 * safe to import in the node environment (where the other test suites run).
 */

if (typeof window !== "undefined") {
  // ResizeObserver — not in jsdom
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // PointerEvent — Radix uses pointer events for keyboard/mouse handling
  if (typeof globalThis.PointerEvent === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type: string, params?: PointerEventInit) {
        super(type, params);
      }
    };
  }

  // hasPointerCapture / releasePointerCapture / setPointerCapture — Radix roving focus
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }

  // scrollIntoView — Radix may call this on focused items
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
}
