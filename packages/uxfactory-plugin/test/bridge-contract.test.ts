/**
 * bridge-contract.test.ts — Cross-layer wire-drift net.
 *
 * Drives the UI's REAL bridge client (ui/lib/bridge.ts) against the REAL
 * bridge server (packages/uxfactory-bridge/src/server.ts) via fastify inject —
 * no mocks on either side of the wire. Every round-trip asserts through the
 * real client AND against the server-side effect (files in the temp project).
 *
 * Why this exists: a client-mock test once false-greened a nested-vs-flat
 * wire bug — the client sent FLAT dial keys ({visual, editorial, ...}) and the
 * mock happily echoed them back, while the real server expected/wrote a NESTED
 * {scope: {...}} profile. This suite makes that class of drift impossible to
 * miss: the putProfile test sends the exact flat wire body and asserts the
 * nested file the server must write.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createBridge as createBridgeServer } from "@uxfactory/bridge";
import type { BridgeServer } from "@uxfactory/bridge";
import { createBridge as createBridgeClient, BridgeError } from "../ui/lib/bridge.js";
import type { Bridge } from "../ui/lib/bridge.js";

// ─── Inject-backed fetch adapter ─────────────────────────────────────────────
//
// The client hardcodes an absolute base URL (http://localhost:3779) while
// fastify inject wants a server-relative path — so the adapter strips the
// origin and forwards method/headers/body untouched. Anything else the client
// puts on the wire (verb, body shape, content-type) reaches the real routes.

function injectFetch(app: BridgeServer, captured?: string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    captured?.push(`${parsed.pathname}${parsed.search}`);
    const res = await app.inject({
      method: init?.method ?? "GET",
      url: `${parsed.pathname}${parsed.search}`,
      ...(init?.body !== undefined && init.body !== null ? { payload: init.body as string } : {}),
      ...(init?.headers !== undefined ? { headers: init.headers as Record<string, string> } : {}),
    });
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    return {
      ok,
      status: res.statusCode,
      json: async () => JSON.parse(res.body) as unknown,
      text: async () => res.body,
    } as unknown as Response;
  }) as typeof fetch;
}

// ─── Fixtures (mirroring packages/uxfactory-bridge/test/project.test.ts) ─────

const FIXTURE_CLASSIFICATION = {
  category: "ecommerce",
  industry: "consumer",
  style: "mix",
};

const FIXTURE_PROFILE = {
  scope: { visual: "low", editorial: "low", coverage: "low", flow: "low" },
  notes: ["keep me"],
  confirm_status: "approved",
};

const FIXTURE_STORIES = {
  stories: [
    {
      id: "US-1",
      acceptanceCriteria: [
        { id: "AC-1.1", statement: "User can see the homepage" },
        { statement: "User can navigate to product list" },
      ],
    },
    {
      id: "US-2",
      acceptanceCriteria: [{ id: "AC-2.1", statement: "Cart shows item count" }],
    },
  ],
};

const FIXTURE_TOKENS = {
  colors: {
    "primary-500": "#5B5BD6",
    "primary-600": "#4f46e5",
    "success-600": "#16a34a",
  },
};

const SKILL_MD = "# craft-review\nReview skill content\n";

/** Write pretty JSON, creating parent dirs. */
async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/** Read a JSON file back from the temp project (the server-side effect). */
async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

// ─── Lifecycle: real server over a temp-dir project, real client over inject ─

let root: string;
let dataDir: string;
let app: BridgeServer;
let bridge: Bridge;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-contract-"));
  dataDir = path.join(root, ".uxfactory");
  await mkdir(dataDir, { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true }); // project-root marker
  await writeJson(path.join(root, "uxfactory.classification.json"), FIXTURE_CLASSIFICATION);
  await writeJson(path.join(root, "uxfactory.profile.json"), FIXTURE_PROFILE);
  await writeJson(path.join(root, "design/acceptance-criteria.json"), FIXTURE_STORIES);
  await writeJson(path.join(root, "design/token-set.json"), FIXTURE_TOKENS);
  await mkdir(path.join(root, "skill", "craft-review"), { recursive: true });
  await writeFile(path.join(root, "skill", "craft-review", "SKILL.md"), SKILL_MD, "utf8");

  app = await createBridgeServer({
    dataDir,
    reposRegistryPath: path.join(root, "repos-registry.json"),
  });
  bridge = createBridgeClient(injectFetch(app));
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

