import type { Spec } from "@uxfactory/spec";

// --- result + input-data types ---------------------------------------------

/** Outcome of a single gate. */
export type CheckStatus = "pass" | "fail" | "skip";
/** Whether a gate blocks the loop (`must`) or only advises (`advisory`). */
export type Severity = "must" | "advisory";

/** One actionable problem a gate found, with reason and the thing it points at. */
export interface BatchFinding {
  detail: string;
  ref?: string;
}

/** The deterministic result of one gate over the batch (skip-and-declare via status:"skip"). */
export interface CheckResult {
  id: string;
  status: CheckStatus;
  severity: Severity;
  findings: BatchFinding[];
  reason?: string;
}

/** A validated batch spec paired with the file it came from. */
export interface LoadedSpec {
  file: string;
  spec: Spec;
}

/** tokens.ds.json (v1): a flat name → hex color register. */
export interface TokenSet {
  colors: Record<string, string>;
}

/** The view-state an acceptance criterion implies. */
export type ImpliedState = "empty" | "loading" | "error" | "success" | "edge";

/** One acceptance criterion: a statement plus the state it implies must exist. */
export interface AcceptanceCriterion {
  statement: string;
  impliedState: ImpliedState;
}

/** One user story with its acceptance criteria. */
export interface Story {
  id: string;
  role: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: AcceptanceCriterion[];
}

/** stories.json (v1). */
export interface StorySet {
  stories: Story[];
}

/** flow.json (v1): an ordered sequence of node/frame names. */
export interface Flow {
  steps: string[];
}

// --- shared spec walkers (pure) --------------------------------------------

/** A spec child reduced to the fields the checks read. */
interface AnyChild {
  type: string;
  name: string;
  fill?: unknown;
  stroke?: unknown;
}

/** Each container's (frame/section) children, regardless of editor. */
function containers(spec: Spec): { name: string; children: AnyChild[] }[] {
  if ("frames" in spec) {
    return spec.frames.map((f) => ({ name: f.name, children: (f.children ?? []) as unknown as AnyChild[] }));
  }
  if ("sections" in spec) {
    return spec.sections.map((s) => ({ name: s.name, children: (s.children ?? []) as unknown as AnyChild[] }));
  }
  return [];
}

/** Normalize a hex color to 6-digit lowercase (`#rrggbb`), or null if not a hex color. */
function normalizeColor(hex: string): string | null {
  const h = hex.trim().toLowerCase();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(h)) return null;
  const digits = h.slice(1);
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return `#${full}`;
}

/** Every fill/stroke color used in a spec, with a human-readable location. */
function specColors(loaded: LoadedSpec): { value: string; where: string }[] {
  const out: { value: string; where: string }[] = [];
  for (const c of containers(loaded.spec)) {
    for (const child of c.children) {
      if (typeof child.fill === "string") out.push({ value: child.fill, where: `${loaded.file}:${c.name}/${child.name}.fill` });
      if (typeof child.stroke === "string") out.push({ value: child.stroke, where: `${loaded.file}:${c.name}/${child.name}.stroke` });
    }
  }
  return out;
}

/** A name+shape signature for each container, used to detect duplicates against reuse specs. */
function containerSignatures(spec: Spec): { name: string; sig: string }[] {
  return containers(spec).map((c) => {
    const parts = c.children.map((ch) => `${ch.type}:${ch.name}`).sort();
    return { name: c.name, sig: `${c.name}::${parts.join(",")}` };
  });
}

// --- gates (Task 2) ---------------------------------------------------------

/**
 * token conformance (must) — every fill/stroke must reference a registered color.
 * Skip-and-declare when no token register is provided. A value that is ad-hoc
 * (or not even a hex color) becomes a finding. Pure + deterministic.
 */
