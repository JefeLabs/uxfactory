/**
 * validate-artifact.ts — `uxfactory validate-artifact <key>`.
 *
 * Runs the deterministic artifact validators (@uxfactory/spec) against a
 * registered artifact: schema, cross-artifact referential integrity, and
 * computed quality (contrast). The intent-side counterpart to the design gate.
 * Reads the referential context (registered persona/story/feature ids) so
 * integrity checks resolve. Exit 0 when clean (no `error` findings), 1 when a
 * hard finding exists, 2 on setup error (unreadable/absent artifact).
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateArtifact } from "@uxfactory/spec";
import type { ValidatorContext } from "@uxfactory/spec";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";

export interface ValidateArtifactFlags {
  cwd?: string;
  json?: boolean;
}

const ARTIFACTS = ".uxfactory/artifacts";

/** Canonical path (file or set directory) for each validatable artifact key. */
const ARTIFACT_PATH: Record<string, { rel: string; set?: boolean; markdown?: boolean }> = {
  brief: { rel: `${ARTIFACTS}/brief.md`, markdown: true },
  "brand-colors": { rel: `${ARTIFACTS}/design-system.json` },
  features: { rel: `${ARTIFACTS}/features.json` },
  audience: { rel: `${ARTIFACTS}/audience.json` },
  sitemap: { rel: `${ARTIFACTS}/sitemap.json` },
  "copy-deck": { rel: `${ARTIFACTS}/content/copy-deck.json` },
  personas: { rel: `${ARTIFACTS}/personas`, set: true },
  stories: { rel: `${ARTIFACTS}/stories`, set: true },
};

/** Read a JSON file, or null. */
async function readJson(abs: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(abs, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Read a directory of `*.json` instances into an array. */
async function readSet(dirAbs: string): Promise<unknown[]> {
  try {
    const members = (await readdir(dirAbs)).filter((e) => e.endsWith(".json")).sort();
    const out: unknown[] = [];
    for (const m of members) {
      const body = await readJson(path.join(dirAbs, m));
      if (body !== null) out.push(body);
    }
    return out;
  } catch {
    return [];
  }
}

/** A section artifact (brand-colors) validates its section, not the whole file. */
function sectionOf(key: string, body: unknown): unknown {
  if (key === "brand-colors" && body !== null && typeof body === "object" && !Array.isArray(body)) {
    const section = (body as Record<string, unknown>)["brand-colors"];
    return section ?? body;
  }
  return body;
}

/** Build the referential context: the registered persona / story / feature ids. */
async function buildContext(cwd: string): Promise<ValidatorContext> {
  const personaIds = new Set(
    (await readSet(path.join(cwd, ARTIFACTS, "personas")))
      .map((p) => (typeof (p as Record<string, unknown>)?.["personaId"] === "string" ? (p as Record<string, string>)["personaId"] : null))
      .filter((id): id is string => id !== null),
  );
  const storyIds = new Set(
    (await readSet(path.join(cwd, ARTIFACTS, "stories")))
      .map((s) => {
        const o = s as Record<string, unknown>;
        return typeof o["storyId"] === "string" ? o["storyId"] : typeof o["id"] === "string" ? (o["id"] as string) : null;
      })
      .filter((id): id is string => id !== null),
  );
  const featuresDoc = await readJson(path.join(cwd, ARTIFACTS, "features.json"));
  const featureIds = new Set(
    (featuresDoc !== null && typeof featuresDoc === "object" && Array.isArray((featuresDoc as Record<string, unknown>)["features"])
      ? ((featuresDoc as { features: unknown[] }).features)
      : []
    )
      .map((f) => (typeof (f as Record<string, unknown>)?.["featureId"] === "string" ? (f as Record<string, string>)["featureId"] : null))
      .filter((id): id is string => id !== null),
  );
  return { personaIds, storyIds, featureIds };
}

export async function validateArtifactCmd(
  key: string,
  flags: ValidateArtifactFlags,
  io: IO,
): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const entry = ARTIFACT_PATH[key];
  if (entry === undefined) {
    io.err(`validate-artifact: no validator for "${key}" (validatable: ${Object.keys(ARTIFACT_PATH).join(", ")})`);
    return EXIT.TRANSPORT;
  }
  const abs = path.join(cwd, entry.rel);
  let body: unknown;
  if (entry.set === true) body = await readSet(abs);
  else if (entry.markdown === true) {
    body = await readFile(abs, "utf8").catch(() => null);
  } else body = sectionOf(key, await readJson(abs));
  if ((entry.set === true && (body as unknown[]).length === 0) || (entry.set !== true && body === null)) {
    io.err(`validate-artifact: ${key} not found or unreadable at ${entry.rel}`);
    return EXIT.TRANSPORT;
  }

  const result = validateArtifact(key, body, await buildContext(cwd));
  if (flags.json === true) {
    io.out(JSON.stringify(result));
  } else if (result.findings.length === 0) {
    io.out(`✓ ${key}: clean`);
  } else {
    for (const f of result.findings) {
      const where = f.path !== undefined ? ` (${f.path})` : "";
      io.out(`  ${f.severity === "error" ? "✗" : "!"} ${f.message}${where}`);
    }
  }
  return result.ok ? EXIT.OK : EXIT.GATE_FAIL;
}