// ─── connectProject ──────────────────────────────────────────────────────────

describe("contract: connectProject", () => {
  it("served root → ok:true with a full snapshot", async () => {
    const result = await bridge.connectProject(root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.snapshot.root).toBe(root);
    expect(result.snapshot.name).toBe(path.basename(root));
    expect(result.snapshot.hasClassification).toBe(true);
    expect(result.snapshot.hasProfile).toBe(true);
    expect(Array.isArray(result.snapshot.artifacts)).toBe(true);
    expect(result.snapshot.artifacts.length).toBeGreaterThan(0);
    expect(result.snapshot.requirements).toHaveLength(3);
  });

  it("a different valid root → ok:true with that root's snapshot (registered)", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "uxf-contract-other-"));
    try {
      await mkdir(path.join(other, ".git"), { recursive: true });
      const result = await bridge.connectProject(other);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.snapshot.root).toBe(other);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("server 400 surfaces as BridgeError through the real client", async () => {
    await expect(bridge.connectProject("")).rejects.toBeInstanceOf(BridgeError);
    await expect(bridge.connectProject("")).rejects.toMatchObject({ status: 400 });
  });
});

// ─── snapshot ────────────────────────────────────────────────────────────────

describe("contract: snapshot", () => {
  it("returns artifacts array and requirements parsed from the stories file", async () => {
    const snap = await bridge.snapshot();
    expect(snap.root).toBe(root);

    const byKey = Object.fromEntries(snap.artifacts.map((a) => [a.key, a]));
    expect(byKey["requirements"]?.status).toBe("up-to-date");
    expect(byKey["tokens"]?.status).toBe("up-to-date");
    expect(byKey["tokens"]?.meta).toBe("3 colors");

    expect(snap.requirements).toEqual([
      { id: "AC-1.1", title: "User can see the homepage" },
      { id: "US-1-2", title: "User can navigate to product list" },
      { id: "AC-2.1", title: "Cart shows item count" },
    ]);
  });
});

// ─── putClassification ───────────────────────────────────────────────────────

describe("contract: putClassification", () => {
  it("writes the exact body to uxfactory.classification.json", async () => {
    const cls = { category: "web_app", industry: "education", style: "formal" };
    const res = await bridge.putClassification(cls);
    expect(res).toEqual({ ok: true });

    // Server-side effect: the file in the temp project is the PUT body.
    const onDisk = await readJson(path.join(root, "uxfactory.classification.json"));
    expect(onDisk).toEqual(cls);
  });
});

// ─── putProfile — the historical nested-vs-flat wire bug, permanently netted ─

describe("contract: putProfile (flat wire body → nested profile file)", () => {
  it("flat dial keys land under scope, coherence under experimental, style in classification", async () => {
    const res = await bridge.putProfile({
      style: "informal",
      visual: "high",
      editorial: "medium",
      flow: "low",
      coverage: "medium",
      coherence: "high",
    });
    expect(res).toEqual({ ok: true });

    // Server-side effect: the profile FILE is nested, not flat.
    const profile = await readJson(path.join(root, "uxfactory.profile.json"));
    expect(profile["scope"]).toMatchObject({
      visual: "high",
      editorial: "medium",
      flow: "low",
      coverage: "medium",
    });
    expect((profile["experimental"] as Record<string, unknown>)["coherence"]).toBe("high");

    // The flat wire keys must NOT have leaked to the top level of the file.
    expect(profile["visual"]).toBeUndefined();
    expect(profile["editorial"]).toBeUndefined();
    expect(profile["flow"]).toBeUndefined();
    expect(profile["coverage"]).toBeUndefined();
    expect(profile["coherence"]).toBeUndefined();
    expect(profile["style"]).toBeUndefined();

    // Merge semantics: pre-existing profile fields survive the PUT.
    expect(profile["notes"]).toEqual(["keep me"]);
    expect(profile["confirm_status"]).toBe("approved");

    // style propagates into the classification file (merged, not clobbered).
    const cls = await readJson(path.join(root, "uxfactory.classification.json"));
    expect(cls["style"]).toBe("informal");
    expect(cls["category"]).toBe("ecommerce");

    // And the real client reads the nested shape back through the real server.
    const snap = await bridge.snapshot();
    expect((snap.profile?.["scope"] as Record<string, string>)["visual"]).toBe("high");
    expect((snap.profile?.["experimental"] as Record<string, string>)["coherence"]).toBe("high");
  });
});

