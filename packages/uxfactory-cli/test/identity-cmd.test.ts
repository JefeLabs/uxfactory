/**
 * Tests for `uxfactory identity propose <file>` and `uxfactory identity show`.
 *
 * Mirrors canvas-cmd.test.ts's style: an in-process bridge (startBridge({port:0}))
 * for the success/end-to-end paths, a dead BridgeClient for the unreachable path,
 * and — the point of the shape-validation tests — a dead client paired with a BAD
 * proposals file, asserting the error message is the SHAPE-VALIDATION message
 * (not "bridge unreachable"), which proves the bad file never reached the network.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBridge } from "@uxfactory/bridge";
import type { IdentityProposal, NodeManifest } from "@uxfactory/spec";
import { BridgeClient } from "../src/client.js";
import { EXIT } from "../src/exit.js";
import {
  identityProposeCmd,
  identityShowCmd,
  identityCheckCmd,
  validateProposalsFile,
} from "../src/commands/identity.js";
import { makeIO } from "./helpers.js";

// ---------------------------------------------------------------------------
// validateProposalsFile — pure shape validation
// ---------------------------------------------------------------------------

describe("validateProposalsFile", () => {
  it("accepts a well-formed proposals file", () => {
    const result = validateProposalsFile({
      proposals: [
        { durableId: "n-a", label: "hero", confidence: "high", reasoning: "r" },
        { durableId: "n-b", matchedComponentKey: "button-key", confidence: "low", reasoning: "r2" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposals).toHaveLength(2);
  });

  it.each([
    ["missing proposals key", {}],
    ["null body", null],
    ["proposals not an array", { proposals: "nope" }],
    ["entry not an object", { proposals: ["nope"] }],
    ["entry missing durableId", { proposals: [{ confidence: "high", reasoning: "r" }] }],
    ["entry with empty durableId", { proposals: [{ durableId: "  ", confidence: "high", reasoning: "r" }] }],
    ["entry missing confidence", { proposals: [{ durableId: "n-a", reasoning: "r" }] }],
    ["entry with invalid confidence", { proposals: [{ durableId: "n-a", confidence: "medium", reasoning: "r" }] }],
    ["entry missing reasoning", { proposals: [{ durableId: "n-a", confidence: "high" }] }],
    [
      "entry with invalid resolutionStatus",
      { proposals: [{ durableId: "n-a", confidence: "high", reasoning: "r", resolutionStatus: "nope" }] },
    ],
    [
      "entry with non-string label",
      { proposals: [{ durableId: "n-a", confidence: "high", reasoning: "r", label: 5 }] },
    ],
  ])("rejects (%s)", (_label, payload) => {
    const result = validateProposalsFile(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// identityProposeCmd
// ---------------------------------------------------------------------------

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-identity-cmd-"));
  // The bridge's ?root= resolution re-validates isProjectRoot() on every
  // request (needs a .git or uxfactory.batch.json marker) — a live-bridge
  // test root must carry one or every /project/identity/* call 410s.
  await mkdir(path.join(root, ".git"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("identityProposeCmd — error paths never reach the network", () => {
  it("exits 2 when the file does not exist (dead bridge — never contacted)", async () => {
    const deadClient = new BridgeClient("http://127.0.0.1:19998");
    const io = makeIO();
    const code = await identityProposeCmd(path.join(root, "missing.json"), {}, io, deadClient);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/cannot read proposals file/i);
  });

  it("exits 2 when the file is not valid JSON (dead bridge — never contacted)", async () => {
    const deadClient = new BridgeClient("http://127.0.0.1:19998");
    const file = path.join(root, "bad.json");
    await writeFile(file, "{ not valid json }", "utf8");
    const io = makeIO();
    const code = await identityProposeCmd(file, {}, io, deadClient);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/not valid JSON/i);
  });

  it("a shape-invalid proposals file exits 2 with the VALIDATION message, not 'bridge unreachable' — proves no POST was attempted", async () => {
    const deadClient = new BridgeClient("http://127.0.0.1:19998");
    const file = path.join(root, "bad-shape.json");
    await writeFile(file, JSON.stringify({ proposals: [{ label: "hero" }] }), "utf8"); // missing durableId/confidence/reasoning
    const io = makeIO();
    const code = await identityProposeCmd(file, {}, io, deadClient);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/invalid proposals file/i);
    expect(io.errText()).toMatch(/durableId/);
    // Distinguishing assertion: NOT the transport-error message a real network
    // attempt against the dead client would have produced.
    expect(io.errText()).not.toMatch(/bridge unreachable/i);
  });

  it("exits 2 when the bridge is genuinely unreachable for a WELL-FORMED file", async () => {
    const deadClient = new BridgeClient("http://127.0.0.1:19998");
    const file = path.join(root, "good.json");
    const proposals: IdentityProposal[] = [
      { durableId: "n-a", label: "hero", confidence: "high", reasoning: "r" },
    ];
    await writeFile(file, JSON.stringify({ proposals }), "utf8");
    const io = makeIO();
    const code = await identityProposeCmd(file, {}, io, deadClient);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/bridge unreachable/i);
  });
});

describe("identityProposeCmd — success path against a live bridge", () => {
  let bridgeHandle: { url: string; close: () => Promise<void> };
  let client: BridgeClient;

  beforeEach(async () => {
    bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
    client = new BridgeClient(bridgeHandle.url);
  });

  afterEach(async () => {
    await bridgeHandle.close();
  });

  async function seedManifest(): Promise<void> {
    const manifest: NodeManifest = {
      version: 1,
      records: {
        "n-hero": {
          durableId: "n-hero",
          figmaNodeId: "f-hero",
          address: "hero-old@desktop",
          scope: ["home"],
          path: [{ label: "hero-old", provenance: "inferred", source: "prior-name" }],
          coordinates: { viewport: { value: "desktop", provenance: "derived", source: "structure" } },
          kind: "FRAME",
          pathRoleDefault: "section",
          isDefinition: false,
          matchability: "composed",
          composition: [],
          currentName: "Hero Old",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      },
    };
    await mkdir(path.join(root, ".uxfactory"), { recursive: true });
    await writeFile(
      path.join(root, ".uxfactory", "node-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }

  it("posts a well-formed file, prints applied/skipped, and the manifest actually changes", async () => {
    await seedManifest();
    const file = path.join(root, "identity-proposals.json");
    const proposals: IdentityProposal[] = [
      { durableId: "n-hero", label: "hero-banner", confidence: "high", reasoning: "Lead section with a CTA." },
    ];
    await writeFile(file, JSON.stringify({ proposals }), "utf8");

    const io = makeIO();
    const code = await identityProposeCmd(file, {}, io, client);
    expect(code).toBe(EXIT.OK);
    expect(io.outText()).toMatch(/applied 1, skipped 0/);

    const { manifest } = await client.getIdentityManifest();
    expect(manifest.records["n-hero"]!.path[0]!.label).toBe("hero-banner");
  });

  it("reports skipped:1 for a proposal targeting an unknown durableId", async () => {
    await seedManifest();
    const file = path.join(root, "identity-proposals.json");
    const proposals: IdentityProposal[] = [
      { durableId: "n-ghost", label: "ghost", confidence: "high", reasoning: "No such record." },
    ];
    await writeFile(file, JSON.stringify({ proposals }), "utf8");

    const io = makeIO();
    const code = await identityProposeCmd(file, {}, io, client);
    expect(code).toBe(EXIT.OK);
    expect(io.outText()).toMatch(/applied 0, skipped 1/);
  });

  it("surfaces the bridge's per-proposal errors[] (fix D) when a proposal is skipped due to an unexpected throw", async () => {
    // A registered "dark" mode token, so the mode proposal below normalizes
    // to a real registry member and `applyIdentityProposal` actually
    // proceeds to `serializeAddress` (the default empty-palette registries
    // would otherwise reject "dark" outright — a different code path, not
    // the one this test is proving).
    await fetch(`${bridgeHandle.url}/project/identity/registries`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        registries: {
          version: 1,
          breakpoints: { bands: [{ name: "desktop", min: 0, max: null }] },
          palette: {
            collections: [
              {
                collectionId: "mode-coll",
                name: "Mode",
                axis: "mode",
                values: [{ modeId: "1:0", token: "dark" }],
              },
            ],
          },
          states: { states: ["default"], defaultState: "default" },
        },
      }),
    });

    // A manifest record with a legacy-invalid (pre-existing, un-normalized)
    // last segment — mirrors the bridge's own atomicity test. A mode-only
    // proposal against it doesn't touch that segment, but serialize still
    // throws on it, so the bridge's backstop reports it in `errors[]`.
    const manifest: NodeManifest = {
      version: 1,
      records: {
        "n-legacy": {
          durableId: "n-legacy",
          figmaNodeId: "f-legacy",
          address: "placeholder@desktop",
          scope: ["home"],
          path: [{ label: "Not Valid!!!", provenance: "inferred", source: "prior-name" }],
          coordinates: { viewport: { value: "desktop", provenance: "derived", source: "structure" } },
          kind: "FRAME",
          pathRoleDefault: "section",
          isDefinition: false,
          matchability: "composed",
          composition: [],
          currentName: "Legacy",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      },
    };
    await mkdir(path.join(root, ".uxfactory"), { recursive: true });
    await writeFile(
      path.join(root, ".uxfactory", "node-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const file = path.join(root, "identity-proposals.json");
    const proposals: IdentityProposal[] = [
      { durableId: "n-legacy", mode: "dark", confidence: "low", reasoning: "Should be reported, not silent." },
    ];
    await writeFile(file, JSON.stringify({ proposals }), "utf8");

    const io = makeIO();
    const code = await identityProposeCmd(file, {}, io, client);
    expect(code).toBe(EXIT.OK); // still a successful bridge round-trip
    expect(io.outText()).toMatch(/applied 0, skipped 1/);
    expect(io.errText()).toMatch(/1 proposal\(s\) skipped with an error/);
    expect(io.errText()).toMatch(/n-legacy/);
  });
});

// ---------------------------------------------------------------------------
// identityShowCmd
// ---------------------------------------------------------------------------

describe("identityShowCmd", () => {
  it("exits 2 when the bridge is unreachable", async () => {
    const deadClient = new BridgeClient("http://127.0.0.1:19998");
    const io = makeIO();
    const code = await identityShowCmd({}, io, deadClient);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/bridge unreachable/i);
  });

  it("prints a friendly message for an empty manifest", async () => {
    const bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
    try {
      const client = new BridgeClient(bridgeHandle.url);
      const io = makeIO();
      const code = await identityShowCmd({}, io, client);
      expect(code).toBe(EXIT.OK);
      expect(io.outText()).toMatch(/no records/i);
    } finally {
      await bridgeHandle.close();
    }
  });

  it("prints an addresses table for a non-empty manifest; --json prints the full manifest", async () => {
    const manifest: NodeManifest = {
      version: 1,
      records: {
        "n-hero": {
          durableId: "n-hero",
          figmaNodeId: "f-hero",
          address: "hero@desktop",
          scope: ["home"],
          path: [{ label: "hero", provenance: "derived", source: "structure" }],
          coordinates: { viewport: { value: "desktop", provenance: "derived", source: "structure" } },
          kind: "FRAME",
          pathRoleDefault: "section",
          isDefinition: false,
          composition: [],
          currentName: "Hero",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      },
    };
    await mkdir(path.join(root, ".uxfactory"), { recursive: true });
    await writeFile(
      path.join(root, ".uxfactory", "node-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    const bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
    try {
      const client = new BridgeClient(bridgeHandle.url);

      const humanIO = makeIO();
      expect(await identityShowCmd({}, humanIO, client)).toBe(EXIT.OK);
      expect(humanIO.outText()).toMatch(/hero@desktop/);
      expect(humanIO.outText()).toMatch(/n-hero/);

      const jsonIO = makeIO();
      expect(await identityShowCmd({ json: true }, jsonIO, client)).toBe(EXIT.OK);
      const parsed = JSON.parse(jsonIO.outText()) as NodeManifest;
      expect(parsed).toEqual(manifest);
    } finally {
      await bridgeHandle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// identityCheckCmd
// ---------------------------------------------------------------------------

describe("identityCheckCmd", () => {
  it("exits 2 when the bridge is unreachable", async () => {
    const deadClient = new BridgeClient("http://127.0.0.1:19998");
    const io = makeIO();
    const code = await identityCheckCmd({}, io, deadClient);
    expect(code).toBe(EXIT.TRANSPORT);
    expect(io.errText()).toMatch(/bridge unreachable/i);
  });

  it("exits 0 for an empty manifest and states every check's zero-finding reason, incl. the route checks' vacuous note", async () => {
    const bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
    try {
      const client = new BridgeClient(bridgeHandle.url);
      const io = makeIO();
      const code = await identityCheckCmd({}, io, client);
      expect(code).toBe(EXIT.OK);
      expect(io.outText()).toMatch(/0 finding\(s\) across 5 check\(s\)/);
      expect(io.outText()).not.toMatch(/FAIL/);
      expect(io.outText()).toMatch(/route-traceable-stories: 0 \(vacuous/);
      expect(io.outText()).toMatch(/address-validity: 0 \(clean\)/);
    } finally {
      await bridgeHandle.close();
    }
  });

  /** The bridge reads node-manifest.json fresh off disk on every GET — writing it directly is enough, no API call needed. */
  async function seedManifest(manifest: NodeManifest): Promise<void> {
    await mkdir(path.join(root, ".uxfactory"), { recursive: true });
    await writeFile(
      path.join(root, ".uxfactory", "node-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }

  it("exits 1 (GATE_FAIL) when an address no longer parses against the current registries", async () => {
    const bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
    try {
      const client = new BridgeClient(bridgeHandle.url);
      const manifest: NodeManifest = {
        version: 1,
        records: {
          "n-bad": {
            durableId: "n-bad",
            figmaNodeId: "f-bad",
            address: "hero@nonexistent-coordinate",
            scope: [],
            path: [{ label: "hero", provenance: "derived", source: "structure" }],
            coordinates: {},
            kind: "FRAME",
            pathRoleDefault: "section",
            isDefinition: false,
            composition: [],
            currentName: "Hero",
            updatedAt: "2020-01-01T00:00:00.000Z",
          },
        },
      };
      await seedManifest(manifest);

      const io = makeIO();
      const code = await identityCheckCmd({}, io, client);
      expect(code).toBe(EXIT.GATE_FAIL);
      expect(io.outText()).toMatch(/FAIL \(error-level finding present\)/);
      expect(io.outText()).toMatch(/address-validity: 1 \(1 error\)/);
      expect(io.outText()).toMatch(/\[error\] n-bad:/);
    } finally {
      await bridgeHandle.close();
    }
  });

  it("a drifted record is warn-only — exits 0, not 1 — and --json carries the full findings array", async () => {
    const bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
    try {
      const client = new BridgeClient(bridgeHandle.url);
      const manifest: NodeManifest = {
        version: 1,
        records: {
          "n-drifted": {
            durableId: "n-drifted",
            figmaNodeId: "f-drifted",
            address: "cta@desktop",
            scope: [],
            path: [{ label: "cta", provenance: "derived", source: "structure" }],
            coordinates: { viewport: { value: "desktop", provenance: "derived", source: "structure" } },
            kind: "INSTANCE",
            pathRoleDefault: "component",
            isDefinition: false,
            resolutionStatus: "drifted",
            composition: [],
            currentName: "CTA",
            updatedAt: "2020-01-01T00:00:00.000Z",
          },
        },
      };
      await seedManifest(manifest);

      const humanIO = makeIO();
      expect(await identityCheckCmd({}, humanIO, client)).toBe(EXIT.OK);
      expect(humanIO.outText()).toMatch(/drift-surfacing: 1 \(1 warn\)/);
      expect(humanIO.outText()).toMatch(/should rebind/);

      const jsonIO = makeIO();
      const code = await identityCheckCmd({ json: true }, jsonIO, client);
      expect(code).toBe(EXIT.OK);
      const parsed = JSON.parse(jsonIO.outText()) as { findings: Array<{ level: string; check: string }> };
      expect(parsed.findings).toEqual([
        expect.objectContaining({ level: "warn", check: "drift-surfacing", durableId: "n-drifted" }),
      ]);
    } finally {
      await bridgeHandle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// CLI integration via run()
// ---------------------------------------------------------------------------

describe("identity propose/show — CLI integration via run()", () => {
  it("run(['identity', 'propose', file, '--bridge', url]) exits 2 for a malformed file, without touching the (dead) bridge", async () => {
    const file = path.join(root, "bad.json");
    await writeFile(file, JSON.stringify({ proposals: [{ durableId: "" }] }), "utf8");

    const { run } = await import("../src/cli.js");
    const code = await run([
      "node",
      "uxfactory",
      "identity",
      "propose",
      file,
      "--bridge",
      "http://127.0.0.1:19998",
    ]);
    expect(code).toBe(EXIT.TRANSPORT);
  });

  it("run(['identity', 'show', '--bridge', url]) exits 0 against a live bridge", async () => {
    const bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
    try {
      const { run } = await import("../src/cli.js");
      const code = await run(["node", "uxfactory", "identity", "show", "--bridge", bridgeHandle.url]);
      expect(code).toBe(EXIT.OK);
    } finally {
      await bridgeHandle.close();
    }
  });

  it("run(['identity', 'check', '--bridge', url]) exits 0 against a live bridge with an empty manifest", async () => {
    const bridgeHandle = await startBridge({ port: 0, dataDir: path.join(root, ".uxfactory") });
    try {
      const { run } = await import("../src/cli.js");
      const code = await run(["node", "uxfactory", "identity", "check", "--bridge", bridgeHandle.url]);
      expect(code).toBe(EXIT.OK);
    } finally {
      await bridgeHandle.close();
    }
  });

  it("run(['identity', 'check', '--bridge', deadUrl]) exits 2 when the bridge is unreachable", async () => {
    const { run } = await import("../src/cli.js");
    const code = await run(["node", "uxfactory", "identity", "check", "--bridge", "http://127.0.0.1:19998"]);
    expect(code).toBe(EXIT.TRANSPORT);
  });
});
