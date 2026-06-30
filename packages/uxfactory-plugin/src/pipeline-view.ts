/**
 * pipeline-view.ts — renders the pipeline panel (header + active-job body, or the
 * first-run intake) from `PanelState` as an HTML string, and wires its chip/button
 * clicks + the one SSE stream to the pipeline client and the store. This is the
 * integration layer that composes the three sibling panel modules.
 *
 * BOUNDARY (load-bearing): this module imports ONLY its three sibling panel
 * modules (`chips`, `panel-state`, `pipeline-client`) plus DOM / `fetch`-stream
 * builtins. It holds no agent runtime, no model, no remote-orchestration surface,
 * and no CLI import — every pipeline payload/result/event is an opaque relay.
 *
 * RENDER MODEL: string templating (the UI bundle is esbuild-inlined, no framework
 * — see `chips.ts`). Re-render is a whole-subtree `root.innerHTML = renderPanel()`,
 * which is safe because ALL interaction goes through ONE delegated click handler
 * bound to `root` (its listener survives an innerHTML swap of the children).
 *
 * SEED INDICATOR: the upstream-seed line is a PURE SELECTOR computed at render time
 * from `jobs['user-story'].artifacts.length` — the stored `seedStatus` field can go
 * stale, so the view never reads it.
 */

import { renderChips, dialChip, toggleChip, type ChipGroup, type DialLevel } from "./chips.js";
import {
  setActiveJob,
  setClassification,
  setManifest,
  jobEnqueued,
  jobEvent,
  jobResult,
  gateResult,
  type PanelState,
  type PanelAction,
  type JobId,
  type Classification,
  type ScopeDials,
  type Manifest,
  type GateResult,
  type Artifact,
} from "./panel-state.js";
import type { PipelineClient } from "./pipeline-client.js";

// ---------------------------------------------------------------------------
// Vocabulary (the verbatim chip enums; ids double as the store field names)
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS: ChipGroup["options"] = [
  { value: "marketing", label: "Marketing" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "web_app", label: "Web app" },
  { value: "news", label: "News" },
];
const INDUSTRY_OPTIONS: ChipGroup["options"] = [
  { value: "education", label: "Education" },
  { value: "corporate", label: "Corporate" },
  { value: "healthcare", label: "Healthcare" },
  { value: "finance", label: "Finance" },
  { value: "consumer", label: "Consumer" },
];
const AGE_OPTIONS: ChipGroup["options"] = [
  { value: "children", label: "Children" },
  { value: "teens", label: "Teens" },
  { value: "18-25", label: "18-25" },
  { value: "26-35", label: "26-35" },
  { value: "36-50", label: "36-50" },
  { value: "50+", label: "50+" },
];
const STYLE_OPTIONS: ChipGroup["options"] = [
  { value: "informal", label: "Informal" },
  { value: "mix", label: "Mix" },
  { value: "formal", label: "Formal" },
];

/** The single-select classification chip groups; the `id` is the store field. */
type SingleField = "category" | "industry" | "age_demographic" | "style";
const SINGLE_GROUPS: { field: SingleField; options: ChipGroup["options"] }[] = [
  { field: "category", options: CATEGORY_OPTIONS },
  { field: "industry", options: INDUSTRY_OPTIONS },
  { field: "age_demographic", options: AGE_OPTIONS },
  { field: "style", options: STYLE_OPTIONS },
];

/** The four scope dials (each low|medium|high). The id is the dial's store key. */
type DialId = keyof ScopeDials;
const DIAL_IDS: readonly DialId[] = ["visual", "editorial", "coverage", "flow"];
const DEFAULT_SCOPE: ScopeDials = {
  visual: "medium",
  editorial: "medium",
  coverage: "medium",
  flow: "medium",
};

/** The three jobs, rendered as a single-select chip group. */
const JOB_TAB_GROUP = "job-tab";
const JOB_IDS: readonly JobId[] = ["user-story", "acceptance-criteria", "user-journey"];
const JOB_LABEL: Record<JobId, string> = {
  "user-story": "Stories",
  "acceptance-criteria": "ACs",
  "user-journey": "Journeys",
};

/** Downstream jobs whose body shows the upstream user-story seed indicator. */
const DOWNSTREAM_JOBS: readonly JobId[] = ["acceptance-criteria", "user-journey"];

