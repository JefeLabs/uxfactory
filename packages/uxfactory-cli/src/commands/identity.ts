/**
 * identity.ts — `uxfactory identity propose <file>`, `uxfactory identity show`,
 * and `uxfactory identity check`.
 *
 * The engine (this CLI) stays LLM-free throughout: `propose` only PARSES a
 * proposals JSON file (already written by the worker's `node-identity` SKILL
 * — see skill/node-identity/SKILL.md) and POSTs it to the bridge for merge,
 * no model call happens here. `show` is a cheap read-only observability
 * command over the manifest the bridge already serves. `check` (Phase 5,
 * task-15-brief.md) runs the five pure conformance checks from
 * `@uxfactory/spec`'s identity-conformance.ts over the manifest/registries/
 * component-registry the bridge serves — this is what turns node-identity
 * into governance (drift, composition, route trace), not just a naming tool.
 */

import { readFile } from "node:fs/promises";
import { TransportError } from "../exit.js";
import { EXIT } from "../exit.js";
import type { IO } from "../io.js";
import type { BridgeClient } from "../client.js";
import type { ComponentTypeEntry, IdentityProposal, IdentityRegistries, NodeManifest } from "@uxfactory/spec";
import {
  CONFORMANCE_CHECKS,
  runConformanceChecks,
  type ConformanceCheckName,
  type ConformanceFinding,
} from "@uxfactory/spec";

// ---------------------------------------------------------------------------
// shared shape-validation (mirrors the bridge's own wire-shape validators —
// deliberately duplicated, not imported: this check runs BEFORE any network
// call so a malformed file never reaches the bridge, matching every other
// package boundary's own wire-shape validator in this codebase)
// ---------------------------------------------------------------------------

const CONFIDENCE_VALUES = new Set(["high", "low"]);
const RESOLUTION_STATUS_VALUES = new Set(["bound", "drifted", "custom"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Shape-validate a parsed proposals file: `{ proposals: IdentityProposal[] }`,
 * every entry carrying a non-empty `durableId`, a valid `confidence`, and a
 * string `reasoning` (required — the skill must never emit an Inferred value
 * without both, per skill/node-identity/SKILL.md §D); optional fields are
 * checked for type when present. Collects every violation; never partially
 * valid — a single bad entry fails the WHOLE file.
 */
export function validateProposalsFile(
  parsed: unknown,
): { ok: true; proposals: IdentityProposal[] } | { ok: false; errors: string[] } {
  const proposalsRaw = isPlainObject(parsed) ? parsed["proposals"] : undefined;
  if (!Array.isArray(proposalsRaw)) {
    return { ok: false, errors: ['"proposals" must be an array'] };
  }

  const errors: string[] = [];
  const proposals: IdentityProposal[] = [];
  proposalsRaw.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      errors.push(`proposals[${i}] must be an object`);
      return;
    }
    if (typeof raw["durableId"] !== "string" || raw["durableId"].trim() === "") {
      errors.push(`proposals[${i}].durableId must be a non-empty string`);
      return;
    }
    if (!CONFIDENCE_VALUES.has(raw["confidence"] as string)) {
      errors.push(`proposals[${i}].confidence must be "high" or "low"`);
      return;
    }
    if (typeof raw["reasoning"] !== "string") {
      errors.push(`proposals[${i}].reasoning must be a string`);
      return;
    }
    if (raw["label"] !== undefined && typeof raw["label"] !== "string") {
      errors.push(`proposals[${i}].label must be a string when present`);
      return;
    }
    if (raw["matchedComponentKey"] !== undefined && typeof raw["matchedComponentKey"] !== "string") {
      errors.push(`proposals[${i}].matchedComponentKey must be a string when present`);
      return;
    }
    if (raw["mode"] !== undefined && typeof raw["mode"] !== "string") {
      errors.push(`proposals[${i}].mode must be a string when present`);
      return;
    }
    if (raw["theme"] !== undefined && typeof raw["theme"] !== "string") {
      errors.push(`proposals[${i}].theme must be a string when present`);
      return;
    }
    if (
      raw["resolutionStatus"] !== undefined &&
      !RESOLUTION_STATUS_VALUES.has(raw["resolutionStatus"] as string)
    ) {
      errors.push(`proposals[${i}].resolutionStatus must be "bound" | "drifted" | "custom" when present`);
      return;
    }
    proposals.push(raw as unknown as IdentityProposal);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, proposals };
}

