/**
 * personas.test.ts — TDD tests for the persona instance bridge routes (Task 1)
 * plus the read/write-asymmetry fix (final whole-branch review, Important
 * finding): `readPersonas` now keys the exposed `personaId` on the FILENAME
 * STEM always (never the body's own field), and PUT/DELETE accept any
 * traversal-safe slug — not just `P-NN` — so hand-authored instances are
 * manageable too.
 *
 * Test matrix:
 *  - GET lists every parseable instance and skips malformed files
 *  - GET returns empty when the dir is missing
 *  - GET keys personaId on the filename, overriding a disagreeing body id
 *    (closes the silent-orphan bug: editing addresses the file that was
 *    actually listed, not a body id that could point at a different file)
 *  - PUT writes the instance file and stamps personaId === :id (ignores body id)
 *  - PUT accepts a hand-authored (non-P-NN) slug id and writes it
 *  - PUT rejects a path-traversal / unsafe-character id with 400 and writes nothing
 *  - DELETE removes the file and is idempotent; rejects a bad id
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, readdir, rm, access } from "node:fs/promises";
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

  it("GET keys personaId on the FILENAME, overriding a disagreeing body id — and a subsequent PUT writes back the SAME file (no orphan)", async () => {
    await mkdir(personasDir(root), { recursive: true });
    // Hand-edited/corrupted: the file is P-01.json but its body claims P-99.
    await writeFile(
      path.join(personasDir(root), "P-01.json"),
      JSON.stringify({ personaId: "P-99", name: "Ana" }),
    );
    const res = await app.inject({ method: "GET", url: `/project/personas?root=${encodeURIComponent(root)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { personas: Array<{ personaId: string; name?: string }> };
    // Filename wins — the panel must address this instance as P-01, matching
    // the file PUT/DELETE would actually operate on.
    expect(body.personas).toEqual([{ personaId: "P-01", name: "Ana" }]);

    // Editing "P-01" (the id the list reported) must write back P-01.json,
    // not mint a new P-99.json and orphan the original.
    const put = await app.inject({
      method: "PUT",
      url: `/project/personas/P-01?root=${encodeURIComponent(root)}`,
      payload: { persona: { name: "Ana Updated" } },
    });
    expect(put.statusCode).toBe(200);
    const writtenP01 = JSON.parse(
      await readFile(path.join(personasDir(root), "P-01.json"), "utf8"),
    ) as { personaId: string; name: string };
    expect(writtenP01).toEqual({ personaId: "P-01", name: "Ana Updated" });
    await expect(access(path.join(personasDir(root), "P-99.json"))).rejects.toThrow(); // no orphan
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

  it("PUT rejects a path-traversal / unsafe-character id with 400 and writes nothing", async () => {
    // PERSONA_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/ — first char alphanumeric,
    // rest alphanumeric/-/_. Note "evil" and "P-" are now VALID (hand-authored
    // slugs are allowed) — they moved to the "accepts" tests below.
    const bad = [
      "..%2F..%2Fevil", // traversal, decodes to "../../evil"
      "a%2Fb", // encoded "/" mid-id
      "a%5Cb", // encoded "\" mid-id
      "a.b", // "." mid-id
      ".hidden", // leading "." (first char not alphanumeric)
      "-lead", // leading "-" (first char not alphanumeric)
      "_lead", // leading "_" (first char not alphanumeric)
      "P-1;rm", // ";" — shell-metacharacter-shaped, not in the allowed charset
      "a%20b", // space mid-id
      "%20", // space-only id
      "", // empty id (matches :id as an empty segment)
    ];
    for (const id of bad) {
      const res = await app.inject({
        method: "PUT",
        url: `/project/personas/${id}?root=${encodeURIComponent(root)}`,
        payload: { persona: { name: "x" } },
      });
      expect(res.statusCode).toBe(400);
    }
    await expect(access(path.join(root, "evil.json"))).rejects.toThrow();
    await expect(access(path.join(root, ".uxfactory/artifacts/evil.json"))).rejects.toThrow();
    const entries = await readdir(personasDir(root)).catch(() => []);
    expect(entries).toEqual([]); // nothing landed in the personas dir either
  });

  it("PUT accepts a hand-authored (non-P-NN) slug id and writes <id>.json", async () => {
    for (const id of ["ana", "evil", "P-", "user_1", "a-b-c"]) {
      const res = await app.inject({
        method: "PUT",
        url: `/project/personas/${id}?root=${encodeURIComponent(root)}`,
        payload: { persona: { name: "Hand-authored" } },
      });
      expect(res.statusCode).toBe(200);
      const written = JSON.parse(
        await readFile(path.join(personasDir(root), `${id}.json`), "utf8"),
      ) as { personaId: string };
      expect(written.personaId).toBe(id);
    }
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

  it("DELETE accepts a hand-authored (non-P-NN) slug id", async () => {
    await mkdir(personasDir(root), { recursive: true });
    await writeFile(path.join(personasDir(root), "ana.json"), JSON.stringify({ personaId: "ana" }));
    const del = await app.inject({ method: "DELETE", url: `/project/personas/ana?root=${encodeURIComponent(root)}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true, deleted: true });
    await expect(access(path.join(personasDir(root), "ana.json"))).rejects.toThrow();
  });
});
