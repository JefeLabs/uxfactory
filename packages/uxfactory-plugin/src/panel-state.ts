/**
 * panel-state.ts — the pipeline panel's pure store: the state shape, the initial
 * state, a discriminated union of actions, their action creators, and an
 * immutable `reduce`.
 *
 * BOUNDARY (load-bearing): this module is pure data + reducers. It imports NO
 * `@helmsmith/*`, NO LLM / agent runtime, and NO `agentcore` / `runpod` /
 * `cloud` surface — only TypeScript types it declares itself. `Classification`
 * and `Manifest` MIRROR the engine's intake/condition vocabulary but are kept
 * PANEL-LOCAL on purpose: the panel must not import `@uxfactory/cli` (where the
 * authoritative `ProjectClassification` / `GateProfile` live). `Artifact` and
 * `GateResult` are intentionally LOOSE because the pipeline result the panel
 * relays is opaque — it is rendered verbatim and unknown fields are ignored
 * (forward-compatible, per the design's "ignore unrecognized event types").
 *
 * PURITY: `reduce` never mutates its inputs and returns a fresh object graph for
 * the parts it changes; untouched job objects keep their identity, so routing is
 * structurally JOB-SCOPED — an action for job A can never touch job B.
 */

// ---------------------------------------------------------------------------
// Job identity
// ---------------------------------------------------------------------------

/** The three requirement-artifact workstreams (the `generate-artifact` targets). */
export type JobId = "user-story" | "acceptance-criteria" | "user-journey";

/** Downstream jobs whose readiness seeds from the upstream `user-story` job. */
const DOWNSTREAM_JOBS: readonly JobId[] = ["acceptance-criteria", "user-journey"];

// ---------------------------------------------------------------------------
// Panel-local classification vocabulary (mirrors the engine intake vector §5.8;
// kept local because the panel cannot import `@uxfactory/cli`).
// ---------------------------------------------------------------------------

export type Category = "marketing" | "ecommerce" | "web_app" | "news";
export type Industry = "education" | "corporate" | "healthcare" | "finance" | "consumer";
export type AgeDemographic = "children" | "teens" | "18-25" | "26-35" | "36-50" | "50+";
export type Style = "informal" | "mix" | "formal";
export type ScopeLevel = "low" | "medium" | "high";

/** The four scope dials (each low|medium|high). */
export interface ScopeDials {
  visual: ScopeLevel;
  editorial: ScopeLevel;
  coverage: ScopeLevel;
  flow: ScopeLevel;
}

/**
 * The intake classification vector (the chip selections). Mirrors the engine's
 * `ProjectClassification` field names so the panel can relay it to the bridge's
 * `classify` kind unchanged; `version`/`flow_refs` are added by the view when it
 * assembles the request, so they are not part of the chip-driven store state.
 */
export interface Classification {
  category: Category;
  industry: Industry;
  age_demographic: AgeDemographic;
  style: Style;
  scope: ScopeDials;
}

// ---------------------------------------------------------------------------
// Panel-local manifest (loose mirror of the engine's condition() output).
// ---------------------------------------------------------------------------

export type Requirement = "requested" | "generatable" | "suppressed";
export type GateEffect = "hard" | "soft" | "suppressed";

/** One per-artifact disposition (a loose mirror of the engine `ManifestEntry`). */
export interface ManifestEntry {
  artifact_kind: string;
  requirement: Requirement;
  gate_effect: GateEffect;
  /** Forward-compatible: the engine carries more (enforced, derived_from, …). */
  [extra: string]: unknown;
}

/**
 * The classify result the panel holds: the artifact manifest plus whatever else
 * the bridge returns (scope, constraints, notes). Loose by design — the panel
 * renders it verbatim and ignores fields it does not recognize.
 */