// ---------------------------------------------------------------------------
// identity propose
// ---------------------------------------------------------------------------

export interface IdentityProposeFlags {
  bridge?: string;
  root?: string;
}

/**
 * `uxfactory identity propose <file>`
 *
 * Reads + parses `file`, shape-validates every proposal, and — only if the
 * WHOLE file is valid — POSTs `{ proposals }` to the bridge's
 * `POST /project/identity/proposals`. A bad file never reaches the network.
 *
 * Exit codes:
 *   0 — proposals accepted and merged; prints `applied <n>, skipped <n>`
 *   2 — file unreadable/invalid JSON/invalid shape, or a bridge/transport error
 */
export async function identityProposeCmd(
  file: string,
  flags: IdentityProposeFlags,
  io: IO,
  client: BridgeClient,
): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.err(`identity propose: cannot read proposals file: ${msg}`);
    return EXIT.TRANSPORT;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    io.err(`identity propose: ${file} is not valid JSON`);
    return EXIT.TRANSPORT;
  }

  const validated = validateProposalsFile(parsed);
  if (!validated.ok) {
    io.err(
      `identity propose: invalid proposals file — nothing was posted:\n` +
        validated.errors.map((e) => `  - ${e}`).join("\n"),
    );
    return EXIT.TRANSPORT;
  }

  let res: { status: number; body: unknown };
  try {
    res = await client.postIdentityProposals(validated.proposals, flags.root);
  } catch (err) {
    if (err instanceof TransportError) {
      io.err(`identity propose: bridge unreachable — ${err.message}`);
      return EXIT.TRANSPORT;
    }
    throw err;
  }

  if (res.status !== 200) {
    io.err(`identity propose: bridge rejected the proposals (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
    return EXIT.TRANSPORT;
  }

  const body = res.body as { applied: number; skipped: number; errors?: string[] };
  io.out(`identity propose: applied ${body.applied}, skipped ${body.skipped}`);
  // The bridge's per-proposal backstop (see project.ts) surfaces an `errors`
  // entry for any proposal it had to skip due to an unexpected throw — print
  // each one so a human (and the worker skill loop reading this command's
  // output) can see WHICH proposal was skipped and why, not just a count.
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    io.err(`identity propose: ${body.errors.length} proposal(s) skipped with an error:`);
    for (const e of body.errors) io.err(`  - ${e}`);
  }
  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// identity show
// ---------------------------------------------------------------------------

export interface IdentityShowFlags {
  bridge?: string;
  root?: string;
  json?: boolean;
}

/** Render one manifest record as a human-readable address line. */
function formatRecord(r: NodeManifest["records"][string]): string {
  const last = r.path[r.path.length - 1];
  const flag = last !== undefined && last.provenance !== "derived" && last.confirmed !== true
    ? ` [${last.provenance}${last.confirmed === false ? ", unconfirmed" : ""}]`
    : "";
  const status = r.resolutionStatus !== undefined ? `, ${r.resolutionStatus}` : "";
  return `  ${r.address}${flag}  (${r.durableId}${status})`;
}

/**
 * `uxfactory identity show [--json]`
 *
 * GETs the current node-identity manifest from the bridge and prints either
 * a human-readable addresses table (default) or the full manifest JSON
 * (`--json`) — cheap observability for the skill loop and for humans.
 *
 * Exit codes:
 *   0 — manifest fetched and printed (even when empty)
 *   2 — bridge unreachable/transport error
 */
export async function identityShowCmd(
  flags: IdentityShowFlags,
  io: IO,
  client: BridgeClient,
): Promise<number> {
  let manifest: NodeManifest;
  try {
    const res = await client.getIdentityManifest(flags.root);
    manifest = res.manifest;
  } catch (err) {
    if (err instanceof TransportError) {
      io.err(`identity show: bridge unreachable — ${err.message}`);
      return EXIT.TRANSPORT;
    }
    throw err;
  }

  if (flags.json === true) {
    io.out(JSON.stringify(manifest));
    return EXIT.OK;
  }

  const records = Object.values(manifest.records);
  if (records.length === 0) {
    io.out("identity show: no records in the manifest.");
    return EXIT.OK;
  }
  io.out(`identity show: ${records.length} record(s):`);
  for (const r of records.sort((a, b) => a.address.localeCompare(b.address))) {
    io.out(formatRecord(r));
  }
  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// identity check
// ---------------------------------------------------------------------------

export interface IdentityCheckFlags {
  bridge?: string;
  root?: string;
  json?: boolean;
}

/**
 * The zero-findings note per check — printed instead of a finding list so a
 * clean run still says WHY each check is clean, not just that it is. The
 * route checks are "vacuous" rather than a genuine "pass" today: the
 * canonical story schema carries no route/destination field yet (see
 * `@uxfactory/spec`'s identity-conformance.ts module doc), so
 * `route-traceable-stories` is always called with an empty promise list, and
 * `nav-consumes-anchors` has no candidates unless some manifest record
 * happens to carry a `route`.
 */
const CHECK_ZERO_NOTE: Record<ConformanceCheckName, string> = {
  "address-validity": "clean",
  "drift-surfacing": "no drifted records",
  "composed-node-conformance": "all composed nodes fully governed",
  "route-traceable-stories": "vacuous — the canonical story schema carries no route/destination field yet",
  "nav-consumes-anchors": "no broken nav/link references (also vacuous when no record carries a route)",
};

/**
 * `uxfactory identity check [--json]`
 *
 * Runs all five deterministic node-identity conformance checks (address
 * validity, drift surfacing, composed-node conformance, route-traceable
 * stories, nav-consumes-anchors — see `@uxfactory/spec`'s
 * identity-conformance.ts) over the manifest/registries/component-registry
 * the bridge already serves. LLM-free: every check is a pure function: this
 * command only fetches the three stores and formats the result.
 *
 * Exit codes:
 *   0 — no error-level finding (warn-level findings may still be present)
 *   1 — at least one error-level finding (only `address-validity` produces one)
 *   2 — bridge unreachable/transport error
 */
export async function identityCheckCmd(
  flags: IdentityCheckFlags,
  io: IO,
  client: BridgeClient,
): Promise<number> {
  let manifest: NodeManifest;
  let registries: IdentityRegistries;
  let components: ComponentTypeEntry[];
  try {
    const [manifestRes, registriesRes, componentsRes] = await Promise.all([
      client.getIdentityManifest(flags.root),
      client.getIdentityRegistries(flags.root),
      client.getIdentityComponents(flags.root),
    ]);
    manifest = manifestRes.manifest;
    registries = registriesRes.registries;
    components = componentsRes.components;
  } catch (err) {
    if (err instanceof TransportError) {
      io.err(`identity check: bridge unreachable — ${err.message}`);
      return EXIT.TRANSPORT;
    }
    throw err;
  }

  // storyRoutes stays [] — see CHECK_ZERO_NOTE's route-traceable-stories entry.
  const findings = runConformanceChecks({ manifest, registries, components, storyRoutes: [] });
  const hasError = findings.some((f) => f.level === "error");
  const exitCode = hasError ? EXIT.GATE_FAIL : EXIT.OK;

  if (flags.json === true) {
    io.out(JSON.stringify({ findings }));
    return exitCode;
  }

  const byCheck = new Map<ConformanceCheckName, ConformanceFinding[]>();
  for (const name of CONFORMANCE_CHECKS) byCheck.set(name, []);
  for (const f of findings) byCheck.get(f.check)!.push(f);

  io.out(
    `identity check: ${findings.length} finding(s) across ${CONFORMANCE_CHECKS.length} check(s)` +
      (hasError ? " — FAIL (error-level finding present)" : ""),
  );
  for (const name of CONFORMANCE_CHECKS) {
    const checkFindings = byCheck.get(name)!;
    if (checkFindings.length === 0) {
      io.out(`  ${name}: 0 (${CHECK_ZERO_NOTE[name]})`);
      continue;
    }
    const errorCount = checkFindings.filter((f) => f.level === "error").length;
    const warnCount = checkFindings.filter((f) => f.level === "warn").length;
    const counts = [
      errorCount > 0 ? `${errorCount} error` : null,
      warnCount > 0 ? `${warnCount} warn` : null,
    ]
      .filter((s): s is string => s !== null)
      .join(", ");
    io.out(`  ${name}: ${checkFindings.length} (${counts})`);
    for (const f of checkFindings) {
      const prefix = f.durableId !== undefined ? `${f.durableId}: ` : "";
      io.out(`    [${f.level}] ${prefix}${f.message}`);
    }
  }
  return exitCode;
}
