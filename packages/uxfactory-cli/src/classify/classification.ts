/**
 * ProjectClassification — the enumerated intake vector (§5.8).
 *
 * `uxfactory.classification.json` (committed, OWNED — the Intake answer).
 * Pure schema: controlled-vocabulary types, `validateClassification` (pure), and
 * `readClassification` (fs).  No conditioning, no LLM, no external deps.
 *
 * Scope-dial level validation reuses `LEVEL_ORD` from `../batch/scope.js` (not duplicated).
 */

import { readFile } from "node:fs/promises";
import { LEVEL_ORD } from "../batch/scope.js";

// ---------------------------------------------------------------------------
// Controlled vocabularies
// ---------------------------------------------------------------------------

export type Category = "marketing" | "ecommerce" | "web_app" | "news";
export type Industry = "education" | "corporate" | "healthcare" | "finance" | "consumer";
export type AgeDemographic = "children" | "teens" | "18-25" | "26-35" | "36-50" | "50+";
export type Style = "informal" | "mix" | "formal";

const CATEGORIES = new Set<string>(["marketing", "ecommerce", "web_app", "news"]);
const INDUSTRIES = new Set<string>(["education", "corporate", "healthcare", "finance", "consumer"]);
const AGE_DEMOGRAPHICS = new Set<string>(["children", "teens", "18-25", "26-35", "36-50", "50+"]);
const STYLES = new Set<string>(["informal", "mix", "formal"]);

// ---------------------------------------------------------------------------
// ProjectClassification
// ---------------------------------------------------------------------------

export interface ProjectClassification {
  version: 1;
  category: Category;
  industry: Industry;
  age_demographic: AgeDemographic;
  style: Style;
  scope: {
    visual: "low" | "medium" | "high";
    editorial: "low" | "medium" | "high";
    coverage: "low" | "medium" | "high";
    flow: "low" | "medium" | "high";
  };
  flow_refs: string[];
}

// ---------------------------------------------------------------------------
// Result type (mirrors registry.ts / batch conventions)
// ---------------------------------------------------------------------------

type ClassificationResult =
  { ok: true; value: ProjectClassification } | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate that `v` is a valid scope dial level (low|medium|high).
 *
 * Reuses `LEVEL_ORD` from `../batch/scope.js` as the authoritative level registry
 * rather than re-implementing a local set — "none" is in LEVEL_ORD but is not a
 * valid dial level for ProjectClassification scope dials.
 */
function isDialLevel(v: unknown): boolean {
  return typeof v === "string" && v in LEVEL_ORD && v !== "none";
}

// ---------------------------------------------------------------------------
// validateClassification
// ---------------------------------------------------------------------------

/**
 * Pure structural validation of a raw `uxfactory.classification.json`.
 *
 * Validates:
 * - `version === 1`
 * - Each enum field is in its controlled vocabulary
 * - Each scope dial is low|medium|high (validated via LEVEL_ORD from scope.ts)
 * - `flow_refs` is a string[]
 *
 * Returns `{ ok: true; value }` on success, `{ ok: false; message }` on failure.
 * Every rejection message names the offending field.  Never throws.
 */
export function validateClassification(raw: unknown): ClassificationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "classification must be a JSON object" };
  }

  if (raw["version"] !== 1) {
    return {
      ok: false,
      message: `classification.version must be 1 (got ${JSON.stringify(raw["version"])})`,
    };
  }

  const category = raw["category"];
  if (!CATEGORIES.has(category as string)) {
    return {
      ok: false,
      message: `classification.category "${String(category)}" is not valid; must be one of: ${[...CATEGORIES].join(", ")}`,
    };
  }

  const industry = raw["industry"];
  if (!INDUSTRIES.has(industry as string)) {
    return {
      ok: false,
      message: `classification.industry "${String(industry)}" is not valid; must be one of: ${[...INDUSTRIES].join(", ")}`,
    };
  }

  const age = raw["age_demographic"];
  if (!AGE_DEMOGRAPHICS.has(age as string)) {
    return {
      ok: false,
      message: `classification.age_demographic "${String(age)}" is not valid; must be one of: ${[...AGE_DEMOGRAPHICS].join(", ")}`,
    };
  }

  const style = raw["style"];
  if (!STYLES.has(style as string)) {
    return {
      ok: false,
      message: `classification.style "${String(style)}" is not valid; must be one of: ${[...STYLES].join(", ")}`,
    };
  }

  // Validate scope dials (each must be low|medium|high — reuses LEVEL_ORD from scope.ts)
  const scope = raw["scope"];
  if (!isPlainObject(scope)) {
    return {
      ok: false,
      message:
        "classification.scope must be an object with four dials: visual, editorial, coverage, flow",
    };
  }

  for (const dial of ["visual", "editorial", "coverage", "flow"] as const) {
    const v = scope[dial];
    if (!isDialLevel(v)) {
      return {
        ok: false,
        message: `classification.scope.${dial} "${JSON.stringify(v)}" is not valid; must be one of: low, medium, high`,
      };
    }
  }

  // Validate flow_refs
  const flowRefs = raw["flow_refs"];
  if (!Array.isArray(flowRefs)) {
    return {
      ok: false,
      message: `classification.flow_refs must be a string[] (got ${JSON.stringify(typeof flowRefs)})`,
    };
  }
  for (let i = 0; i < flowRefs.length; i++) {
    if (typeof flowRefs[i] !== "string") {
      return {
        ok: false,
        message: `classification.flow_refs[${i}] must be a string (got ${JSON.stringify(flowRefs[i])})`,
      };
    }
  }

  return { ok: true, value: raw as unknown as ProjectClassification };
}

// ---------------------------------------------------------------------------
// readClassification
// ---------------------------------------------------------------------------

/**
 * Read + JSON-parse + validate a `uxfactory.classification.json` file.
 *
 * - Absent file → `{ ok: false, message: "…not found…" }` (does not throw)
 * - Malformed JSON → `{ ok: false, message: "invalid JSON…" }` (does not throw)
 * - Invalid classification → delegates to `validateClassification` (field-naming message)
 */
export async function readClassification(filePath: string): Promise<ClassificationResult> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    // ENOENT = genuinely absent → "not found" (back-compat).
    // Any other fs error (EACCES, EISDIR, …) surfaces as a distinct error message.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        message: `classification file not found: ${filePath}`,
      };
    }
    return {
      ok: false,
      message: `cannot read classification file ${filePath}: ${(err as Error).message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return {
      ok: false,
      message: `invalid JSON in classification file ${filePath}: ${(err as Error).message}`,
    };
  }

  return validateClassification(parsed);
}
