import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { shouldSync, buildSyncCommand, main as syncMain } from "../scripts/sync-on-edit.mjs";
import {
  buildDriftCommand,
  formatDriftContext,
  main as driftMain,
} from "../scripts/drift-notify.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

describe("hooks.json", () => {
  it("wires PostToolUse(Write|Edit) → sync-on-edit and SessionStart → drift-notify", async () => {
    const hooks = JSON.parse(await readFile(`${pkgRoot}hooks/hooks.json`, "utf8"));
    const post = hooks.hooks.PostToolUse[0];
    expect(post.matcher).toBe("Write|Edit");
    expect(post.hooks[0].type).toBe("command");
    expect(post.hooks[0].command).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(post.hooks[0].command).toContain("scripts/sync-on-edit.mjs");
    const start = hooks.hooks.SessionStart[0];
    expect(start.hooks[0].type).toBe("command");
    expect(start.hooks[0].command).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(start.hooks[0].command).toContain("scripts/drift-notify.mjs");
  });
});

describe("shouldSync", () => {
  it("matches only *.uxfactory.json", () => {
    expect(shouldSync("deployment.uxfactory.json")).toBe(true);
    expect(shouldSync("/abs/path/x.uxfactory.json")).toBe(true);
    expect(shouldSync("x.json")).toBe(false);
    expect(shouldSync("x.uxfactoryXjson")).toBe(false);
    expect(shouldSync("uxfactory.json")).toBe(false);
  });
});

describe("command builders", () => {
  it("buildSyncCommand returns the publish --verify invocation", () => {
    expect(buildSyncCommand("a.uxfactory.json")).toEqual([
      "uxfactory",
      "publish",
      "--verify",
      "a.uxfactory.json",
    ]);
  });
  it("buildDriftCommand returns the drift --json invocation", () => {
    expect(buildDriftCommand()).toEqual(["uxfactory", "drift", "--json"]);
  });
});

describe("formatDriftContext", () => {
  it("reports clean when there are no findings", () => {
    expect(formatDriftContext({ findings: [] })).toContain("no drift");
    expect(formatDriftContext(null)).toContain("no drift report");
  });
  it("lists findings when present", () => {
    const ctx = formatDriftContext({
      findings: [{ component: "api-gateway", kind: "deleted-but-diagrammed" }],
    });
    expect(ctx).toContain("api-gateway");
    expect(ctx).toContain("deleted-but-diagrammed");
  });
});

describe("import guard", () => {
  it("importing the hook modules does not execute main()", () => {
    // If main() ran on import, sync's readStdin() would attach to process.stdin
    // and hang the worker, and both would spawn the CLI. Reaching this assertion
    // (the suite did not hang) proves the modules imported inertly.
    expect(typeof syncMain).toBe("function");
    expect(typeof driftMain).toBe("function");
  });
});
