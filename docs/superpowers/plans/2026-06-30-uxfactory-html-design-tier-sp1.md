# HTML Design Tier — SP1 (Verifiable HTML Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI author real HTML+CSS+JS screens that are rendered headless and gated over the rendering (render-coverage · a11y · contrast · token-conformance) to a green bar.

**Architecture:** An async **render stage** (Chromium + axe-core) quarantines all browser I/O and emits a deterministic `RenderSnapshot[]`; the gate is **pure, synchronous checks over those snapshots** — exactly as today's checks are pure over `LoadedSpec[]`. HTML mode is selected when the batch registry declares `inputs.screens` + `inputs.trace`; otherwise the existing `*.uxfactory.json` spec path is untouched. The unit of work is `(page, view)`: each page is loaded once and each declared view is activated, settled, screenshotted, and captured.

**Tech Stack:** TypeScript (ESM/NodeNext), `playwright` (already a devDependency), `axe-core` (new), `vitest` 4, `commander`. Spec: `docs/superpowers/specs/2026-06-30-uxfactory-html-design-tier-sp1-design.md`.

## Global Constraints

- **Engine self-contained:** NO LLM / helmsmith / AgentCore / cloud imports anywhere in `packages/*`. The render stage (Playwright + axe-core) is offline + deterministic and is permitted in the engine.
- **Gate purity:** `runBatch`-style checks stay **pure and synchronous** (no async, no clock, no randomness, no LLM). All async (browser) lives in the render stage, never inside a check.
- **Exit contract (unchanged):** `0` clean · `1` a binding `must` gate failed · `2` setup / missing required input / transport. Use `EXIT.OK` / `EXIT.GATE_FAIL` / `EXIT.TRANSPORT` from `packages/uxfactory-cli/src/exit.js`.
- **Render failure is loud:** a page that fails to load / activate / settle yields `ok:false` and a render-coverage finding; the HTML renderer being unavailable (Playwright/axe-core missing) is `EXIT.TRANSPORT` with a clear message — **never a silent pass**.
- **TS module rules:** `.js` import specifiers, `verbatimModuleSyntax` (use `import type` for type-only imports), Node ≥ 20.10.
- **Determinism:** the render stage fixes viewport `390×844`, `locale:"en-US"`, `timezoneId:"UTC"`, `reducedMotion:"reduce"`, injects an animation-freeze stylesheet, and waits `networkidle` + `document.fonts.ready` + an optional `window.uxfReady` (bounded 5000 ms). Checks read structured DOM/axe data, **never pixels**.
- **cc-invariant** on skills; `sk-…` masking. **Never `git add -A`** — stage only the files a task names. Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Work on `main`, commit sequentially.
- **Test commands:** single file → `pnpm exec vitest run <path>` (from repo root); full suite → `pnpm test`; typecheck → `pnpm --filter @uxfactory/cli typecheck`.

## File Structure

- `packages/uxfactory-cli/src/batch/trace.ts` — **new.** `trace.json` types + never-throws validator/loader.
- `packages/uxfactory-cli/src/batch/html-checks.ts` — **new.** `RenderSnapshot` contract + the four pure checks + `HTML_GATE_THRESHOLDS` + `runHtmlBatch`.
- `packages/uxfactory-cli/src/batch/registry.ts` — **modify.** Add `screens` + `trace` to `BatchInputs` / validation / `ResolvedInputs` / `resolveInputs`.
- `packages/uxfactory-cli/src/render/html-render.ts` — **new.** Deps-injected async orchestrator (`renderHtml`).
- `packages/uxfactory-cli/src/render/html-render-playwright.ts` — **new.** The only module importing `playwright` + `axe-core` (lazy).
- `packages/uxfactory-cli/src/commands/batch.ts` — **modify.** Extract `resolveBatchScope`; branch to HTML mode when `screens`+`trace` are registered.
- `packages/uxfactory-cli/src/commands/batch-html.ts` — **new.** The HTML-mode command path.
- `packages/uxfactory-cli/package.json` — **modify.** Add `axe-core` devDependency.
- `clients/uxfactory-worker/src/batch-registry.ts` — **modify.** Register `screens` + `trace`.
- `skill/design/SKILL.md` — **rewrite.** HTML authoring guide.
- Tests: `packages/uxfactory-cli/test/{trace,html-checks,html-render,batch-html,skill-design}.test.ts`, extend `registry.test.ts`; `clients/uxfactory-worker/test/batch-registry.test.ts` (extend or add).

**Plugin: no change.** `renderGateStrip` (`pipeline-view.ts:264`) renders any gate id generically (`esc(g.gate)` + status glyph), so `render-coverage` / `a11y` / `contrast` / `token-conformance` display automatically. Friendly labels are deferred.

---

### Task 1: `trace.ts` — trace.json schema + never-throws loader

**Files:**
- Create: `packages/uxfactory-cli/src/batch/trace.ts`
- Test: `packages/uxfactory-cli/test/trace.test.ts`

**Interfaces:**
- Consumes: `ImpliedState` from `../batch/checks.js`.
- Produces: types `TraceManifest`, `TracePage`, `TraceView`, `TraceCover`, `Activation`; `validateTrace(raw: unknown): { ok: true; trace: TraceManifest } | { ok: false; message: string }`; `readTrace(absPath: string): Promise<{ ok: true; trace: TraceManifest } | { ok: false; message: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-cli/test/trace.test.ts
import { describe, it, expect } from "vitest";
import { validateTrace } from "../src/batch/trace.js";

const VALID = {
  version: 1,
  pages: [
    {
      file: "screens/checkout.html",
      views: [
        { id: "success", activate: { hash: "view=success" },
          covers: [{ story: "checkout", impliedState: "success", selector: "[data-ac='ok']" }] },
        { id: "error", activate: { click: ["#pay"] },
          covers: [{ story: "checkout", impliedState: "error", selector: "#err" }] },
      ],
    },
  ],
};

describe("validateTrace", () => {
  it("accepts a valid two-level manifest", () => {
    const r = validateTrace(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trace.pages[0]!.views[1]!.id).toBe("error");
  });

  it("rejects a non-1 version", () => {
    const r = validateTrace({ ...VALID, version: 2 });
    expect(r).toEqual({ ok: false, message: "trace version must be 1" });
  });

  it("rejects a page missing file", () => {
    const r = validateTrace({ version: 1, pages: [{ views: VALID.pages[0]!.views }] });
    expect(r.ok).toBe(false);
  });

  it("rejects a bad impliedState", () => {
    const bad = structuredClone(VALID);
    (bad.pages[0]!.views[0]!.covers[0] as { impliedState: string }).impliedState = "nope";
    const r = validateTrace(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects a view with no covers", () => {
    const bad = structuredClone(VALID);
    bad.pages[0]!.views[0]!.covers = [];
    expect(validateTrace(bad).ok).toBe(false);
  });

  it("accepts and preserves an optional viewports array (reserved, unused)", () => {
    const r = validateTrace({ ...VALID, pages: [{ ...VALID.pages[0], viewports: ["mobile"] }] });
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown activation form", () => {
    const bad = structuredClone(VALID);
    (bad.pages[0]!.views[0]!.activate as Record<string, unknown>) = { scroll: 10 };
    expect(validateTrace(bad).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/trace.test.ts`
