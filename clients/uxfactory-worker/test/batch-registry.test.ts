import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureBatchRegistry } from '../src/batch-registry.js';

const mkProject = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'uxw-reg-'));
const readReg = async (root: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path.join(root, 'uxfactory.batch.json'), 'utf8')) as Record<
    string,
    unknown
  >;
const writeDesign = (root: string, rel: string, body: string): Promise<void> =>
  mkdir(path.join(root, 'design'), { recursive: true }).then(() =>
    writeFile(path.join(root, rel), body),
  );

describe('ensureBatchRegistry', () => {
  it('creates the registry, registering the conventional inputs that exist', async () => {
    const root = await mkProject();
    try {
      await writeDesign(root, 'design/acceptance-criteria.json', '{"stories":[]}');
      await writeDesign(root, 'design/user-flow.json', '{"steps":[]}');
      await ensureBatchRegistry(root);
      const reg = await readReg(root);
      expect(reg.version).toBe(1);
      const inputs = reg.inputs as Record<string, unknown>;
      expect(inputs.stories).toBe('design/acceptance-criteria.json');
      expect(inputs.flow).toBe('design/user-flow.json');
      expect(inputs.tokens).toBeUndefined(); // no token-set.json present
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('only registers inputs whose files actually exist', async () => {
    const root = await mkProject();
    try {
      await writeDesign(root, 'design/acceptance-criteria.json', '{"stories":[]}');
      await ensureBatchRegistry(root);
      const inputs = (await readReg(root)).inputs as Record<string, unknown>;
      expect(inputs.stories).toBe('design/acceptance-criteria.json');
      expect(inputs.flow).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('is non-clobbering: preserves an existing registry + user fields, fills missing inputs', async () => {
    const root = await mkProject();
    try {
      await writeDesign(root, 'design/user-flow.json', '{"steps":[]}');
      await writeFile(
        path.join(root, 'uxfactory.batch.json'),
        JSON.stringify({ version: 1, inputs: { stories: 'custom/stories.json' }, scope: 'interactive' }),
      );
      await ensureBatchRegistry(root);
      const reg = await readReg(root);
      const inputs = reg.inputs as Record<string, unknown>;
      expect(inputs.stories).toBe('custom/stories.json'); // user path NOT overwritten
      expect(inputs.flow).toBe('design/user-flow.json'); // newly registered (file exists)
      expect(reg.scope).toBe('interactive'); // preserved
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('starts fresh on a malformed existing registry (never throws)', async () => {
    const root = await mkProject();
    try {
      await writeFile(path.join(root, 'uxfactory.batch.json'), 'not json{');
      await ensureBatchRegistry(root);
      const reg = await readReg(root);
      expect(reg.version).toBe(1);
      expect(reg.inputs).toEqual({});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