// ─── links round-trip ────────────────────────────────────────────────────────

describe("contract: getLinks / putLinks", () => {
  it("starts empty, PUT writes .uxfactory/links.json, GET reads it back", async () => {
    expect(await bridge.getLinks()).toEqual({ links: [] });

    const links = [
      { nodeId: "1:2", unitName: "HeroSection", unitType: "organism", acId: "AC-1.1" },
      { nodeId: "3:4", unitName: "CartBadge", unitType: "molecule", acId: "AC-2.1" },
    ];
    expect(await bridge.putLinks(links)).toEqual({ ok: true });

    // Server-side effect: links.json under the data dir holds the array.
    const onDisk = JSON.parse(await readFile(path.join(dataDir, "links.json"), "utf8"));
    expect(onDisk).toEqual(links);

    // Round-trip through the real client.
    expect(await bridge.getLinks()).toEqual({ links });
  });
});

// ─── skills ──────────────────────────────────────────────────────────────────

describe("contract: skills", () => {
  it("lists the fixture skill dir with a deterministic 7-hex rev", async () => {
    const res = await bridge.skills!();
    const expectedRev = createHash("sha256").update(SKILL_MD, "utf8").digest("hex").slice(0, 7);
    expect(res.skills).toEqual([{ name: "craft-review", rev: expectedRev, pinned: false }]);
  });
});

// ─── stats ───────────────────────────────────────────────────────────────────

describe("contract: stats", () => {
  it("returns the BridgeStats shape with tokenCount from the tokens fixture", async () => {
    const stats = await bridge.stats();
    expect(typeof stats.version).toBe("string");
    expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(stats.runsRelayed).toBe(0);
    expect(stats.tokenCount).toBe(3);
  });
});

// ─── fs/cwd ──────────────────────────────────────────────────────────────────

describe("contract: getCwd", () => {
  it("returns the bridge process cwd for the Connect screen hint", async () => {
    const res = await bridge.getCwd!();
    expect(res).toEqual({ cwd: process.cwd() });
  });
});

// ─── root-carrying contract ───────────────────────────────────────────────────

