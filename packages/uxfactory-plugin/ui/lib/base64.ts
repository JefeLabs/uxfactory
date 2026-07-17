/**
 * base64.ts — Uint8Array → base64 string encoding for the iframe UI sandbox.
 *
 * The plugin main thread has no Buffer (it's the Figma plugin sandbox); the
 * iframe UI is a plain browser environment, which has no Buffer either
 * (Buffer is Node-only) but DOES have `btoa`. Used to transport root-tier
 * identity crop PNGs (Task 9) from the main thread's Uint8Array bytes to the
 * bridge's `POST /project/identity/crops` JSON body.
 *
 * `String.fromCharCode(...bytes)` blows the call stack on large inputs (V8
 * caps spread/apply argument counts well under a typical PNG's byte count)
 * — chunk the input first, same defensive shape as other span/argument-count
 * guards in this codebase.
 */

const CHUNK_SIZE = 0x8000; // 32 KiB — comfortably under engine call-stack/arg-count limits

/** Encodes raw bytes as a base64 string using the browser's `btoa`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