export function tokenConformance(specs: LoadedSpec[], tokens: TokenSet | null): CheckResult {
  const id = "token-conformance";
  if (tokens === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no token register registered" };
  }
  const registered = new Set<string>();
  for (const value of Object.values(tokens.colors ?? {})) {
    const n = normalizeColor(value);
    if (n !== null) registered.add(n);
  }
  const findings: BatchFinding[] = [];
  for (const loaded of specs) {
    for (const used of specColors(loaded)) {
      const n = normalizeColor(used.value);
      if (n === null || !registered.has(n)) {
        findings.push({ detail: `ad-hoc color ${used.value} at ${used.where} is not a registered token`, ref: used.value });
      }
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/**
 * reuse (must) — a batch container that duplicates one already present in a
 * registered existing spec (same name + child shape) should be referenced, not
 * regenerated. Skip-and-declare when no reuse specs are provided. Pure + deterministic.
 */
export function reuse(specs: LoadedSpec[], reuseSpecs: Spec[] | null): CheckResult {
  const id = "reuse";
  if (reuseSpecs === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no existing specs registered for reuse" };
  }
  const existing = new Map<string, string>(); // sig -> container name
  for (const spec of reuseSpecs) {
    for (const { name, sig } of containerSignatures(spec)) existing.set(sig, name);
  }
  const findings: BatchFinding[] = [];
  for (const loaded of specs) {
    for (const { name, sig } of containerSignatures(loaded.spec)) {
      if (existing.has(sig)) {
        findings.push({ detail: `${loaded.file}:${name} duplicates an existing spec — reference it instead of regenerating`, ref: name });
      }
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

// --- gates (Task 3) ---------------------------------------------------------

/** Every container (frame/section) name across the batch. */
function frameNames(specs: LoadedSpec[]): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const loaded of specs) for (const c of containers(loaded.spec)) out.push({ file: loaded.file, name: c.name });
  return out;
}

/** Every node name across the batch (containers + children) for keyword search. */
function allNodeNames(specs: LoadedSpec[]): string[] {
  const names: string[] = [];
  for (const loaded of specs) {
    for (const c of containers(loaded.spec)) {
      names.push(c.name);
      for (const child of c.children) names.push(child.name);
    }
  }
  return names;
}

/** Build a directed name→names graph from every spec's connectors. */
function buildGraph(specs: LoadedSpec[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const loaded of specs) {
    const conns = "connectors" in loaded.spec && loaded.spec.connectors ? loaded.spec.connectors : [];
    for (const c of conns) {
      const set = adj.get(c.from) ?? new Set<string>();
      set.add(c.to);
      adj.set(c.from, set);
    }
  }
  return adj;
}

/** Is `to` reachable from `from` in the directed graph (trivially true if equal). */
function reachable(adj: Map<string, Set<string>>, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>([from]);
  const stack: string[] = [from];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const next of adj.get(cur) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/**
 * requirement & state coverage (must) — name-based traceability between stories
 * and the batch. Each story.id must be named by ≥1 frame; each AC.impliedState
 * keyword must appear in some node name; any frame naming no story id is story-less.
 * Skip-and-declare when no stories. Pure + deterministic (no LLM, no judge).
 */
export function requirementCoverage(specs: LoadedSpec[], stories: StorySet | null): CheckResult {
  const id = "requirement-coverage";
  if (stories === null) {
    return { id, status: "skip", severity: "must", findings: [], reason: "no stories registered" };
  }
  const storyList = stories.stories ?? [];
  const frames = frameNames(specs);
  const lowerFrames = frames.map((f) => ({ ...f, lname: f.name.toLowerCase() }));
  const lowerNodes = allNodeNames(specs).map((n) => n.toLowerCase());
  const findings: BatchFinding[] = [];

  for (const story of storyList) {
    const idl = story.id.toLowerCase();
    if (!lowerFrames.some((f) => f.lname.includes(idl))) {
      findings.push({ detail: `story ${story.id} is not covered by any frame (no frame name contains "${story.id}")`, ref: story.id });
    }
    for (const ac of story.acceptanceCriteria ?? []) {
      const kw = ac.impliedState.toLowerCase();
      if (!lowerNodes.some((n) => n.includes(kw))) {
        findings.push({ detail: `story ${story.id} AC "${ac.statement}" implies a ${ac.impliedState} state with no matching node`, ref: story.id });
      }
    }
  }

  const storyIds = storyList.map((s) => s.id.toLowerCase());
  for (const f of lowerFrames) {
    if (!storyIds.some((sid) => f.lname.includes(sid))) {
      findings.push({ detail: `frame ${f.name} (${f.file}) has no story basis (its name contains no registered story id)`, ref: f.name });
    }
  }

  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "must", findings };
}

/**
 * flow reachability (ADVISORY) — when a flow declares a step order, verify each
 * consecutive pair is reachable along the specs' connectors. Skip-and-declare when
 * no flow. Pure deterministic graph reachability — NO LLM. Always severity:"advisory",
 * so an unreachable finding never trips the must-pass set.
 */
export function flowReachability(specs: LoadedSpec[], flow: Flow | null): CheckResult {
  const id = "flow-reachability";
  if (flow === null) {
    return { id, status: "skip", severity: "advisory", findings: [], reason: "no flow registered" };
  }
  const steps = flow.steps ?? [];
  const adj = buildGraph(specs);
  const findings: BatchFinding[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i] as string;
    const to = steps[i + 1] as string;
    if (!reachable(adj, from, to)) {
      findings.push({ detail: `flow step "${from}" → "${to}" is not reachable along any connector path`, ref: `${from}->${to}` });
    }
  }
  return { id, status: findings.length > 0 ? "fail" : "pass", severity: "advisory", findings };
}
