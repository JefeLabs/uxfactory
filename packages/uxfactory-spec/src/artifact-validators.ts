/**
 * artifact-validators.ts — the deterministic quality gate for INTENT artifacts.
 *
 * UXFactory verifies designs against registered intent; these validators verify
 * the intent itself — schema, cross-artifact referential integrity, and
 * computed quality (contrast) — before anything downstream consumes it. Pure
 * and LLM-free, so a producer can iterate against them in a fast inner loop:
 * draft → validate → revise → pass. An `error` finding fails; a `warn` advises.
 */

export type Severity = "error" | "warn";

export interface ValidationFinding {
  severity: Severity;
  message: string;
  /** Dotted path to the offending value, when locatable. */
  path?: string;
}

export interface ArtifactValidation {
  artifact: string;
  ok: boolean;
  findings: ValidationFinding[];
}

/** Cross-artifact referential context — the registered ids a draft must resolve to. */
export interface ValidatorContext {
  personaIds?: ReadonlySet<string>;
  storyIds?: ReadonlySet<string>;
  featureIds?: ReadonlySet<string>;
}

// ─── WCAG contrast ────────────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function toRgb(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/** WCAG contrast ratio between two hex colors (1–21). Returns 1 for bad input. */
export function contrastRatio(a: string, b: string): number {
  const ra = toRgb(a);
  const rb = toRgb(b);
  if (ra === null || rb === null) return 1;
  const la = relLuminance(ra);
  const lb = relLuminance(rb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Flatten a nested object into `{ path, value }` leaf pairs. */
function leaves(obj: unknown, prefix = ""): { path: string; value: unknown }[] {
  if (!isObj(obj)) return [];
  const out: { path: string; value: unknown }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === "" ? k : `${prefix}.${k}`;
    if (isObj(v)) out.push(...leaves(v, path));
    else out.push({ path, value: v });
  }
  return out;
}

const looksLikeColorKey = (path: string): boolean =>
  /color|primary|accent|surface|text|bg|background|border|brand|neutral|hover|page/i.test(path);

// ─── per-artifact rule sets ───────────────────────────────────────────────────

type Rule = (body: unknown, ctx: ValidatorContext) => ValidationFinding[];

const RULES: Record<string, Rule> = {
  "brand-colors": (body) => {
    const out: ValidationFinding[] = [];
    const all = leaves(body);
    const hexes = all.filter((l) => typeof l.value === "string" && HEX_RE.test(l.value as string));
    if (hexes.length === 0) {
      out.push({ severity: "error", message: "no color values found — brand-colors must define hex anchors" });
      return out;
    }
    // Malformed hex under a color-ish key — but only when the value LOOKS like a
    // color attempt (starts with '#', or a short spaceless token). Prose under a
    // usage/documentation subsection ("primary actions (buttons, links)") is not
    // a failed hex and must not be flagged.
    const looksLikeColorValue = (v: string): boolean =>
      v.startsWith("#") || (!v.includes(" ") && v.length <= 20);
    for (const l of all) {
      if (
        typeof l.value === "string" &&
        looksLikeColorKey(l.path) &&
        looksLikeColorValue(l.value) &&
        !HEX_RE.test(l.value)
      ) {
        out.push({ severity: "error", message: `not a valid hex color: "${l.value}"`, path: l.path });
      }
    }
    // Contrast: first text-ish over first surface/bg-ish.
    const text = all.find((l) => /text/i.test(l.path) && typeof l.value === "string" && HEX_RE.test(l.value as string));
    const surface = all.find(
      (l) => /surface|bg|background|page/i.test(l.path) && typeof l.value === "string" && HEX_RE.test(l.value as string),
    );
    if (text && surface) {
      const ratio = contrastRatio(text.value as string, surface.value as string);
      if (ratio < 4.5) {
        out.push({
          severity: "warn",
          message: `text-on-surface contrast is ${ratio.toFixed(2)}:1 — below WCAG AA (4.5:1)`,
          path: text.path,
        });
      }
    }
    return out;
  },

  features: (body, ctx) => {
    const out: ValidationFinding[] = [];
    const features = isObj(body) && Array.isArray(body["features"]) ? body["features"] : [];
    for (const f of features) {
      if (!isObj(f)) continue;
      const id = typeof f["featureId"] === "string" ? f["featureId"] : "(feature)";
      const refs = Array.isArray(f["storyRefs"]) ? (f["storyRefs"] as unknown[]) : [];
      if (refs.length === 0) out.push({ severity: "warn", message: `feature ${id} groups no stories` });
      if (ctx.storyIds !== undefined) {
        for (const ref of refs) {
          if (typeof ref === "string" && !ctx.storyIds.has(ref)) {
            out.push({ severity: "error", message: `feature ${id} references unknown story "${ref}"` });
          }
        }
      }
    }
    return out;
  },

  audience: (body) => {
    const out: ValidationFinding[] = [];
    const segments = isObj(body) && Array.isArray(body["segments"]) ? body["segments"] : [];
    const names = new Set(segments.filter(isObj).map((s) => s["name"]).filter((n): n is string => typeof n === "string"));
    const primary = isObj(body) ? body["primarySegment"] : undefined;
    if (typeof primary === "string" && !names.has(primary)) {
      out.push({ severity: "error", message: `primarySegment "${primary}" is not one of the segments` });
    }
    const shares = segments.filter(isObj).map((s) => (typeof s["share"] === "number" ? s["share"] : 0));
    if (shares.length > 0) {
      const sum = shares.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.05) {
        out.push({ severity: "warn", message: `segment shares sum to ${sum.toFixed(2)}, not ~1.0` });
      }
    }
    return out;
  },

  personas: (body) => {
    const out: ValidationFinding[] = [];
    const list = Array.isArray(body) ? body : [];
    if (list.length < 2) {
      out.push({ severity: "error", message: "define at least two distinct personas" });
    }
    const seen = new Set<string>();
    for (const p of list) {
      if (!isObj(p)) continue;
      const id = typeof p["personaId"] === "string" ? p["personaId"] : undefined;
      if (id !== undefined) {
        if (seen.has(id)) out.push({ severity: "error", message: `duplicate personaId "${id}"` });
        seen.add(id);
      }
      const hasGoals = Array.isArray(p["goals"]) && p["goals"].length > 0;
      const hasFrustrations = Array.isArray(p["frustrations"]) && p["frustrations"].length > 0;
      if (!hasGoals) out.push({ severity: "warn", message: `persona ${id ?? "(unnamed)"} has no goals` });
      if (!hasFrustrations) out.push({ severity: "warn", message: `persona ${id ?? "(unnamed)"} has no frustrations` });
    }
    return out;
  },

  stories: (body, ctx) => {
    const out: ValidationFinding[] = [];
    const list = Array.isArray(body) ? body : [];
    for (const s of list) {
      if (!isObj(s)) continue;
      const id = typeof s["storyId"] === "string" ? s["storyId"] : "(story)";
      const actor = typeof s["actor"] === "string" ? s["actor"] : "";
      if (ctx.personaIds !== undefined && actor !== "" && !ctx.personaIds.has(actor)) {
        out.push({ severity: "error", message: `story ${id} actor "${actor}" is not a registered persona` });
      }
      const acs = Array.isArray(s["acceptanceCriteria"]) ? s["acceptanceCriteria"] : [];
      if (acs.length === 0) out.push({ severity: "warn", message: `story ${id} has no acceptance criteria` });
    }
    return out;
  },

  sitemap: (body, ctx) => {
    const out: ValidationFinding[] = [];
    const nodes = isObj(body) && Array.isArray(body["nodes"]) ? body["nodes"] : [];
    for (const n of nodes) {
      if (!isObj(n)) continue;
      const title = typeof n["title"] === "string" ? n["title"] : typeof n["nodeId"] === "string" ? n["nodeId"] : "(node)";
      const refs = Array.isArray(n["featureRefs"]) ? (n["featureRefs"] as unknown[]) : [];
      if (ctx.featureIds !== undefined) {
        for (const ref of refs) {
          if (typeof ref === "string" && !ctx.featureIds.has(ref)) {
            out.push({ severity: "error", message: `page ${title} references unknown feature "${ref}"` });
          }
        }
      }
    }
    return out;
  },

  brief: (body) => {
    // Markdown body. Warn when an enumerable line is authored as a comma/semicolon
    // run of short items rather than a markdown list — it won't render as bullets.
    const out: ValidationFinding[] = [];
    const text = typeof body === "string" ? body : "";
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line === "" || /^([-*+]|\d+\.)\s/.test(line)) continue; // blank or already a list item
      const after = line.replace(/^\*\*[^*\n]+\*\*\s*/, ""); // drop a leading **Label.**
      if (/[.!?]$/.test(after)) continue; // a full sentence, not a list run
      const items = after.split(/[,;]/).map((s) => s.trim()).filter((s) => s !== "");
      // A genuine list: 3+ SHORT items (≤3 words, ≤25 chars, no parentheses) —
      // this excludes parenthetical enumerations and comma clauses inside prose.
      const short = (i: string): boolean =>
        i.length <= 25 && i.split(/\s+/).length <= 3 && !/[()]/.test(i);
      if (items.length >= 3 && items.every(short)) {
        out.push({
          severity: "warn",
          message: `this ${items.length}-item run reads as a list — author it as a markdown list (- item per line) so it renders as bullets`,
        });
      }
    }
    return out;
  },

  "copy-deck": (body) => {
    const out: ValidationFinding[] = [];
    const entries = isObj(body) && Array.isArray(body["entries"]) ? body["entries"] : [];
    for (const e of entries) {
      if (!isObj(e)) continue;
      const key = typeof e["key"] === "string" ? e["key"] : "";
      if (!key.includes(".")) {
        out.push({ severity: "error", message: `copy key "${key}" must be dotted (page.section.element)` });
      }
    }
    return out;
  },
};

/**
 * Validate one artifact's body against its deterministic rules. `body` is the
 * parsed content — an object for single-file artifacts, an array of instances
 * for set artifacts (personas/stories). Unknown artifacts have no rules and
 * pass clean. `ok` is true when no `error`-severity finding is present.
 */
export function validateArtifact(
  artifact: string,
  body: unknown,
  ctx: ValidatorContext = {},
): ArtifactValidation {
  const rule = RULES[artifact];
  const findings = rule !== undefined ? rule(body, ctx) : [];
  return { artifact, ok: !findings.some((f) => f.severity === "error"), findings };
}
