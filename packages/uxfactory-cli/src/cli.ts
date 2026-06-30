#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { consoleIO } from "./io.js";
import { EXIT } from "./exit.js";
import { BridgeClient } from "./client.js";
import { lintCmd } from "./commands/lint.js";
import { verifyCmd } from "./commands/verify.js";
import { publishCmd } from "./commands/publish.js";
import { selectionCmd } from "./commands/selection.js";
import { scanCmd } from "./commands/scan.js";
import { stubCmd } from "./commands/stub.js";
import { mapScaffoldCmd, mapCheckCmd } from "./commands/map.js";
import { driftCmd } from "./commands/drift.js";
import { batchCmd } from "./commands/batch.js";
import { reviewCmd } from "./commands/review.js";
import { classifyCmd } from "./commands/classify.js";
import { canvasFetchCmd, canvasPostCmd } from "./commands/canvas.js";
// renderCmd and bridgeCmd are lazy-loaded inside their actions
// (renderCmd avoids pulling in @resvg/resvg-js native binding on every CLI call;
//  bridgeCmd avoids pulling in fastify on every call)

/** Module-scoped state reset by every run() call. */
let lastCode: number = EXIT.OK;
let foreground: boolean = false;

/** Resolve the bridge base URL: --bridge, else UXFACTORY_PORT, else the 127.0.0.1 default. */
function resolveBridgeUrl(opt?: string): string {
  if (opt !== undefined) return opt;
  if (process.env.UXFACTORY_PORT !== undefined) {
    return `http://127.0.0.1:${process.env.UXFACTORY_PORT}`;
  }
  return "http://127.0.0.1:3779";
}

/** Resolve the data dir: --data-dir (resolved), else <cwd>/.uxfactory. */
function resolveDataDir(opt?: string): string {
  return opt !== undefined ? path.resolve(opt) : path.resolve(process.cwd(), ".uxfactory");
}