Expected: FAIL — `Cannot find module '../src/batch/trace.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/uxfactory-cli/src/batch/trace.ts
import { readFile } from "node:fs/promises";
import type { ImpliedState } from "./checks.js";

/** How the render stage drives a page into a view. Exactly one form, all eval-free. */
export type Activation =
  | { hash: string }
  | { query: string }
  | { click: string[] };

/** One (story, impliedState) claim, resolved by a CSS selector against the activated DOM. */
export interface TraceCover {
  story: string;
  impliedState: ImpliedState;
  selector: string;
}

/** A render-state of a page: activated, screenshotted, and coverage-checked on its own. */
export interface TraceView {
  id: string;
  activate?: Activation;
  covers: TraceCover[];
}

/** One HTML document; hosts ≥1 view. `viewports` is reserved (validated, unused in SP1). */
export interface TracePage {
  file: string;
  views: TraceView[];
  viewports?: string[];
}

/** The AI-emitted coverage manifest (design/trace.json). */
export interface TraceManifest {
  version: 1;
  pages: TracePage[];
}

const IMPLIED_STATES = new Set<string>(["empty", "loading", "error", "success", "edge"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateActivation(a: unknown): string | null {
  if (a === undefined) return null;
  if (!isObject(a)) return "activate must be an object";
  const keys = Object.keys(a);
  if (keys.length !== 1) return `activate must have exactly one form, got: ${keys.join(", ") || "none"}`;
  if ("hash" in a) return typeof a["hash"] === "string" ? null : "activate.hash must be a string";
  if ("query" in a) return typeof a["query"] === "string" ? null : "activate.query must be a string";
  if ("click" in a)
    return Array.isArray(a["click"]) && a["click"].every((s) => typeof s === "string")
      ? null
      : "activate.click must be an array of selector strings";
  return `unknown activation form: ${keys[0]}`;
}

/** Pure structural validation of a parsed trace manifest. Never throws. */
export function validateTrace(
  raw: unknown,
): { ok: true; trace: TraceManifest } | { ok: false; message: string } {
  if (!isObject(raw)) return { ok: false, message: "trace must be a JSON object" };
  if (raw["version"] !== 1) return { ok: false, message: "trace version must be 1" };
  if (!Array.isArray(raw["pages"]) || raw["pages"].length === 0)
    return { ok: false, message: "trace.pages must be a non-empty array" };

  for (const [pi, page] of raw["pages"].entries()) {
    if (!isObject(page)) return { ok: false, message: `trace.pages[${pi}] must be an object` };
    if (typeof page["file"] !== "string" || !page["file"].endsWith(".html"))
      return { ok: false, message: `trace.pages[${pi}].file must be a string path ending in .html` };
    if (page["viewports"] !== undefined &&
        (!Array.isArray(page["viewports"]) || page["viewports"].some((v) => typeof v !== "string")))
      return { ok: false, message: `trace.pages[${pi}].viewports must be an array of strings` };
    if (!Array.isArray(page["views"]) || page["views"].length === 0)
      return { ok: false, message: `trace.pages[${pi}].views must be a non-empty array` };

    const ids = new Set<string>();
    for (const [vi, view] of page["views"].entries()) {
      const at = `trace.pages[${pi}].views[${vi}]`;
      if (!isObject(view)) return { ok: false, message: `${at} must be an object` };
      if (typeof view["id"] !== "string" || view["id"].length === 0)
        return { ok: false, message: `${at}.id must be a non-empty string` };
      if (ids.has(view["id"])) return { ok: false, message: `${at}.id "${view["id"]}" is duplicated within the page` };
      ids.add(view["id"]);
      const actErr = validateActivation(view["activate"]);
      if (actErr !== null) return { ok: false, message: `${at}.${actErr}` };
      if (!Array.isArray(view["covers"]) || view["covers"].length === 0)
        return { ok: false, message: `${at}.covers must be a non-empty array` };
      for (const [ci, cover] of view["covers"].entries()) {
        const cat = `${at}.covers[${ci}]`;
        if (!isObject(cover)) return { ok: false, message: `${cat} must be an object` };
        if (typeof cover["story"] !== "string") return { ok: false, message: `${cat}.story must be a string` };
        if (typeof cover["impliedState"] !== "string" || !IMPLIED_STATES.has(cover["impliedState"]))
          return { ok: false, message: `${cat}.impliedState must be one of empty|loading|error|success|edge` };
        if (typeof cover["selector"] !== "string" || cover["selector"].length === 0)
          return { ok: false, message: `${cat}.selector must be a non-empty string` };
      }
    }
  }
  return { ok: true, trace: raw as unknown as TraceManifest };
}

/** Read + JSON-parse + validate a trace file. Never throws on bad input. */
export async function readTrace(
  absPath: string,
): Promise<{ ok: true; trace: TraceManifest } | { ok: false; message: string }> {
  let text: string;
  try {
    text = await readFile(absPath, "utf8");
  } catch {
    return { ok: false, message: `cannot read trace manifest ${absPath}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, message: `invalid JSON in ${absPath}: ${(err as Error).message}` };
  }
  return validateTrace(parsed);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/trace.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @uxfactory/cli typecheck
git add packages/uxfactory-cli/src/batch/trace.ts packages/uxfactory-cli/test/trace.test.ts
git commit -m "feat(cli): trace.json schema + never-throws loader (HTML tier)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `html-checks.ts` — `RenderSnapshot` contract + `render-coverage`

**Files:**
- Create: `packages/uxfactory-cli/src/batch/html-checks.ts`
- Test: `packages/uxfactory-cli/test/html-checks.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `BatchFinding`, `Severity`, `ImpliedState`, `StorySet` from `./checks.js`.
- Produces: types `CoverCheck`, `PaintedColor`, `AxeFinding`, `RenderSnapshot`; `renderCoverage(snapshots: RenderSnapshot[], stories: StorySet | null): CheckResult`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-cli/test/html-checks.test.ts
import { describe, it, expect } from "vitest";
import { renderCoverage, type RenderSnapshot } from "../src/batch/html-checks.js";
import type { StorySet } from "../src/batch/checks.js";

function snap(p: Partial<RenderSnapshot>): RenderSnapshot {
  return {
    page: "screens/checkout.html", view: "v", viewport: { width: 390, height: 844 },
    screenshot: "checkout-v.png", ok: true, coverChecks: [], paintedColors: [], axe: [],
    ...p,
  };
}

const stories: StorySet = {
  stories: [{
    id: "checkout", role: "user", goal: "pay", benefit: "done",
    acceptanceCriteria: [
      { statement: "ok", impliedState: "success" },
      { statement: "fail", impliedState: "error" },
    ],
  }],
};

describe("renderCoverage", () => {
  it("skips when no stories", () => {
    const r = renderCoverage([snap({})], null);
    expect(r.status).toBe("skip");
  });

  it("passes when every required state is covered visibly", () => {
    const snaps = [
      snap({ view: "success", coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }] }),
      snap({ view: "error", coverChecks: [{ story: "checkout", impliedState: "error", selector: "#err", found: true, visible: true }] }),
    ];
    expect(renderCoverage(snaps, stories).status).toBe("pass");
  });

  it("fails an uncovered state", () => {
    const snaps = [snap({ view: "success", coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }] })];
    const r = renderCoverage(snaps, stories);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.detail.includes("error state is not covered"))).toBe(true);
  });

  it("fails a dead selector and an invisible selector with distinct findings", () => {
    const snaps = [
      snap({ view: "success", coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: false, visible: false }] }),
      snap({ view: "error", coverChecks: [{ story: "checkout", impliedState: "error", selector: "#err", found: true, visible: false }] }),
    ];
    const r = renderCoverage(snaps, stories);
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => f.detail.includes("matched no element"))).toBe(true);
    expect(r.findings.some((f) => f.detail.includes("is not visible"))).toBe(true);
  });

  it("reports a render failure", () => {
    const snaps = [snap({ ok: false, error: "load timeout", coverChecks: [] })];
    const r = renderCoverage(snaps, stories);
    expect(r.findings.some((f) => f.detail.includes("failed to render: load timeout"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/html-checks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/uxfactory-cli/src/batch/html-checks.ts
import type { BatchFinding, CheckResult, ImpliedState, StorySet } from "./checks.js";

/** One trace cover, resolved against the activated DOM by the render stage. */
export interface CoverCheck {
  story: string;
  impliedState: ImpliedState;
  selector: string;
  found: boolean;   // selector resolved ≥1 element
  visible: boolean; // rendered + non-zero box + not display:none/visibility:hidden/opacity:0
}

/** A distinct computed color actually painted on a visible element. */
export interface PaintedColor {
  hex: string;            // "#RRGGBB", normalized by the render stage
  exampleSelector: string;
}

/** An axe-core violation captured during a view's single axe run. */
export interface AxeFinding {
  id: string;             // rule id, e.g. "color-contrast", "image-alt"
  impact?: "minor" | "moderate" | "serious" | "critical";
  targets: string[];      // selectors of offending nodes
  help?: string;
}

/** The deterministic per-(page,view) record the pure checks consume. */
export interface RenderSnapshot {
  page: string;
  view: string;
  viewport: { width: number; height: number };
  screenshot: string;     // relative path under .uxfactory/batch/previews/
  ok: boolean;            // false → render/activation/settle failed
  error?: string;         // present iff ok === false
  coverChecks: CoverCheck[];
  paintedColors: PaintedColor[];
  axe: AxeFinding[];
}

const NUL = " ";

/**
 * render-coverage (must) — every story's required impliedStates must each be claimed
 * by ≥1 visible cover across the rendered views. Pure + deterministic.
 */
export function renderCoverage(snapshots: RenderSnapshot[], stories: StorySet | null): CheckResult {
  const id = "render-coverage";
  if (stories === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no stories registered" };
  }
  const findings: BatchFinding[] = [];
  const covered = new Set<string>();
  for (const s of snapshots) {
    for (const c of s.coverChecks) {
      if (c.found && c.visible) covered.add(`${c.story}${NUL}${c.impliedState}`);
    }
  }
  // Render failures first — loud, never silent.
  for (const s of snapshots) {
    if (!s.ok) {
      findings.push({
        detail: `${s.page} › ${s.view} failed to render: ${s.error ?? "unknown error"}`,
        ref: `${s.page} › ${s.view}`,
      });
    }
  }
  // Dead / invisible claimed selectors.
  for (const s of snapshots) {
    for (const c of s.coverChecks) {
      if (!c.found) {
        findings.push({
          detail: `${s.page} › ${s.view}: claimed selector "${c.selector}" for ${c.story}/${c.impliedState} matched no element`,
          ref: `${s.page} › ${s.view} › ${c.selector}`,
        });
      } else if (!c.visible) {
        findings.push({
          detail: `${s.page} › ${s.view}: claimed selector "${c.selector}" for ${c.story}/${c.impliedState} is not visible`,
          ref: `${s.page} › ${s.view} › ${c.selector}`,
        });
      }
    }
  }
  // Required (story × distinct impliedState) coverage.
  for (const story of stories.stories ?? []) {
    const required = new Set<ImpliedState>();
    for (const ac of story.acceptanceCriteria ?? []) required.add(ac.impliedState);
    for (const state of required) {
      if (!covered.has(`${story.id}${NUL}${state}`)) {
        findings.push({
          detail: `story ${story.id} ${state} state is not covered by any visible rendering`,
          ref: `${story.id}/${state}`,
        });
      }
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/html-checks.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/batch/html-checks.ts packages/uxfactory-cli/test/html-checks.test.ts
git commit -m "feat(cli): RenderSnapshot contract + render-coverage check (HTML tier)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `html-checks.ts` — `a11y` + `contrast` (axe partition)

**Files:**
- Modify: `packages/uxfactory-cli/src/batch/html-checks.ts`
- Test: `packages/uxfactory-cli/test/html-checks.test.ts` (append)

**Interfaces:**
- Produces: `a11y(snapshots: RenderSnapshot[]): CheckResult`; `contrast(snapshots: RenderSnapshot[]): CheckResult`. Both partition the captured `axe` findings on the rule id `"color-contrast"` — contrast owns that rule, a11y owns all others.

- [ ] **Step 1: Write the failing test (append to html-checks.test.ts)**

```ts
import { a11y, contrast } from "../src/batch/html-checks.js";

