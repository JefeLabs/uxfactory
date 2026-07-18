/**
 * personas.test.ts — TDD tests for the persona instance bridge routes (Task 1).
 *
 * `personas` is a SET artifact: one JSON file per persona under
 * `.uxfactory/artifacts/personas/<id>.json`. These routes let the panel
 * manage individual instances (list all, write one, delete one) instead of
 * only opening the whole directory in Finder.
 *
 * Test matrix:
 *  - GET lists every parseable instance and skips malformed files
 *  - GET returns empty when the dir is missing
 *  - PUT writes the instance file and stamps personaId === :id (ignores body id)
 *  - PUT rejects a path-traversal / non-P-NN id with 400 and writes nothing
 *  - DELETE removes the file and is idempotent; rejects a bad id
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { createBridge } from "../src/server.js";

// ─── Fixture helpers (mirrors project.test.ts) ──────────────────────────────

async function mkRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "uxf-personas-"));
}

async function addGitMarker(root: string): Promise<void> {
  await mkdir(path.join(root, ".git"), { recursive: true });
}

const personasDir = (root: string) => path.join(root, ".uxfactory/artifacts/personas");

// ─── Test lifecycle ──────────────────────────────────────────────────────────

let app: FastifyInstance;
let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await mkRoot();
  dataDir = path.join(root, ".uxfactory");
  await mkdir(dataDir, { recursive: true });
  await addGitMarker(root);
  app = await createBridge({ dataDir });
});

afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

describe("persona instance routes", () => {
  it("GET lists every parseable instance and skips malformed files", async () => {
    await mkdir(personasDir(root), { recursive: true });
    await writeFile(path.join(personasDir(root), "P-01.json"), JSON.stringify({ personaId: "P-01", name: "Ana" }));
    await writeFile(path.join(personasDir(root), "P-02.json"), JSON.stringify({ personaId: "P-02", name: "Ben" }));
    await writeFile(path.join(personasDir(root), "broken.json"), "{ not json");
    const res = await app.inject({ method: "GET", url: `/project/personas?root=${encodeURIComponent(root)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { personas: Array<{ personaId: string; name?: string }> };
    expect(body.personas.map((p) => p.personaId).sort()).toEqual(["P-01", "P-02"]);
  });

  it("GET returns empty when the dir is missing", async () => {
    const res = await app.inject({ method: "GET", url: `/project/personas?root=${encodeURIComponent(root)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ personas: [] });
  });

  it("PUT writes the instance file and stamps personaId === :id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/project/personas/P-03?root=${encodeURIComponent(root)}`,
      payload: { persona: { name: "Cara", personaId: "WRONG", goals: ["ship"] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const written = JSON.parse(await readFile(path.join(personasDir(root), "P-03.json"), "utf8")) as {
      personaId: string;
      name: string;
    };
    expect(written.personaId).toBe("P-03"); // server stamps it, ignores the body's wrong id
    expect(written.name).toBe("Cara");
  });

  it("PUT rejects a path-traversal / non-P-NN id with 400 and writes nothing", async () => {
    for (const bad of ["..%2F..%2Fevil", "P-1;rm", "evil", "P-"]) {
      const res = await app.inject({
        method: "PUT",
        url: `/project/personas/${bad}?root=${encodeURIComponent(root)}`,
        payload: { persona: { name: "x" } },
      });
      expect(res.statusCode).toBe(400);
    }
    await expect(access(path.join(root, "evil.json"))).rejects.toThrow();
    await expect(access(path.join(root, ".uxfactory/artifacts/evil.json"))).rejects.toThrow();
  });

  it("PUT rejects a malformed body with 400 and writes nothing", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/project/personas/P-05?root=${encodeURIComponent(root)}`,
      payload: { persona: "not-an-object" },
    });
    expect(res.statusCode).toBe(400);
    await expect(access(path.join(personasDir(root), "P-05.json"))).rejects.toThrow();
  });

  it("DELETE removes the file and is idempotent; rejects a bad id", async () => {
    await mkdir(personasDir(root), { recursive: true });
    await writeFile(path.join(personasDir(root), "P-04.json"), JSON.stringify({ personaId: "P-04" }));
    const del = await app.inject({ method: "DELETE", url: `/project/personas/P-04?root=${encodeURIComponent(root)}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true, deleted: true });
    await expect(access(path.join(personasDir(root), "P-04.json"))).rejects.toThrow();

    const again = await app.inject({ method: "DELETE", url: `/project/personas/P-04?root=${encodeURIComponent(root)}` });
    expect(again.statusCode).toBe(200); // idempotent
    expect(again.json()).toEqual({ ok: true, deleted: false });

    const bad = await app.inject({ method: "DELETE", url: `/project/personas/..%2Fx?root=${encodeURIComponent(root)}` });
    expect(bad.statusCode).toBe(400);
  });
});