/** The default artifacts directory the worker gates (it also defaults to this). */
const DEFAULT_GATE_DIR = "design";

/** Per-gate status glyphs for the strip. */
const GATE_GLYPH: Record<GateResult["status"], string> = {
  pass: "✓",
  soft: "⚠",
  fail: "✗",
  "not-run": "○",
};

// ---------------------------------------------------------------------------
// Escaping (local copy: chips.ts keeps its own private esc)
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Pure selectors
// ---------------------------------------------------------------------------

/** A project is "defined" once it carries a manifest — until then, show intake. */
function isProjectDefined(s: PanelState): boolean {
  return s.project !== null && s.project.manifest !== undefined;
}

function classificationOf(s: PanelState): Partial<Classification> {
  return s.project?.classification ?? {};
}

function scopeOf(s: PanelState): ScopeDials {
  return classificationOf(s).scope ?? DEFAULT_SCOPE;
}

/** The currently-selected value for a single-select classification field. */
function selectedFor(s: PanelState, field: SingleField): string[] {
  const v = classificationOf(s)[field];
  return typeof v === "string" ? [v] : [];
}

/** SELECTOR: the upstream-seed indicator, computed from the user-story count. */
function seedIndicator(s: PanelState): string {
  const n = s.jobs["user-story"].artifacts.length;
  return n > 0 ? `Stories: ${n} ✓` : "needs Stories";
}

/** The upstream user-story refs that seed a downstream generation. */
function storyRefs(s: PanelState): string[] {
  return s.jobs["user-story"].artifacts
    .map((a) => a.ref)
    .filter((r): r is string => typeof r === "string");
}

// ---------------------------------------------------------------------------
// renderPanel
// ---------------------------------------------------------------------------

export function renderPanel(s: PanelState): string {
  return isProjectDefined(s) ? renderJobView(s) : renderIntake(s);
}

/** First-run intake: classification chips + scope dials + Define project. */
function renderIntake(s: PanelState): string {
  const disabled = s.connection === "disconnected";
  const scope = scopeOf(s);

  const classificationGroups = SINGLE_GROUPS.map(
    ({ field, options }) =>
      `<div class="intake-field"><span class="field-label">${esc(field)}</span>${renderChips({
        id: field,
        mode: "single",
        selected: selectedFor(s, field),
        options,
        disabled,
      })}</div>`,
  ).join("");

  const dials = DIAL_IDS.map(
    (d) => `<div class="dial-field"><span class="field-label">${esc(d)}</span>${dialChip(d, scope[d])}</div>`,
  ).join("");

  return `<section class="panel intake" data-view="intake">
  <header class="panel-header">${connectionDot(s)}<h1>Define your project</h1></header>
  <div class="intake-body">
    <div class="classification">${classificationGroups}</div>
    <div class="scope-dials">${dials}</div>
  </div>
  <div class="actions">
    <button type="button" class="primary" data-action="define"${disabledAttr(disabled)}>Define project</button>
  </div>
</section>`;
}

/** The working panel: header (project ▾ + job tabs + gate strip) + active body. */
function renderJobView(s: PanelState): string {
  return `<section class="panel job-view" data-view="job">
${renderHeader(s)}
${renderBody(s)}
</section>`;
}

function renderHeader(s: PanelState): string {
  const name = classificationOf(s).category ?? "Project";
  const jobTabs = renderChips({
    id: JOB_TAB_GROUP,
    mode: "single",
    selected: [s.activeJob],
    options: JOB_IDS.map((id) => ({ value: id, label: JOB_LABEL[id] })),
    disabled: s.connection === "disconnected",
  });
  return `<header class="panel-header">
  <div class="header-row">
    <button type="button" class="project-name" data-action="project-menu">${esc(name)} ▾</button>
    ${jobTabs}
    ${connectionDot(s)}
  </div>
  ${renderGateStrip(s.jobs[s.activeJob].gates)}
</header>`;
}

function connectionDot(s: PanelState): string {
  const connected = s.connection === "connected";
  return `<span class="conn ${connected ? "connected" : "disconnected"}" title="${connected ? "connected" : "start the bridge"}">${connected ? "●" : "○"} ${connected ? "connected" : "disconnected"}</span>`;
}

