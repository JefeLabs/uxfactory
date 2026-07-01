import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { provisionCraftRubric } from '../src/generative.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'uxf-craft-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('provisionCraftRubric', () => {
  it('writes the craft rubric into <projectRoot>/.uxfactory/craft-rubric.md for the judge subagent', async () => {
    const file = await provisionCraftRubric(root);
    expect(file).toBe(path.join(root, '.uxfactory', 'craft-rubric.md'));
    const content = await readFile(file, 'utf8');
    // it is the craft-review skill body (single source), carrying the rubric + output contract
    expect(content).toContain('hierarchy');
    expect(content).toContain('craft-report.json');
    // frontmatter is stripped (loadSkill returns the body only)
    expect(content).not.toMatch(/^---\r?\n/);
  });

  it('is idempotent (re-provisioning overwrites cleanly, same path)', async () => {
    const a = await provisionCraftRubric(root);
    const b = await provisionCraftRubric(root);
    expect(a).toBe(b);
    expect((await readFile(b, 'utf8')).length).toBeGreaterThan(0);
  });
});