describe("a11y / contrast partition the axe findings", () => {
  const snaps = [snap({
    view: "success",
    axe: [
      { id: "image-alt", impact: "critical", targets: ["img.hero"], help: "Images must have alt text" },
      { id: "color-contrast", impact: "serious", targets: ["p.muted"], help: "Elements must have sufficient contrast" },
    ],
  })];

  it("a11y reports non-contrast violations only", () => {
    const r = a11y(snaps);
    expect(r.status).toBe("fail");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.detail).toContain("image-alt");
    expect(r.findings[0]!.ref).toBe("img.hero");
  });

  it("contrast reports color-contrast violations only", () => {
    const r = contrast(snaps);
    expect(r.status).toBe("fail");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.ref).toBe("p.muted");
  });

  it("both pass on a clean snapshot", () => {
    const clean = [snap({ axe: [] })];
    expect(a11y(clean).status).toBe("pass");
    expect(contrast(clean).status).toBe("pass");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/html-checks.test.ts`
Expected: FAIL — `a11y`/`contrast` not exported.

- [ ] **Step 3: Add the implementation (append to html-checks.ts)**

```ts
const CONTRAST_RULE = "color-contrast";

/** a11y (must) — all non-contrast axe violations across views. */
export function a11y(snapshots: RenderSnapshot[]): CheckResult {
  const id = "a11y";
  const findings: BatchFinding[] = [];
  for (const s of snapshots) {
    for (const v of s.axe) {
      if (v.id === CONTRAST_RULE) continue;
      findings.push({
        detail: `${s.page} › ${s.view}: ${v.help ?? v.id} (${v.id})`,
        ref: v.targets[0] ?? `${s.page} › ${s.view}`,
      });
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/** contrast (must) — the color-contrast axe violations (partition of the same run). */
export function contrast(snapshots: RenderSnapshot[]): CheckResult {
  const id = "contrast";
  const findings: BatchFinding[] = [];
  for (const s of snapshots) {
    for (const v of s.axe) {
      if (v.id !== CONTRAST_RULE) continue;
      findings.push({
        detail: `${s.page} › ${s.view}: ${v.help ?? "insufficient color contrast"}`,
        ref: v.targets[0] ?? `${s.page} › ${s.view}`,
      });
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/html-checks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/batch/html-checks.ts packages/uxfactory-cli/test/html-checks.test.ts
git commit -m "feat(cli): a11y + contrast checks partition the axe run (HTML tier)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `html-checks.ts` — `token-conformance` + `runHtmlBatch`

**Files:**
- Modify: `packages/uxfactory-cli/src/batch/html-checks.ts`
- Test: `packages/uxfactory-cli/test/html-checks.test.ts` (append)

**Interfaces:**
- Consumes: `TokenSet` from `./checks.js`; `binds`, `RenderScope`, `GateThresholds` from `./scope.js`; `BatchReport` from `./run.js`.
- Produces: `htmlTokenConformance(snapshots, tokens): CheckResult`; `HTML_GATE_THRESHOLDS: Record<string, GateThresholds>`; `RunHtmlBatchInput`; `runHtmlBatch(input: RunHtmlBatchInput): BatchReport`.

- [ ] **Step 1: Write the failing test (append)**

```ts
import { htmlTokenConformance, runHtmlBatch } from "../src/batch/html-checks.js";
import type { TokenSet } from "../src/batch/checks.js";
import type { RenderScope } from "../src/batch/scope.js";

const tokens: TokenSet = { colors: { brand: "#1E88E5", ink: "#111111" } };

describe("htmlTokenConformance", () => {
  it("skips with no token register", () => {
    expect(htmlTokenConformance([snap({})], null).status).toBe("skip");
  });
  it("passes when every painted color is registered", () => {
    const snaps = [snap({ paintedColors: [{ hex: "#1e88e5", exampleSelector: "button.cta" }, { hex: "#111111", exampleSelector: "h1" }] })];
    expect(htmlTokenConformance(snaps, tokens).status).toBe("pass");
  });
  it("fails an unregistered painted color", () => {
    const snaps = [snap({ paintedColors: [{ hex: "#ff00ff", exampleSelector: "div.x" }] })];
    const r = htmlTokenConformance(snaps, tokens);
    expect(r.status).toBe("fail");
    expect(r.findings[0]!.detail).toContain("#ff00ff");
  });
});

describe("runHtmlBatch", () => {
  const VISUAL_MEDIUM: RenderScope = { visual: "medium", editorial: "low", coverage: "medium", flow: "low" };
  const VISUAL_LOW: RenderScope = { visual: "low", editorial: "low", coverage: "low", flow: "low" };
  const goodSnap = snap({
    coverChecks: [
      { story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true },
      { story: "checkout", impliedState: "error", selector: "#err", found: true, visible: true },
    ],
    paintedColors: [{ hex: "#1e88e5", exampleSelector: "button" }],
    axe: [],
  });

  it("runs all four checks at visual:medium and is clean when all pass", () => {
    const r = runHtmlBatch({ snapshots: [goodSnap], stories, tokens, scope: VISUAL_MEDIUM });
    expect(r.clean).toBe(true);
    expect(r.checks.map((c) => c.id).sort()).toEqual(["a11y", "contrast", "render-coverage", "token-conformance"]);
    expect(r.checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("marks a11y/contrast/token not-owed at visual:low; render-coverage still binds", () => {
    const r = runHtmlBatch({ snapshots: [goodSnap], stories, tokens, scope: VISUAL_LOW });
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(byId["render-coverage"]).toBe("pass");
    expect(byId["a11y"]).toBe("not-owed");
    expect(byId["token-conformance"]).toBe("not-owed");
  });

  it("mustPassFailed when a binding must check fails", () => {
    const r = runHtmlBatch({ snapshots: [snap({ ok: false, error: "x" })], stories, tokens, scope: VISUAL_MEDIUM });
    expect(r.clean).toBe(false);
    expect(r.mustPassFailed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/html-checks.test.ts`
Expected: FAIL — `htmlTokenConformance`/`runHtmlBatch` not exported.

- [ ] **Step 3: Add the implementation (append)**

Add these to the existing imports at the **top** of `html-checks.ts` (imports must be at the top — only the functions/consts below get appended):

```ts
import { binds } from "./scope.js";
import type { GateThresholds, RenderScope } from "./scope.js";
import type { Severity, TokenSet } from "./checks.js";
import type { BatchReport } from "./run.js";

/** Normalize a hex string to "#rrggbb" (3- or 6-digit, case-insensitive). null if not hex. */
function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  const m6 = /^#[0-9a-f]{6}$/.exec(v);
  if (m6) return v;
  return null;
}

/** token-conformance (must) — every painted color must be a registered token. */
export function htmlTokenConformance(snapshots: RenderSnapshot[], tokens: TokenSet | null): CheckResult {
  const id = "token-conformance";
  if (tokens === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no token register registered" };
  }
  const registered = new Set<string>();
  for (const value of Object.values(tokens.colors ?? {})) {
    const n = normalizeHex(value);
    if (n !== null) registered.add(n);
  }
  const findings: BatchFinding[] = [];
  const seen = new Set<string>();
  for (const s of snapshots) {
    for (const pc of s.paintedColors) {
      const n = normalizeHex(pc.hex);
      const key = `${s.page}${NUL}${pc.hex.toLowerCase()}`;
      if ((n === null || !registered.has(n)) && !seen.has(key)) {
        seen.add(key);
        findings.push({
          detail: `${s.page}: painted color ${pc.hex} at ${pc.exampleSelector} is not a registered token`,
          ref: pc.hex,
        });
      }
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/** Per-gate binding thresholds for the HTML tier (kept separate from spec-mode GATE_THRESHOLDS). */
export const HTML_GATE_THRESHOLDS: Record<string, GateThresholds> = {
  "render-coverage": { min_visual: "none", min_editorial: "none", min_coverage: "low", min_flow: "none" },
  a11y: { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  contrast: { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
  "token-conformance": { min_visual: "medium", min_editorial: "none", min_coverage: "none", min_flow: "none" },
};

/** Everything one deterministic HTML gate pass needs (snapshots already captured). */
export interface RunHtmlBatchInput {
  snapshots: RenderSnapshot[];
  stories: StorySet | null;
  tokens: TokenSet | null;
  scope: RenderScope;
}

interface HtmlGateEntry {
  id: string;
  severity: Severity;
  run: (i: RunHtmlBatchInput) => CheckResult;
}

const HTML_GATE_ENTRIES: HtmlGateEntry[] = [
  { id: "render-coverage", severity: "must", run: (i) => renderCoverage(i.snapshots, i.stories) },
  { id: "a11y", severity: "must", run: (i) => a11y(i.snapshots) },
  { id: "contrast", severity: "must", run: (i) => contrast(i.snapshots) },
  { id: "token-conformance", severity: "must", run: (i) => htmlTokenConformance(i.snapshots, i.tokens) },
];

/**
 * One deterministic scope-scoped HTML gate pass. PURE: no async, no clock, no LLM.
 * A gate runs only when `binds(HTML_GATE_THRESHOLDS[id], scope)`; others are `not-owed`.
 * Returns the BatchReport shape so report.json stays identical between modes.
 */
export function runHtmlBatch(input: RunHtmlBatchInput): BatchReport {
  const { scope } = input;
  const checks: CheckResult[] = [];
  for (const entry of HTML_GATE_ENTRIES) {
    const t = HTML_GATE_THRESHOLDS[entry.id];
    const doesBind = t !== undefined && binds(t, scope);
    if (doesBind) checks.push(entry.run(input));
    else
      checks.push({
        id: entry.id, status: "not-owed", severity: entry.severity, findings: [],
        reason: "does not bind at the current render scope",
      });
  }
  const rubric = Object.keys(HTML_GATE_THRESHOLDS).filter((id) => {
    const t = HTML_GATE_THRESHOLDS[id];
    return t !== undefined && binds(t, scope);
  });
  const mustPassFailed = checks.some((c) => c.severity === "must" && c.status === "fail");
  return { scope, rubric, checks, mustPassFailed, clean: !mustPassFailed };
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/html-checks.test.ts && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/batch/html-checks.ts packages/uxfactory-cli/test/html-checks.test.ts
git commit -m "feat(cli): HTML token-conformance + runHtmlBatch gate runner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `registry.ts` — `screens` + `trace` inputs

**Files:**
- Modify: `packages/uxfactory-cli/src/batch/registry.ts`
- Test: `packages/uxfactory-cli/test/registry.test.ts` (append)

**Interfaces:**
- Produces: `BatchInputs` gains optional `screens?: string` and `trace?: string`; `ResolvedInputs` gains `screens: string | null` and `trace: string | null`; `validateRegistry` accepts/validates them; `resolveInputs` resolves them.

- [ ] **Step 1: Write the failing test (append to registry.test.ts)**

```ts
import { validateRegistry, resolveInputs } from "../src/batch/registry.js";

describe("registry screens/trace inputs (HTML tier)", () => {
  it("accepts string screens + trace paths", () => {
    const r = validateRegistry({ version: 1, inputs: { screens: "design/screens", trace: "design/trace.json" } });
    expect(r.ok).toBe(true);
  });
  it("rejects non-string screens", () => {
    const r = validateRegistry({ version: 1, inputs: { screens: 5 } });
    expect(r.ok).toBe(false);
  });
  it("resolveInputs resolves screens + trace to absolute paths, null when absent", () => {
    const reg = validateRegistry({ version: 1, inputs: { screens: "design/screens", trace: "design/trace.json" } });
    if (!reg.ok) throw new Error("expected ok");
    const resolved = resolveInputs(reg.registry, "/repo");
    expect(resolved.screens).toBe("/repo/design/screens");
    expect(resolved.trace).toBe("/repo/design/trace.json");
  });

  it("resolveInputs yields null screens/trace when absent", () => {
    const reg = validateRegistry({ version: 1, inputs: {} });
    if (!reg.ok) throw new Error("expected ok");
    const resolved = resolveInputs(reg.registry, "/repo");
    expect(resolved.screens).toBeNull();
    expect(resolved.trace).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/registry.test.ts`
Expected: FAIL — `resolved.screens` is `undefined`.

- [ ] **Step 3: Implement (three edits in `registry.ts`)**

Edit `BatchInputs` (after `reuse?`):
```ts
  /** Existing spec files to compose/reuse against. */
  reuse?: string[];
  /** HTML tier: directory of authored HTML pages (presence selects HTML mode). */
  screens?: string;
  /** HTML tier: the trace.json coverage manifest (presence selects HTML mode). */
  trace?: string;
```

Edit `ResolvedInputs` (after `reuse: string[]`):
```ts
  reuse: string[];
  screens: string | null;
  trace: string | null;
```

In `validateRegistry`, extend the string-path loop to include the new keys:
```ts
  for (const key of ["tokens", "stories", "flow", "screens", "trace"] as const) {
    const v = inputs[key];
    if (v !== undefined && typeof v !== "string") {
      return { ok: false, message: `registry.inputs.${key} must be a string path` };
    }
  }
```

In `resolveInputs`, resolve them:
```ts
export function resolveInputs(registry: BatchRegistry, registryDir: string): ResolvedInputs {
  const abs = (p: string): string => path.resolve(registryDir, p);
  const { tokens, stories, flow, reuse, screens, trace } = registry.inputs;
  return {
    tokens: tokens !== undefined ? abs(tokens) : null,
    stories: stories !== undefined ? abs(stories) : null,
    flow: flow !== undefined ? abs(flow) : null,
    reuse: reuse !== undefined ? reuse.map(abs) : [],
    screens: screens !== undefined ? abs(screens) : null,
    trace: trace !== undefined ? abs(trace) : null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/uxfactory-cli/src/batch/registry.ts packages/uxfactory-cli/test/registry.test.ts
git commit -m "feat(cli): register screens + trace inputs (HTML mode selector)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `html-render.ts` + `html-render-playwright.ts` — async render stage

**Files:**
- Create: `packages/uxfactory-cli/src/render/html-render.ts`
- Create: `packages/uxfactory-cli/src/render/html-render-playwright.ts`
- Modify: `packages/uxfactory-cli/package.json` (add `axe-core` devDependency)
- Test: `packages/uxfactory-cli/test/html-render.test.ts`

**Interfaces:**
- Consumes: `RenderSnapshot` from `../batch/html-checks.js`; `TraceManifest` from `../batch/trace.js`.
- Produces: `HtmlRenderRequest`, `HtmlRenderDeps`, `renderHtml(req, deps?): Promise<RenderSnapshot[]>` (orchestrator, deps-injected like `raster-select`); `renderViewsPlaywright(req): Promise<RenderSnapshot[]>` (the real Chromium+axe impl, the ONLY module importing `playwright`/`axe-core`, lazily).

- [ ] **Step 1: Add the devDependency**

```bash
cd /Users/edwincruz/Development/Workspaces/jefelabs/uxfactory
pnpm --filter @uxfactory/cli add -D axe-core@4.10.2
```
Expected: `packages/uxfactory-cli/package.json` `devDependencies` gains `"axe-core": "4.10.2"`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/uxfactory-cli/test/html-render.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderHtml, type HtmlRenderRequest } from "../src/render/html-render.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";
import type { TraceManifest } from "../src/batch/trace.js";

const trace: TraceManifest = {
  version: 1,
  pages: [{
    file: "screens/checkout.html",
    views: [{ id: "success", covers: [{ story: "checkout", impliedState: "success", selector: "#ok" }] }],
  }],
};

// --- orchestrator delegates to the injected dep (no browser) ---------------
describe("renderHtml (deps injection)", () => {
  it("delegates to the injected renderer", async () => {
    const fake: RenderSnapshot[] = [{
      page: "screens/checkout.html", view: "success", viewport: { width: 390, height: 844 },
      screenshot: "checkout-success.png", ok: true,
      coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }],
      paintedColors: [], axe: [],
    }];
    const got = await renderHtml(
      { baseDir: "/x", trace, previewDir: "/x/.uxfactory/batch/previews", viewport: { width: 390, height: 844 } },
      { renderViews: async (_req: HtmlRenderRequest) => fake },
    );
    expect(got).toBe(fake);
  });
});

// --- real browser path (skipped when Chromium is unavailable) --------------
async function browserAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch {
    return false;
  }
}
const HAS_BROWSER = await browserAvailable();

describe.skipIf(!HAS_BROWSER)("renderViewsPlaywright (real Chromium)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "uxf-html-"));
    await mkdir(path.join(dir, "screens"), { recursive: true });
    await mkdir(path.join(dir, "previews"), { recursive: true });
    // Deliberately: low-contrast text (#777 on #888) → contrast violation; <img> w/o alt → a11y violation.
    await writeFile(path.join(dir, "screens/checkout.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Checkout</title></head>
<body style="background:#888888;margin:0"><main><h1 id="ok" style="color:#111111">Order confirmed</h1>
<p style="color:#777777">thank you</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></body></html>`, "utf8");
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("captures cover visibility, painted colors, and axe violations", async () => {
    const { renderViewsPlaywright } = await import("../src/render/html-render-playwright.js");
    const snaps = await renderViewsPlaywright({
      baseDir: dir, trace, previewDir: path.join(dir, "previews"), viewport: { width: 390, height: 844 },
    });
    expect(snaps).toHaveLength(1);
    const s = snaps[0]!;
    expect(s.ok).toBe(true);
    expect(s.coverChecks[0]).toMatchObject({ found: true, visible: true });
    expect(s.paintedColors.some((c) => c.hex === "#111111")).toBe(true);
    expect(s.axe.some((v) => v.id === "color-contrast")).toBe(true);
    expect(s.axe.some((v) => v.id === "image-alt")).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/html-render.test.ts`
Expected: FAIL — `../src/render/html-render.js` not found.

- [ ] **Step 4: Implement the orchestrator**

```ts
// packages/uxfactory-cli/src/render/html-render.ts
import type { RenderSnapshot } from "../batch/html-checks.js";
import type { TraceManifest } from "../batch/trace.js";

/** One render request: where the pages live, the manifest, and where screenshots go. */
export interface HtmlRenderRequest {
  /** Directory the trace `pages[].file` paths resolve against (the dir holding trace.json). */
  baseDir: string;
  trace: TraceManifest;
  /** Absolute directory screenshots are written to. */
  previewDir: string;
  viewport: { width: number; height: number };
}

/** Injectable renderer for deterministic testing without a real browser. */
export interface HtmlRenderDeps {
  renderViews: (req: HtmlRenderRequest) => Promise<RenderSnapshot[]>;
}

/**
 * Render every (page, view) in the trace to a screenshot + RenderSnapshot.
 * `deps.renderViews` overrides the real Playwright implementation in tests.
 * The default lazily imports the playwright module so this file (and its importers)
 * load even when playwright/axe-core are not installed — the error surfaces only on call.
 */
export async function renderHtml(
  req: HtmlRenderRequest,
  deps?: HtmlRenderDeps,
): Promise<RenderSnapshot[]> {
  const fn =
    deps?.renderViews ??
    (async (r: HtmlRenderRequest): Promise<RenderSnapshot[]> => {
      const { renderViewsPlaywright } = await import("./html-render-playwright.js");
      return renderViewsPlaywright(r);
    });
  return fn(req);
}
```

- [ ] **Step 5: Implement the real Playwright+axe renderer**

```ts
// packages/uxfactory-cli/src/render/html-render-playwright.ts
/**
 * The ONLY module importing `playwright` + `axe-core` — both lazily, inside the
 * function body, so importing this module never fails when they are absent.
 * Renders each (page, view): goto → activate → settle → freeze → screenshot →
 * capture (cover selectors · painted colors) → axe run.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { HtmlRenderRequest } from "./html-render.js";
import type { RenderSnapshot, CoverCheck, PaintedColor, AxeFinding } from "../batch/html-checks.js";

const SETTLE_TIMEOUT_MS = 5000;
const FREEZE_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

/** In-page capture: resolves cover selectors + collects painted colors. Runs in the browser. */
const CAPTURE_FN = `(covers) => {
  const toHex = (c) => {
    const m = /^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)$/.exec(c);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return null;
    const h = (n) => parseInt(n, 10).toString(16).padStart(2, "0");
    return "#" + h(m[1]) + h(m[2]) + h(m[3]);
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const shortSel = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + el.id;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/)[0] : "";
    return cls ? tag + "." + cls : tag;
  };
  const coverChecks = covers.map((c) => {
    const el = document.querySelector(c.selector);
    return { story: c.story, impliedState: c.impliedState, selector: c.selector, found: !!el, visible: !!el && visible(el) };
  });
  const colorMap = new Map();
  for (const el of document.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    for (const prop of ["color", "backgroundColor", "borderColor"]) {
      const hex = toHex(s[prop]);
      if (hex && !colorMap.has(hex)) colorMap.set(hex, shortSel(el));
    }
  }
  const paintedColors = [...colorMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([hex, exampleSelector]) => ({ hex, exampleSelector }));
  return { coverChecks, paintedColors };
}`;

export async function renderViewsPlaywright(req: HtmlRenderRequest): Promise<RenderSnapshot[]> {
  const { chromium } = await import("playwright");
  const axeMod = (await import("axe-core")) as unknown as { source?: string; default?: { source?: string } };
  const axeSource = axeMod.source ?? axeMod.default?.source;
  if (typeof axeSource !== "string") throw new Error("axe-core source unavailable");

  const browser = await chromium.launch({ headless: true });
  const out: RenderSnapshot[] = [];
  try {
    const context = await browser.newContext({
      viewport: req.viewport, locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce",
    });
    for (const tp of req.trace.pages) {
      const fileAbs = path.resolve(req.baseDir, tp.file);
      const fileUrl = pathToFileURL(fileAbs).href;
      for (const view of tp.views) {
        const screenshot = `${path.basename(tp.file, ".html")}-${view.id}.png`;
        const base: Omit<RenderSnapshot, "ok" | "error" | "coverChecks" | "paintedColors" | "axe"> = {
          page: tp.file, view: view.id, viewport: req.viewport, screenshot,
        };
        const page = await context.newPage();
        try {
          const gotoUrl =
            view.activate !== undefined && "query" in view.activate
              ? `${fileUrl}?${view.activate.query}`
              : fileUrl;
          await page.goto(gotoUrl, { waitUntil: "networkidle", timeout: SETTLE_TIMEOUT_MS * 3 });

          if (view.activate !== undefined && "hash" in view.activate) {
            const h = view.activate.hash;
            await page.evaluate((hash) => {
              location.hash = hash;
              window.dispatchEvent(new HashChangeEvent("hashchange"));
            }, h);
          } else if (view.activate !== undefined && "click" in view.activate) {
            for (const sel of view.activate.click) await page.click(sel, { timeout: SETTLE_TIMEOUT_MS });
          }

          await page.waitForLoadState("networkidle");
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate((t) => {
            const r = (window as unknown as { uxfReady?: PromiseLike<unknown> }).uxfReady;
            return r && typeof (r as PromiseLike<unknown>).then === "function"
              ? Promise.race([r, new Promise((res) => setTimeout(res, t))])
              : null;
          }, SETTLE_TIMEOUT_MS);

          await page.addStyleTag({ content: FREEZE_CSS });
          await page.screenshot({ path: path.join(req.previewDir, screenshot), fullPage: true });

          const captured = (await page.evaluate(
            `(${CAPTURE_FN})(${JSON.stringify(view.covers)})`,
          )) as { coverChecks: CoverCheck[]; paintedColors: PaintedColor[] };

          await page.addScriptTag({ content: axeSource });
          const axeRaw = (await page.evaluate(
            "axe.run(document, { resultTypes: ['violations'] })",
          )) as { violations: { id: string; impact?: string; help?: string; nodes: { target: string[] }[] }[] };
          const axe: AxeFinding[] = axeRaw.violations.map((v) => ({
            id: v.id,
            impact: v.impact as AxeFinding["impact"],
            help: v.help,
            targets: v.nodes.flatMap((n) => n.target.map(String)),
          }));

          out.push({ ...base, ok: true, coverChecks: captured.coverChecks, paintedColors: captured.paintedColors, axe });
        } catch (err) {
          out.push({
            ...base, ok: false, error: (err as Error).message,
            coverChecks: view.covers.map((c) => ({ story: c.story, impliedState: c.impliedState, selector: c.selector, found: false, visible: false })),
            paintedColors: [], axe: [],
          });
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}
```

- [ ] **Step 6: Run the test + typecheck**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/html-render.test.ts && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS — the orchestrator test always runs; the real-browser test runs if Chromium is installed (else skipped). 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/uxfactory-cli/src/render/html-render.ts packages/uxfactory-cli/src/render/html-render-playwright.ts packages/uxfactory-cli/package.json packages/uxfactory-cli/test/html-render.test.ts ../../pnpm-lock.yaml
git commit -m "feat(cli): headless HTML render stage (Playwright + axe-core, deps-injected)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
> If `pnpm-lock.yaml` is at the repo root, stage it with its real path; do not `git add -A`.

---

### Task 7: `batch.ts` HTML-mode branch + `batch-html.ts`

**Files:**
- Modify: `packages/uxfactory-cli/src/commands/batch.ts` (extract `resolveBatchScope`; add the early HTML branch)
- Create: `packages/uxfactory-cli/src/commands/batch-html.ts`
- Test: `packages/uxfactory-cli/test/batch-html.test.ts`

**Interfaces:**
- Consumes: `readRegistry`/`ResolvedInputs` (`../batch/registry.js`); `loadStoriesInput`/`loadTokensInput` (`../batch/inputs.js`); `readTrace` (`../batch/trace.js`); `renderHtml`/`HtmlRenderDeps` (`../render/html-render.js`); `runHtmlBatch` (`../batch/html-checks.js`); `resolveScope`/`checkReadiness`/`parseScope` (`../batch/scope.js`); `EXIT` (`../exit.js`); `IO` (`../io.js`).
- Produces: `resolveBatchScope(flags, profileScope, registryScope, io): RenderScope | null` (shared helper, errors emitted via `io`); `batchHtmlMode(specsDir, flags, io, inputs, profileScope, deps?): Promise<number>`.

> **Design note:** the spec-mode `batchCmd` keeps its exact behavior. The only changes are (a) factoring steps 4–5 (dial validation + scope resolution) into `resolveBatchScope` and calling it from both paths, and (b) an early branch right after the registry+inputs load: when `inputs.screens !== null && inputs.trace !== null`, delegate to `batchHtmlMode`. The existing `test/batch.test.ts` is the regression guard for the spec path.

- [ ] **Step 1: Write the failing test (HTML mode, injected renderer)**

```ts
// packages/uxfactory-cli/test/batch-html.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { batchHtmlMode } from "../src/commands/batch-html.js";
import { resolveInputs } from "../src/batch/registry.js";
import { EXIT } from "../src/exit.js";
import { makeIO } from "./helpers.js";
import type { RenderSnapshot } from "../src/batch/html-checks.js";

let root: string;

const stories = {
  stories: [{
    id: "checkout", role: "user", goal: "pay", benefit: "done",
    acceptanceCriteria: [{ statement: "ok", impliedState: "success" }],
  }],
};
const tokens = { colors: { ink: "#111111" } };
const trace = {
  version: 1,
  pages: [{ file: "screens/checkout.html", views: [{ id: "success", covers: [{ story: "checkout", impliedState: "success", selector: "#ok" }] }] }],
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "uxf-batch-html-"));
  await mkdir(path.join(root, "design/screens"), { recursive: true });
  await writeFile(path.join(root, "design/acceptance-criteria.json"), JSON.stringify(stories));
  await writeFile(path.join(root, "design/tokens.ds.json"), JSON.stringify(tokens));
  await writeFile(path.join(root, "design/trace.json"), JSON.stringify(trace));
  await writeFile(path.join(root, "design/screens/checkout.html"), "<!doctype html><html><body><h1 id=ok>ok</h1></body></html>");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function inputsFor(): ReturnType<typeof resolveInputs> {
  return resolveInputs(
    { version: 1, inputs: { stories: "design/acceptance-criteria.json", tokens: "design/tokens.ds.json", screens: "design/screens", trace: "design/trace.json" } },
    root,
  );
}

const goodSnap: RenderSnapshot = {
  page: "screens/checkout.html", view: "success", viewport: { width: 390, height: 844 },
  screenshot: "checkout-success.png", ok: true,
  coverChecks: [{ story: "checkout", impliedState: "success", selector: "#ok", found: true, visible: true }],
  paintedColors: [{ hex: "#111111", exampleSelector: "h1" }], axe: [],
};

describe("batchHtmlMode", () => {
  it("returns EXIT.OK and writes report.json when the rendering passes", async () => {
    const io = makeIO();
    const code = await batchHtmlMode(
      "design",
      { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined,
      { renderViews: async () => [goodSnap] },
    );
    expect(code).toBe(EXIT.OK);
    const report = JSON.parse(await readFile(path.join(root, ".uxfactory/batch/report.json"), "utf8"));
    expect(report.clean).toBe(true);
    expect(report.checks.map((c: { id: string }) => c.id)).toContain("render-coverage");
  });

  it("returns EXIT.GATE_FAIL when a binding must check fails", async () => {
    const io = makeIO();
    const badSnap: RenderSnapshot = { ...goodSnap, coverChecks: [{ ...goodSnap.coverChecks[0]!, visible: false }] };
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined, { renderViews: async () => [badSnap] },
    );
    expect(code).toBe(EXIT.GATE_FAIL);
  });

  it("returns EXIT.TRANSPORT when the renderer is unavailable", async () => {
    const io = makeIO();
    const code = await batchHtmlMode(
      "design", { json: true, dataDir: path.join(root, ".uxfactory"), cwd: root, scope: "visual" },
      io, inputsFor(), undefined,
      { renderViews: async () => { throw new Error("playwright not installed"); } },
    );
    expect(code).toBe(EXIT.TRANSPORT);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/batch-html.test.ts`
Expected: FAIL — `../src/commands/batch-html.js` not found.

- [ ] **Step 3: Implement `batch-html.ts`**

```ts
// packages/uxfactory-cli/src/commands/batch-html.ts
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../exit.js";
import { loadStoriesInput, loadTokensInput } from "../batch/inputs.js";
import { readTrace } from "../batch/trace.js";
import { renderHtml, type HtmlRenderDeps } from "../render/html-render.js";
import { runHtmlBatch } from "../batch/html-checks.js";
import { resolveScope, checkReadiness, parseScope } from "../batch/scope.js";
import type { Dial, DialLevel, RenderScope } from "../batch/scope.js";
import type { ResolvedInputs } from "../batch/registry.js";
import type { StorySet, TokenSet } from "../batch/checks.js";
import type { BatchReport } from "../batch/run.js";
import type { IO } from "../io.js";
import type { BatchFlags } from "./batch.js";

const DEFAULT_VIEWPORT = { width: 390, height: 844 };
const VALID_DIAL_LEVELS = new Set(["low", "medium", "high"]);

/**
 * HTML-mode batch: render the trace's (page,view) set, run the pure HTML gate over the
 * snapshots, write report.json + screenshots, and return the loop-termination exit code.
 * The renderer is injectable (`deps`) so tests run without a browser.
 */
export async function batchHtmlMode(
  specsDir: string,
  flags: BatchFlags,
  io: IO,
  inputs: ResolvedInputs,
  profileScope: RenderScope | undefined,
  deps?: HtmlRenderDeps,
): Promise<number> {
  void specsDir; // HTML mode reads the screens dir from the registry, not the positional arg

  // Dial-flag validation (parity with batchCmd).
  for (const [name, val] of [["visual", flags.visual], ["editorial", flags.editorial], ["coverage", flags.coverage], ["flow", flags.flow]] as const) {
    if (val !== undefined && !VALID_DIAL_LEVELS.has(val)) {
      io.err(`invalid --${name} value: "${val}". Must be one of: low, medium, high.`);
      return EXIT.TRANSPORT;
    }
  }
  if (flags.scope !== undefined) {
    const c = parseScope(flags.scope);
    if (!c.ok) { io.err(c.message); return EXIT.TRANSPORT; }
  }
  const overrides: Partial<Record<Dial, DialLevel>> = {};
  if (flags.visual !== undefined) overrides.visual = flags.visual as DialLevel;
  if (flags.editorial !== undefined) overrides.editorial = flags.editorial as DialLevel;
  if (flags.coverage !== undefined) overrides.coverage = flags.coverage as DialLevel;
  if (flags.flow !== undefined) overrides.flow = flags.flow as DialLevel;
  const rawBase = flags.scope !== undefined ? flags.scope : profileScope;
  const scope = resolveScope(rawBase, overrides);
  if (scope === null) {
    if (flags.json === true) io.out(JSON.stringify({ ok: false, reason: "scope-unset", missing: [], declared: [] }));
    else io.err("set a render scope before requesting a batch.");
    return EXIT.TRANSPORT;
  }

  // Load registered inputs.
  const storiesResult = await loadStoriesInput(inputs.stories);
  if (storiesResult.state === "broken") { io.err(storiesResult.message); return EXIT.TRANSPORT; }
  const stories: StorySet | null = storiesResult.state === "ok" ? storiesResult.value : null;

  const tokensResult = await loadTokensInput(inputs.tokens);
  if (tokensResult.state === "broken") { io.err(tokensResult.message); return EXIT.TRANSPORT; }
  const tokens: TokenSet | null = tokensResult.state === "ok" ? tokensResult.value : null;

  // Readiness: stories required at coverage≥low; tokens required at visual≥medium (HTML token-conformance).
  const readiness = checkReadiness(scope, { specs: inputs.screens !== null, stories: stories !== null, tokens: tokens !== null, flow: true });
  if (!readiness.ready) {
    if (flags.json === true) io.out(JSON.stringify({ ok: false, reason: "not-ready", missing: readiness.missing, declared: readiness.declared }));
    else { io.err("batch: readiness check failed — missing required artifacts:"); for (const m of readiness.missing) io.err(`  - ${m.artifact} (${m.dial}:${m.level}) — ${m.action}`); }
    return EXIT.TRANSPORT;
  }

  if (inputs.trace === null) { io.err("HTML mode requires inputs.trace"); return EXIT.TRANSPORT; }
  const traceResult = await readTrace(inputs.trace);
  if (!traceResult.ok) { io.err(traceResult.message); return EXIT.TRANSPORT; }

  // Render (async). A renderer failure is a setup error (2), never a silent pass.
  const previewDir = path.join(flags.dataDir, "batch", "previews");
  await mkdir(previewDir, { recursive: true });
  let snapshots;
  try {
    snapshots = await renderHtml(
      { baseDir: path.dirname(inputs.trace), trace: traceResult.trace, previewDir, viewport: DEFAULT_VIEWPORT },
      deps,
    );
  } catch (err) {
    io.err(`HTML renderer unavailable (install playwright + axe-core): ${(err as Error).message}`);
    return EXIT.TRANSPORT;
  }

  // Pure gate over the snapshots.
  const report: BatchReport = runHtmlBatch({ snapshots, stories, tokens, scope });

  const reportDoc = { screens: snapshots.map((s) => `${s.page} › ${s.view}`), ...report };
  await writeFile(path.join(flags.dataDir, "batch", "report.json"), JSON.stringify(reportDoc, null, 2), "utf8");
  if (flags.json === true) {
    io.out(JSON.stringify(reportDoc));
  } else {
    io.out(`batch: ${report.clean ? "clean" : "FAILED"} — ${snapshots.length} view(s) rendered`);
    for (const c of report.checks) {
      io.out(c.status === "skip" ? `  [${c.severity}] ${c.id}: ${c.status} (${c.reason ?? "no input"})` : `  [${c.severity}] ${c.id}: ${c.status}`);
      for (const f of c.findings) io.out(`    - ${f.detail}`);
    }
  }
  return report.mustPassFailed ? EXIT.GATE_FAIL : EXIT.OK;
}
```

- [ ] **Step 4: Wire the branch into `batchCmd`**

In `packages/uxfactory-cli/src/commands/batch.ts`, immediately after step 3 (loading the registered inputs — after the `reuseSpecs` block, before "// 4. Validate per-dial flag values"), insert:

```ts
  // 3a. HTML mode — when screens + trace are registered, gate the rendering instead of specs.
  if (reg.inputs.screens !== null && reg.inputs.trace !== null) {
    const { batchHtmlMode } = await import("./batch-html.js");
    return batchHtmlMode(specsDir, flags, io, reg.inputs, profileScope);
  }
```

(`profileScope` is already in scope from step 0; `reg.inputs` is the `ResolvedInputs`.)

- [ ] **Step 5: Run the new test + the spec-path regression test + typecheck**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/batch-html.test.ts packages/uxfactory-cli/test/batch.test.ts && pnpm --filter @uxfactory/cli typecheck`
Expected: PASS for both (the spec path is unchanged); 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/uxfactory-cli/src/commands/batch.ts packages/uxfactory-cli/src/commands/batch-html.ts packages/uxfactory-cli/test/batch-html.test.ts
git commit -m "feat(cli): batch HTML-mode branch — render + gate the rendering

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Worker — register `screens` + `trace` inputs

**Files:**
- Modify: `clients/uxfactory-worker/src/batch-registry.ts`
- Test: `clients/uxfactory-worker/test/batch-registry.test.ts` (create if absent)

**Interfaces:**
- Produces: `ensureBatchRegistry` additionally registers `screens → design/screens` (a directory) and `trace → design/trace.json` when they exist, selecting HTML mode for the worker's `generate-design` kind.

- [ ] **Step 1: Write the failing test**

```ts
// clients/uxfactory-worker/test/batch-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureBatchRegistry } from "../src/batch-registry.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "uxf-reg-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("registers screens + trace when present", async () => {
  await mkdir(path.join(root, "design/screens"), { recursive: true });
  await writeFile(path.join(root, "design/trace.json"), "{}");
  await ensureBatchRegistry(root);
  const reg = JSON.parse(await readFile(path.join(root, "uxfactory.batch.json"), "utf8"));
  expect(reg.inputs.screens).toBe("design/screens");
  expect(reg.inputs.trace).toBe("design/trace.json");
});

it("does not register screens/trace when absent", async () => {
  await ensureBatchRegistry(root);
  const reg = JSON.parse(await readFile(path.join(root, "uxfactory.batch.json"), "utf8"));
  expect(reg.inputs.screens).toBeUndefined();
  expect(reg.inputs.trace).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run clients/uxfactory-worker/test/batch-registry.test.ts`
Expected: FAIL — `screens`/`trace` not registered.

- [ ] **Step 3: Implement — extend `CONVENTIONAL_INPUTS`**

In `clients/uxfactory-worker/src/batch-registry.ts`, widen the key union and add entries:

```ts
/** Conventional generation paths — keep in sync with generative.ts TARGET_MAP. */
const CONVENTIONAL_INPUTS: ReadonlyArray<{ key: 'stories' | 'flow' | 'tokens' | 'screens' | 'trace'; rel: string }> = [
  { key: 'stories', rel: 'design/acceptance-criteria.json' },
  { key: 'flow', rel: 'design/user-flow.json' },
  { key: 'tokens', rel: 'design/token-set.json' },
  { key: 'screens', rel: 'design/screens' },     // HTML tier: directory of authored pages
  { key: 'trace', rel: 'design/trace.json' },     // HTML tier: coverage manifest
];
```

`fileExists` already uses `access`, which succeeds for directories too, so `design/screens` is registered when the directory exists. No other change needed.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run clients/uxfactory-worker/test/batch-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clients/uxfactory-worker/src/batch-registry.ts clients/uxfactory-worker/test/batch-registry.test.ts
git commit -m "feat(worker): register screens + trace so generate-design selects HTML mode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Rewrite `skill/design/SKILL.md` — HTML authoring guide

**Files:**
- Rewrite: `skill/design/SKILL.md`
- Test: `packages/uxfactory-cli/test/skill-design.test.ts` (binds the skill's example to the real validators so the doc can't drift)

**Interfaces:**
- Consumes: `validateTrace` from `../src/batch/trace.js` (in the test).
- Produces: a SKILL.md whose embedded `trace.json` example validates and whose authoring contract matches Tasks 1–8 (screens dir, activation vocabulary, `window.uxfReady`, the four gate ids, `UXF::PROGRESS`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/uxfactory-cli/test/skill-design.test.ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTrace } from "../src/batch/trace.js";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../skill/design/SKILL.md");

describe("skill/design SKILL.md stays in sync with the engine", () => {
  it("its embedded trace.json example validates", async () => {
    const md = await readFile(SKILL, "utf8");
    const m = /<!-- trace-example-start -->\s*```json\s*([\s\S]*?)```\s*<!-- trace-example-end -->/.exec(md);
    expect(m, "SKILL.md must contain a marked trace.json example").not.toBeNull();
    const parsed = JSON.parse(m![1]!);
    expect(validateTrace(parsed).ok).toBe(true);
  });

  it("documents the four HTML gate ids and the progress marker", async () => {
    const md = await readFile(SKILL, "utf8");
    for (const id of ["render-coverage", "a11y", "contrast", "token-conformance", "UXF::PROGRESS", "window.uxfReady"]) {
      expect(md, `SKILL.md must mention ${id}`).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/skill-design.test.ts`
Expected: FAIL — the current SKILL.md has no marked trace example / mentions JSON specs.

- [ ] **Step 3: Rewrite `skill/design/SKILL.md`**

Replace the whole file with:

````markdown
---
name: uxfactory-design
description: "Author REAL high-fidelity UI screens as self-contained HTML+CSS+JS that cover a project's user stories and acceptance criteria, then drive the deterministic `uxfactory batch` gate — which renders each screen headless and gates the RENDERING (render-coverage · a11y · contrast · token-conformance) — to a green bar. Use WHENEVER the user wants production-shaped UI screens generated from stories/acceptance-criteria and gated PASS/FAIL against an actual rendering. You are the agentic loop: you author HTML, run the gate, read its report, revise, and stop when the gate is clean (exit 0) or the iteration budget is spent. Do NOT use it for the single-spec online render→verify loop (the main uxfactory skill) or for drafting one upstream artifact (the generate skill)."
compatibility: "Requires the uxfactory-cli (Node 20+) with a headless Chromium (Playwright) + axe-core available. Gating runs fully offline — no bridge or Figma needed. Self-contained: the engine renders + gates; you author the HTML."
---

# UXFactory — author real HTML screens, drive the rendering gate green

You are an autonomous designer-in-the-loop. Your job: turn a project's **stories + acceptance criteria** into **real `*.html` screens** (self-contained — inline CSS + JS) that pass the deterministic `uxfactory batch` gate at the project's render scope. You author the HTML; the engine **renders each screen headless and gates the rendering**. One `batch` call = one deterministic render+gate pass; its **exit code** stops you.

The loop is: **author HTML → gate (render + check) → read the report → revise → green.** Never spin: every draft/revise counts against `maxIterations`.

## Step 0 — Read the pinned context

- **`design/acceptance-criteria.json`** — the stories: `{ "stories": [ { "id", "role", "goal", "benefit", "acceptanceCriteria": [ { "statement", "impliedState" } ] } ] }`. `impliedState` ∈ `empty · loading · error · success · edge`. These are the requirements you must cover.
- **`uxfactory.profile.json`** — the pinned scope dials (`visual`/`editorial`/`coverage`/`flow`, each `low|medium|high`) + constraints. At `visual ≥ medium` the `a11y`, `contrast`, and `token-conformance` gates bind; honor every constraint.
- **`uxfactory.batch.json`** — `maxIterations` (your budget) and `inputs` (registry paths: `inputs.stories`, `inputs.tokens`, `inputs.screens`, `inputs.trace`). Write artifacts to the registered paths.

## Step 1 — Author REAL HTML screens (one file per page)

For each **page** write `design/screens/<page>.html` as a self-contained document (inline `<style>` + `<script>`; no external assets). Rules the rendering gate enforces:

- **Semantic, accessible HTML.** Real landmarks (`<main>`, `<nav>`, `<h1>`…), labels for inputs, `alt` on images, button text. The gate runs **axe-core** on the rendered DOM — `a11y` violations FAIL at `visual ≥ medium`.
- **Real copy + layout**, honoring profile constraints. A page hosts multiple **view-states** (empty/loading/error/success/edge).
- **Expose each view-state via the activation contract** so the gate can render it:
  - respond to `location.hash` like `#view=error` (re-render on `hashchange`), and/or
  - reach a state by a click sequence (e.g. a `#pay` button → the error view).
  - When a state does async work (a `loading` state, a fetch), expose `window.uxfReady` as a Promise that resolves once the view is painted — the gate awaits it (bounded 5 s) before screenshotting.
- **Colors come from tokens.** Every painted color (text/background/border) must be a registered token at `visual ≥ medium` (see Step 2).

## Step 2 — Author tokens (when `visual ≥ medium`)

Write `design/tokens.ds.json` = `{ "colors": { "<name>": "#RRGGBB", … } }` registering EVERY color your screens paint, and use those exact hexes (the gate extracts colors from the **rendered** page). Ensure `uxfactory.batch.json` `inputs.tokens` points at it. At `visual: low` tokens are not owed.

## Step 3 — Author `design/trace.json` (the coverage manifest)

Map every required `(story, impliedState)` to a `(page, view, selector)`. One story may span many pages; one page hosts many views. The gate verifies each `selector` is **present and visible** in that view's rendered DOM.

<!-- trace-example-start -->
```json
{
  "version": 1,
  "pages": [
    {
      "file": "screens/checkout.html",
      "views": [
        { "id": "success", "activate": { "hash": "view=success" },
          "covers": [ { "story": "checkout", "impliedState": "success", "selector": "[data-ac='checkout-success']" } ] },
        { "id": "error", "activate": { "click": ["#pay"] },
          "covers": [ { "story": "checkout", "impliedState": "error", "selector": "[data-ac='checkout-error']" } ] }
      ]
    }
  ]
}
```
<!-- trace-example-end -->

Activation forms (exactly one per view, all eval-free): omit it (page as-loaded), `{ "hash": "view=error" }`, `{ "query": "state=error" }`, or `{ "click": ["#pay", ".retry"] }`.

## Step 4 — The loop: gate → read report → revise

```bash
uxfactory batch --json -- design
```

This renders each `(page, view)` headless, screenshots it to `.uxfactory/batch/previews/<page>-<view>.png`, runs the gate, writes `.uxfactory/batch/report.json`, and returns:

| Code | Meaning | What to do |
| ---- | ------- | ---------- |
| `0` | every binding `must` gate is green | **Stop.** Clean. |
| `1` | a binding `must` gate failed | read findings; revise; re-run |
| `2` | setup / missing input / renderer unavailable | fix setup (register inputs; ensure Playwright + axe-core) — NOT a quality signal |

On **exit 1**, act on each `must` check with `status:"fail"`:
- **render-coverage** — a `(story, state)` has no visible covering rendering, or a claimed selector didn't resolve / wasn't visible. Add/fix the view; make the selector present and visible when that view is activated.
- **a11y** — fix the axe violation (add `alt`, label the control, fix the role) in the HTML.
- **contrast** — raise the contrast of the offending text/background (and keep the colors registered tokens).
- **token-conformance** — the page painted a color that isn't a registered token: add it to `design/tokens.ds.json` or change the style to a registered hex.

## Step 5 — Stop

Stop at **exit 0** (clean) or when `maxIterations` is spent (surface best-effort screens + open findings). **Never spin** — never re-run the gate without changing anything.

## Progress feedback (emit at EVERY step)

Print one compact JSON line per step:

```
UXF::PROGRESS {"iter":<n>,"phase":"draft"|"gate"|"revise"|"done","gate":<gate-id-or-null>,"status":"pass"|"fail"|null,"findings":<count>,"note":"<short note>"}
```

- before drafting · after each `uxfactory batch` (the first failing gate id + status + findings count, or `status:"pass"`) · before each revise · once at the end (`phase:"done"`). Keep `note` SHORT and secret-free (never echo keys/tokens).

## Report

When you stop, report: the `design/screens/<page>.html` files written, whether `design/tokens.ds.json` was authored (and why — the `visual` dial), whether the gate reached **green** (exit 0) or hit the budget with open findings, and the **iteration count** spent.
````

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/uxfactory-cli/test/skill-design.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add skill/design/SKILL.md packages/uxfactory-cli/test/skill-design.test.ts
git commit -m "docs(skill): rewrite design skill to author HTML gated over the rendering

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification (after all tasks)

- [ ] **Full suite:** `pnpm test` — expected: all green (new HTML tests + the unchanged spec-path tests).
- [ ] **Typecheck:** `pnpm -r typecheck` — 0 errors across the workspace.
- [ ] **Boundary check:** `grep -rniE "helmsmith|agentcore|runpod|@anthropic|claude" packages/uxfactory-cli/src` returns nothing (engine stays self-contained; the LLM authoring lives only in the skill + worker).
- [ ] Dispatch the broad whole-branch review (superpowers:requesting-code-review) over `git merge-base main HEAD..HEAD`.

## Self-review notes (plan vs. spec)

- **Spec coverage:** §2 async-render→pure-gate → Tasks 6+7; §3 (page,view) unit → Tasks 1,6; §4 trace.json → Task 1; §5 RenderSnapshot → Task 2; §6 activation/settle → Task 6; §7 four checks + scope binding → Tasks 2–4; §8 registry HTML mode → Tasks 5,7; §9 skill → Task 9; §10 worker → Task 8; §11 plugin → **no change required** (verified `renderGateStrip` renders ids generically); §13 invariants → Global Constraints; §14 testing → each task's tests + Final Verification.
- **Type consistency:** `RenderSnapshot`/`CoverCheck`/`PaintedColor`/`AxeFinding` defined once (Task 2), imported by Tasks 3,4,6,7; `TraceManifest` defined once (Task 1), imported by Tasks 6,7; `runHtmlBatch` returns `BatchReport` (Task 4) consumed by Task 7; `HtmlRenderRequest.baseDir` set by Task 7 = `path.dirname(inputs.trace)`, consumed by Task 6's resolver.
- **Out of scope (deferred):** vision rubric (SP2); Figma landing / DOM→DesignSpec (SP3); responsive multi-viewport (schema reserves `viewports`); panel thumbnails (SP3).
````
