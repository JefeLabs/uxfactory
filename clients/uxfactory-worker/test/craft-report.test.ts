import { describe, it, expect } from 'vitest';
import { validateCraftReport, craftPasses, CRAFT_DIMENSIONS } from '../src/craft-report.js';

function fullDims(score: number) {
  return CRAFT_DIMENSIONS.map((name) => ({ name, score, findings: [] as unknown[] }));
}
const VALID = {
  version: 1,
  overall: 4,
  pass: true,
  reliability: 'best-effort',
  dimensions: CRAFT_DIMENSIONS.map((name) => ({
    name,
    score: 4,
    findings:
      name === 'hierarchy'
        ? [{ screen: 'checkout-success', issue: 'flat', fix: 'raise the heading, add a filled primary button' }]
        : [],
  })),
};

describe('validateCraftReport', () => {
  it('accepts a well-formed report covering all 8 dimensions', () => {
    const r = validateCraftReport(VALID);
    expect(r.ok).toBe(true);
  });
  it('rejects a non-1 version', () => {
    expect(validateCraftReport({ ...VALID, version: 2 }).ok).toBe(false);
  });
  it('rejects an out-of-range score', () => {
    const bad = structuredClone(VALID);
    bad.dimensions[0]!.score = 6;
    expect(validateCraftReport(bad).ok).toBe(false);
  });
  it('rejects a missing dimension', () => {
    const bad = structuredClone(VALID);
    bad.dimensions = bad.dimensions.slice(1);
    expect(validateCraftReport(bad).ok).toBe(false);
  });
  it('rejects a bad reliability label', () => {
    expect(validateCraftReport({ ...VALID, reliability: 'exact' }).ok).toBe(false);
  });
  it('rejects a finding missing its fix', () => {
    const bad = structuredClone(VALID);
    (bad.dimensions[0]!.findings[0] as Record<string, unknown>) = { screen: 'x', issue: 'y' };
    expect(validateCraftReport(bad).ok).toBe(false);
  });
});

describe('craftPasses (overall >= CRAFT_BAR AND no dim below CRAFT_DIM_FLOOR; ignores self-reported pass)', () => {
  it('passes at overall 4 with one dimension at the 3 floor (a good design, not perfection on every axis)', () => {
    const dims = fullDims(4);
    dims[2]!.score = 3; // a single dimension at the floor is acceptable
    const r = validateCraftReport({ ...VALID, dimensions: dims, overall: 4, pass: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(craftPasses(r.report)).toBe(true); // self-reported pass:false is IGNORED
  });
  it('fails when overall is below the bar even if every dimension is at/above the floor', () => {
    const r = validateCraftReport({ ...VALID, dimensions: fullDims(3), overall: 3, pass: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(craftPasses(r.report)).toBe(false); // overall 3 < 4
  });
  it('fails on a glaring weakness (a dimension below the floor) even with a high overall', () => {
    const dims = fullDims(5);
    dims[2]!.score = 2; // below the floor
    const r = validateCraftReport({ ...VALID, dimensions: dims, overall: 5, pass: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(craftPasses(r.report)).toBe(false); // dim 2 < 3
  });
});
