import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCraftReport, CRAFT_DIMENSIONS } from '../src/craft-report.js';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../skill/craft-review/SKILL.md');

describe('skill/craft-review SKILL.md stays in sync with the craft-report schema', () => {
  it('its embedded craft-report example validates', async () => {
    const md = await readFile(SKILL, 'utf8');
    const m = /<!-- craft-report-example-start -->\s*```json\s*([\s\S]*?)```\s*<!-- craft-report-example-end -->/.exec(md);
    expect(m, 'SKILL.md must contain a marked craft-report example').not.toBeNull();
    expect(validateCraftReport(JSON.parse(m![1]!)).ok).toBe(true);
  });
  it('documents every rubric dimension + the best-effort + adversarial framing', async () => {
    const md = await readFile(SKILL, 'utf8');
    for (const d of CRAFT_DIMENSIONS) expect(md, `must mention dimension ${d}`).toContain(d);
    for (const s of ['best-effort', 'craft-report.json', 'production-quality']) expect(md).toContain(s);
  });
  it('is cc-invariant: no cloud-deploy mentions', async () => {
    const md = await readFile(SKILL, 'utf8');
    for (const re of [/agentcore/i, /runpod/i, /\bcloud\b/i]) expect(md).not.toMatch(re);
  });
});
