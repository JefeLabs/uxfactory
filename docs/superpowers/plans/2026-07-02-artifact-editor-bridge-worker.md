# Artifact Editor v1 — Bridge Routes + Worker Brief Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /project/artifact` and `PUT /project/artifact` routes to the bridge, and add brief-section and no-restatement instructions to the worker's brief plan.

**Architecture:** Two additive Fastify routes inside `projectPlugin` resolve artifact paths via a new `resolveConcernPath` helper that mirrors `buildArtifacts` path logic (registry-aware for tokens/requirements). The worker's `planGenerative` gains a `briefNote` string computed only when `artifact === 'brief'`. No existing routes or logic are changed.

**Tech Stack:** Node.js / TypeScript / Fastify (bridge); plain TypeScript (worker). Tests use Vitest + temp-dir fixtures.

## Global Constraints

- Touch ONLY: `packages/uxfactory-bridge/src/project.ts`, `packages/uxfactory-bridge/test/project.test.ts`, `clients/uxfactory-worker/src/generative.ts`, `clients/uxfactory-worker/test/worker.test.ts`.
- Do NOT modify `server.ts`, `store.ts`, `index.ts`, any plugin package, or any other file outside these four.
- CORS already allows PUT (`server.ts` line 74 registers `methods: [..., "PUT", ...]`). No CORS changes needed.
- `mkdir` must be imported from `node:fs/promises` in `project.ts` (it is currently absent from that import).
- The `resolveConcernPath` function must never throw. Unknown keys return `null`.
- Tests run with: `pnpm --filter @uxfactory/bridge test` and `pnpm --filter uxfactory-worker test`.
- Commit only the four files, on `main`, with exact message: `feat(bridge,worker): artifact content routes; brief plan sections and no-restatement rule\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Add `resolveConcernPath` helper to `project.ts`

**Files:**
- Modify: `packages/uxfactory-bridge/src/project.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface ConcernPath {
    absolutePath: string;  // absolute path on disk
    relativePath: string;  // root-relative (forward-slash on all platforms from path.relative)
    format: 'markdown' | 'json';
    exists: boolean;
  }
  async function resolveConcernPath(key: string, root: string): Promise<ConcernPath | null>
  ```
  Returns `null` for unknown keys. Never throws.

- [ ] **Step 1: Add `mkdir` to the node:fs/promises import**

  Open `packages/uxfactory-bridge/src/project.ts`. Find the import block at the top:
  ```typescript
  import {
    readFile,
    writeFile,
    readdir,
    access,
    stat,
  } from "node:fs/promises";
  ```
  Change it to:
  ```typescript
  import {
    readFile,
    writeFile,
    mkdir,
    readdir,
    access,
    stat,
  } from "node:fs/promises";
  ```

- [ ] **Step 2: Add the `CONCERN_CANONICAL` constant below the existing path constants**

  The three existing constants are around line 98–100:
  ```typescript
  const STORIES_PATH = "design/acceptance-criteria.json";
  const TOKENS_PATH = "design/token-set.json";
  const DESIGN_SYSTEM_PATH = "design/design-system.json";
  ```

  Insert immediately after those three lines:
  ```typescript
  /**
   * Canonical write-path for each panel concern key. Used when no existing file
   * is found during path resolution (the "create new" case for GET 404 / PUT mkdir).
   */
  const CONCERN_CANONICAL: Record<string, string> = {
    brief: "brief.md",
    requirements: STORIES_PATH,
    sitemap: "design/sitemap.json",
    flows: "design/flows.json",
    "brand-colors": DESIGN_SYSTEM_PATH,
    palettes: DESIGN_SYSTEM_PATH,
    fonts: DESIGN_SYSTEM_PATH,
    grid: DESIGN_SYSTEM_PATH,
    tokens: TOKENS_PATH,
    icons: "design/assets/icons.json",
    photography: "design/assets/photography.json",
    illustrations: "design/assets/illustrations.json",
  };
  ```

- [ ] **Step 3: Add the `ConcernPath` interface and `resolveConcernPath` function**

  These go in the "Utility helpers" section, after the existing `findByPrefix` function (around line 160) and before `resolveInputPaths`. Insert after the closing brace of `findByPrefix`:

  ```typescript
  /** Shape returned by {@link resolveConcernPath}. */
  interface ConcernPath {
    /** Absolute path to the artifact file. */
    absolutePath: string;
    /** Root-relative path string (for the response body). */
    relativePath: string;
    /** Format inferred from the file extension. */
    format: "markdown" | "json";
    /** Whether the file currently exists on disk. */
    exists: boolean;
  }

  /**
   * Resolve a panel concern key to its artifact path, mirroring the same logic as
   * `buildArtifacts` (registry-aware for tokens/requirements; prefix-search for
   * sitemap/flows; two-candidate search for brief). Returns `null` for unknown keys.
   * Never throws.
   */
  async function resolveConcernPath(
    key: string,
    root: string,
  ): Promise<ConcernPath | null> {
    if (!Object.prototype.hasOwnProperty.call(CONCERN_CANONICAL, key)) return null;

    let absolutePath: string;
    let exists = false;

    if (key === "brief") {
      // Mirror buildArtifacts: check brief.md first, then design/brief.md.
      let found: string | null = null;
      for (const rel of ["brief.md", "design/brief.md"]) {
        const abs = path.join(root, rel);
        if (await fileAccessible(abs)) {
          found = abs;
          break;
        }
      }
      absolutePath = found ?? path.join(root, "brief.md");
      exists = found !== null;
    } else if (key === "requirements") {
      const { storiesPath } = await resolveInputPaths(root);
      absolutePath = storiesPath;
      exists = await fileAccessible(absolutePath);
    } else if (key === "tokens") {
      const { tokensPath } = await resolveInputPaths(root);
      absolutePath = tokensPath;
      exists = await fileAccessible(absolutePath);
    } else if (key === "sitemap" || key === "flows") {
      const designDir = path.join(root, "design");
      const found = await findByPrefix(designDir, key);
      absolutePath = found ?? path.join(root, CONCERN_CANONICAL[key]!);
      exists = found !== null;
    } else {
      // All remaining keys (design-system sections, assets) have a single conventional path.
      absolutePath = path.join(root, CONCERN_CANONICAL[key]!);
      exists = await fileAccessible(absolutePath);
    }

    const relativePath = path.relative(root, absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const format: "markdown" | "json" = ext === ".md" ? "markdown" : "json";

    return { absolutePath, relativePath, format, exists };
  }
  ```

- [ ] **Step 4: Run the bridge tests to verify nothing is broken (no new tests yet)**

  ```bash
  pnpm --filter @uxfactory/bridge test
  ```
  Expected: all existing tests pass (the new helper is not yet called by any route).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/uxfactory-bridge/src/project.ts
  git commit -m "feat(bridge): add resolveConcernPath helper for artifact routes"
  ```

---

### Task 2: Add `GET /project/artifact` route to `project.ts`

**Files:**
- Modify: `packages/uxfactory-bridge/src/project.ts`

**Interfaces:**
- Consumes: `resolveConcernPath(key, servedRoot): Promise<ConcernPath | null>` (from Task 1)
- Produces:
  ```
  GET /project/artifact?key=<concernKey>
  200 → { key: string, path: string, format: "markdown"|"json", content: string }
  400 → { error: string }   (unknown key or missing/empty key)
  404 → { error: string }   (known key but file absent)
  ```

- [ ] **Step 1: Add the GET route inside `projectPlugin`**

  Inside the `projectPlugin` async function, after the `GET /skills` route handler (the last route, ending around line 653) and before the closing `};` of the plugin, insert:

  ```typescript
  // ── GET /project/artifact ────────────────────────────────────────────────
  app.get<{ Querystring: { key?: string } }>("/project/artifact", async (req, reply) => {
    const key = req.query.key;
    if (typeof key !== "string" || key.trim() === "") {
      return reply.code(400).send({ error: "key query param is required" });
    }

    const resolved = await resolveConcernPath(key, servedRoot);
    if (resolved === null) {
      return reply.code(400).send({ error: `unknown concern key: ${key}` });
    }

    if (!resolved.exists) {
      return reply.code(404).send({ error: `artifact not found: ${key}` });
    }

    // Containment check — the resolved path must be inside the served root.
    const rootWithSep = servedRoot.endsWith(path.sep) ? servedRoot : servedRoot + path.sep;
    if (resolved.absolutePath !== servedRoot && !resolved.absolutePath.startsWith(rootWithSep)) {
      return reply
        .code(400)
        .send({ error: "artifact path is outside the project root", key });
    }

    const content = await readFile(resolved.absolutePath, "utf8");
    return { key, path: resolved.relativePath, format: resolved.format, content };
  });
  ```

- [ ] **Step 2: Run the bridge tests**

  ```bash
  pnpm --filter @uxfactory/bridge test
  ```
  Expected: all existing tests still pass.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/uxfactory-bridge/src/project.ts
  git commit -m "feat(bridge): add GET /project/artifact route"
  ```

---

### Task 3: Add `PUT /project/artifact` route to `project.ts`

**Files:**
- Modify: `packages/uxfactory-bridge/src/project.ts`

**Interfaces:**
- Consumes: `resolveConcernPath(key, servedRoot)` (Task 1); `mkdir` (added in Task 1 import)
- Produces:
  ```
  PUT /project/artifact  body: { key: string, content: string }
  200 → { ok: true }
  400 → { error: string }   (unknown key, non-string key/content, or path outside root)
  ```

- [ ] **Step 1: Add the PUT route immediately after the GET /project/artifact route**

  ```typescript
  // ── PUT /project/artifact ────────────────────────────────────────────────
  app.put<{ Body: { key?: unknown; content?: unknown } }>(
    "/project/artifact",
    async (req, reply) => {
      const { key, content } = (req.body ?? {}) as { key?: unknown; content?: unknown };

      if (typeof key !== "string" || key.trim() === "") {
        return reply.code(400).send({ error: "key must be a non-empty string" });
      }
      if (typeof content !== "string") {
        return reply.code(400).send({ error: "content must be a string" });
      }

      const resolved = await resolveConcernPath(key, servedRoot);
      if (resolved === null) {
        return reply.code(400).send({ error: `unknown concern key: ${key}` });
      }

      // Containment check — guard against a registry pointing outside root.
      const rootWithSep = servedRoot.endsWith(path.sep) ? servedRoot : servedRoot + path.sep;
      if (resolved.absolutePath !== servedRoot && !resolved.absolutePath.startsWith(rootWithSep)) {
        return reply
          .code(400)
          .send({ error: "artifact path is outside the project root", key });
      }

      // mkdir -p the parent directory so writing to a new location always succeeds.
      await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await writeFile(resolved.absolutePath, content, "utf8");

      return { ok: true };
    },
  );
  ```

- [ ] **Step 2: Run the bridge tests**

  ```bash
  pnpm --filter @uxfactory/bridge test
  ```
  Expected: all existing tests still pass.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/uxfactory-bridge/src/project.ts
  git commit -m "feat(bridge): add PUT /project/artifact route"
  ```

---

### Task 4: Add bridge tests for the artifact routes

**Files:**
- Modify: `packages/uxfactory-bridge/test/project.test.ts`

**Interfaces:**
- Consumes: `createBridge` (same test helper used throughout the existing file); `addGitMarker`, `mkRoot`, `writeJson`, `writeTxt` (existing test helpers in the file)

- [ ] **Step 1: Add the `GET /project/artifact` test suite at the end of the file**

  Append to the end of `packages/uxfactory-bridge/test/project.test.ts` (after the final `});` of the `GET /skills` suite):

  ```typescript
  // ─── GET /project/artifact ───────────────────────────────────────────────────

  describe("GET /project/artifact", () => {
    beforeEach(async () => {
      await addGitMarker(root);
      app = await createBridge({ dataDir });
    });

    it("round-trip: PUT brief → GET returns content + path + format", async () => {
      const briefContent = "# My Brief\n\n## Overview\nGreat product.\n";

      // Write via PUT.
      const put = await app.inject({
        method: "PUT",
        url: "/project/artifact",
        payload: { key: "brief", content: briefContent },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual({ ok: true });

      // Read via GET.
      const get = await app.inject({
        method: "GET",
        url: "/project/artifact?key=brief",
      });
      expect(get.statusCode).toBe(200);
      const body = get.json() as {
        key: string;
        path: string;
        format: string;
        content: string;
      };
      expect(body.key).toBe("brief");
      expect(body.path).toBe("brief.md");
      expect(body.format).toBe("markdown");
      expect(body.content).toBe(briefContent);
    });

    it("round-trip: snapshot reflects up-to-date after PUT brief", async () => {
      await app.inject({
        method: "PUT",
        url: "/project/artifact",
        payload: { key: "brief", content: "# Brief\n\n## Overview\nHello.\n" },
      });

      const snap = (
        await app.inject({ method: "GET", url: "/project/snapshot" })
      ).json() as { artifacts: Array<{ key: string; status: string }> };
      const byKey = Object.fromEntries(snap.artifacts.map((a) => [a.key, a]));
      expect(byKey["brief"]?.status).toBe("up-to-date");
    });

    it("unknown key → 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/project/artifact?key=nonexistent-artifact-xyz",
      });
      expect(res.statusCode).toBe(400);
    });

    it("missing key query param → 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/project/artifact",
      });
      expect(res.statusCode).toBe(400);
    });

    it("known key but file absent → 404", async () => {
      // brief.md does not exist (fresh root with only .git marker)
      const res = await app.inject({
        method: "GET",
        url: "/project/artifact?key=brief",
      });
      expect(res.statusCode).toBe(404);
    });

    it("registry-resolved path honored: tokens at a non-conventional path", async () => {
      // Point registry to a custom tokens path.
      await writeJson(path.join(root, "uxfactory.batch.json"), {
        version: 1,
        inputs: { tokens: "custom/my-tokens.json" },
      });
      const tokenContent = JSON.stringify({ colors: { primary: "#fff" } });
      await writeJson(path.join(root, "custom/my-tokens.json"), {
        colors: { primary: "#fff" },
      });

      const get = await app.inject({
        method: "GET",
        url: "/project/artifact?key=tokens",
      });
      expect(get.statusCode).toBe(200);
      const body = get.json() as { key: string; path: string; format: string; content: string };
      expect(body.key).toBe("tokens");
      // The path returned is root-relative and points to the registry location.
      expect(body.path).toBe("custom/my-tokens.json");
      expect(body.format).toBe("json");
      expect(JSON.parse(body.content)).toMatchObject({ colors: { primary: "#fff" } });
    });

    it("traversal-safe: a registry-pointing-outside-root yields 400", async () => {
      // A crafted batch.json points tokens outside the project root.
      // Even though the resolve succeeds, the containment check must catch it.
      await writeJson(path.join(root, "uxfactory.batch.json"), {
        version: 1,
        inputs: { tokens: "../../etc/passwd" },
      });

      // The file won't exist, so we'd normally get 404 — but the containment
      // check fires first on GET. We just need to NOT get 200.
      const res = await app.inject({
        method: "GET",
        url: "/project/artifact?key=tokens",
      });
      // Either 400 (containment blocked) or 404 (file absent) is acceptable.
      // What we must NOT get is 200 with contents of /etc/passwd.
      expect(res.statusCode).not.toBe(200);
    });
  });

  // ─── PUT /project/artifact ───────────────────────────────────────────────────

  describe("PUT /project/artifact", () => {
    beforeEach(async () => {
      await addGitMarker(root);
      app = await createBridge({ dataDir });
    });

    it("unknown key → 400", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/project/artifact",
        payload: { key: "totally-unknown", content: "stuff" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("missing content → 400", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/project/artifact",
        payload: { key: "brief" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("creates parent directory when it does not exist (mkdir -p semantics)", async () => {
      // icons lives under design/assets/ which does not exist yet.
      const res = await app.inject({
        method: "PUT",
        url: "/project/artifact",
        payload: { key: "icons", content: JSON.stringify({ icons: [] }) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      // The file should now exist.
      const get = await app.inject({
        method: "GET",
        url: "/project/artifact?key=icons",
      });
      expect(get.statusCode).toBe(200);
    });

    it("registry-resolved PUT: writes tokens to the non-conventional path", async () => {
      await writeJson(path.join(root, "uxfactory.batch.json"), {
        version: 1,
        inputs: { tokens: "tokens/custom.json" },
      });

      const tokenContent = JSON.stringify({ colors: { accent: "#0f0" } }, null, 2);
      const put = await app.inject({
        method: "PUT",
        url: "/project/artifact",
        payload: { key: "tokens", content: tokenContent },
      });
      expect(put.statusCode).toBe(200);

      // Verify via GET that it's at the registry path.
      const get = await app.inject({
        method: "GET",
        url: "/project/artifact?key=tokens",
      });
      expect(get.statusCode).toBe(200);
      const body = get.json() as { path: string };
      expect(body.path).toBe("tokens/custom.json");
    });
  });
  ```

- [ ] **Step 2: Run the bridge tests — all must pass**

  ```bash
  pnpm --filter @uxfactory/bridge test
  ```
  Expected output: all tests pass, including the new suites. You should see the new test names in the output.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/uxfactory-bridge/test/project.test.ts
  git commit -m "test(bridge): artifact GET/PUT round-trip, unknown key, 404, registry path, traversal-safe"
  ```

---

### Task 5: Add brief content rule to `generative.ts`

**Files:**
- Modify: `clients/uxfactory-worker/src/generative.ts`

**Interfaces:**
- Consumes: `artifact` local variable in `planGenerative` (already narrowed to `PanelArtifactKey`)
- Produces: `briefNote` string injected into the `user` instruction when `artifact === 'brief'`

The key requirement (spec §2 Worker):
1. Mandate exactly these `## ` sections in order: `Overview`, `Audience & insight`, `Goals & success metrics`, `Scope & constraints`, `Risks & open questions`
2. Forbid restating classification/profile values
3. Require net-new substance or an honest `TBD — needs user input` line per section

- [ ] **Step 1: Write the failing test first (see Task 6, Step 1) — come back here after the test fails**

  (The test is in the next task; implement it first so you know the assertion strings before you write the prompt.)

- [ ] **Step 2: Add `briefNote` to the panel-artifact path in `planGenerative`**

  In `clients/uxfactory-worker/src/generative.ts`, find the panel-artifact path inside `planGenerative` (around line 590). The current `user` string construction looks like:

  ```typescript
  const user =
    `Write the ${entry.label} artifact to ${entry.path} inside ${ctx.projectRoot}.` +
    ` Ground the content in uxfactory.classification.json and uxfactory.profile.json` +
    ` (read both first).${sectionNote}` +
    ` Keep the output strictly the artifact file:` +
    ` valid JSON for .json targets, Markdown for .md targets.` +
    ` Report the written path once done.${guidanceNote}`;
  ```

  Replace the block from `const sectionNote = ...` through `return { ... }` with:

  ```typescript
  const sectionNote =
    entry.sectionKey !== undefined
      ? ` Merge ONLY the '${entry.sectionKey}' section into ${entry.path}` +
        ` (create the file if absent, preserve all other sections).`
      : '';
  const briefNote =
    artifact === 'brief'
      ? ' Structure the document with exactly these ## sections in order:' +
        ' ## Overview, ## Audience & insight, ## Goals & success metrics,' +
        ' ## Scope & constraints, ## Risks & open questions.' +
        ' DO NOT restate classification or profile values (category, industry, platforms,' +
        ' scope dials — these are pinned config, not brief content); reference them only' +
        ' where an implication matters (e.g. "given the mobile-first audience").' +
        ' Every section must carry net-new substance; if a section is genuinely unknown' +
        ' at this time, write a single "TBD — needs user input" line.'
      : '';
  const guidanceNote =
    guidance !== undefined && guidance.trim() !== ''
      ? ` USER GUIDANCE (honor verbatim): ${guidance}`
      : '';
  const user =
    `Write the ${entry.label} artifact to ${entry.path} inside ${ctx.projectRoot}.` +
    ` Ground the content in uxfactory.classification.json and uxfactory.profile.json` +
    ` (read both first).${sectionNote}${briefNote}` +
    ` Keep the output strictly the artifact file:` +
    ` valid JSON for .json targets, Markdown for .md targets.` +
    ` Report the written path once done.${guidanceNote}`;
  return {
    systemPrompt: loadSkill('generate'),
    user,
    artifactPath: entry.path,
  };
  ```

  Note: `sectionNote` and `guidanceNote` were already present before; you are keeping them in place and inserting `briefNote` between `sectionNote` and the rest of the user string.

- [ ] **Step 3: Run the worker tests to verify the new test passes and no regressions**

  ```bash
  pnpm --filter uxfactory-worker test
  ```
  Expected: all tests pass including the new brief-sections test.

- [ ] **Step 4: Commit**

  ```bash
  git add clients/uxfactory-worker/src/generative.ts
  git commit -m "feat(worker): brief plan mandates five ## sections and no-restatement rule"
  ```

---

### Task 6: Add worker tests for brief plan sections and no-restatement rule

**Files:**
- Modify: `clients/uxfactory-worker/test/worker.test.ts`

**Interfaces:**
- Consumes: `runGenerative`, `FakeAdapter`, `FakeBridge`, `ctx()` (all defined in the existing test file); `DispatchCtx` type from `'../src/dispatch.js'`

- [ ] **Step 1: Write the failing test BEFORE the implementation (TDD)**

  In `clients/uxfactory-worker/test/worker.test.ts`, find the end of the `runGenerative` describe block (the last `it(...)` inside it, around line 1348). Insert these tests immediately before the closing `});` of the `runGenerative` describe block:

  ```typescript
  // ── Brief content rule: five schema sections + no-restatement ─────────────

  it('generate-artifact artifact:brief prompt mandates the five ## sections', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    await runGenerative(
      {
        id: 'pr_brief_sections',
        kind: 'generate-artifact',
        payload: { artifact: 'brief' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    // Spec §2 Worker: exactly these ## sections must be mandated.
    expect(user).toContain('## Overview');
    expect(user).toContain('## Audience & insight');
    expect(user).toContain('## Goals & success metrics');
    expect(user).toContain('## Scope & constraints');
    expect(user).toContain('## Risks & open questions');
  });

  it('generate-artifact artifact:brief prompt contains the no-restatement rule', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    await runGenerative(
      {
        id: 'pr_brief_no_restate',
        kind: 'generate-artifact',
        payload: { artifact: 'brief' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    // Must explicitly forbid restating pinned config values.
    expect(user).toContain('DO NOT restate');
    // Must require net-new substance or a TBD line.
    expect(user).toContain('TBD — needs user input');
  });

  it('generate-artifact artifact:tokens prompt does NOT contain the brief section rule (regression)', async () => {
    // The brief-specific instruction must not leak into other panel artifact plans.
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    await runGenerative(
      {
        id: 'pr_tokens_no_brief',
        kind: 'generate-artifact',
        payload: { artifact: 'tokens' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).not.toContain('## Overview');
    expect(user).not.toContain('DO NOT restate');
  });
  ```

- [ ] **Step 2: Run the worker tests to confirm these three new tests FAIL**

  ```bash
  pnpm --filter uxfactory-worker test
  ```
  Expected: the three new tests fail with "Expected: …contains…" errors (the brief sections instruction doesn't exist yet).

- [ ] **Step 3: Implement Task 5 (the `briefNote` change in `generative.ts`), then run tests again**

  ```bash
  pnpm --filter uxfactory-worker test
  ```
  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add clients/uxfactory-worker/test/worker.test.ts
  git commit -m "test(worker): brief plan sections and no-restatement rule assertions"
  ```

---

### Task 7: Final gate — run all tests and build, then write the report

**Files:**
- Create: `.superpowers/sdd/artifact-editor-1-report.md`

- [ ] **Step 1: Run both test suites**

  ```bash
  pnpm --filter @uxfactory/bridge test && pnpm --filter uxfactory-worker test
  ```
  Expected: all tests pass for both packages (no failures, no skips that indicate missing work).

- [ ] **Step 2: Run the monorepo build**

  ```bash
  pnpm -r build
  ```
  Expected: exits 0. If TypeScript errors appear, fix them in the four touched files only.

- [ ] **Step 3: Create the SDD report**

  ```bash
  mkdir -p .superpowers/sdd
  ```

  Write `.superpowers/sdd/artifact-editor-1-report.md`:

  ```markdown
  # Artifact Editor v1 — Bridge + Worker Implementation Report

  **Date:** 2026-07-02
  **Spec:** docs/superpowers/specs/2026-07-02-uxfactory-artifact-editor-v1-design.md (§2 Bridge, §2 Worker, §3)

  ## What was built

  ### Bridge routes (`packages/uxfactory-bridge/src/project.ts`)

  Two additive routes registered inside `projectPlugin`:

  - `GET /project/artifact?key=<concernKey>` — resolves the artifact path via the new
    `resolveConcernPath` helper (registry-aware for `tokens`/`requirements`; prefix-search
    for `sitemap`/`flows`; two-candidate for `brief`); returns
    `{ key, path, format, content }`. Returns 400 for unknown keys and 404 for missing files.
    Containment check mirrors `POST /project/open`.

  - `PUT /project/artifact` body `{ key, content }` — writes the file at the resolved path
    with `mkdir -p` semantics. Returns `{ ok: true }`. Returns 400 for unknown keys or
    non-string content.

  `mkdir` was added to the `node:fs/promises` import (it was absent before).

  ### Worker brief rule (`clients/uxfactory-worker/src/generative.ts`)

  `planGenerative` now computes `briefNote` (non-empty only when `artifact === 'brief'`) and
  inserts it between `sectionNote` and the closing keep-output clause. The note mandates:
  - Exactly five `## ` sections in order: Overview, Audience & insight, Goals & success metrics,
    Scope & constraints, Risks & open questions.
  - `DO NOT restate` classification/profile values.
  - `TBD — needs user input` per section when substance is unavailable.

  ## Test coverage

  ### Bridge (`packages/uxfactory-bridge/test/project.test.ts`)
  - `GET /project/artifact`: round-trip PUT→GET, snapshot up-to-date, unknown key 400,
    missing file 404, registry-resolved tokens path, traversal-safe.
  - `PUT /project/artifact`: unknown key 400, missing content 400, mkdir-p semantics,
    registry-resolved tokens write.

  ### Worker (`clients/uxfactory-worker/test/worker.test.ts`)
  - Brief plan contains all five `## ` section names.
  - Brief plan contains `DO NOT restate` and `TBD — needs user input`.
  - Non-brief artifacts (`tokens`) do NOT carry the brief instruction (regression guard).

  ## Gates
  - `pnpm --filter @uxfactory/bridge test`: green
  - `pnpm --filter uxfactory-worker test`: green
  - `pnpm -r build`: green
  ```

- [ ] **Step 4: Create the final commit on main**

  Stage only the four touched source files plus the report:

  ```bash
  git add packages/uxfactory-bridge/src/project.ts \
          packages/uxfactory-bridge/test/project.test.ts \
          clients/uxfactory-worker/src/generative.ts \
          clients/uxfactory-worker/test/worker.test.ts \
          .superpowers/sdd/artifact-editor-1-report.md
  git commit -m "$(cat <<'EOF'
  feat(bridge,worker): artifact content routes; brief plan sections and no-restatement rule

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 5: Report final status to the caller**

  Return: status (pass/fail), commit hash from `git rev-parse --short HEAD`, and a one-line test summary.

---

## Self-Review

### Spec coverage

| Spec requirement | Task covering it |
|------------------|-----------------|
| `GET /project/artifact` route | Tasks 2, 4 |
| `PUT /project/artifact` route | Tasks 3, 4 |
| Path containment enforced | Tasks 2, 3 (containment check) |
| Registry-aware path (tokens) | Tasks 1, 4 |
| 400 on unknown key | Tasks 2, 3, 4 |
| 404 on known key / missing file | Tasks 2, 4 |
| Brief: five `## ` sections | Tasks 5, 6 |
| Brief: no-restatement rule | Tasks 5, 6 |
| Brief: TBD fallback requirement | Tasks 5, 6 |
| `pnpm --filter @uxfactory/bridge test` green | Task 7 |
| `pnpm --filter uxfactory-worker test` green | Task 7 |
| `pnpm -r build` green | Task 7 |
| Report in `.superpowers/sdd/` | Task 7 |
| Commit on main with exact message | Task 7 |

### Placeholder scan
None — every step includes actual code.

### Type consistency
- `ConcernPath` interface is defined in Task 1 and used only within `project.ts`.
- `briefNote` is a `string` computed inline in `planGenerative`; no new exported type.
- `resolveConcernPath` parameter and return types are consistent across all tasks.
- The test helper calls (`app.inject`, `runGenerative`, `FakeAdapter`) match existing patterns exactly.