/** Build the commander program wiring every command to its action function. */
export function buildProgram(): Command {
  const program = new Command();
  // exitOverride() must be set BEFORE .command() calls so subcommands inherit
  // _exitCallback via copyInheritedSettings(). This maps all commander usage
  // errors (unknown cmd, missing arg, unknown option) to throws instead of
  // process.exit(1), allowing run() to remap them to EXIT.TRANSPORT (2).
  program.exitOverride();
  program
    .name("uxfactory")
    .description("Render and verify structured Figma/FigJam diagrams from JSON specs")
    .version("0.0.0");

  program
    .command("bridge")
    .description("Start the localhost relay and keep it open")
    .option("--port <port>", "port to listen on (default 3779 or UXFACTORY_PORT)")
    .option("--data-dir <path>", "data directory (default <cwd>/.uxfactory)")
    .action(async (opts: { port?: string; dataDir?: string }) => {
      const { bridgeCmd } = await import("./commands/bridge.js");
      const { code } = await bridgeCmd(
        {
          ...(opts.port !== undefined ? { port: Number(opts.port) } : {}),
          dataDir: resolveDataDir(opts.dataDir),
        },
        consoleIO,
      );
      if (code !== EXIT.OK) {
        lastCode = code;
      } else {
        // Foreground relay: do NOT close — the open server keeps the event loop alive.
        foreground = true;
      }
    });

  program
    .command("lint <spec>")
    .description("Validate a spec against the schema; renders nothing")
    .option("--json", "machine-readable output")
    .action(async (spec: string, opts: { json?: boolean }) => {
      lastCode = await lintCmd(spec, { json: opts.json }, consoleIO);
    });

  program
    .command("publish <spec>")
    .description("Validate and enqueue a spec for the plugin to render")
    .option("--wait", "block until the render report lands")
    .option("--verify", "after the render lands, gate it PASS/FAIL")
    .option("--tolerance <px>", "geometry epsilon for --verify")
    .option("--dry-run", "print what would be enqueued without writing")
    .option("--json", "machine-readable output")
    .option("--bridge <url>", "bridge base URL")
    .option("--data-dir <path>", "data directory")
    .action(
      async (
        spec: string,
        opts: {
          wait?: boolean;
          verify?: boolean;
          tolerance?: string;
          dryRun?: boolean;
          json?: boolean;
          bridge?: string;
          dataDir?: string;
        },
      ) => {
        const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
        lastCode = await publishCmd(
          spec,
          {
            wait: opts.wait,
            verify: opts.verify,
            tolerance: opts.tolerance,
            dryRun: opts.dryRun,
            json: opts.json,
            dataDir: resolveDataDir(opts.dataDir),
          },
          consoleIO,
          client,
        );
      },
    );

  program
    .command("verify <spec>")
    .description("Gate the latest (or a specific) render against the spec via POST /verify")
    .option("--tolerance <px>", "geometry epsilon (default 0.5)")
    .option("--render <id>", "verify against a specific render report")
    .option("--json", "machine-readable output")
    .option("--bridge <url>", "bridge base URL")
    .action(
      async (
        spec: string,
        opts: { tolerance?: string; render?: string; json?: boolean; bridge?: string },
      ) => {
        const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
        lastCode = await verifyCmd(
          spec,
          { tolerance: opts.tolerance, render: opts.render, json: opts.json },
          consoleIO,
          client,
        );
      },
    );

  program
    .command("selection")
    .description("Read the current Figma selection via GET /selection")
    .option("--json", "machine-readable output")
    .option("--bridge <url>", "bridge base URL")
    .action(async (opts: { json?: boolean; bridge?: string }) => {
      const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
      lastCode = await selectionCmd({ json: opts.json }, consoleIO, client);
    });

  program
    .command("scan")
    .description("Materialize the asset catalog from a committed uxfactory.assets.json")
    .option("--json", "machine-readable output")
    .option("--data-dir <path>", "data directory")
    .action(async (opts: { json?: boolean; dataDir?: string }) => {
      lastCode = await scanCmd(
        { dataDir: resolveDataDir(opts.dataDir), json: opts.json },
        consoleIO,
      );
    });

  const map = program.command("map").description("Maintain the component map (scaffold/check)");
  map
    .command("scaffold")
    .description("Propose component↔node links by name match into uxfactory.map.json")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      lastCode = await mapScaffoldCmd({ json: opts.json }, consoleIO);
    });
  map
    .command("check")
    .description("Verify every map entry resolves on both sides; exit 1 on a dangling entry")
    .option("--json", "machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      lastCode = await mapCheckCmd({ json: opts.json }, consoleIO);
    });

  program
    .command("drift")
    .description("Detect spec-vs-reality drift via the component map")
    .option("--json", "machine-readable output")
    .option("--bridge <url>", "bridge base URL")
    .action(async (opts: { json?: boolean; bridge?: string }) => {
      const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
      lastCode = await driftCmd({ json: opts.json }, consoleIO, client);
    });

  program
    .command("render <spec>")
    .description("Render a spec to an image offline (approximate; no Figma)")
    .option("--out <file>", "output path (.png or .svg; default <spec>.png)")
    .action(async (spec: string, opts: { out?: string }) => {
      const { renderCmd } = await import("./commands/render.js");
      lastCode = await renderCmd(spec, { out: opts.out }, consoleIO);
    });

  program
    .command("batch <dir>")
    .description(
      "Offline batch mode: gate a set of specs against registered inputs, then stage (§13)",
    )
    .option("--json", "machine-readable output")
    .option("--stage", "on a clean batch, stage it to the bridge for approval")
    .option("--data-dir <path>", "data directory (default <cwd>/.uxfactory)")
    .option("--bridge <url>", "bridge base URL")
    .option(
      "--scope <preset>",
      "render scope preset (wireframe|content|visual|interactive|production)",
    )
    .option("--visual <level>", "visual dial override (low|medium|high)")
    .option("--editorial <level>", "editorial dial override (low|medium|high)")
    .option("--coverage <level>", "coverage dial override (low|medium|high)")
    .option("--flow <level>", "flow dial override (low|medium|high)")
    .action(
      async (
        dir: string,
        opts: {
          json?: boolean;
          stage?: boolean;
          dataDir?: string;
          bridge?: string;
          scope?: string;
          visual?: string;
          editorial?: string;
          coverage?: string;
          flow?: string;
        },
      ) => {
        const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
        lastCode = await batchCmd(
          dir,
          {
            json: opts.json,
            stage: opts.stage,
            dataDir: resolveDataDir(opts.dataDir),
            cwd: process.cwd(),
            scope: opts.scope,
            visual: opts.visual,
            editorial: opts.editorial,
            coverage: opts.coverage,
            flow: opts.flow,
          },
          consoleIO,
          client,
        );
      },
    );

  program
    .command("classify")
    .description(
      "Derive a GateProfile from uxfactory.classification.json; --confirm pins it (§6.6)",
    )
    .option("--confirm", "pin the profile as approved (the compute-commit boundary)")
    .option("--json", "emit the GateProfile as JSON to stdout")
    .action(async (opts: { confirm?: boolean; json?: boolean }) => {
      lastCode = await classifyCmd(
        {
          confirm: opts.confirm,
          json: opts.json,
          cwd: process.cwd(),
        },
        consoleIO,
      );
    });

  program
    .command("review <design>")
    .description(
      "Conformance review: assess whether a design satisfies its registered requirements (§14)",
    )
    .option("--json", "machine-readable output")
    .option(
      "--scope <preset>",
      "render scope preset (wireframe|content|visual|interactive|production); default: interactive",
    )
    .option("--visual <level>", "visual dial override (low|medium|high)")
    .option("--editorial <level>", "editorial dial override (low|medium|high)")
    .option("--coverage <level>", "coverage dial override (low|medium|high)")
    .option("--flow <level>", "flow dial override (low|medium|high)")
    .option("--data-dir <path>", "data directory (unused; kept for flag parity with batch)")
    .option(
      "--annotate",
      "post the conformance report to the bridge for in-Figma annotation (§7.8)",
    )
    .option(
      "--best-effort",
      "label the review as best-effort (auto-set for canvas-inferred snapshots, §14.2)",
    )
    .option("--bridge <url>", "bridge base URL")
    .action(
      async (
        design: string,
        opts: {
          json?: boolean;
          scope?: string;
          visual?: string;
          editorial?: string;
          coverage?: string;
          flow?: string;
          dataDir?: string;
          annotate?: boolean;
          bestEffort?: boolean;
          bridge?: string;
        },
      ) => {
        const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
        lastCode = await reviewCmd(
          design,
          {
            json: opts.json,
            scope: opts.scope,
            visual: opts.visual,
            editorial: opts.editorial,
            coverage: opts.coverage,
            flow: opts.flow,
            dataDir: opts.dataDir !== undefined ? resolveDataDir(opts.dataDir) : undefined,
            cwd: process.cwd(),
            annotate: opts.annotate,
            bestEffort: opts.bestEffort,
          },
          consoleIO,
          client,
        );
      },
    );

  // ---- canvas command group (§14.2 best-effort vision review) ----
  const canvas = program
    .command("canvas")
    .description("Canvas review relay commands (fetch pending request / post report)");

  canvas
    .command("fetch")
    .description(
      "Fetch the pending canvas review request from the bridge and write snapshot.json + screenshot.png",
    )
    .option("--bridge <url>", "bridge base URL")
    .option("--out <dir>", "output directory (default: cwd)")
    .action(async (opts: { bridge?: string; out?: string }) => {
      const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
      lastCode = await canvasFetchCmd({ out: opts.out }, consoleIO, client);
    });

  canvas
    .command("post <report>")
    .description(
      "Post a ReviewReport JSON file to the bridge /review endpoint (plugin annotates canvas)",
    )
    .option("--bridge <url>", "bridge base URL")
    .action(async (report: string, opts: { bridge?: string }) => {
      const client = new BridgeClient(resolveBridgeUrl(opts.bridge));
      lastCode = await canvasPostCmd(report, consoleIO, client);
    });

  const stubs: ReadonlyArray<readonly [name: string, phase: string, desc: string]> = [
    ["snapshot", "roadmap", "Pull current canvas state back into a spec"],
  ];
  for (const [name, phase, desc] of stubs) {
    program
      .command(name)
      .description(`${desc} (not yet implemented)`)
      .argument("[args...]", "ignored until implemented")
      .allowUnknownOption(true)
      .action(() => {
        lastCode = stubCmd(name, phase, consoleIO);
      });
  }

  return program;
}

