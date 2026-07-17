/**
 * base64.test.ts — Tests for ui/lib/base64.ts (bytesToBase64).
 *
 * Coverage:
 *   - Small input encodes to the exact base64 a Node Buffer would produce
 *     (cross-checks against the runtime's own trusted encoder).
 *   - Empty input.
 *   - Large input (bigger than the internal chunk size) round-trips intact
 *     — this is the failure mode the chunking exists to prevent
 *     (String.fromCharCode(...bytes) blowing the call stack on a big array).
 */

import { describe, it, expect } from "vitest";
import { bytesToBase64 } from "../ui/lib/base64.js";

describe("bytesToBase64", () => {
  it("encodes PNG magic bytes to the same base64 Buffer would produce", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const expected = Buffer.from(bytes).toString("base64");
    expect(bytesToBase64(bytes)).toBe(expected);
  });

  it("encodes an empty array to an empty string", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });

  it("round-trips a large input (> chunk size) intact", () => {
    // 100_000 bytes — well over the 32 KiB internal chunk boundary, so this
    // input can only round-trip correctly if chunk boundaries don't corrupt
    // the byte stream.
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    const encoded = bytesToBase64(bytes);
    expect(encoded).toBe(Buffer.from(bytes).toString("base64"));

    const decoded = new Uint8Array(Buffer.from(encoded, "base64"));
    expect(decoded).toEqual(bytes);
  });

  it("does not throw on an input larger than the chunk size (the call-stack guard actually works)", () => {
    const bytes = new Uint8Array(500_000);
    expect(() => bytesToBase64(bytes)).not.toThrow();
  });
});
