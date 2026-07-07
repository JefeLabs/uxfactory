/**
 * story-schema.ts — canonical story files with nested ACs (decision 6).
 *
 * Source: .plans/artifact-schemas-and-elicitation.md `stories` section +
 * docs/superpowers/plans/2026-07-06-stories-nested-acs-migration.md.
 *
 * One story per file under `.uxfactory/artifacts/stories/`. Two input shapes
 * normalize into the canonical story: the PRD shape (storyId/actor/want/
 * soThat, Given/When/Then ACs) and a legacy `design/acceptance-criteria.json`
 * member (id/role/goal/benefit, statement+impliedState ACs). The engine gate
 * never reads canonical files directly — `storyToEngine` renders the shape
 * `requirementCoverage` consumes, keeping the deterministic gate LLM-free.
 */

/** The view-state an acceptance criterion implies must exist (engine vocabulary). */
export type StoryImpliedState = "empty" | "loading" | "error" | "success" | "edge";

/** auto = the deterministic gate enforces it; manual = human sign-off, never auto-gated. */
export type ACCheckable = "auto" | "manual";

/**
 * One canonical acceptance criterion. Carries EITHER a Given/When/Then triple
 * (PRD interview output) OR a legacy `statement`; `impliedState` is explicit
 * when known, else derived from the text at engine-render time.
 */
export interface CanonicalAC {
  acId: string;
  given?: string;
  when?: string;
  then?: string;
  statement?: string;
  impliedState?: StoryImpliedState;
  checkable: ACCheckable;
}

export type StoryStatus = "draft" | "registered" | "retired";

/** One canonical story — the per-file body. */
export interface CanonicalStory {
  storyId: string;
  /** Persona id (registered `personas` member) — free text only on migrated legacy stories. */
  actor: string;
  want: string;
  soThat: string;
  featureRef: string | null;
  acceptanceCriteria: CanonicalAC[];
  status: StoryStatus;
}

/** Engine AC — what `requirementCoverage` consumes; `checkable` lets it skip manual ACs. */
export interface EngineAC {
  /** The AC's stable id — lets the gate bind coverage to a specific criterion. */
  acId: string;
  statement: string;
  impliedState: StoryImpliedState;
  checkable?: ACCheckable;
}

/** Engine story — the legacy `{stories:[…]}` member shape the gate reads. */
export interface EngineStory {
  id: string;
  role: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: EngineAC[];
}

export type StoryParseResult =
  | { ok: true; story: CanonicalStory }
  | { ok: false; message: string };

const IMPLIED_STATES: ReadonlySet<string> = new Set([
  "empty", "loading", "error", "success", "edge",
]);

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Derive the implied view-state from AC text. Keyword table, first match wins:
 * error > empty > loading; anything else implies the success state. `edge` is
 * never derived — it must be explicit.
 */
export function deriveImpliedState(text: string): StoryImpliedState {
  const t = text.toLowerCase();
  if (t.includes("error")) return "error";
  if (t.includes("empty")) return "empty";
  if (t.includes("loading")) return "loading";
  return "success";
}

function parseAC(raw: unknown, index: number): CanonicalAC {
  const ac = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const explicit = str(ac["impliedState"]);
  return {
    acId: str(ac["acId"], `AC-${String(index + 1).padStart(3, "0")}`),
    ...(typeof ac["given"] === "string" ? { given: ac["given"] } : {}),
    ...(typeof ac["when"] === "string" ? { when: ac["when"] } : {}),
    ...(typeof ac["then"] === "string" ? { then: ac["then"] } : {}),
    ...(typeof ac["statement"] === "string" ? { statement: ac["statement"] } : {}),
    ...(IMPLIED_STATES.has(explicit) ? { impliedState: explicit as StoryImpliedState } : {}),
    checkable: ac["checkable"] === "manual" ? "manual" : "auto",
  };
}

/**
 * Parse one story file body — canonical (storyId/actor/want/soThat) or legacy
 * member (id/role/goal/benefit). Missing prose fields default to empty
 * strings; a story without an id is unusable (frame coverage keys on it) and
 * is rejected. Legacy members arrive with status "registered" (they were live
 * gate inputs); bare canonical bodies default to "draft".
 */
export function parseStoryFile(raw: unknown): StoryParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "story file must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;
  const legacy = typeof body["storyId"] !== "string" && typeof body["id"] === "string";
  const storyId = str(body["storyId"]) || str(body["id"]);
  if (storyId === "") {
    return { ok: false, message: 'story file needs a "storyId" (or legacy "id")' };
  }
  const acsRaw = body["acceptanceCriteria"] ?? [];
  if (!Array.isArray(acsRaw)) {
    return { ok: false, message: '"acceptanceCriteria" must be an array' };
  }
  const statusRaw = str(body["status"]);
  const status: StoryStatus =
    statusRaw === "registered" || statusRaw === "retired"
      ? statusRaw
      : legacy
        ? "registered"
        : "draft";
  return {
    ok: true,
    story: {
      storyId,
      actor: str(body["actor"]) || str(body["role"]),
      want: str(body["want"]) || str(body["goal"]),
      soThat: str(body["soThat"]) || str(body["benefit"]),
      featureRef: typeof body["featureRef"] === "string" ? body["featureRef"] : null,
      acceptanceCriteria: acsRaw.map(parseAC),
      status,
    },
  };
}

/** Render one canonical AC into the engine's statement + impliedState. */
function acToEngine(ac: CanonicalAC): EngineAC {
  const statement =
    ac.statement ??
    `Given ${ac.given ?? ""}, when ${ac.when ?? ""}, then ${ac.then ?? ""}`;
  return {
    acId: ac.acId,
    statement,
    impliedState: ac.impliedState ?? deriveImpliedState(ac.then ?? statement),
    checkable: ac.checkable,
  };
}

/** Render a canonical story into the engine shape the deterministic gate reads. */
export function storyToEngine(story: CanonicalStory): EngineStory {
  return {
    id: story.storyId,
    role: story.actor,
    goal: story.want,
    benefit: story.soThat,
    acceptanceCriteria: story.acceptanceCriteria.map(acToEngine),
  };
}