/**
 * Parse argv and run the matched command.
 * Returns the exit code, or "foreground" when the bridge server is running
 * (caller must NOT call process.exit so the event loop stays alive).
 *
 * Commander usage errors (unknown command, missing arg, unknown option) are
 * mapped to EXIT.TRANSPORT (2) via exitOverride(), keeping them distinct from
 * EXIT.GATE_FAIL (1) per PRD §5.3.
 */
export async function run(argv: string[]): Promise<number | "foreground"> {
  lastCode = EXIT.OK;
  foreground = false;
  const program = buildProgram(); // exitOverride already applied inside buildProgram
  try {
    await program.parseAsync(argv);
  } catch (err) {
    const e = err as { exitCode?: number };
    // exitCode 0 = --help / --version (successful output, then "exit"); otherwise transport error
    return e.exitCode === 0 ? EXIT.OK : EXIT.TRANSPORT;
  }
  return foreground ? "foreground" : lastCode;
}

// Guard: only auto-run when this file is the entry-point, not when imported in tests.
// Canonicalize argv[1] via realpath first: when invoked through a bin symlink
// (npm/pnpm `.bin/uxfactory`, or the worker's resolveCliBin), process.argv[1] is
// the *symlink* path while import.meta.url is the realpath — a naive compare would
// make the CLI a silent no-op. realpathSync resolves the symlink so they match.
export function entryUrlMatches(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return moduleUrl === pathToFileURL(argv1).href;
  }
}
if (entryUrlMatches(process.argv[1], import.meta.url)) {
  void run(process.argv).then((r) => {
    if (r !== "foreground") process.exit(r);
  });
}
