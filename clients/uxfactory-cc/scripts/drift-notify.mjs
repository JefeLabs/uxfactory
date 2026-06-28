import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The CLI invocation that reports spec-vs-reality drift as JSON. */
export function buildDriftCommand() {
  return ["uxfactory", "drift", "--json"];
}

/** Turn a `uxfactory drift --json` result into SessionStart additionalContext. */
export function formatDriftContext(result) {
  if (!result || typeof result !== "object") {
    return "UXFactory drift check: no drift report available.";
  }
  const findings = Array.isArray(result.findings) ? result.findings : [];
  if (findings.length === 0) {
    return "UXFactory drift check: no drift detected — diagrams match their sources.";
  }
  const lines = findings.map(
    (f) =>
      `- ${f.component ?? f.node ?? "(unknown)"}: ${f.kind ?? "drift"}${f.detail ? ` — ${f.detail}` : ""}`,
  );
  return [
    `UXFactory drift check: ${findings.length} finding(s) — diagrams may be stale:`,
    ...lines,
    "Ask the user whether to re-render and verify the affected specs.",
  ].join("\n");
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
    }),
  );
}

export async function main() {
  const [cmd, ...args] = buildDriftCommand();
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  // `uxfactory drift` is a stub until Phase 4; stay silent if the CLI is
  // unavailable (exit/spawn error) or reports a transport/setup error (exit 2).
  if (res.error || res.status === 2) return;
  let result = null;
  try {
    result = JSON.parse(res.stdout || "null");
  } catch {
    result = null;
  }
  emit(formatDriftContext(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(String(err?.stack ?? err));
    process.exit(1);
  });
}
