import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SPEC_SUFFIX = ".uxfactory.json";

/** True iff the edited path is a UXFactory spec file (the sync-on-edit filter). */
export function shouldSync(filePath) {
  return typeof filePath === "string" && filePath.endsWith(SPEC_SUFFIX);
}

/** The CLI invocation that re-renders and gates a spec: publish --verify <file>. */
export function buildSyncCommand(filePath) {
  return ["uxfactory", "publish", "--verify", filePath];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function emit(systemMessage) {
  process.stdout.write(JSON.stringify({ systemMessage }));
}

export async function main() {
  let input;
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    input = {};
  }
  const filePath = input?.tool_input?.file_path;
  if (!shouldSync(filePath)) return; // not a spec edit — stay silent

  const [cmd, ...args] = buildSyncCommand(filePath);
  const res = spawnSync(cmd, args, { encoding: "utf8" });

  if (res.error || res.status === 2) {
    emit(
      `UXFactory: could not sync ${filePath} — the bridge is down or the Figma plugin is not open (run /uxfactory:bridge and open the plugin). ${
        res.stderr ?? res.error?.message ?? ""
      }`.trim(),
    );
    return;
  }
  if (res.status === 1) {
    emit(
      `UXFactory: gate FAIL after publishing ${filePath}. Review the failures and correct the spec, then re-edit.\n${res.stdout ?? ""}`.trim(),
    );
    return;
  }
  emit(`UXFactory: ${filePath} published and verified (PASS).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(String(err?.stack ?? err));
    process.exit(1);
  });
}