describe("contract: setProjectRoot appends ?root= to root-scoped verbs", () => {
  it("every /project/* + enqueue call carries the encoded root; connect does not", async () => {
    const captured: string[] = [];
    const rooted = createBridgeClient(injectFetch(app, captured));
    rooted.setProjectRoot!(root);

    await rooted.snapshot();
    await rooted.putClassification({ category: "x" });
    await rooted.putProfile({ visual: "high" });
    await rooted.getLinks();
    await rooted.putLinks([]);
    await rooted.putArtifact!("brief", "# b\n");
    await rooted.getArtifact!("brief");
    await rooted.enqueue({ kind: "k", payload: {} });

    const enc = encodeURIComponent(root);
    const rootedCalls = captured.filter(
      (u) =>
        u.startsWith("/project/snapshot") ||
        u.startsWith("/project/classification") ||
        u.startsWith("/project/profile") ||
        u.startsWith("/project/links") ||
        u.startsWith("/project/artifact") ||
        u.startsWith("/pipeline/request"),
    );
    expect(rootedCalls.length).toBeGreaterThanOrEqual(8);
    for (const u of rootedCalls) expect(u).toContain(`root=${enc}`);

    // connect (registration) must NOT carry ?root=.
    captured.length = 0;
    await rooted.connectProject(root);
    const connect = captured.find((u) => u.startsWith("/project/connect"))!;
    expect(connect).not.toContain("root=");
  });

  it("getArtifact keeps its key param and adds root with &", async () => {
    const captured: string[] = [];
    const rooted = createBridgeClient(injectFetch(app, captured));
    rooted.setProjectRoot!(root);
    await rooted.getArtifact!("brief").catch(() => undefined);
    const call = captured.find((u) => u.startsWith("/project/artifact"))!;
    expect(call).toContain("key=brief");
    expect(call).toContain(`root=${encodeURIComponent(root)}`);
    expect(call.indexOf("&root=")).toBeGreaterThan(-1);
  });

  it("with NO project root set, scoped verbs emit byte-identical legacy URLs (no root=)", async () => {
    // The old-bridge compat row: an unrooted client's wire must be exactly
    // today's — a stray root= (even root=null) would break legacy bridges.
    const captured: string[] = [];
    const unrooted = createBridgeClient(injectFetch(app, captured));

    await unrooted.snapshot();
    await unrooted.putClassification({ category: "x" });
    await unrooted.putProfile({ visual: "high" });
    await unrooted.getLinks();
    await unrooted.getArtifact!("brief").catch(() => undefined);
    await unrooted.enqueue({ kind: "k", payload: {} });

    expect(captured.length).toBeGreaterThanOrEqual(6);
    for (const u of captured) expect(u).not.toContain("root=");
    // Spot-check exact legacy shapes for a bare and a query-carrying verb.
    expect(captured).toContain("/project/snapshot");
    expect(captured).toContain("/project/artifact?key=brief");
  });

  it("render relay verbs (/next, /rendered) carry ?root= when rooted", async () => {
    const captured: string[] = [];
    const client = createBridgeClient(injectFetch(app, captured));
    client.setProjectRoot!(root);

    await client.nextRenderJob!().catch(() => null);
    await client.postRenderReport!({ ok: true, jobId: "j1" }).catch(() => null);

    const enc = encodeURIComponent(root);
    expect(captured.find((u) => u.startsWith("/next"))).toContain(`root=${enc}`);
    expect(captured.find((u) => u.startsWith("/rendered"))).toContain(`root=${enc}`);
  });

  it("approval queue verbs carry ?root= when rooted", async () => {
    const captured: string[] = [];
    const client = createBridgeClient(injectFetch(app, captured));
    client.setProjectRoot!(root);

    await client.listRenderQueue!().catch(() => null);
    await client.approveRenderJob!("job_x").catch(() => null);
    await client.discardRenderJob!("job_x").catch(() => null);

    const enc = encodeURIComponent(root);
    expect(captured.find((u) => u.startsWith("/queue?"))).toContain(`root=${enc}`);
    expect(captured.find((u) => u.startsWith("/queue/job_x/approve"))).toContain(`root=${enc}`);
    expect(captured.find((u) => u.startsWith("/queue/job_x/discard"))).toContain(`root=${enc}`);
  });

  it("render relay verbs stay byte-identical legacy when unrooted", async () => {
    const captured: string[] = [];
    const unrooted = createBridgeClient(injectFetch(app, captured));

    await unrooted.nextRenderJob!().catch(() => null);
    await unrooted.postRenderReport!({ ok: true }).catch(() => null);

    expect(captured).toContain("/next");
    expect(captured).toContain("/rendered");
    for (const u of captured) expect(u).not.toContain("root=");
  });

  it("getRepos returns the ReposResponse shape from the real server", async () => {
    const res = await bridge.getRepos!();
    expect(res.cwd).toBe(root);
    expect(Array.isArray(res.repos)).toBe(true);
    expect(res.repos[0]!.root).toBe(root);
  });
});
