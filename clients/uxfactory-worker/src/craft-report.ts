/**
 * craft-report — the independent craft judge's structured verdict (SP2).
 *
 * Craft is subjective, so the SCORES are the judge's opinion — but the SHAPE is
 * validated here (the "verifiable" thesis applied to a subjective signal), and the
 * loop computes the real pass from the scores against a pinned bar (`craftPasses`),
 * NOT from the judge's self-reported `pass`. This module is pure + LLM-free; it lives
 * in the worker (never the engine).
 */
import { readFile } from 'node:fs/promises';

/** The 8 craft dimensions the judge scores (spec §6). */
export const CRAFT_DIMENSIONS = [
  'hierarchy',
  'typography',
  'spacing',
  'color',
  'components',
  'depth',
  'brand-fit',
  'production-readiness',
] as const;
export type CraftDimensionName = (typeof CRAFT_DIMENSIONS)[number];

/** The pinned craft bar: a dimension/overall at or above this is "good enough". */
export const CRAFT_BAR = 4;

/** One actionable craft issue, pinned to a screen, with a concrete fix. */
export interface CraftFinding {
  screen: string;
  issue: string;
  fix: string;
}

/** One dimension's score (1–5) + its findings. */
export interface CraftDimension {
  name: CraftDimensionName;
  score: number;
  findings: CraftFinding[];
}

/** The judge's structured verdict (craft-report.json). Scores subjective; SHAPE validated. */
export interface CraftReport {
  version: 1;
  overall: number;
  /** The judge's self-report — NOT trusted by consumers; use `craftPasses()`. */
  pass: boolean;
  reliability: 'best-effort';
  dimensions: CraftDimension[];
}

/**
 * Whether the design clears the pinned bar — computed from the SCORES, not the
 * judge's self-reported `pass` (rigor: the bar is the consumer's, not the judge's).
 */
export function craftPasses(report: CraftReport): boolean {
  return report.overall >= CRAFT_BAR && report.dimensions.every((d) => d.score >= CRAFT_BAR);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}
const DIMENSION_SET = new Set<string>(CRAFT_DIMENSIONS);

/** Pure structural validation of a parsed craft report. Never throws. */
export function validateCraftReport(
  raw: unknown,
): { ok: true; report: CraftReport } | { ok: false; message: string } {
  if (!isObject(raw)) return { ok: false, message: 'craft-report must be a JSON object' };
  if (raw['version'] !== 1) return { ok: false, message: 'craft-report version must be 1' };
  if (!isScore(raw['overall'])) return { ok: false, message: 'craft-report.overall must be an integer 1–5' };
  if (typeof raw['pass'] !== 'boolean') return { ok: false, message: 'craft-report.pass must be a boolean' };
  if (raw['reliability'] !== 'best-effort')
    return { ok: false, message: 'craft-report.reliability must be "best-effort"' };
  if (!Array.isArray(raw['dimensions']))
    return { ok: false, message: 'craft-report.dimensions must be an array' };

  const seen = new Set<string>();
  for (const [i, dim] of raw['dimensions'].entries()) {
    const at = `craft-report.dimensions[${i}]`;
    if (!isObject(dim)) return { ok: false, message: `${at} must be an object` };
    if (typeof dim['name'] !== 'string' || !DIMENSION_SET.has(dim['name']))
      return { ok: false, message: `${at}.name must be one of ${CRAFT_DIMENSIONS.join(', ')}` };
    if (seen.has(dim['name'])) return { ok: false, message: `${at}.name "${dim['name']}" is duplicated` };
    seen.add(dim['name']);
    if (!isScore(dim['score'])) return { ok: false, message: `${at}.score must be an integer 1–5` };
    if (!Array.isArray(dim['findings'])) return { ok: false, message: `${at}.findings must be an array` };
    for (const [j, f] of dim['findings'].entries()) {
      const fat = `${at}.findings[${j}]`;
      if (!isObject(f)) return { ok: false, message: `${fat} must be an object` };
      for (const key of ['screen', 'issue', 'fix'] as const) {
        if (typeof f[key] !== 'string' || f[key] === '')
          return { ok: false, message: `${fat}.${key} must be a non-empty string` };
      }
    }
  }
  if (seen.size !== CRAFT_DIMENSIONS.length)
    return {
      ok: false,
      message: `craft-report must score all ${CRAFT_DIMENSIONS.length} dimensions (missing: ${CRAFT_DIMENSIONS.filter((d) => !seen.has(d)).join(', ')})`,
    };

  return { ok: true, report: raw as unknown as CraftReport };
}

/** Read + JSON-parse + validate a craft-report file. Never throws on bad input. */
export async function readCraftReport(
  absPath: string,
): Promise<{ ok: true; report: CraftReport } | { ok: false; message: string }> {
  let text: string;
  try {
    text = await readFile(absPath, 'utf8');
  } catch {
    return { ok: false, message: `cannot read craft-report ${absPath}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, message: `invalid JSON in ${absPath}: ${(err as Error).message}` };
  }
  return validateCraftReport(parsed);
}