export interface Manifest {
  manifest: ManifestEntry[];
  constraints?: string[];
  [extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// Loose pipeline-result types (the relayed payloads are opaque).
// ---------------------------------------------------------------------------

/**
 * A single drafted artifact accrued in a job. Loose: the worker's
 * `generate-artifact` returns `{ content, artifactPath }`, but a future batch
 * could split a result into `{ ref, title, seedRef, … }` items — the store keeps
 * all fields and the view reads what it understands.
 */
export interface Artifact {
  /** Stable ref, e.g. "S-1" / "AC-2" (when the producer supplies one). */
  ref?: string;
  /** Short human label. */
  title?: string;
  /** Cross-link to the seeding upstream artifact (e.g. an AC's Story). */
  seedRef?: string;
  /** Registry path written (the worker echoes `artifactPath`). */
  path?: string;
  /** The drafted payload (opaque). */
  content?: unknown;
  [extra: string]: unknown;
}

/** A single gate outcome for a job's gate strip (loose; report rendered verbatim). */
export interface GateResult {
  /** Gate id, e.g. "requirement-coverage" / "flow-reachability". */
  gate: string;
  /** ✓ pass · ⚠ soft · ✗ hard-fail · ○ not-run. */
  status: "pass" | "soft" | "fail" | "not-run";
  /** The detailed per-gate report (opaque). */
  report?: unknown;
  [extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Per-job slice of the store. */
export interface JobState {
  artifacts: Artifact[];
  gates: GateResult[];
  /** The latest live SSE line for this job (replaced, not accumulated). */
  streamLine?: string;
  /** Upstream-seed indicator, e.g. "Stories: 4 ✓" / "needs Stories". */
  seedStatus?: string;
  /** The in-flight request id (set on enqueue, cleared on result). */
  pendingId?: string;
}

/**
 * The PROJECT-level screens scaffold (one set covers ALL jobs/stories, so it
 * lives on the shared project block, not a per-job slice). `written` is the list
 * of `<story>.uxfactory.json` spec files the worker's deterministic
 * `generate-specs` kind wrote — the thing that makes requirement-coverage pass.
 */
export interface Screens {
  written: string[];
}

export interface PanelState {
  connection: "connected" | "disconnected";
  project: {
    classification: Partial<Classification>;
    manifest?: Manifest;
    /** PROJECT-level scaffolded design specs (shared across all jobs). */
    screens?: Screens;
  } | null;
  jobs: Record<JobId, JobState>;
  activeJob: JobId;
}

/** A fresh, empty per-job slice. */
function emptyJob(): JobState {
  return { artifacts: [], gates: [] };
}

export const initialState: PanelState = {
  connection: "disconnected",
  project: null,
  jobs: {
    "user-story": emptyJob(),
    "acceptance-criteria": emptyJob(),
    "user-journey": emptyJob(),
  },
  activeJob: "user-story",
};

// ---------------------------------------------------------------------------
// Actions (discriminated union)
// ---------------------------------------------------------------------------

/**
 * `setClassification` is a distributive union over the classification fields so
 * `field`/`value` stay correlated (field "category" ⇒ value `Category`, etc.).
 */
export type SetClassificationAction = {
  [K in keyof Classification]: { type: "setClassification"; field: K; value: Classification[K] };
}[keyof Classification];

export type PanelAction =
  | { type: "setConnection"; connection: PanelState["connection"] }
  | SetClassificationAction
  | { type: "setManifest"; manifest: Manifest }
  | { type: "setActiveJob"; job: JobId }
  | { type: "jobEnqueued"; job: JobId; id: string }
  | { type: "jobEvent"; job: JobId; event: unknown }
  | { type: "jobResult"; job: JobId; result: { status: number; result: unknown } }
  | { type: "gateResult"; job: JobId; gates: GateResult[] }
  | { type: "screensScaffolded"; written: string[] };

// ---------------------------------------------------------------------------
// Action creators
// ---------------------------------------------------------------------------

export function setConnection(connection: PanelState["connection"]): PanelAction {
  return { type: "setConnection", connection };
}

export function setClassification<K extends keyof Classification>(
  field: K,
  value: Classification[K],
): PanelAction {
  return { type: "setClassification", field, value } as SetClassificationAction;
}

export function setManifest(manifest: Manifest): PanelAction {
  return { type: "setManifest", manifest };
}

export function setActiveJob(job: JobId): PanelAction {
  return { type: "setActiveJob", job };
}

export function jobEnqueued(job: JobId, id: string): PanelAction {
  return { type: "jobEnqueued", job, id };
}

export function jobEvent(job: JobId, event: unknown): PanelAction {
  return { type: "jobEvent", job, event };
}

export function jobResult(
  job: JobId,
  result: { status: number; result: unknown },
): PanelAction {
  return { type: "jobResult", job, result };
}

export function gateResult(job: JobId, gates: GateResult[]): PanelAction {
  return { type: "gateResult", job, gates };
}

/** Record the PROJECT-level set of scaffolded design specs the worker wrote. */
export function screensScaffolded(written: string[]): PanelAction {
  return { type: "screensScaffolded", written };
}

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

/** "Stories: N ✓" when the upstream job has artifacts, else "needs Stories". */
function deriveSeedStatus(storyCount: number): string {
  return storyCount > 0 ? `Stories: ${storyCount} ✓` : "needs Stories";
}

/** Coerce one opaque result item into a (loose) Artifact, wrapping primitives. */
function normalizeArtifact(v: unknown): Artifact {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Artifact)
    : { content: v };
}

/**
 * Normalize an opaque `jobResult` payload into Artifact[]:
 *  - `null`/`undefined` → no artifacts (e.g. a setup-error result).
 *  - `{ artifacts: [...] }` → that pre-split list (a future batch shape).
 *  - an array → each element as an artifact.
 *  - any other object/primitive → one artifact (the worker's `{content,path}`).
 */
function toArtifacts(result: unknown): Artifact[] {
  if (result === null || result === undefined) return [];
  if (Array.isArray(result)) return result.map(normalizeArtifact);
  if (typeof result === "object") {
    const maybe = (result as { artifacts?: unknown }).artifacts;
    if (Array.isArray(maybe)) return maybe.map(normalizeArtifact);
  }
  return [normalizeArtifact(result)];
}

/** Derive the single live stream line for a job from an opaque SSE event. */
function toStreamLine(event: unknown): string {
  if (event !== null && typeof event === "object") {
    const e = event as Record<string, unknown>;
    if (typeof e["text"] === "string") return e["text"];
    if (typeof e["message"] === "string") return e["message"];
    if (typeof e["type"] === "string") return e["type"];
  }
  if (typeof event === "string") return event;
  return JSON.stringify(event);
}

/**
 * Replace ONE job's slice immutably. Copies the jobs record (preserving every
 * sibling object's identity), then swaps the single target — this is what makes
 * routing structurally job-scoped: an action for `job` cannot touch siblings.
 */
function updateJob(s: PanelState, job: JobId, patch: Partial<JobState>): PanelState {
  const jobs: Record<JobId, JobState> = { ...s.jobs };
  jobs[job] = { ...s.jobs[job], ...patch };
  return { ...s, jobs };
}

// ---------------------------------------------------------------------------
// reduce — pure, immutable
// ---------------------------------------------------------------------------

export function reduce(s: PanelState, a: PanelAction): PanelState {
  switch (a.type) {
    case "setConnection":
      return { ...s, connection: a.connection };

    case "setClassification": {
      const classification: Partial<Classification> = {
        ...(s.project?.classification ?? {}),
        [a.field]: a.value,
      };
      return {
        ...s,
        project: { ...(s.project ?? { classification: {} }), classification },
      };
    }

    case "setManifest": {
      const project = { ...(s.project ?? { classification: {} }), manifest: a.manifest };
      const seedStatus = deriveSeedStatus(s.jobs["user-story"].artifacts.length);
      const jobs: Record<JobId, JobState> = { ...s.jobs };
      for (const id of DOWNSTREAM_JOBS) {
        jobs[id] = { ...s.jobs[id], seedStatus };
      }
      return { ...s, project, jobs };
    }

    case "setActiveJob":
      return { ...s, activeJob: a.job };

    case "jobEnqueued":
      return updateJob(s, a.job, { pendingId: a.id });

    case "jobEvent":
      return updateJob(s, a.job, { streamLine: toStreamLine(a.event) });

    case "jobResult":
      return updateJob(s, a.job, {
        artifacts: [...s.jobs[a.job].artifacts, ...toArtifacts(a.result.result)],
        pendingId: undefined,
      });

    case "gateResult":
      return updateJob(s, a.job, { gates: a.gates });

    case "screensScaffolded": {
      // PROJECT-level: screens are scaffolded only against a defined project, so
      // there is nothing to record when no project exists yet — no-op.
      if (s.project === null) return s;
      return { ...s, project: { ...s.project, screens: { written: a.written } } };
    }

    default:
      // Forward-compatible: an unrecognized runtime action leaves state as-is.
      return s;
  }
}
