/**
 * Worker subscribe-loop + deterministic dispatch (Phase 11B, Task 3).
 *
 * No real LLM and no real bridge package: deterministic dispatch is exercised
 * against a STUB `uxfactory` CLI (an executable .cjs that echoes JSON + a chosen
 * exit code), and the bridge surface is exercised against either a FAKE in-memory
 * `BridgeLike` (drain/dispatch tests) or a tiny in-process `node:http` server that
 * mirrors the real `/pipeline/*` shapes (WorkerBridgeClient + runWorker tests).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, chmod, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { RateLimitError } from '@helmsmith/agent-adapter';
import type {
  AgentAdapter,
  AgentChunk,
  AgentInput,
  AgentInvocationResult,
} from '@helmsmith/agent-adapter';

import { WorkerBridgeClient } from '../src/bridge-client.js';
import type { BridgeLike, PipelineRequest } from '../src/bridge-client.js';
import { runCli, resolveCliBin } from '../src/run-cli.js';
import { DETERMINISTIC, isDeterministic, runGenerative } from '../src/dispatch.js';
import type { DispatchCtx } from '../src/dispatch.js';
import {
  demoAnswersRelPath,
  ensureSkillPermissions,
  extractArtifacts,
  parseProgressLine,
  planGenerative,
  readDemoAnswers,
  STYLE_GUIDANCE,
} from '../src/generative.js';
import { loadSkill, loadArtifactSkill } from '../src/skills.js';
import { runPool } from '../src/main.js';
import { drain, handleRequest, runWorker } from '../src/main.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Write an executable stub `uxfactory` that records its cwd+argv, prints JSON, exits `code`. */
async function writeStubCli(file: string, code: number, stdout: string): Promise<void> {
  const body =
    `#!/usr/bin/env node\n` +
    `const fs=require('node:fs'),path=require('node:path');\n` +
    `try{fs.writeFileSync(path.join(process.cwd(),'.stub-call.json'),` +
    `JSON.stringify({cwd:process.cwd(),argv:process.argv.slice(2)}));}catch(e){}\n` +
    `process.stdout.write(${JSON.stringify(stdout)});\n` +
    `process.exit(${code});\n`;
  await writeFile(file, body);
  await chmod(file, 0o755);
}

async function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor: condition not met before timeout');
}

/** A minimal in-memory BridgeLike for drain/dispatch tests. */
class FakeBridge implements BridgeLike {
  queue: PipelineRequest[] = [];
  results: { id: string; status: number; result: unknown }[] = [];
  events: { requestId: string; event: unknown }[] = [];
  wake: (() => void) | null = null;

  async pullRequest(): Promise<PipelineRequest | null> {
    return this.queue.shift() ?? null;
  }
  async postResult(id: string, status: number, result: unknown): Promise<void> {
    this.results.push({ id, status, result });
  }
  async postEvent(requestId: string, event: unknown): Promise<void> {
    this.events.push({ requestId, event });
  }
  subscribeEvents(onWake: () => void): () => void {
    this.wake = onWake;
    return () => {
      this.wake = null;
    };
  }
}

/**
 * A FAKE AgentAdapter: records the AgentInput it is handed, then either yields a
 * scripted list of AgentChunks from `stream` or throws a scripted error. No real
 * LLM — proves the generative wiring (systemPrompt, user, forwarding, masking).
 */
class FakeAdapter implements AgentAdapter {
  readonly type = 'claude-code-cli' as const;
  readonly capabilities = {
    reportsUsage: true,
    supportsStreaming: true,
    supportsToolUse: true,
    toolUseMode: 'autonomous' as const,
    supportsExtendedThinking: false,
    supportsCancellation: true,
    supportsCapture: false,
    supportsJsonMode: false,
    supportsSessionResume: false,
  };
  readonly workdir: string;
  lastInput: AgentInput | null = null;

  constructor(
    workdir: string,
    private readonly chunks: AgentChunk[],
    private readonly throwErr?: Error,
  ) {
    this.workdir = workdir;
  }

  async invoke(input: AgentInput): Promise<AgentInvocationResult> {
    let content = '';
    for await (const c of this.stream(input)) if (c.type === 'text-delta') content += c.text;
    return { content, durationMs: 0 };
  }

  async *stream(input: AgentInput): AsyncIterable<AgentChunk> {
    this.lastInput = input;
    if (this.throwErr) throw this.throwErr;
    for (const c of this.chunks) yield c;
  }
}

interface FakeServer {
  url: string;
  close: () => Promise<void>;
  state: {
    queue: PipelineRequest[];
    results: { id: string; status: number; result: unknown }[];
    events: { requestId: string; event: unknown }[];
    sse: http.ServerResponse[];
    seq: number;
  };
}

