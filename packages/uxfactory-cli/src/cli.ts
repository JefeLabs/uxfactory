#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { consoleIO } from "./io.js";
import { EXIT } from "./exit.js";
import { BridgeClient } from "./client.js";
import { lintCmd } from "./commands/lint.js";
import { verifyCmd } from "./commands/verify.js";
import { publishCmd } from "./commands/publish.js";
import { selectionCmd } from "./commands/selection.js";
import { scanCmd } from "./commands/scan.js";
import { bridgeCmd } from "./commands/bridge.js";
import { stubCmd } from "./commands/stub.js";

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
      const { code } = await bridgeCmd(
        {
          ...(opts.port !== undefined ? { port: Number(opts.port) } : {}),
          dataDir: resolveDataDir(opts.dataDir),
        },
        consoleIO,
      );
      // Do NOT close — foreground the relay (the open server keeps the process alive).
      if (code !== EXIT.OK) process.exit(code);
    });

  program
    .command("lint <spec>")
    .description("Validate a spec against the schema; renders nothing")
    .option("--json", "machine-readable output")
    .action(async (spec: string, opts: { json?: boolean }) => {
      process.exit(await lintCmd(spec, { json: opts.json }, consoleIO));
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
        process.exit(
          await publishCmd(
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
          ),
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
        process.exit(
          await verifyCmd(
            spec,
            { tolerance: opts.tolerance, render: opts.render, json: opts.json },
            consoleIO,
            client,
          ),
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
      process.exit(await selectionCmd({ json: opts.json }, consoleIO, client));
    });

  program
    .command("scan")
    .description("Materialize the asset catalog from a committed uxfactory.assets.json")
    .option("--json", "machine-readable output")
    .option("--data-dir <path>", "data directory")
    .action(async (opts: { json?: boolean; dataDir?: string }) => {
      process.exit(
        await scanCmd({ dataDir: resolveDataDir(opts.dataDir), json: opts.json }, consoleIO),
      );
    });

  const stubs: ReadonlyArray<readonly [name: string, phase: string, desc: string]> = [
    ["map", "4", "Maintain the component map (scaffold/check)"],
    ["drift", "4", "Detect spec-vs-reality drift"],
    ["render", "5", "Render a spec to an image offline"],
    ["batch", "6", "Offline batch mode"],
    ["review", "7", "Conformance review"],
    ["snapshot", "roadmap", "Pull current canvas state back into a spec"],
  ];
  for (const [name, phase, desc] of stubs) {
    program
      .command(name)
      .description(`${desc} (not yet implemented)`)
      .argument("[args...]", "ignored until implemented")
      .allowUnknownOption(true)
      .action(() => {
        process.exit(stubCmd(name, phase, consoleIO));
      });
  }

  return program;
}

/** Parse argv and run the matched command (commander expects node + script in argv). */
export async function run(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv);
}

run(process.argv).catch((err: unknown) => {
  consoleIO.err(err instanceof Error ? err.message : String(err));
  process.exit(EXIT.TRANSPORT);
});
