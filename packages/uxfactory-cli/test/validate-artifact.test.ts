import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateArtifactCmd } from "../src/commands/validate-artifact.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";

const mk = (): Promise<string> => mkdtemp(path.join(os.tmpdir(), "uxf-validate-"));
const wj = (p: string, b: unknown): Promise<void> => writeFile(p, JSON.stringify(b));

describe("validateArtifactCmd", () => {
  it("features: an unknown storyRef fails (exit 1) with an error finding", async () => {
    const root = await mk();
    try {
      await mkdir(path.join(root, ".uxfactory/artifacts/stories"), { recursive: true });
      await wj(path.join(root, ".uxfactory/artifacts/stories/s.json"), { storyId: "browse-faq", actor: "visitor", acceptanceCriteria: [{ acId: "AC-1" }] });
      await wj(path.join(root, ".uxfactory/artifacts/features.json"), { features: [{ featureId: "F-01", storyRefs: ["browse-faq", "ghost"] }] });
      const io = makeIO();
      expect(await validateArtifactCmd("features", { cwd: root, json: true }, io)).toBe(EXIT.GATE_FAIL);
      const r = JSON.parse(io.outText());
      expect(r.ok).toBe(false);
      expect(r.findings.some((f: { message: string }) => /ghost/.test(f.message))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("brand-colors: validates the section and passes a clean palette (exit 0)", async () => {
    const root = await mk();
    try {
      await mkdir(path.join(root, ".uxfactory/artifacts"), { recursive: true });
      await wj(path.join(root, ".uxfactory/artifacts/design-system.json"), {
        version: 1,
        "brand-colors": { neutrals: { "text.primary": "#111111", surface: "#ffffff" } },
      });
      expect(await validateArtifactCmd("brand-colors", { cwd: root }, makeIO())).toBe(EXIT.OK);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("absent artifact → setup error (exit 2); unknown key → exit 2", async () => {
    const root = await mk();
    try {
      expect(await validateArtifactCmd("features", { cwd: root }, makeIO())).toBe(EXIT.TRANSPORT);
      expect(await validateArtifactCmd("nonsense", { cwd: root }, makeIO())).toBe(EXIT.TRANSPORT);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