/** Spin up a node:http server mirroring the real bridge `/pipeline/*` REST + SSE shapes. */
async function startFakeBridge(): Promise<FakeServer> {
  const state: FakeServer['state'] = { queue: [], results: [], events: [], sse: [], seq: 0 };

  const readBody = (req: http.IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => resolve(raw === '' ? {} : (JSON.parse(raw) as unknown)));
    });

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url === '/pipeline/request/next') {
      const next = state.queue.shift();
      if (next === undefined) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(next));
      return;
    }
    if (req.method === 'POST' && url === '/pipeline/request') {
      void readBody(req).then((b) => {
        const body = b as { kind: string; payload: unknown };
        state.seq += 1;
        const id = `pr_${state.seq}`;
        state.queue.push({ id, kind: body.kind, payload: body.payload, createdAt: state.seq });
        // Mirror the real bridge: enqueue ALSO broadcasts a wake frame so a request
        // enqueued while the worker is idle has a `data:` frame to wake on (the
        // worker then FIFO-drains via GET /pipeline/request/next).
        const frame =
          `id: ${state.seq}\n` +
          `data: ${JSON.stringify({ requestId: id, event: { type: 'pipeline-request', id }, seq: state.seq })}\n\n`;
        for (const client of state.sse) client.write(frame);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id }));
      });
      return;
    }
    if (req.method === 'POST' && url === '/pipeline/result') {
      void readBody(req).then((b) => {
        const body = b as { id: string; status: number; result: unknown };
        state.results.push({ id: body.id, status: body.status, result: body.result });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === 'POST' && url === '/pipeline/event') {
      void readBody(req).then((b) => {
        const body = b as { requestId: string; event: unknown };
        state.events.push(body);
        state.seq += 1;
        const frame = `id: ${state.seq}\ndata: ${JSON.stringify({ ...body, seq: state.seq })}\n\n`;
        for (const client of state.sse) client.write(frame);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === 'GET' && url.startsWith('/pipeline/events')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      state.sse.push(res);
      req.on('close', () => {
        const i = state.sse.indexOf(res);
        if (i >= 0) state.sse.splice(i, 1);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of state.sse) c.end();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

describe('runCli', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-runcli-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('maps exit 0 → status 0 and parses stdout JSON', async () => {
    const bin = path.join(dir, 'uxfactory.cjs');
    await writeStubCli(bin, 0, JSON.stringify({ ok: true, n: 1 }));
    const res = await runCli(bin, ['classify', '--json'], dir);
    expect(res.status).toBe(0);
    expect(res.json).toEqual({ ok: true, n: 1 });
  });

  it('maps exit 1 → status 1 (json still parsed)', async () => {
    const bin = path.join(dir, 'uxfactory.cjs');
    await writeStubCli(bin, 1, JSON.stringify({ clean: false }));
    const res = await runCli(bin, ['batch', 'design', '--json'], dir);
    expect(res.status).toBe(1);
    expect(res.json).toEqual({ clean: false });
  });

  it('maps a spawn failure (ENOENT) → status 2, json null', async () => {
    const res = await runCli(path.join(dir, 'does-not-exist'), ['classify'], dir);
    expect(res.status).toBe(2);
    expect(res.json).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveCliBin
// ---------------------------------------------------------------------------

describe('resolveCliBin', () => {
  it('prefers an explicit config cliBin', () => {
    expect(resolveCliBin({ projectRoot: '/x', cliBin: '/custom/uxfactory' })).toBe(
      '/custom/uxfactory',
    );
  });
  it("falls back to PATH 'uxfactory' when no local bin exists", () => {
    expect(resolveCliBin({ projectRoot: '/definitely/not/a/repo' })).toBe('uxfactory');
  });
});

// ---------------------------------------------------------------------------
// deterministic dispatch via drain
// ---------------------------------------------------------------------------

describe('deterministic dispatch', () => {
  let projectRoot: string;
  let binDir: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-proj-'));
    binDir = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-bin-'));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  const deps = (bridge: FakeBridge, cliBin: string): Parameters<typeof drain>[0] => ({
    bridge,
    ctx: { projectRoot, cliBin } satisfies DispatchCtx,
    generative: async () => ({ status: 2, result: { error: 'no generative in this test' } }),
  });

  it('classify: writes the payload classification, runs the CLI in projectRoot, posts status 0 + JSON', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(
      bin,
      0,
      JSON.stringify({ confirm_status: 'draft', scope: { visual: 'low' } }),
    );

    const bridge = new FakeBridge();
    bridge.queue.push({
      id: 'pr_1',
      kind: 'classify',
      payload: { classification: { product_type: 'saas', surfaces: ['web'] } },
      createdAt: 1,
    });

    await drain(deps(bridge, bin));

    // posted the parsed CLI JSON with status 0
    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ id: 'pr_1', status: 0 });
    expect(bridge.results[0]!.result).toEqual({
      confirm_status: 'draft',
      scope: { visual: 'low' },
    });

    // wrote the payload-provided classification to projectRoot BEFORE the CLI read it
    const written = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.classification.json'), 'utf8'),
    ) as unknown;
    expect(written).toEqual({ product_type: 'saas', surfaces: ['web'] });

    // the CLI ran in projectRoot with the expected args
    const call = JSON.parse(await readFile(path.join(projectRoot, '.stub-call.json'), 'utf8')) as {
      cwd: string;
      argv: string[];
    };
    // macOS symlinks /var → /private/var, so compare resolved realpaths.
    expect(call.cwd).toBe(await realpath(projectRoot));
    expect(call.argv).toEqual(['classify', '--json']);
  });

  it('batch: a CLI that exits 1 yields result status 1', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(bin, 1, JSON.stringify({ clean: false, mustPassFailed: true }));

    const bridge = new FakeBridge();
    bridge.queue.push({ id: 'pr_b', kind: 'batch', payload: { dir: 'design' }, createdAt: 1 });

    await drain(deps(bridge, bin));

    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ id: 'pr_b', status: 1 });
    expect(bridge.results[0]!.result).toEqual({ clean: false, mustPassFailed: true });
  });

  it('a spawn failure inside a handler yields result status 2 and keeps the loop alive', async () => {
    const bridge = new FakeBridge();
    bridge.queue.push({ id: 'pr_s', kind: 'batch', payload: { dir: 'design' }, createdAt: 1 });
    bridge.queue.push({ id: 'pr_t', kind: 'batch', payload: { dir: 'design' }, createdAt: 2 });

    await drain(deps(bridge, path.join(binDir, 'no-such-uxfactory')));

    expect(bridge.results).toHaveLength(2);
    expect(bridge.results[0]).toMatchObject({ id: 'pr_s', status: 2 });
    expect(bridge.results[1]).toMatchObject({ id: 'pr_t', status: 2 });
  });

  it('runPool processes up to N jobs concurrently (the producer pool)', async () => {
    const bridge = new FakeBridge();
    for (let i = 0; i < 4; i++) {
      bridge.queue.push({ id: `pr_${i}`, kind: 'generate-artifact', payload: {}, createdAt: i });
    }
    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const generative = async (): Promise<DispatchOutcome> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate; // hold every in-flight job until released
      inFlight -= 1;
      return { status: 0, result: {} };
    };
    const poolDeps: WorkerDeps = {
      bridge,
      ctx: { projectRoot: '/tmp/x', cliBin: 'uxfactory' } as unknown as WorkerDeps['ctx'],
      generative,
    };
    const stop = runPool(poolDeps, 3);
    await new Promise((r) => setTimeout(r, 20));
    // 3 lanes → exactly 3 jobs in flight; the 4th waits behind a lane.
    expect(maxInFlight).toBe(3);
    release();
    await new Promise((r) => setTimeout(r, 20));
    stop();
    expect(bridge.results.map((r) => r.id).sort()).toEqual(['pr_0', 'pr_1', 'pr_2', 'pr_3']);
  });

  it('drains the queue until pullRequest returns null (204)', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(bin, 0, JSON.stringify({ ok: true }));

    const bridge = new FakeBridge();
    for (let i = 0; i < 3; i++) {
      bridge.queue.push({ id: `pr_${i}`, kind: 'classify', payload: {}, createdAt: i });
    }

    await drain(deps(bridge, bin));

    expect(bridge.results.map((r) => r.id)).toEqual(['pr_0', 'pr_1', 'pr_2']);
    expect(bridge.queue).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // SECURITY — untrusted positional hardening (argv flag smuggling + escape)
  // -------------------------------------------------------------------------

  it('rejects a dir positional that smuggles a flag, WITHOUT spawning the CLI', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(bin, 0, JSON.stringify({ ok: true }));

    const bridge = new FakeBridge();
    bridge.queue.push({
      id: 'pr_inj',
      kind: 'batch',
      payload: { dir: '--malicious' },
      createdAt: 1,
    });

    await drain(deps(bridge, bin));

    // mapped to a setup error...
    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ id: 'pr_inj', status: 2 });
    // ...and the CLI was NEVER spawned (no stub-call recorded in projectRoot).
    await expect(readFile(path.join(projectRoot, '.stub-call.json'), 'utf8')).rejects.toThrow();
  });

  it('rejects a design path that escapes the project root, WITHOUT spawning the CLI', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(bin, 0, JSON.stringify({ ok: true }));

    const bridge = new FakeBridge();
    bridge.queue.push({
      id: 'pr_esc',
      kind: 'review',
      payload: { design: '../../etc/passwd' },
      createdAt: 1,
    });

    await drain(deps(bridge, bin));

    expect(bridge.results[0]).toMatchObject({ id: 'pr_esc', status: 2 });
    await expect(readFile(path.join(projectRoot, '.stub-call.json'), 'utf8')).rejects.toThrow();
  });

  it('inserts a `--` end-of-options sentinel before the dir positional', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(bin, 0, JSON.stringify({ ok: true }));

    const bridge = new FakeBridge();
    bridge.queue.push({
      id: 'pr_safe',
      kind: 'batch',
      payload: { dir: 'design', scope: 'wireframe' },
      createdAt: 1,
    });

    await drain(deps(bridge, bin));

    expect(bridge.results[0]).toMatchObject({ id: 'pr_safe', status: 0 });
    const call = JSON.parse(await readFile(path.join(projectRoot, '.stub-call.json'), 'utf8')) as {
      argv: string[];
    };
    expect(call.argv).toEqual(['batch', '--json', '--scope', 'wireframe', '--', 'design']);
  });

  it('generate-specs: runs the CLI in projectRoot with a `--` sentinel and relays its JSON + status', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(
      bin,
      0,
      JSON.stringify({ written: ['checkout.uxfactory.json'], skipped: [] }),
    );

    const bridge = new FakeBridge();
    bridge.queue.push({
      id: 'pr_gs',
      kind: 'generate-specs',
      payload: { dir: 'design' },
      createdAt: 1,
    });

    await drain(deps(bridge, bin));

    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ id: 'pr_gs', status: 0 });
    expect(bridge.results[0]!.result).toEqual({
      written: ['checkout.uxfactory.json'],
      skipped: [],
    });

    const call = JSON.parse(await readFile(path.join(projectRoot, '.stub-call.json'), 'utf8')) as {
      cwd: string;
      argv: string[];
    };
    expect(call.cwd).toBe(await realpath(projectRoot));
    expect(call.argv).toEqual(['generate-specs', '--json', '--', 'design']);
  });

  it('generate-specs: rejects a dir that smuggles a flag, WITHOUT spawning the CLI', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(bin, 0, JSON.stringify({ ok: true }));

    const bridge = new FakeBridge();
    bridge.queue.push({
      id: 'pr_gs_inj',
      kind: 'generate-specs',
      payload: { dir: '--force' },
      createdAt: 1,
    });

    await drain(deps(bridge, bin));

    expect(bridge.results[0]).toMatchObject({ id: 'pr_gs_inj', status: 2 });
    await expect(readFile(path.join(projectRoot, '.stub-call.json'), 'utf8')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generative branch routing (no adapter)
// ---------------------------------------------------------------------------

describe('generative branch routing', () => {
  it('isDeterministic recognizes the six deterministic kinds and rejects generative ones', () => {
    for (const k of ['classify', 'gate', 'batch', 'generate-specs', 'review', 'render']) {
      expect(isDeterministic(k)).toBe(true);
    }
    expect(isDeterministic('generate-artifact')).toBe(false);
    expect(isDeterministic('canvas-review')).toBe(false);
    // identity-interpret (Phase 3 vision) is a generative kind (skill-driven), NOT a
    // deterministic CLI handler — it routes to runGenerative by absence from DETERMINISTIC.
    expect(isDeterministic('identity-interpret')).toBe(false);
    // generate-design is a generative kind (skill-driven), NOT a deterministic CLI handler.
    expect(isDeterministic('generate-design')).toBe(false);
    // demo-brief (Task 2: panel Demo button) is a generative kind (skill-driven),
    // NOT a deterministic CLI handler — it routes to runGenerative by absence.
    expect(isDeterministic('demo-brief')).toBe(false);
  });

  it('a throwing generative handler is caught → result status 2 (loop stays alive)', async () => {
    const bridge = new FakeBridge();
    await handleRequest(
      { id: 'pr_g', kind: 'generate-artifact', payload: {}, createdAt: 1 },
      {
        bridge,
        ctx: { projectRoot: '/x', cliBin: 'uxfactory' },
        generative: async () => {
          throw new Error('boom');
        },
      },
    );
    expect(bridge.results).toHaveLength(1);
    expect(bridge.results[0]).toMatchObject({ id: 'pr_g', status: 2 });
  });
});

// ---------------------------------------------------------------------------
// loadArtifactSkill — per-artifact specialist skill with generic fallback
describe('loadArtifactSkill', () => {
  it('uses the specialist skill when skill/artifacts/<key>/SKILL.md exists', () => {
    const s = loadArtifactSkill('brand-colors');
    expect(s).toContain('Draft brand-colors');
    expect(s).not.toBe(loadSkill('generate'));
  });

  it('falls back to the generic generate skill for artifacts without a specialist', () => {
    expect(loadArtifactSkill('grid')).toBe(loadSkill('generate'));
  });

  it('sanitizes the key — a traversal attempt falls back safely', () => {
    expect(loadArtifactSkill('../../../etc/passwd')).toBe(loadSkill('generate'));
  });
});

// loadSkill
// ---------------------------------------------------------------------------

describe('loadSkill', () => {
  it('returns the SKILL.md body (frontmatter stripped) as the systemPrompt', () => {
    const body = loadSkill('generate');
    expect(body.startsWith('---')).toBe(false); // YAML frontmatter dropped
    expect(body).toContain('# UXFactory — Draft One UX Artifact');
    expect(body).toContain('uxfactory classify --json');
  });

  it('resolves the design skill body (frontmatter stripped) for the generate-design path', () => {
    const body = loadSkill('design');
    expect(body.startsWith('---')).toBe(false); // YAML frontmatter dropped
    // the design skill drives the HTML author -> gate -> revise loop
    expect(body).toContain('uxfactory batch --json -- design');
    expect(body).toContain('.uxfactory/batch/report.json');
    // HTML tier: author screens + trace, not *.uxfactory.json specs
    expect(body).toContain('design/screens/<page>.html');
    expect(body).toContain('design/trace.json');
  });
});

// ---------------------------------------------------------------------------
// parseProgressLine — the design loop's UXF::PROGRESS narration markers
// ---------------------------------------------------------------------------

describe('parseProgressLine', () => {
  it('parses a well-formed marker and masks any sk-… in its note', () => {
    const parsed = parseProgressLine(
      'UXF::PROGRESS {"iter":1,"phase":"gate","status":"fail","findings":2,"note":"oops sk-ant-api03-XYZ00000"}',
    );
    expect(parsed).toMatchObject({ iter: 1, phase: 'gate', status: 'fail', findings: 2 });
    expect(parsed?.['note']).toBe('oops sk-[redacted]');
  });

  it('tolerates surrounding whitespace on the line', () => {
    expect(parseProgressLine('  UXF::PROGRESS {"phase":"draft"}  ')).toEqual({ phase: 'draft' });
  });

  it('returns null for a non-marker line', () => {
    expect(parseProgressLine('just some narration')).toBeNull();
  });

  it('returns null (never throws) for a malformed JSON payload', () => {
    expect(parseProgressLine('UXF::PROGRESS {not json')).toBeNull();
  });

  it('returns null for a non-object JSON payload (array/scalar)', () => {
    expect(parseProgressLine('UXF::PROGRESS [1,2,3]')).toBeNull();
    expect(parseProgressLine('UXF::PROGRESS 42')).toBeNull();
  });

  it('finds the marker MID-LINE (prefixed by narration) + tolerates trailing text', () => {
    // The live run showed the agent emits e.g. "…authoring the specs.`UXF::PROGRESS {…}".
    expect(
      parseProgressLine(
        'Now authoring the specs.`UXF::PROGRESS {"iter":2,"phase":"gate","status":"pass"} continuing',
      ),
    ).toMatchObject({ iter: 2, phase: 'gate', status: 'pass' });
  });

  it('handles a brace inside a string value (balanced, string-aware extraction)', () => {
    expect(parseProgressLine('x UXF::PROGRESS {"note":"fix {checkout}"} y')?.['note']).toBe(
      'fix {checkout}',
    );
  });
});

// ---------------------------------------------------------------------------
// extractArtifacts — per-item refs lifted from a written artifact file
// ---------------------------------------------------------------------------

describe('extractArtifacts', () => {
  it('user-story: maps each story id → { ref, title: goal } (real stories.json shape)', () => {
    const parsed = {
      stories: [
        { id: 'story-1', role: 'user', goal: 'see home', benefit: 'fast' },
        { id: 'story-2', goal: 'check out' },
      ],
    };
    expect(extractArtifacts(parsed, 'user-story')).toEqual([
      { ref: 'story-1', title: 'see home' },
      { ref: 'story-2', title: 'check out' },
    ]);
  });

  it('user-story: accepts a top-level array and falls title back to title ?? name', () => {
    const parsed = [
      { id: 'S-1', title: 'Login' },
      { id: 'S-2', name: 'Browse' },
    ];
    expect(extractArtifacts(parsed, 'user-story')).toEqual([
      { ref: 'S-1', title: 'Login' },
      { ref: 'S-2', title: 'Browse' },
    ]);
  });

  it('user-story: skips stories without an id', () => {
    const parsed = { stories: [{ goal: 'no id' }, { id: 'story-9', goal: 'ok' }] };
    expect(extractArtifacts(parsed, 'user-story')).toEqual([{ ref: 'story-9', title: 'ok' }]);
  });

  it('acceptance-criteria: flattens nested criteria, seedRef = the owning story id', () => {
    const parsed = {
      stories: [
        {
          id: 'story-1',
          goal: 'see home',
          acceptanceCriteria: [
            { statement: 'no data', impliedState: 'empty' },
            { statement: 'loaded', impliedState: 'success' },
          ],
        },
        {
          id: 'story-2',
          goal: 'check out',
          acceptanceCriteria: [{ statement: 'pays', impliedState: 'success' }],
        },
      ],
    };
    expect(extractArtifacts(parsed, 'acceptance-criteria')).toEqual([
      { ref: 'story-1#ac-1', title: 'no data', seedRef: 'story-1' },
      { ref: 'story-1#ac-2', title: 'loaded', seedRef: 'story-1' },
      { ref: 'story-2#ac-1', title: 'pays', seedRef: 'story-2' },
    ]);
  });

  it('acceptance-criteria: a story with no criteria emits one self-seeded artifact', () => {
    const parsed = { stories: [{ id: 'story-3', goal: 'orphan' }] };
    expect(extractArtifacts(parsed, 'acceptance-criteria')).toEqual([
      { ref: 'story-3', title: 'orphan', seedRef: 'story-3' },
    ]);
  });

  it('user-journey: canonical string steps → the step names as refs', () => {
    const parsed = { steps: ['story-1-home', 'story-1-detail'] };
    expect(extractArtifacts(parsed, 'user-journey')).toEqual([
      { ref: 'story-1-home' },
      { ref: 'story-1-detail' },
    ]);
  });

  it('user-journey: tolerant object steps → id/name refs + seedRef from story', () => {
    const parsed = {
      steps: [
        { id: 'step-a', name: 'Home', story: 'story-1' },
        { name: 'Detail', storyRef: 'story-2' },
      ],
    };
    expect(extractArtifacts(parsed, 'user-journey')).toEqual([
      { ref: 'step-a', title: 'Home', seedRef: 'story-1' },
      { ref: 'Detail', title: 'Detail', seedRef: 'story-2' },
    ]);
  });

  it('user-journey: no steps → a single flow artifact from id/name', () => {
    expect(extractArtifacts({ id: 'flow-1', name: 'Checkout' }, 'user-journey')).toEqual([
      { ref: 'flow-1', title: 'Checkout' },
    ]);
  });

  it('malformed / empty input → [] for every target (never throws)', () => {
    for (const t of ['user-story', 'acceptance-criteria', 'user-journey'] as const) {
      expect(extractArtifacts(null, t)).toEqual([]);
      expect(extractArtifacts(42, t)).toEqual([]);
      expect(extractArtifacts('nope', t)).toEqual([]);
      expect(extractArtifacts({}, t)).toEqual([]);
      expect(extractArtifacts({ stories: 'not-an-array' }, t)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// readDemoAnswers — the demo-brief result read-back helper
// ---------------------------------------------------------------------------

describe('readDemoAnswers', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'demo-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the trimmed answers object when the file is present and valid', async () => {
    await writeFile(
      path.join(dir, 'demo-brief.json'),
      JSON.stringify({
        answers: { problem: 'p', outcomes: 'o', 'out-of-scope': 's', constraints: 'c' },
      }),
    );
    expect(await readDemoAnswers(path.join(dir, 'demo-brief.json'))).toEqual({
      problem: 'p',
      outcomes: 'o',
      'out-of-scope': 's',
      constraints: 'c',
    });
  });

  it('returns null when the file is absent', async () => {
    expect(await readDemoAnswers(path.join(dir, 'missing.json'))).toBeNull();
  });

  it('returns null when the JSON is malformed (unparseable)', async () => {
    await writeFile(path.join(dir, 'bad.json'), '{ not json');
    expect(await readDemoAnswers(path.join(dir, 'bad.json'))).toBeNull();
  });

  it('returns null when an answer is missing, empty, or non-string', async () => {
    await writeFile(
      path.join(dir, 'missing-key.json'),
      JSON.stringify({ answers: { problem: 'p', outcomes: 'o', 'out-of-scope': 's' } }),
    );
    expect(await readDemoAnswers(path.join(dir, 'missing-key.json'))).toBeNull();

    await writeFile(
      path.join(dir, 'empty-value.json'),
      JSON.stringify({
        answers: { problem: '  ', outcomes: 'o', 'out-of-scope': 's', constraints: 'c' },
      }),
    );
    expect(await readDemoAnswers(path.join(dir, 'empty-value.json'))).toBeNull();

    await writeFile(
      path.join(dir, 'non-string.json'),
      JSON.stringify({
        answers: { problem: 42, outcomes: 'o', 'out-of-scope': 's', constraints: 'c' },
      }),
    );
    expect(await readDemoAnswers(path.join(dir, 'non-string.json'))).toBeNull();
  });

  it('returns null when `answers` itself is absent/malformed', async () => {
    await writeFile(path.join(dir, 'no-answers.json'), JSON.stringify({ foo: 'bar' }));
    expect(await readDemoAnswers(path.join(dir, 'no-answers.json'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runGenerative (FAKE AgentAdapter — no real LLM)
// ---------------------------------------------------------------------------

describe('runGenerative', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-gen-'));
    // Root gate (spec 2026-07-11-product-brief-root-gate): this describe's cases
    // exercise prompt composition, not the gate itself, so seed a brief by
    // default — the dedicated gate describe below uses its own bare tmp roots.
    await mkdir(path.join(projectRoot, '.uxfactory', 'artifacts'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.uxfactory', 'artifacts', 'brief.md'),
      '# Acme\nBrief.',
      'utf8',
    );
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const ctx = (): DispatchCtx => ({ projectRoot, cliBin: 'uxfactory' });

  it('generate-artifact: builds AgentInput from the generate skill + target/path, forwards masked chunks', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'text-delta', text: 'drafting (key=sk-ant-api03-TESTSECRET00000) done' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_gen',
        kind: 'generate-artifact',
        payload: {
          target: 'user-story',
          path: 'design/stories.json',
          classification: { category: 'web_app' },
          constraints: ['FERPA', 'COPPA'],
        },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    // systemPrompt is the generate skill body; user carries the target + path override.
    expect(adapter.lastInput?.systemPrompt).toBe(loadSkill('generate'));
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('user-story');
    expect(user).toContain('design/stories.json');
    expect(user).toContain('FERPA');

    // every chunk reached the bridge; the text-delta's sk-… is masked.
    expect(bridge.events.map((e) => (e.event as { type: string }).type)).toEqual([
      'text-delta',
      'message-stop',
    ]);
    const text = (bridge.events[0]!.event as { text: string }).text;
    expect(text).not.toContain('TESTSECRET');
    expect(text).toContain('sk-[redacted]');

    // success outcome echoes the (overridden) artifact path; accumulated content masked too.
    expect(out.status).toBe(0);
    expect(out.result).toMatchObject({ artifactPath: 'design/stories.json' });
    expect((out.result as { content: string }).content).not.toContain('TESTSECRET');
  });

  it('generate-artifact target:acceptance-criteria threads emphasis + seedRefs + the AcceptanceCriterion path', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_ac',
        kind: 'generate-artifact',
        payload: {
          target: 'acceptance-criteria',
          seedRefs: ['S-1', 'S-2'],
          classification: { category: 'ecommerce' },
        },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(adapter.lastInput?.systemPrompt).toBe(loadSkill('generate'));
    const user = adapter.lastInput?.messages[0]?.content as string;
    // the target discriminator + the seed refs + the resolved AcceptanceCriterion artifact/path.
    expect(user).toContain('acceptance-criteria');
    expect(user).toContain('S-1');
    expect(user).toContain('S-2');
    expect(user).toContain('AcceptanceCriterion');
    expect(user).toContain('testable acceptance criteria for the seeded stories');
    expect(out.status).toBe(0);
    // user-story / acceptance-criteria both resolve the AcceptanceCriterion default path.
    expect((out.result as { artifactPath: string }).artifactPath).toBe(
      'design/acceptance-criteria.json',
    );
  });

  it('generate-artifact target:user-journey resolves the UserFlow path', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_uj',
        kind: 'generate-artifact',
        payload: { target: 'user-journey', seedRefs: ['S-1', 'S-2'] },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('user-journey');
    expect(user).toContain('UserFlow');
    expect(user).toContain('S-1');
    expect(out.status).toBe(0);
    expect((out.result as { artifactPath: string }).artifactPath).toBe('design/user-flow.json');
  });

  it('generate-artifact target:user-story resolves the AcceptanceCriterion path', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_us', kind: 'generate-artifact', payload: { target: 'user-story' }, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('user-story');
    expect(user).toContain('AcceptanceCriterion');
    expect(user).toContain('the user-story narratives');
    expect(out.status).toBe(0);
    expect((out.result as { artifactPath: string }).artifactPath).toBe(
      'design/acceptance-criteria.json',
    );
  });

  it('generate-artifact with an invalid target → status 2 (never invokes the adapter)', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_bad',
        kind: 'generate-artifact',
        payload: { target: 'token-set' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
    // a bad target is rejected before the adapter is ever streamed.
    expect(adapter.lastInput).toBeNull();
  });

  it('generate-artifact with a missing target → status 2', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_miss', kind: 'generate-artifact', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
    expect(adapter.lastInput).toBeNull();
  });

  // ── Panel-artifact plan table (Artifacts tab concern keys) ─────────────────

  it('generate-artifact artifact:brief builds a plan with brief.md path + guidance in user prompt', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_brief',
        kind: 'generate-artifact',
        payload: {
          artifact: 'brief',
          guidance: 'target enterprise SaaS customers',
          answers: { problem: 'Ops teams drown in spreadsheets' },
        },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    expect(adapter.lastInput?.systemPrompt).toBe(loadSkill('generate'));
    const user = adapter.lastInput?.messages[0]?.content as string;
    // Producer writes to an isolated per-job scratch path; the RESULT reports canonical.
    expect(user).toContain('.uxfactory/scratch/pr_brief/brief.md');
    expect(user).toContain('target enterprise SaaS customers');
    expect((out.result as { artifactPath: string }).artifactPath).toBe('.uxfactory/artifacts/brief.md');
  });

  it('generate-artifact artifact:brief omits USER GUIDANCE clause when guidance is absent', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    await runGenerative(
      {
        id: 'pr_brief_ng',
        kind: 'generate-artifact',
        payload: { artifact: 'brief', answers: { problem: 'Ops teams drown in spreadsheets' } },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('.uxfactory/scratch/pr_brief_ng/brief.md');
    expect(user).not.toContain('USER GUIDANCE');
  });

  it('generate-artifact artifact:stories frames a SET artifact at the stories directory', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_stories',
        kind: 'generate-artifact',
        payload: { artifact: 'stories', guidance: 'checkout happy path first' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('.uxfactory/artifacts/stories');
    expect(user).toContain('SET artifact');
    expect(user).toContain('checkout happy path first');
    expect((out.result as { artifactPath: string }).artifactPath).toBe(
      '.uxfactory/artifacts/stories',
    );
  });

  it('generate-artifact artifact:features resolves the features.json path', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_features',
        kind: 'generate-artifact',
        payload: { artifact: 'features' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('/scratch/');
    expect(user).toContain('features.json');
    expect((out.result as { artifactPath: string }).artifactPath).toBe(
      '.uxfactory/artifacts/features.json',
    );
  });

  it('generate-artifact producer: reads the scratch file into a write-intent for the bridge (phase 3b)', async () => {
    // Simulate the agent writing its section content to the isolated scratch path.
    const scratchDir = path.join(projectRoot, '.uxfactory', 'scratch', 'pr_bc_intent');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(path.join(scratchDir, 'brand-colors.json'), JSON.stringify({ primary: '#2952E3' }));

    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const out = await runGenerative(
      { id: 'pr_bc_intent', kind: 'generate-artifact', payload: { artifact: 'brand-colors' }, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    expect(out.status).toBe(0);
    const writes = (out.result as { writes?: Array<Record<string, unknown>> }).writes;
    expect(writes).toEqual([
      { path: '.uxfactory/artifacts/design-system.json', sectionKey: 'brand-colors', body: { primary: '#2952E3' } },
    ]);
    // The result reports the CANONICAL path, not scratch.
    expect((out.result as { artifactPath: string }).artifactPath).toBe('.uxfactory/artifacts/design-system.json');
  });

  it('generate-artifact producer: cleans up the scratch dir after building the write-intent', async () => {
    const scratchDir = path.join(projectRoot, '.uxfactory', 'scratch', 'pr_bc_clean');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(path.join(scratchDir, 'brand-colors.json'), JSON.stringify({ primary: '#2952E3' }));
    const out = await runGenerative(
      { id: 'pr_bc_clean', kind: 'generate-artifact', payload: { artifact: 'brand-colors' }, createdAt: 1 },
      new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]),
      new FakeBridge(),
      ctx(),
    );
    // Write-intent still built, but the scratch dir is gone.
    expect((out.result as { writes?: unknown[] }).writes).toHaveLength(1);
    await expect(readFile(path.join(scratchDir, 'brand-colors.json'), 'utf8')).rejects.toThrow();
  });

  it('generate-artifact producer: debug mode RETAINS the scratch dir', async () => {
    const scratchDir = path.join(projectRoot, '.uxfactory', 'scratch', 'pr_bc_debug');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(path.join(scratchDir, 'brand-colors.json'), JSON.stringify({ primary: '#2952E3' }));
    await runGenerative(
      { id: 'pr_bc_debug', kind: 'generate-artifact', payload: { artifact: 'brand-colors' }, createdAt: 1 },
      new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]),
      new FakeBridge(),
      { ...ctx(), debug: true },
    );
    // Retained for inspection.
    expect(JSON.parse(await readFile(path.join(scratchDir, 'brand-colors.json'), 'utf8'))).toEqual({ primary: '#2952E3' });
  });

  it('generate-artifact producer: a whole-file artifact emits a plain write-intent', async () => {
    const scratchDir = path.join(projectRoot, '.uxfactory', 'scratch', 'pr_sm_intent');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(path.join(scratchDir, 'sitemap.json'), JSON.stringify({ nodes: [] }));
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const out = await runGenerative(
      { id: 'pr_sm_intent', kind: 'generate-artifact', payload: { artifact: 'sitemap' }, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const writes = (out.result as { writes?: Array<Record<string, unknown>> }).writes;
    expect(writes).toEqual([{ path: '.uxfactory/artifacts/sitemap.json', body: { nodes: [] } }]);
  });

  it('generate-artifact with an unknown artifact key → status 2 (never invokes the adapter)', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_bad_artifact',
        kind: 'generate-artifact',
        payload: { artifact: 'unknown-key' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
    expect(adapter.lastInput).toBeNull();
  });

  it('generate-artifact legacy target:user-story is unaffected by the panel-artifact table (regression)', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_legacy_regression',
        kind: 'generate-artifact',
        payload: { target: 'user-story', classification: { category: 'web_app' } },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    expect(adapter.lastInput?.systemPrompt).toBe(loadSkill('generate'));
    const user = adapter.lastInput?.messages[0]?.content as string;
    // Legacy path carries target + AcceptanceCriterion + emphasis.
    expect(user).toContain('user-story');
    expect(user).toContain('AcceptanceCriterion');
    expect(user).toContain('the user-story narratives');
    // Legacy path is NOT routed through panel-artifact framing.
    expect(user).not.toContain('USER GUIDANCE');
    expect((out.result as { artifactPath: string }).artifactPath).toBe(
      'design/acceptance-criteria.json',
    );
  });

  it('generate-artifact artifact:brand-colors maps to design-system.json with section-merge instructions', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_brand_colors',
        kind: 'generate-artifact',
        payload: { artifact: 'brand-colors' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('/scratch/');
    expect(user).toContain('brand-colors');
    // section-merge instruction is present for shared-file section keys.
    // Section content goes to scratch; the bridge does the deterministic merge now.
    expect(user).toContain("ONLY the content of the 'brand-colors' section");
    expect((out.result as { artifactPath: string }).artifactPath).toBe('.uxfactory/artifacts/design-system.json');
  });

  // ── Brief content rule: five schema sections + no-restatement ─────────────

  it('generate-artifact artifact:brief prompt mandates the five ## sections', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    await runGenerative(
      {
        id: 'pr_brief_sections',
        kind: 'generate-artifact',
        payload: { artifact: 'brief', answers: { problem: 'Ops teams drown in spreadsheets' } },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    // Spec §2 Worker: exactly these ## sections must be mandated.
    expect(user).toContain('## Overview');
    expect(user).toContain('## Audience & insight');
    expect(user).toContain('## Goals & success metrics');
    expect(user).toContain('## Scope & constraints');
    expect(user).toContain('## Risks & open questions');
  });

  it('generate-artifact artifact:brief prompt contains the no-restatement rule', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    await runGenerative(
      {
        id: 'pr_brief_no_restate',
        kind: 'generate-artifact',
        payload: { artifact: 'brief', answers: { problem: 'Ops teams drown in spreadsheets' } },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    // Must explicitly forbid restating pinned config values.
    expect(user).toContain('DO NOT restate');
    // Must require net-new substance or an honest TBD line per section.
    expect(user).toContain('net-new substance');
    expect(user).toContain('TBD — needs user input');
  });

  it('generate-artifact artifact:tokens prompt does NOT carry the brief section rule (regression)', async () => {
    // The brief-specific instruction must not leak into other panel artifact plans.
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    await runGenerative(
      {
        id: 'pr_tokens_no_brief',
        kind: 'generate-artifact',
        payload: { artifact: 'tokens' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).not.toContain('## Overview');
    expect(user).not.toContain('DO NOT restate');
  });

  it('a thrown RateLimitError (AdapterError) → status 2', async () => {
    const adapter = new FakeAdapter(projectRoot, [], new RateLimitError('429 slow down'));
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_rl',
        kind: 'generate-artifact',
        payload: { target: 'user-journey', path: 'design/flow.json' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
  });

  it('canvas-review: uses the vision-review skill + the review instruction', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_cr', kind: 'canvas-review', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(adapter.lastInput?.systemPrompt).toBe(loadSkill('vision-review'));
    expect(adapter.lastInput?.messages[0]?.content).toMatch(/review the pending canvas/i);
    expect(out.status).toBe(0);
    // canvas-review has no artifact path.
    expect((out.result as { artifactPath?: string }).artifactPath).toBeUndefined();
  });

  it('identity-interpret: uses the node-identity skill + an IO-contract-referencing instruction', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_ii', kind: 'identity-interpret', payload: { root: projectRoot }, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(adapter.lastInput?.systemPrompt).toBe(loadSkill('node-identity'));
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toMatch(/identity propose identity-proposals\.json/);
    expect(out.status).toBe(0);
    // identity-interpret has no artifact path (mirrors canvas-review).
    expect((out.result as { artifactPath?: string }).artifactPath).toBeUndefined();
  });

  it('demo-brief: routes to the demo-brief skill and injects the configContext', () => {
    const plan = planGenerative(
      {
        id: 'r1',
        kind: 'demo-brief',
        payload: { configContext: 'Product type: SaaS & tools › X' },
        createdAt: 1,
      },
      ctx(),
      {},
    );
    expect(plan.systemPrompt).toBe(loadSkill('demo-brief'));
    expect(plan.user).toContain('SaaS & tools › X');
    // Per-request scratch path (Fix 1): the agent is told the exact path to
    // write to, so a stale file from a prior run can never be read back.
    expect(plan.user).toContain(path.join('scratch', 'r1', 'demo-brief.json'));
  });

  it('demo-brief: on success reads the four answers back into result.answers (status 0)', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();
    // The skill would WRITE this file during the run; simulate it landing at the
    // resolved per-request scratch path (the read happens after the stream completes).
    await mkdir(path.join(projectRoot, '.uxfactory', 'scratch', 'pr_demo'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.uxfactory', 'scratch', 'pr_demo', 'demo-brief.json'),
      JSON.stringify({
        answers: {
          problem: 'Shift managers lose 20 minutes/day to whiteboard shuffles.',
          outcomes: 'Cut scheduling time by 50% in 90 days.',
          'out-of-scope': 'Payroll integration.',
          constraints: 'Must run offline-first on shop-floor tablets.',
        },
      }),
      'utf8',
    );

    const out = await runGenerative(
      {
        id: 'pr_demo',
        kind: 'demo-brief',
        payload: { configContext: 'Product type: SaaS & tools › Scheduling' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(adapter.lastInput?.systemPrompt).toBe(loadSkill('demo-brief'));
    expect(out.status).toBe(0);
    expect(out.result).toEqual({
      answers: {
        problem: 'Shift managers lose 20 minutes/day to whiteboard shuffles.',
        outcomes: 'Cut scheduling time by 50% in 90 days.',
        'out-of-scope': 'Payroll integration.',
        constraints: 'Must run offline-first on shop-floor tablets.',
      },
    });
  });

  it('demo-brief: a missing/malformed demo-brief.json yields status 2 with an error', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();
    // No file written at the per-request scratch path → the post-stream read fails.

    const out = await runGenerative(
      { id: 'pr_demo_missing', kind: 'demo-brief', payload: { configContext: 'X' }, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
    expect((out.result as { error: string }).error).toMatch(/no answers/i);
  });

  it('demo-brief: a stale file from a DIFFERENT req.id cannot be read as this run\'s answers', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();
    // Simulate a previous run (job-1) that left a clean answers file behind.
    await mkdir(path.join(projectRoot, '.uxfactory', 'scratch', 'job-1'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.uxfactory', 'scratch', 'job-1', 'demo-brief.json'),
      JSON.stringify({
        answers: {
          problem: 'Stale from job-1.',
          outcomes: 'Stale outcomes.',
          'out-of-scope': 'Stale scope.',
          constraints: 'Stale constraints.',
        },
      }),
      'utf8',
    );

    // job-2's run never writes its own file (the LLM/tool hiccup this fix guards
    // against) — it must NOT fall back to job-1's file.
    const out = await runGenerative(
      { id: 'job-2', kind: 'demo-brief', payload: { configContext: 'X' }, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
    expect((out.result as { error: string }).error).toMatch(/no answers/i);
  });

  it('demoAnswersRelPath: differs per req.id', () => {
    const a = demoAnswersRelPath('job-1');
    const b = demoAnswersRelPath('job-2');
    expect(a).not.toBe(b);
    expect(a).toBe(path.join('.uxfactory', 'scratch', 'job-1', 'demo-brief.json'));
    expect(b).toBe(path.join('.uxfactory', 'scratch', 'job-2', 'demo-brief.json'));
  });

  it('generate-design: a registered audience modulates the instruction; absent stays silent', async () => {
    await mkdir(path.join(projectRoot, '.uxfactory/artifacts'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.uxfactory/artifacts/audience.json'),
      JSON.stringify({
        segments: [
          { name: 'floor managers', ageRange: '35-55', locales: ['en-US'],
            context: 'on the floor between tasks', deviceMix: { mobile: 0.7, desktop: 0.3 },
            accessibilityNotes: 'age-related vision — larger type', share: 0.8 },
          { name: 'auditors', ageRange: '25-40', locales: ['en-US'], context: 'desk review', share: 0.2 },
        ],
        primarySegment: 'floor managers',
      }),
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const out = await runGenerative(
      { id: 'pr_design_aud', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    expect(out.status).toBe(0);
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('AUDIENCE');
    expect(user).toContain('floor managers');
    expect(user).toContain('on the floor between tasks');
    expect(user).toContain('age-related vision — larger type');

    // Absent audience → no note (regression guard uses a fresh root).
    const bare = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-noaud-'));
    try {
      const adapter2 = new FakeAdapter(bare, [{ type: 'message-stop', finishReason: 'stop' }]);
      await runGenerative(
        { id: 'pr_design_noaud', kind: 'generate-design', payload: {}, createdAt: 1 },
        adapter2,
        new FakeBridge(),
        { ...ctx(), projectRoot: bare },
      );
      expect(adapter2.lastInput?.messages[0]?.content as string).not.toContain('AUDIENCE');
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('generate-design: builds AgentInput from the design skill + the loop task, forwards masked chunks', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'text-delta', text: 'planning (key=sk-ant-api03-TESTSECRET00000)\n' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_design', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    // systemPrompt is the design skill body verbatim.
    expect(adapter.lastInput?.systemPrompt).toBe(loadSkill('design'));
    // the task names the HTML loop, the screens, the tokens, the trace, and the gate.
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('uxfactory batch --json -- design');
    expect(user).toContain('design/acceptance-criteria.json');
    expect(user).toContain('design/screens/<page>.html');
    expect(user).toContain('design/tokens.ds.json');
    expect(user).toContain('design/trace.json');
    // the OLD spec-mode fallback must be gone (HTML workflow has no generate-specs)
    expect(user).not.toContain('generate-specs');
    expect(user).toContain(projectRoot); // works in the project root; CLI on PATH
    expect(user).toContain('PATH');

    // the text-delta reached the bridge with its sk-… masked.
    const textEvent = bridge.events
      .map((e) => e.event as { type: string; text?: string })
      .find((e) => e.type === 'text-delta');
    expect(textEvent?.text).not.toContain('TESTSECRET');
    expect(textEvent?.text).toContain('sk-[redacted]');

    expect(out.status).toBe(0);
    // generate-design is a multi-spec loop — no single artifactPath/artifacts echoed.
    expect((out.result as { artifactPath?: string }).artifactPath).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out.result, 'artifacts')).toBe(false);
    expect((out.result as { content: string }).content).not.toContain('TESTSECRET');
  });

  // ── Unit-type differentiation: composer payload shapes the design task ────

  it('generate-design: includes the user prompt, unit scope, and platforms from the payload', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    await runGenerative(
      {
        id: 'pr_unit_home',
        kind: 'generate-design',
        payload: {
          prompt: 'A dashboard for teachers',
          unitType: 'home-page',
          platforms: ['desktop', 'mobile'],
        },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('USER REQUEST (honor verbatim): A dashboard for teachers');
    expect(user).toContain('Scope:');
    expect(user).toContain('HOME page');
    expect(user).toContain('desktop, mobile');
    // The base HTML-loop task is still present.
    expect(user).toContain('uxfactory batch --json -- design');
  });

  it('generate-design: each unit type carries its own distinct scope guidance', async () => {
    const UNIT_MARKERS: Record<string, string> = {
      'user-flow': 'MULTI-SCREEN',
      story: 'IN PLACE',
      'home-page': 'HOME page',
      'secondary-page': 'SECONDARY page',
      'tertiary-page': 'TERTIARY page',
      page: 'standalone PAGE',
      template: 'TEMPLATE',
      organism: 'ORGANISM',
      molecule: 'MOLECULE',
      atom: 'ATOM',
      email: 'HTML EMAIL',
      'instagram-post': '1080×1080',
      'instagram-story': '1080×1920',
      'youtube-thumbnail': '1280×720',
      'facebook-post': '1200×630',
      'x-post': '1600×900',
    };

    for (const [unitType, marker] of Object.entries(UNIT_MARKERS)) {
      const adapter = new FakeAdapter(projectRoot, [
        { type: 'message-stop', finishReason: 'stop' },
      ]);
      await runGenerative(
        { id: `pr_unit_${unitType}`, kind: 'generate-design', payload: { unitType }, createdAt: 1 },
        adapter,
        new FakeBridge(),
        ctx(),
      );
      const user = adapter.lastInput?.messages[0]?.content as string;
      expect(user, `unitType=${unitType}`).toContain('Scope:');
      expect(user, `unitType=${unitType}`).toContain(marker);
    }
  });

  // ── Design style: classification.designStyle shapes the task + rubric ─────

  it('generate-design: classification designStyle injects style guidance and the rubric section', async () => {
    await writeFile(
      path.join(projectRoot, 'uxfactory.classification.json'),
      JSON.stringify({ category: 'marketing', designStyle: 'swiss' }),
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_style_swiss', kind: 'generate-design', payload: { prompt: 'landing' }, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );

    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('Design style: SWISS');
    expect(user).toContain('modular grid');

    const rubric = await readFile(path.join(projectRoot, '.uxfactory', 'craft-rubric.md'), 'utf8');
    expect(rubric).toContain('Design style conformance');
    expect(rubric).toContain('Swiss');
    expect(rubric).toContain('modular grid');
  });

  it('generate-design: every design style carries distinct guidance', async () => {
    const STYLE_MARKERS: Record<string, string> = {
      minimalism: 'negative space',
      neobrutalism: 'Clashing color',
      constructivism: 'geometric shapes',
      swiss: 'modular grid',
      editorial: 'Print-inspired',
      'hand-drawn': 'Handwritten or script',
      retro: 'old-school tech',
      flat: 'no shadows or 3D',
      bento: 'rounded content blocks',
      enterprise: 'data density',
      glassmorphism: 'Frosted-glass',
      material: 'paper-and-ink',
      neumorphism: 'extruded',
      wireframe: 'Placeholder typography',
      bauhaus: 'circles, squares, triangles',
      memphis: 'squiggles',
      aurora: 'mesh gradients',
      cyberpunk: 'neon accents',
      claymorphism: 'Double inner shadows',
      kinetic: 'tightly kerned',
      skeuomorphic: 'brushed metal',
      cupertino: 'translucent surfaces',
      metro: 'solid blocks of color',
      holographic: 'Iridescent',
      y2k: 'Bubble fonts',
      'brutalist-web': 'Times New Roman',
      'retro-os': 'Thick bevels',
      vaporwave: 'Neon pinks',
      'pixel-art': 'low-resolution',
      'art-deco': 'gold and black',
      'pop-art': 'halftone',
      'de-stijl': 'horizontal and vertical lines',
      organic: 'Earth tones',
      'dark-academia': 'Vintage paper',
      glitch: 'chromatic aberration',
      terminal: 'amber',
    };
    for (const [style, marker] of Object.entries(STYLE_MARKERS)) {
      await writeFile(
        path.join(projectRoot, 'uxfactory.classification.json'),
        JSON.stringify({ designStyle: style }),
        'utf8',
      );
      const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
      await runGenerative(
        { id: `pr_style_${style}`, kind: 'generate-design', payload: {}, createdAt: 1 },
        adapter,
        new FakeBridge(),
        ctx(),
      );
      const user = adapter.lastInput?.messages[0]?.content as string;
      expect(user, style).toContain('Design style:');
      expect(user, style).toContain(marker);
    }
  });

  it('generate-design: payload designStyle overrides the classification default', async () => {
    await writeFile(
      path.join(projectRoot, 'uxfactory.classification.json'),
      JSON.stringify({ designStyle: 'swiss' }),
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      {
        id: 'pr_style_override',
        kind: 'generate-design',
        payload: { designStyle: 'cyberpunk' },
        createdAt: 1,
      },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('Design style: CYBERPUNK');
    expect(user).not.toContain('Design style: SWISS');
    const rubric = await readFile(path.join(projectRoot, '.uxfactory', 'craft-rubric.md'), 'utf8');
    expect(rubric).toContain('Cyberpunk');
  });

  it('generate-design: the effective designStyle is stamped into the registry (payload wins)', async () => {
    await writeFile(
      path.join(projectRoot, 'uxfactory.classification.json'),
      JSON.stringify({ designStyle: 'swiss' }),
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_style_reg', kind: 'generate-design', payload: { designStyle: 'flat' }, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { designStyle?: string };
    expect(reg.designStyle).toBe('flat');

    // No style anywhere → stale registry stamp cleared.
    await writeFile(path.join(projectRoot, 'uxfactory.classification.json'), '{}', 'utf8');
    const adapter2 = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_style_reg_clear', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter2,
      new FakeBridge(),
      ctx(),
    );
    const reg2 = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { designStyle?: string };
    expect(reg2.designStyle).toBeUndefined();
  });

  it('generate-design: an unknown payload designStyle falls back to the classification', async () => {
    await writeFile(
      path.join(projectRoot, 'uxfactory.classification.json'),
      JSON.stringify({ designStyle: 'swiss' }),
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_style_bad', kind: 'generate-design', payload: { designStyle: 'vibes' }, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('Design style: SWISS');
  });

  it('STYLE_GUIDANCE stays in sync with the panel DESIGN_STYLES vocabulary', async () => {
    const { DESIGN_STYLES } = await import(
      '../../../packages/uxfactory-plugin/ui/lib/design-styles.js'
    );
    expect(Object.keys(STYLE_GUIDANCE).sort()).toEqual(
      DESIGN_STYLES.map((s: { value: string }) => s.value).sort(),
    );
  });

  it('generate-design: no designStyle → no style note, rubric untouched (legacy)', async () => {
    await writeFile(
      path.join(projectRoot, 'uxfactory.classification.json'),
      JSON.stringify({ category: 'marketing' }),
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_style_none', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).not.toContain('Design style:');
    const rubric = await readFile(path.join(projectRoot, '.uxfactory', 'craft-rubric.md'), 'utf8');
    expect(rubric).not.toContain('Design style conformance');
  });

  it('generate-design: empty payload (legacy) adds no request/scope/platform lines', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    await runGenerative(
      { id: 'pr_unit_legacy', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).not.toContain('USER REQUEST');
    expect(user).not.toContain('Scope:');
    expect(user).not.toContain('Target platforms');
  });

  it('generate-design: ensures the skill grant covers Read (the loop reads report.json + inputs)', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    await runGenerative(
      { id: 'pr_grant', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    const settings = JSON.parse(
      await readFile(path.join(projectRoot, '.claude', 'settings.json'), 'utf8'),
    ) as { permissions: { allow: string[] } };
    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining(['Bash(uxfactory:*)', 'Write', 'Edit', 'Read']),
    );
  });

  it('generate-design: provisions inputs.screens + inputs.trace so the agent batch selects HTML mode', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    // No screens/ dir and no trace.json exist yet — the loop authors them AFTER
    // this call. The registration must be unconditional (bypass the existence gate).
    await runGenerative(
      { id: 'pr_reg', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    const reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { inputs: Record<string, unknown> };
    expect(reg.inputs.screens).toBe('design/screens');
    expect(reg.inputs.trace).toBe('design/trace.json');
  });

  it('generate-design: stamps the payload unitType into the registry unit field', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_reg_unit', kind: 'generate-design', payload: { unitType: 'atom' }, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { unit?: string };
    expect(reg.unit).toBe('atom');
  });

  it('generate-design: stamps registry viewports from platforms + viewportSizes', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      {
        id: 'pr_reg_vps',
        kind: 'generate-design',
        payload: {
          unitType: 'page',
          platforms: ['desktop', 'mobile-landscape', 'tablet'],
          viewportSizes: { desktop: '1920x1080', tablet: '768x1024', mobile: '430x932' },
        },
        createdAt: 1,
      },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { viewports?: unknown };
    expect(reg.viewports).toEqual([
      { name: 'desktop', width: 1920, height: 1080 },
      // landscape token swaps the configured mobile size
      { name: 'mobile-landscape', width: 932, height: 430 },
      // bare token, portrait, straight from viewportSizes
      { name: 'tablet', width: 768, height: 1024 },
    ]);
  });

  it('generate-design: platforms without viewportSizes use the conventional defaults', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_reg_vp_default', kind: 'generate-design', payload: { platforms: ['mobile'] }, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { viewports?: unknown };
    expect(reg.viewports).toEqual([{ name: 'mobile', width: 390, height: 844 }]);
  });

  it('generate-design: channel units stamp their fixed canvas as the sole viewport', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      {
        id: 'pr_reg_canvas',
        kind: 'generate-design',
        payload: { unitType: 'instagram-story', platforms: ['desktop', 'mobile'] },
        createdAt: 1,
      },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { viewports?: unknown };
    expect(reg.viewports).toEqual([{ name: 'canvas', width: 1080, height: 1920 }]);
  });

  it('generate-design: empty payload clears stale registry viewports', async () => {
    await writeFile(
      path.join(projectRoot, 'uxfactory.batch.json'),
      JSON.stringify({
        version: 1,
        inputs: {},
        viewports: [{ name: 'stale', width: 111, height: 222 }],
      }),
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_reg_vp_stale', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    const reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { viewports?: unknown };
    expect(reg.viewports).toBeUndefined();
  });

  it('generate-design: clears a stale unit on unit-less payloads; never stamps unknown types', async () => {
    // Seed a stale unit as if a previous atom run left it behind.
    await writeFile(
      path.join(projectRoot, 'uxfactory.batch.json'),
      JSON.stringify({ version: 1, inputs: {}, unit: 'atom' }),
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_reg_stale', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      new FakeBridge(),
      ctx(),
    );
    let reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { unit?: string };
    expect(reg.unit).toBeUndefined();

    // An unknown unitType must not be stamped — it would fail the CLI's
    // registry validation and turn the agent's every batch run into a setup error.
    const adapter2 = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    await runGenerative(
      { id: 'pr_reg_unknown', kind: 'generate-design', payload: { unitType: 'widget' }, createdAt: 1 },
      adapter2,
      new FakeBridge(),
      ctx(),
    );
    reg = JSON.parse(
      await readFile(path.join(projectRoot, 'uxfactory.batch.json'), 'utf8'),
    ) as { unit?: string };
    expect(reg.unit).toBeUndefined();
  });

  it('generate-design: forwards a UXF::PROGRESS line as a structured progress event (note masked)', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'text-delta', text: 'starting work\n' },
      {
        type: 'text-delta',
        text:
          'UXF::PROGRESS {"iter":1,"phase":"gate","gate":"requirement-coverage","status":"fail",' +
          '"findings":2,"note":"2 stories uncovered sk-ant-api03-LEAK00000000"}\n',
      },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_prog', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    // the raw narration is still forwarded (we don't drop it) …
    const types = bridge.events.map((e) => (e.event as { type: string }).type);
    expect(types).toContain('text-delta');
    // … AND a structured progress event is forwarded with the parsed payload.
    const progress = bridge.events
      .map((e) => e.event as Record<string, unknown>)
      .find((e) => e['type'] === 'progress');
    expect(progress).toMatchObject({
      type: 'progress',
      iter: 1,
      phase: 'gate',
      gate: 'requirement-coverage',
      status: 'fail',
      findings: 2,
    });
    // the note is secret-masked before it reaches the panel.
    expect(progress?.['note']).not.toContain('LEAK');
    expect(progress?.['note']).toContain('sk-[redacted]');
  });

  it('generate-design: a UXF::PROGRESS marker spanning two chunks is parsed once whole', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'text-delta', text: 'UXF::PROGRESS {"iter":2,"phase":"done",' },
      { type: 'text-delta', text: '"status":"pass","findings":0,"note":"gate green"}\n' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    await runGenerative(
      { id: 'pr_span', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    const progressEvents = bridge.events
      .map((e) => e.event as Record<string, unknown>)
      .filter((e) => e['type'] === 'progress');
    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0]).toMatchObject({ iter: 2, phase: 'done', status: 'pass' });
  });

  it('a thrown RateLimitError on generate-design → status 2 (AdapterError mapped)', async () => {
    const adapter = new FakeAdapter(projectRoot, [], new RateLimitError('429 slow down'));
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_dl', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
  });

  it('shared path: a usage chunk is forwarded (flattened) AND returned in the result (generate-design)', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'text-delta', text: 'working\n' },
      { type: 'usage', usage: { inputTokens: 1200, outputTokens: 340 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_usage_d', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    // a live, flattened usage event reaches the panel feed …
    const usageEvent = bridge.events
      .map((e) => e.event as Record<string, unknown>)
      .find((e) => e['type'] === 'usage');
    expect(usageEvent).toEqual({ type: 'usage', inputTokens: 1200, outputTokens: 340 });
    // … and the final result carries the cumulative usage.
    expect(out.status).toBe(0);
    expect((out.result as { usage?: unknown }).usage).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
    });
  });

  it('shared path: usage is captured for generate-artifact too (not design-specific)', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'usage', usage: { inputTokens: 50, outputTokens: 10 } },
      { type: 'usage', usage: { inputTokens: 80, outputTokens: 25 } }, // cumulative → latest wins
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_usage_a',
        kind: 'generate-artifact',
        payload: { target: 'user-story' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    // the latest cumulative usage wins (mirrors reduceStream semantics).
    expect((out.result as { usage?: unknown }).usage).toEqual({
      inputTokens: 80,
      outputTokens: 25,
    });
    const usageEvents = bridge.events
      .map((e) => e.event as Record<string, unknown>)
      .filter((e) => e['type'] === 'usage');
    expect(usageEvents).toEqual([
      { type: 'usage', inputTokens: 50, outputTokens: 10 },
      { type: 'usage', inputTokens: 80, outputTokens: 25 },
    ]);
  });

  it('omits usage gracefully when the runtime reports none', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'text-delta', text: 'no usage here' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_no_usage', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(out.result, 'usage')).toBe(false);
    expect(bridge.events.some((e) => (e.event as { type: string }).type === 'usage')).toBe(false);
  });

  it('reads the written artifact file and attaches per-item refs (2 stories → 2 artifacts)', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();
    // The skill would WRITE this file during the run; simulate it landing at the
    // resolved path (the read happens after the stream completes).
    await mkdir(path.join(projectRoot, 'design'), { recursive: true });
    await writeFile(
      path.join(projectRoot, 'design', 'stories.json'),
      JSON.stringify({
        stories: [
          { id: 'story-1', goal: 'see home' },
          { id: 'story-2', goal: 'check out' },
        ],
      }),
      'utf8',
    );

    const out = await runGenerative(
      {
        id: 'pr_seed',
        kind: 'generate-artifact',
        payload: { target: 'user-story', path: 'design/stories.json' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    expect(out.result).toMatchObject({ artifactPath: 'design/stories.json' });
    // per-item refs the panel seeds downstream jobs from.
    expect((out.result as { artifacts: unknown }).artifacts).toEqual([
      { ref: 'story-1', title: 'see home' },
      { ref: 'story-2', title: 'check out' },
    ]);
  });

  it('an ABSENT artifact file omits `artifacts` gracefully but keeps { content, artifactPath }', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();
    // No file is written at the resolved path → the post-stream read fails.

    const out = await runGenerative(
      {
        id: 'pr_absent',
        kind: 'generate-artifact',
        payload: { target: 'user-story', path: 'design/stories.json' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    expect(out.result).toMatchObject({ content: '', artifactPath: 'design/stories.json' });
    // graceful: a missing/unreadable file omits `artifacts` entirely (no throw).
    expect(Object.prototype.hasOwnProperty.call(out.result, 'artifacts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generative root gate (spec 2026-07-11-product-brief-root-gate)
// ---------------------------------------------------------------------------

describe('generative root gate (spec 2026-07-11-product-brief-root-gate)', () => {
  let projectRoot: string;
  beforeEach(async () => {
    // Bare tmp root — NO default brief (unlike the `runGenerative` describe
    // above) so every case controls its own brief-presence fixture.
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-gate-'));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const ctx = (): DispatchCtx => ({ projectRoot, cliBin: 'uxfactory' });

  it('generate-artifact for a non-brief artifact refuses when no brief exists anywhere', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_gate_missing',
        kind: 'generate-artifact',
        payload: { artifact: 'audience', guidance: 'x' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
    expect((out.result as { error: string }).error).toContain('no product brief found');
    expect(adapter.lastInput).toBeNull();
  });

  it('gate passes when the canonical .uxfactory/artifacts/brief.md is non-empty', async () => {
    await mkdir(path.join(projectRoot, '.uxfactory', 'artifacts'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.uxfactory', 'artifacts', 'brief.md'),
      '# Acme\nBrief.',
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_gate_canonical',
        kind: 'generate-artifact',
        payload: { artifact: 'audience', guidance: 'x' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(adapter.lastInput).not.toBeNull();
    expect(out.status).toBe(0);
  });

  it('gate passes when the brief exists only at the legacy design/brief.md path', async () => {
    await mkdir(path.join(projectRoot, 'design'), { recursive: true });
    await writeFile(path.join(projectRoot, 'design', 'brief.md'), '# Acme\nBrief.', 'utf8');
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_gate_legacy',
        kind: 'generate-artifact',
        payload: { artifact: 'audience', guidance: 'x' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(adapter.lastInput).not.toBeNull();
    expect(out.status).toBe(0);
  });

  it('a whitespace-only brief.md does not satisfy the gate', async () => {
    await mkdir(path.join(projectRoot, '.uxfactory', 'artifacts'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.uxfactory', 'artifacts', 'brief.md'),
      '   \n\t  \n',
      'utf8',
    );
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_gate_whitespace',
        kind: 'generate-artifact',
        payload: { artifact: 'audience', guidance: 'x' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
    expect((out.result as { error: string }).error).toContain('no product brief found');
    expect(adapter.lastInput).toBeNull();
  });

  it('generate-artifact artifact:brief without answers is refused (never invents the brief)', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_gate_brief_no_answers',
        kind: 'generate-artifact',
        payload: { artifact: 'brief', guidance: 'x' },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(2);
    expect((out.result as { error: string }).error).toContain('must be user-authored');
    expect(adapter.lastInput).toBeNull();
  });

  it('generate-artifact artifact:brief with user answers passes the gate and weaves them into the prompt', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      {
        id: 'pr_gate_brief_answers',
        kind: 'generate-artifact',
        payload: {
          artifact: 'brief',
          guidance: 'x',
          answers: {
            problem: 'Ops teams drown in spreadsheets',
            outcomes: '',
            'out-of-scope': '',
            constraints: '',
          },
        },
        createdAt: 1,
      },
      adapter,
      bridge,
      ctx(),
    );

    expect(out.status).toBe(0);
    expect(adapter.lastInput).not.toBeNull();
    const user = adapter.lastInput?.messages[0]?.content as string;
    expect(user).toContain('Ops teams drown in spreadsheets');
    expect(user).toContain('do not add claims the user did not make');
  });

  it('generate-design is never gated by the brief root gate (own grounding-chip semantics)', async () => {
    const adapter = new FakeAdapter(projectRoot, [{ type: 'message-stop', finishReason: 'stop' }]);
    const bridge = new FakeBridge();

    const out = await runGenerative(
      { id: 'pr_gate_design', kind: 'generate-design', payload: {}, createdAt: 1 },
      adapter,
      bridge,
      ctx(),
    );

    expect(adapter.lastInput).not.toBeNull();
    expect(out.status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSkillPermissions (approach A — idempotent + scoped grant)
// ---------------------------------------------------------------------------

describe('ensureSkillPermissions', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-perm-'));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const settingsPath = (): string => path.join(projectRoot, '.claude', 'settings.json');

  it('writes the least grant to <projectRoot>/.claude/settings.json, idempotently', async () => {
    const file = await ensureSkillPermissions(projectRoot);
    expect(file).toBe(settingsPath());

    const s1 = JSON.parse(await readFile(file, 'utf8')) as {
      permissions: { allow: string[] };
    };
    expect(s1.permissions.allow).toEqual(
      expect.arrayContaining(['Bash(uxfactory:*)', 'Write', 'Edit', 'Read']),
    );
    const len = s1.permissions.allow.length;

    // second call adds no duplicates
    await ensureSkillPermissions(projectRoot);
    const s2 = JSON.parse(await readFile(file, 'utf8')) as { permissions: { allow: string[] } };
    expect(s2.permissions.allow).toHaveLength(len);
  });

  it('merges into an existing user file without clobbering unrelated keys', async () => {
    await ensureSkillPermissions(projectRoot); // create the dir
    await writeFile(
      settingsPath(),
      JSON.stringify({
        env: { FOO: 'bar' },
        permissions: { allow: ['Read'], deny: ['Bash(rm:*)'] },
      }),
    );

    await ensureSkillPermissions(projectRoot);

    const s = JSON.parse(await readFile(settingsPath(), 'utf8')) as {
      env: Record<string, string>;
      permissions: { allow: string[]; deny: string[] };
    };
    expect(s.env).toEqual({ FOO: 'bar' }); // unrelated top-level key preserved
    expect(s.permissions.deny).toEqual(['Bash(rm:*)']); // unrelated perms key preserved
    expect(s.permissions.allow).toEqual(
      expect.arrayContaining(['Read', 'Bash(uxfactory:*)', 'Write', 'Edit']),
    );
  });
});

// ---------------------------------------------------------------------------
// WorkerBridgeClient against an in-process http bridge
// ---------------------------------------------------------------------------

describe('WorkerBridgeClient (http)', () => {
  let fake: FakeServer;
  beforeEach(async () => {
    fake = await startFakeBridge();
  });
  afterEach(async () => {
    await fake.close();
  });

  it('pullRequest: 204 → null, 200 → the request', async () => {
    const client = new WorkerBridgeClient(fake.url);
    expect(await client.pullRequest()).toBeNull();

    fake.state.queue.push({ id: 'pr_1', kind: 'classify', payload: { a: 1 }, createdAt: 9 });
    const req = await client.pullRequest();
    expect(req).toEqual({ id: 'pr_1', kind: 'classify', payload: { a: 1 }, createdAt: 9 });
  });

  it('postResult + postEvent send the documented body shapes', async () => {
    const client = new WorkerBridgeClient(fake.url);
    await client.postResult('pr_1', 0, { ok: true });
    await client.postEvent('pr_1', { type: 'text-delta', text: 'hi' });
    expect(fake.state.results[0]).toEqual({ id: 'pr_1', status: 0, result: { ok: true } });
    expect(fake.state.events[0]).toEqual({
      requestId: 'pr_1',
      event: { type: 'text-delta', text: 'hi' },
    });
  });

  it('subscribeEvents: fires onWake on a broadcast data frame; unsubscribe stops it', async () => {
    const client = new WorkerBridgeClient(fake.url);
    let wakes = 0;
    const unsub = client.subscribeEvents(() => {
      wakes += 1;
    });
    // wait until the SSE client is registered server-side
    await waitFor(() => fake.state.sse.length >= 1);
    await client.postEvent('pr_live', { type: 'message-stop' });
    await waitFor(() => wakes >= 1);
    expect(wakes).toBeGreaterThanOrEqual(1);
    unsub();
  });

  it('pullRequest appends ?root= when a projectRoot is set', async () => {
    const seenUrls: string[] = [];
    const server = http.createServer((req, res) => {
      seenUrls.push(req.url ?? '');
      if (req.url?.startsWith('/pipeline/request/next')) {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const client = new WorkerBridgeClient(`http://127.0.0.1:${port}`, '/repo/alpha');
      expect(await client.pullRequest()).toBeNull();
      const pollUrl = seenUrls.find((u) => u.startsWith('/pipeline/request/next'))!;
      expect(pollUrl).toContain(`root=${encodeURIComponent('/repo/alpha')}`);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('two pollers on different roots never claim each other\'s job', async () => {
    // Per-root FIFO queues keyed by the ?root= query param.
    const queues: Record<string, { id: string; kind: string; payload: unknown; createdAt: number; root: string }[]> = {
      '/repo/alpha': [{ id: 'a1', kind: 'k', payload: {}, createdAt: 1, root: '/repo/alpha' }],
      '/repo/beta': [{ id: 'b1', kind: 'k', payload: {}, createdAt: 1, root: '/repo/beta' }],
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://x');
      if (url.pathname === '/pipeline/request/next') {
        const root = url.searchParams.get('root') ?? '';
        const job = queues[root]?.shift() ?? null;
        if (job === null) { res.writeHead(204).end(); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(job));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const alpha = new WorkerBridgeClient(`http://127.0.0.1:${port}`, '/repo/alpha');
      const beta = new WorkerBridgeClient(`http://127.0.0.1:${port}`, '/repo/beta');
      const gotAlpha = await alpha.pullRequest();
      const gotBeta = await beta.pullRequest();
      expect(gotAlpha?.id).toBe('a1');
      expect(gotAlpha?.root).toBe('/repo/alpha');
      expect(gotBeta?.id).toBe('b1');
      // Neither claimed the other's remaining work.
      expect(await alpha.pullRequest()).toBeNull();
      expect(await beta.pullRequest()).toBeNull();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('subscribeEvents tags the URL with client=worker, root, and kinds', async () => {
    const seenUrls: string[] = [];
    const server = http.createServer((req, res) => {
      seenUrls.push(req.url ?? '');
      if (req.url?.startsWith('/pipeline/events')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return; // keep the stream open
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const client = new WorkerBridgeClient(
        `http://127.0.0.1:${port}`,
        '/repo/alpha',
        ['generate-artifact', 'validate'],
      );
      const unsub = client.subscribeEvents(() => {});
      await waitFor(() => seenUrls.some((u) => u.startsWith('/pipeline/events')));
      unsub();
      const url = new URL(seenUrls.find((u) => u.startsWith('/pipeline/events'))!, 'http://x');
      expect(url.searchParams.get('client')).toBe('worker');
      expect(url.searchParams.get('root')).toBe('/repo/alpha');
      expect(url.searchParams.get('kinds')).toBe('generate-artifact,validate');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('subscribeEvents omits root and kinds when unset (legacy compat)', async () => {
    const seenUrls: string[] = [];
    const server = http.createServer((req, res) => {
      seenUrls.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const client = new WorkerBridgeClient(`http://127.0.0.1:${port}`);
      const unsub = client.subscribeEvents(() => {});
      await waitFor(() => seenUrls.length >= 1);
      unsub();
      const url = new URL(seenUrls[0]!, 'http://x');
      expect(url.searchParams.get('client')).toBe('worker');
      expect(url.searchParams.has('root')).toBe(false);
      expect(url.searchParams.has('kinds')).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// ---------------------------------------------------------------------------
// runWorker end-to-end (http bridge + stub CLI)
// ---------------------------------------------------------------------------

describe('runWorker (end-to-end)', () => {
  let fake: FakeServer;
  let projectRoot: string;
  let binDir: string;

  beforeEach(async () => {
    fake = await startFakeBridge();
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-e2e-'));
    binDir = await mkdtemp(path.join(os.tmpdir(), 'uxf-worker-e2ebin-'));
  });
  afterEach(async () => {
    await fake.close();
    await rm(projectRoot, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  it('drains a queued classify request on start and posts the result', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(bin, 0, JSON.stringify({ confirm_status: 'draft' }));
    fake.state.queue.push({ id: 'pr_e2e', kind: 'classify', payload: {}, createdAt: 1 });

    const bridge = new WorkerBridgeClient(fake.url);
    const stop = runWorker({
      bridge,
      ctx: { projectRoot, cliBin: bin },
      generative: async () => ({ status: 2, result: {} }),
    });

    await waitFor(() => fake.state.results.length >= 1);
    stop();

    expect(fake.state.results[0]).toMatchObject({ id: 'pr_e2e', status: 0 });
    expect(fake.state.results[0]!.result).toEqual({ confirm_status: 'draft' });
  });

  it('wakes via SSE on a request enqueued while IDLE and drains it', async () => {
    const bin = path.join(binDir, 'uxfactory.cjs');
    await writeStubCli(bin, 0, JSON.stringify({ confirm_status: 'draft' }));

    // Start with an EMPTY queue: the initial tick drains to 204 and the worker
    // goes idle, leaving the SSE wake frame as the only way to pick up new work.
    const bridge = new WorkerBridgeClient(fake.url);
    const stop = runWorker({
      bridge,
      ctx: { projectRoot, cliBin: bin },
      generative: async () => ({ status: 2, result: {} }),
    });

    // Wait until the worker's SSE stream is connected (so the wake frame can land)
    // and confirm the initial drain found nothing.
    await waitFor(() => fake.state.sse.length >= 1);
    expect(fake.state.results).toHaveLength(0);

    // Enqueue AFTER the worker is idle — only the broadcast wake frame can trigger
    // the drain that picks this up.
    const enqueued = await fetch(`${fake.url}/pipeline/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'classify', payload: {} }),
    });
    const { id } = (await enqueued.json()) as { id: string };

    await waitFor(() => fake.state.results.length >= 1);
    stop();

    expect(fake.state.results[0]).toMatchObject({ id, status: 0 });
    expect(fake.state.results[0]!.result).toEqual({ confirm_status: 'draft' });
  });

  it('flows a generate-artifact request → event → result via the FAKE adapter', async () => {
    const adapter = new FakeAdapter(projectRoot, [
      { type: 'text-delta', text: 'wrote the artifact' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    fake.state.queue.push({
      id: 'pr_gen_e2e',
      kind: 'generate-artifact',
      payload: { target: 'user-journey', path: 'design/flow.json' },
      createdAt: 1,
    });

    const bridge = new WorkerBridgeClient(fake.url);
    const ctx: DispatchCtx = { projectRoot, cliBin: 'uxfactory' };
    const stop = runWorker({
      bridge,
      ctx,
      generative: (req) => runGenerative(req, adapter, bridge, ctx),
    });

    await waitFor(() => fake.state.results.length >= 1);
    stop();

    // request → result
    expect(fake.state.results[0]).toMatchObject({ id: 'pr_gen_e2e', status: 0 });
    expect((fake.state.results[0]!.result as { artifactPath: string }).artifactPath).toBe(
      'design/flow.json',
    );
    // request → event (the text-delta reached the bridge as a relayed event)
    expect(fake.state.events.some((e) => (e.event as { type: string }).type === 'text-delta')).toBe(
      true,
    );
  });
});