function renderGateStrip(gates: GateResult[]): string {
  if (gates.length === 0) {
    return `<div class="gate-strip" data-gates="0"><span class="gate not-run">${GATE_GLYPH["not-run"]} gates not run</span></div>`;
  }
  const cells = gates
    .map(
      (g) =>
        `<span class="gate ${g.status}">${GATE_GLYPH[g.status] ?? "○"} ${esc(g.gate)}</span>`,
    )
    .join("");
  return `<div class="gate-strip" data-gates="${gates.length}">${cells}</div>`;
}

function renderBody(s: PanelState): string {
  const job = s.activeJob;
  const slice = s.jobs[job];
  const disabled = s.connection === "disconnected";
  const busy = slice.pendingId !== undefined;
  const scope = scopeOf(s);

  const dials = DIAL_IDS.map(
    (d) => `<div class="dial-field"><span class="field-label">${esc(d)}</span>${dialChip(d, scope[d])}</div>`,
  ).join("");

  const seed = DOWNSTREAM_JOBS.includes(job)
    ? `<div class="seed-indicator" data-seed="true">seed [ ${esc(seedIndicator(s))} ]</div>`
    : "";

  const stream =
    slice.streamLine !== undefined
      ? `<div class="stream-line" data-live="true">◐ ${esc(slice.streamLine)}</div>`
      : "";

  return `<div class="job-body" data-job="${esc(job)}"${disabled ? ' data-disabled="true"' : ""}>
  <div class="inputs-row">
    <div class="scope-dials">${dials}</div>
    ${seed}
  </div>
  ${stream}
  ${renderArtifacts(slice.artifacts)}
  <div class="actions">
    <button type="button" class="primary" data-action="generate"${disabledAttr(disabled || busy)}>Generate</button>
    <button type="button" data-action="provide"${disabledAttr(disabled)}>Provide my own</button>
    <button type="button" data-action="run-gates"${disabledAttr(disabled)}>Run gates</button>
  </div>
  ${renderGateReport(slice.gates)}
</div>`;
}

/** The accrued artifact list with Stories↔ACs↔Journeys cross-links. */
function renderArtifacts(artifacts: Artifact[]): string {
  if (artifacts.length === 0) {
    return `<ul class="artifacts" data-count="0"><li class="empty">No artifacts yet — Generate or Provide your own.</li></ul>`;
  }
  const items = artifacts
    .map((a) => {
      const failure = artifactFailure(a);
      if (failure !== null) {
        return `<li class="artifact failure" data-failure="true">⚠ ${esc(failure)}</li>`;
      }
      const ref = typeof a.ref === "string" ? a.ref : "";
      const title = typeof a.title === "string" ? a.title : "";
      const link =
        typeof a.seedRef === "string" ? ` <span class="xlink">→ ${esc(a.seedRef)}</span>` : "";
      const head = [ref, title].filter((x) => x !== "").map(esc).join("  ");
      return `<li class="artifact" data-ref="${esc(ref)}">✓ ${head}${link}</li>`;
    })
    .join("");
  return `<ul class="artifacts" data-count="${artifacts.length}">${items}</ul>`;
}

/**
 * A setup-error result (status 2) surfaces as an artifact carrying an error
 * shape; render it inline as a failure (the error class/message) — Generate is
 * re-enabled automatically because the result cleared the job's pendingId.
 */
