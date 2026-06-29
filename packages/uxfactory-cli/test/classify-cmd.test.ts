/**
 * classify-cmd.test.ts — TDD for `classifyCmd` (Phase 8, Task 3).
 *
 * RED first: write all failing tests, then implement classify.ts to make them GREEN.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyCmd } from "../src/commands/classify.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";
import type { GateProfile } from "../src/classify/condition.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A fully valid minimal ProjectClassification (marketing, corporate, no compliance). */
const validClassification = {
  version: 1,
  category: "marketing",
  industry: "corporate",
  age_demographic: "26-35",
  style: "informal",
  scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
  flow_refs: [],
};

/** A web_app classification with visual:high scope (tokens required). */
const webAppClassification = {
  version: 1,
  category: "web_app",
  industry: "corporate",
  age_demographic: "26-35",
  style: "formal",
  scope: { visual: "high", editorial: "medium", coverage: "high", flow: "high" },
  flow_refs: ["dashboard"],
};

/** An education classification (FERPA+COPPA constraints + A11yProfile requested). */
const educationClassification = {
  version: 1,
  category: "web_app",
  industry: "education",
  age_demographic: "children",
  style: "informal",
  scope: { visual: "medium", editorial: "low", coverage: "medium", flow: "medium" },
  flow_refs: [],
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-classify-cmd-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Error cases (exit 2)
// ---------------------------------------------------------------------------

describe("classifyCmd — error cases", () => {
  it("absent classification.json → exit 2 with clear message", async () => {
    const io = makeIO();
    const code = await classifyCmd({ cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/classification file not found/);
  });

  it("invalid JSON in classification.json → exit 2", async () => {
    await writeFile(path.join(root, "uxfactory.classification.json"), "{ not valid json", "utf8");
    const io = makeIO();
    const code = await classifyCmd({ cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/invalid JSON/);
  });

  it("invalid classification (bad category) → exit 2 naming the field", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify({ ...validClassification, category: "not-a-category" }),
      "utf8",
    );
    const io = makeIO();
    const code = await classifyCmd({ cwd: root }, io);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/category/);
  });
});

// ---------------------------------------------------------------------------
// Draft profile (no --confirm)
// ---------------------------------------------------------------------------

describe("classifyCmd — no --confirm → draft profile", () => {
  it("writes uxfactory.profile.json with confirm_status: 'draft' + exit 0", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(validClassification),
      "utf8",
    );
    const io = makeIO();
    const code = await classifyCmd({ cwd: root }, io);

    expect(code).toBe(EXIT.OK);

    const raw = await readFile(path.join(root, "uxfactory.profile.json"), "utf8");
    // Stable 2-space JSON with trailing newline
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toMatch(/^ {2}"/m); // 2-space indent

    const profile = JSON.parse(raw) as GateProfile;
    expect(profile.confirm_status).toBe("draft");
    expect(profile.scope).toBeDefined();
    expect(profile.manifest).toBeDefined();
    expect(profile.constraints).toBeDefined();
    expect(profile.notes).toBeDefined();
  });

  it("marketing classification → scope has coverage:low and flow:low (category floors)", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(validClassification),
      "utf8",
    );
    const io = makeIO();
    await classifyCmd({ cwd: root }, io);

    const raw = await readFile(path.join(root, "uxfactory.profile.json"), "utf8");
    const profile = JSON.parse(raw) as GateProfile;
    expect(profile.scope.coverage).toBe("low");
    expect(profile.scope.flow).toBe("low");
  });

  it("education+children classification → constraints include FERPA and COPPA", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(educationClassification),
      "utf8",
    );
    const io = makeIO();
    await classifyCmd({ cwd: root }, io);

    const raw = await readFile(path.join(root, "uxfactory.profile.json"), "utf8");
    const profile = JSON.parse(raw) as GateProfile;
    expect(profile.constraints).toContain("FERPA");
    expect(profile.constraints).toContain("COPPA");
  });

  it("human summary includes scope + requested/generatable/suppressed counts + draft", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(validClassification),
      "utf8",
    );
    const io = makeIO();
    await classifyCmd({ cwd: root }, io);

    const out = io.outText();
    expect(out).toMatch(/draft/);
    expect(out).toMatch(/scope:/);
    expect(out).toMatch(/requested/);
    expect(out).toMatch(/generatable/);
    expect(out).toMatch(/suppressed/);
  });
});

// ---------------------------------------------------------------------------
// Approved profile (--confirm)
// ---------------------------------------------------------------------------

describe("classifyCmd — --confirm → approved (PINNED)", () => {
  it("writes confirm_status: 'approved' + exit 0", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(validClassification),
      "utf8",
    );
    const io = makeIO();
    const code = await classifyCmd({ confirm: true, cwd: root }, io);

    expect(code).toBe(EXIT.OK);
    const raw = await readFile(path.join(root, "uxfactory.profile.json"), "utf8");
    const profile = JSON.parse(raw) as GateProfile;
    expect(profile.confirm_status).toBe("approved");
  });

  it("human summary mentions approved", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(validClassification),
      "utf8",
    );
    const io = makeIO();
    await classifyCmd({ confirm: true, cwd: root }, io);
    expect(io.outText()).toMatch(/approved/);
  });
});

// ---------------------------------------------------------------------------
// --json flag
// ---------------------------------------------------------------------------

describe("classifyCmd — --json flag", () => {
  it("emits GateProfile JSON with scope + manifest + constraints + confirm_status", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(validClassification),
      "utf8",
    );
    const io = makeIO();
    const code = await classifyCmd({ json: true, cwd: root }, io);

    expect(code).toBe(EXIT.OK);
    // outText() should be parseable JSON (one JSON line, no human text appended)
    const profile = JSON.parse(io.outText()) as GateProfile;
    expect(profile).toHaveProperty("scope");
    expect(profile).toHaveProperty("manifest");
    expect(profile).toHaveProperty("constraints");
    expect(profile).toHaveProperty("notes");
    expect(profile).toHaveProperty("confirm_status");
    expect(profile.confirm_status).toBe("draft");
  });

  it("--json + --confirm → confirm_status: 'approved' in JSON output", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(validClassification),
      "utf8",
    );
    const io = makeIO();
    await classifyCmd({ json: true, confirm: true, cwd: root }, io);

    const profile = JSON.parse(io.outText()) as GateProfile;
    expect(profile.confirm_status).toBe("approved");
  });

  it("web_app classification --json → DiscoverabilityStrategy suppressed", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(webAppClassification),
      "utf8",
    );
    const io = makeIO();
    await classifyCmd({ json: true, cwd: root }, io);

    const profile = JSON.parse(io.outText()) as GateProfile;
    const ds = profile.manifest.find((e) => e.artifact_kind === "DiscoverabilityStrategy");
    expect(ds).toBeDefined();
    expect(ds?.requirement).toBe("suppressed");
  });

  it("still writes profile.json when --json is used", async () => {
    await writeFile(
      path.join(root, "uxfactory.classification.json"),
      JSON.stringify(validClassification),
      "utf8",
    );
    const io = makeIO();
    await classifyCmd({ json: true, cwd: root }, io);

    const raw = await readFile(path.join(root, "uxfactory.profile.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const profile = JSON.parse(raw) as GateProfile;
    expect(profile.confirm_status).toBe("draft");
  });
});
