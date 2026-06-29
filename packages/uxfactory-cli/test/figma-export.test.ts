import { describe, it, expect } from "vitest";
import { figmaImageExport } from "../src/render/figma-export.js";

/** A minimal fetch-like response. */
function res(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

describe("figmaImageExport", () => {
  it("builds the REST URL + X-Figma-Token header and parses images", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> | undefined;
    const fetchImpl = async (url: string, opts?: { headers?: Record<string, string> }) => {
      capturedUrl = url;
      capturedHeaders = opts?.headers;
      return res({ images: { "1:2": "https://img.figma/1.png" } });
    };

    const out = await figmaImageExport(
      { token: "tok-123", fileKey: "FILEKEY", ids: ["1:2", "3:4"], format: "png", scale: 2 },
      fetchImpl,
    );

    expect(out.images).toEqual({ "1:2": "https://img.figma/1.png" });
    expect(capturedUrl).toContain("https://api.figma.com/v1/images/FILEKEY");
    expect(capturedUrl).toContain("ids=1%3A2%2C3%3A4"); // "1:2,3:4" url-encoded
    expect(capturedUrl).toContain("format=png");
    expect(capturedUrl).toContain("scale=2");
    expect(capturedHeaders?.["X-Figma-Token"]).toBe("tok-123");
  });

  it("defaults to format=png and omits scale when not given", async () => {
    let capturedUrl = "";
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return res({ images: {} });
    };
    await figmaImageExport({ token: "t", fileKey: "K", ids: ["9:9"] }, fetchImpl);
    expect(capturedUrl).toContain("format=png");
    expect(capturedUrl).not.toContain("scale=");
  });

  it("throws on a non-200 response", async () => {
    const fetchImpl = async () => res({}, { ok: false, status: 403 });
    await expect(
      figmaImageExport({ token: "t", fileKey: "K", ids: ["1:1"] }, fetchImpl),
    ).rejects.toThrow(/403/);
  });

  it("throws when the body carries an `err` field", async () => {
    const fetchImpl = async () => res({ err: "Invalid node id", status: 400 });
    await expect(
      figmaImageExport({ token: "t", fileKey: "K", ids: ["1:1"] }, fetchImpl),
    ).rejects.toThrow(/Invalid node id/);
  });
});