function artifactFailure(a: Artifact): string | null {
  const err = (a as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object") {
    const e = err as { name?: unknown; message?: unknown };
    const msg = typeof e.message === "string" ? e.message : "";
    const name = typeof e.name === "string" ? e.name : "Error";
    return msg !== "" ? `${name}: ${msg}` : name;
  }
  if (a.ref === undefined && a.title === undefined && a.path === undefined) {
    const m = (a as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return null;
}

function renderGateReport(gates: GateResult[]): string {
  const reports = gates.filter((g) => g.report !== undefined || g.status === "fail" || g.status === "soft");
  const body =
    reports.length === 0
      ? "<em>no report</em>"
      : `<pre>${esc(JSON.stringify(reports, null, 2))}</pre>`;
  return `<details class="gate-report"><summary>report ▸</summary>${body}</details>`;
}

function disabledAttr(disabled: boolean): string {
  return disabled ? ' disabled aria-disabled="true"' : "";
}

// ---------------------------------------------------------------------------
// Opaque-result coercion (gates)
// ---------------------------------------------------------------------------

/** Coerce one opaque gate item into a (loose) GateResult. */
function coerceGate(v: unknown): GateResult {
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const gate =
      typeof o["gate"] === "string"
        ? o["gate"]
        : typeof o["name"] === "string"
          ? o["name"]
          : typeof o["id"] === "string"
            ? o["id"]
            : "gate";
    let status: GateResult["status"];
    const s = o["status"];
    if (s === "pass" || s === "soft" || s === "fail" || s === "not-run") status = s;
    else if (typeof o["passed"] === "boolean") status = o["passed"] ? "pass" : "fail";
    else if (typeof o["ok"] === "boolean") status = o["ok"] ? "pass" : "fail";
    else status = "not-run";
    return { ...o, gate, status };
  }
  return { gate: "gate", status: "not-run" };
}

/** Derive the GateResult[] for the strip from an opaque gate pipeline result. */
function toGateResults(r: { status: number; result: unknown }): GateResult[] {
  const inner = r.result;
  if (Array.isArray(inner)) return inner.map(coerceGate);
  if (inner !== null && typeof inner === "object") {
    const gates = (inner as { gates?: unknown }).gates;
    if (Array.isArray(gates)) return gates.map(coerceGate);
  }
  // Fall back to a single synthetic gate derived from the pipeline status
  // (0 ok / 1 gate-fail / 2 setup).
  const status: GateResult["status"] = r.status === 0 ? "pass" : r.status === 1 ? "fail" : "not-run";
  return [{ gate: "gate", status, report: inner }];
}

// ---------------------------------------------------------------------------
// wirePanel
// ---------------------------------------------------------------------------

export interface WirePanelOptions {
  client: PipelineClient;
  getState(): PanelState;
  dispatch(a: PanelAction): void;
}

/** Polling cadence for the await-based flows (Define / Run gates). */
const POLL_INTERVAL_MS = 500;
const MAX_POLLS = 600; // ~5 min ceiling; tests resolve on the first poll

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wire the panel's delegated click handler + the one SSE subscription to `root`.
 *
 * TEARDOWN (load-bearing): returns the `client.subscribe` unsubscribe so the
 * caller (`ui.ts`) can close the SSE stream on disconnect/re-mount — re-mounting
 * without it would leak one fetch-stream reader per reconnect. The delegated
 * click handler lives on `root` and is discarded with the element, so the
 * subscription is the only thing the caller must explicitly release.
 */
export function wirePanel(root: HTMLElement, opts: WirePanelOptions): () => void {
  const { client, getState } = opts;

  const render = (): void => {
    root.innerHTML = renderPanel(getState());
  };

  const dispatchAndRender = (a: PanelAction): void => {
    opts.dispatch(a);
    render();
  };

  // --- the one delegated click handler -------------------------------------
  root.addEventListener("click", (ev: Event): void => {
    const target = ev.target as Element | null;
    const chip = target?.closest<HTMLElement>("[data-chip-group][data-chip-value]");
    if (chip) {
      handleChip(
        chip.getAttribute("data-chip-group") ?? "",
        chip.getAttribute("data-chip-value") ?? "",
      );
      return;
    }
    const action = target?.closest<HTMLElement>("[data-action]");
    if (action) handleAction(action.getAttribute("data-action") ?? "");
  });

  function handleChip(group: string, value: string): void {
    if (group === JOB_TAB_GROUP) {
      dispatchAndRender(setActiveJob(value as JobId));
      return;
    }
    if (isDialId(group)) {
      applyDial(group, value as DialLevel);
      return;
    }
    if (isSingleField(group)) {
      applyClassificationChip(group, value);
    }
  }

  function applyClassificationChip(field: SingleField, value: string): void {
    const next = toggleChip(
      { id: field, mode: "single", selected: selectedFor(getState(), field), options: [] },
      value,
    );
    const v = next[0];
    if (v === undefined) return; // single-select always yields exactly one
    dispatchAndRender(setClassification(field, v as Classification[SingleField]));
  }

  function applyDial(dial: DialId, level: DialLevel): void {
    const scope: ScopeDials = { ...scopeOf(getState()), [dial]: level };
    dispatchAndRender(setClassification("scope", scope));
  }

  function handleAction(action: string): void {
    switch (action) {
      case "define":
        void define();
        return;
      case "generate":
        void generate();
        return;
      case "run-gates":
        void runGates();
        return;
      // "provide" (paste-your-own) is panel-local and out of v1 scope here.
      default:
        return;
    }
  }

  // --- intake → classify → manifest ----------------------------------------
  async function define(): Promise<void> {
    const classification = classificationOf(getState());
    const id = await client.enqueue("classify", { classification });
    const result = await awaitResult(id);
    if (result) dispatchAndRender(setManifest(result.result as Manifest));
  }

  // --- per-job generate: poll-until-done owns the artifact append ----------
  // The SSE frames update the live streamLine (subscription below); the
  // completion/append comes from awaitResult, NOT a single SSE-nudge poll. The
  // real worker streams every frame (incl. the terminal one) DURING the run and
  // stores the result only AFTER, so a single poll fired on the terminal frame
  // can race ahead of the store and strand the job. Poll-until-done can't.
  async function generate(): Promise<void> {
    const s = getState();
    const job = s.activeJob;
    const id = await client.enqueue("generate-artifact", buildGeneratePayload(s, job));
    dispatchAndRender(jobEnqueued(job, id));
    const result = await awaitResult(id);
    if (result) dispatchAndRender(jobResult(job, result));
  }

  // --- per-job gates (await the result, then set the strip) ----------------
  async function runGates(): Promise<void> {
    const s = getState();
    const job = s.activeJob;
    const id = await client.enqueue("gate", { dir: gateDir(s), scope: scopeOf(s) });
    const result = await awaitResult(id);
    if (result) dispatchAndRender(gateResult(job, toGateResults(result)));
  }

  // --- the single SSE subscription: live progress only ---------------------
  // Each frame updates the owning job's streamLine. Completion/append is owned
  // by each action's awaitResult (poll-until-done), so a frame whose result is
  // not stored yet cannot strand the job. A late frame arriving after
  // completion finds no owner (jobResult cleared pendingId) and is ignored.
  const unsubscribe = client.subscribe((frame) => {
    const job = jobForRequest(frame.requestId);
    if (job === undefined) return; // no in-flight job owns this id → ignore
    dispatchAndRender(jobEvent(job, frame.event));
  });

  /** Find the job whose pendingId matches the request id (from live state). */
  function jobForRequest(requestId: string): JobId | undefined {
    const s = getState();
    for (const id of JOB_IDS) if (s.jobs[id].pendingId === requestId) return id;
    return undefined;
  }

  /** Poll until the bridge has a stored result (or the request is unknown). */
  async function awaitResult(
    id: string,
  ): Promise<{ status: number; result: unknown } | null> {
    for (let i = 0; i < MAX_POLLS; i++) {
      const poll = await client.pollResult(id);
      if (poll.status === "done") return poll.result;
      if (poll.status === "unknown") return null;
      await delay(POLL_INTERVAL_MS);
    }
    return null;
  }

  // initial paint
  render();

  // Hand the caller the SSE teardown (the click handler dies with `root`).
  return unsubscribe;
}

// ---------------------------------------------------------------------------
// Payload builders / type guards
// ---------------------------------------------------------------------------

function buildGeneratePayload(s: PanelState, job: JobId): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    target: job,
    classification: classificationOf(s),
    scope: scopeOf(s),
  };
  // Downstream jobs are seeded by the upstream user-story refs.
  if (DOWNSTREAM_JOBS.includes(job)) payload["seedRefs"] = storyRefs(s);
  return payload;
}

function gateDir(s: PanelState): string {
  const dir = (s.project?.manifest as { dir?: unknown } | undefined)?.dir;
  return typeof dir === "string" ? dir : DEFAULT_GATE_DIR;
}

function isDialId(group: string): group is DialId {
  return (DIAL_IDS as readonly string[]).includes(group);
}

function isSingleField(group: string): group is SingleField {
  return group === "category" || group === "industry" || group === "age_demographic" || group === "style";
}
