# Cross-phase contract notes

Living notes for obligations that span phases — surfaced by reviews while building an earlier phase, to be honored by a later one. Fold the relevant items into each phase's plan when it is written.

## For Phase 1c — `uxfactory-bridge` (`POST /verify`) ✅ IMPLEMENTED (all honored)

- **`verifyId` is the bridge's to generate.** `gate()` is pure and never invents ids. The bridge must generate `verifyId` (timestamp-based, per PRD §10.1 `v_…`) and pass it to `gate(spec, report, { verifyId })`. `renderId` is echoed by the gate from the report.
- **Map the HTTP tolerance shape to the gate option.** The §10.1 request body uses `tolerance: { geometryPx }`; the gate option is `tolerancePx`. The bridge adapts `tolerance.geometryPx → options.tolerancePx` (default 0.5 when absent).
- **`checks` subset passthrough.** The §10.1 request may include a `checks` subset; pass it as `options.checks`. (The gate now treats an empty array as "all" to avoid a vacuous PASS, but the bridge should still validate input.)
- **`GateResult.summary` includes `skipped`.** Beyond the PRD §10.1 example (`{ checks, passed, failed }`), the implemented summary is `{ checks, passed, failed, skipped }` — necessary because `passed + failed ≠ checks` whenever a check is SKIP (the common case for edit-only specs). The `/verify` response serializer and any response schema must include `skipped`.
- **HTTP status vs body.** Gate outcomes (PASS/FAIL) are HTTP `200` with the verdict in the body. HTTP status is reserved for transport problems: `409` no render report yet, `404` unknown `renderId`, `503` plugin never connected (PRD §10.1).
- **Validate before gating.** The gate assumes a structurally valid spec. The bridge should run `@uxfactory/spec`'s `validate()` on the incoming spec before calling `gate()`.

## For Phase 1d — `uxfactory-cli` (writes the queue directly) ✅ IMPLEMENTED (all honored)

The bridge does NOT expose a `publish`/enqueue HTTP endpoint. Per PRD §10.3, `uxfactory publish` writes the spec **directly** into the shared `.uxfactory/queue/` directory on the same machine; the bridge's `GET /next` serves it. So the CLI must match the bridge's queue-file contract exactly:

- **File format:** a pending job is a file `.uxfactory/queue/<jobId>.json` whose entire contents are the **raw spec JSON** (no envelope/wrapper). The `jobId` is the filename minus `.json`.
- **jobId charset:** must be `[A-Za-z0-9_-]+` (the bridge does NOT re-validate ids read off disk; a generated id like `pub_<ts>` is fine).
- **Write atomically.** Write to a temp file (e.g. `.uxfactory/queue/.<jobId>.tmp` or in `os.tmpdir()`) then `rename` into `queue/<jobId>.json`. The bridge's `dequeueNext` reads+parses before moving; a half-written file would be **quarantined to `.uxfactory/queue/failed/`** (not crash the queue, but the job is lost). Atomic rename avoids this.
- **Ordering:** jobs are served oldest-first by **mtime** (tiebreak: filename). `publish --wait` should poll `GET /rendered` for the resulting report.
- **dataDir agreement:** CLI and bridge both default to `<cwd>/.uxfactory`; run them from the same project dir (or share `--dataDir`/`UXFACTORY_PORT`).
- **`POST /batch/:id/approve` is idempotent** — safe for the CLI to retry on a dropped response (re-approve enqueues nothing).
- **`POST /edits` is the synchronous channel** with a 504 on timeout; transport errors are exit 2, gate FAIL is exit 1.

### Surfaced while building the CLI — for the later phases that replace the stubs

- **`publish --wait`/`--verify` correlates renders by baseline-diff, NOT by `jobId`.** The CLI records the latest `renderId` before enqueue, then polls `GET /rendered` (the GLOBALLY newest report) until it changes. The bridge only echoes `jobId` to resolve `POST /edits` waiters — the CLI doesn't use that channel. Correct for single-user/single-job v1, but **concurrent publishes or a plugin open on another file can verify the WRONG render**. When the **batch (Phase 6)** or any concurrent-publish path lands, the CLI must correlate by `jobId` — which needs a bridge affordance (e.g. `GET /rendered?jobId=` or a per-job render lookup). Record before building batch.
- **Stub commands currently return exit 2 ("not yet implemented").** When **drift (Phase 4)**, **render (Phase 5)**, **batch (Phase 6)**, **review (Phase 7)** replace their stubs, each must adopt the §5.3 split — and `drift`/`review` specifically need `1` = conformance/drift-FAIL vs `2` = transport, mirroring `verify`.
- **Commander wiring: `program.exitOverride()` must be called BEFORE `.command()` calls** so subcommands inherit the exit callback (`copyInheritedSettings`); otherwise subcommand usage errors bypass it and `process.exit(1)`. `run(argv)` returns the exit code (or `"foreground"` for `bridge`); the bin maps it to `process.exit`. Any new CLI command must route through this so usage errors stay exit 2.

## For Phase 2 — `uxfactory-plugin` (the render report producer)

- **Echo `jobId` in `POST /rendered`.** `GET /next` returns `{ jobId, spec }`. After rendering, the plugin MUST include that `jobId` in the `POST /rendered` body so the bridge can resolve a pending synchronous `POST /edits` waiter. Without it, `/edits` callers always 504 (their render lands but isn't correlated).
- **`renderId` must be filename-safe** (`[A-Za-z0-9_-]+`). The bridge writes `renders/<renderId>.json`; an unsafe/absent renderId is silently replaced with a bridge-generated one, changing the id the plugin sees back.

- **Every edit-target node MUST appear in `report.nodes` with its full post-edit property values.** The gate verifies edits by reading post-edit values from `report.nodes` (via the `width→w`/`height→h` mapping), **not** from `report.edits[]`. The `ReportEditDiff` strings in `report.edits[]` are informational/human-readable only — the gate never reads them. This applies even to **edit-only renders**, which have no "section children" in the §7.4 sense: the plugin must still include each edited node in `nodes`. (Recommend tightening §7.4 wording, which currently says "geometry of section children.")
- **Color emission.** The gate normalizes colors (trim, lowercase, 3-digit→6-digit) before comparing, so the plugin may emit 6-digit lowercase hex; both sides are normalized, so case/length won't cause false mismatches.
- **`ReportNode` optional fields mirror the edit alphabet** (`rotation, opacity, visible, cornerRadius, fill, stroke, strokeWidth, characters` + `x/y/w/h`). Populate the ones relevant to a node so the `edits` check can verify any set property.
- **PNGs are not needed by the gate** (PRD §12). The plugin's full report may carry PNG previews, but `gate()` ignores pixels; the bridge stores them separately if needed.

## Monorepo conventions established (apply to every later package)

- **Cross-package type resolution:** put the `paths` mapping (`"@uxfactory/<pkg>": ["../uxfactory-<pkg>/src/index.ts"]`) in the package's **`tsconfig.typecheck.json`** with `rootDir: ".."` + `noEmit`, NOT in the build `tsconfig.json` (build's `rootDir: "."` triggers TS6059 on out-of-package `.ts`). The build resolves the workspace dep from its published `dist` (`.d.ts`), relying on pnpm's topological `pnpm -r build` order. This keeps `pnpm typecheck` working with zero `dist` present (CI runs typecheck before build).
- **ajv import:** use the named form `import { Ajv } from "ajv"` (default import fails TS2351 under `verbatimModuleSyntax`).
- **Per-package `typecheck` script** (`tsc -p tsconfig.typecheck.json`, includes `src` + `test`) so test files are type-checked; root `typecheck` = `pnpm -r --if-present typecheck`; CI runs `pnpm typecheck` before build.
- **`engines.node`: `>=20.10`** everywhere (import-attributes `with { type: "json" }` floor).
- **Built artifacts must load in real Node** — add a CI step (and a task verify step) that imports the compiled package and exercises it, since Vitest/esbuild transforms can mask real-Node ESM issues.

## Drift `compare` contract (Phase 4 — §11.1)

The `source.compare` map on a `ComponentMap` entry is the bridge between infra attributes and spec-node properties for the precise field diff.

- **Keys** are **spec-node property names** — they must be real properties that exist on a node object: `name`, `characters`, `fill`, `stroke`, `width`, `height`, `opacity`, etc. Using a key that is not a node property (e.g. `label`, `port`) will produce a permanent mismatch because `getByPath(node, "label")` returns `undefined` → the actual side is always `undefined`.
- **Values** are **source attribute names** — the attribute key to read from the resolved source (`ResolvedSource.values`). For example, `{ characters: "target_port" }` reads `values["target_port"]` from the terraform/k8s/compose source and compares it to `specNode.characters`.
- The PRD §11.1 example `{ label: "name", port: "container_port" }` uses fictional node properties. Real usage should use node property names from the `@uxfactory/spec` `ReportNode` shape (`name`, `characters`, `fill`, `stroke`, `cornerRadius`, `opacity`, `visible`, `x`, `y`, `w`, `h`).
- Both sides are coerced to `String(value)` before comparison, so a YAML-parsed number `8080` matches the spec string `"8080"`.

## Known accepted limitations

- **`findNode` first-match-by-name:** duplicate-named nodes collapse to the first match in `presence`/`geometry`; the `counts` check catches the cardinality mismatch. This is per PRD ("by `id`, else first-match `name`").

## Phase 2 live-integration notes (plugin runs against REAL Figma + bridge)

The plugin was built BUILD-TO-SPEC (no live Figma); the opus phase review surfaced live-correctness items. FIXED + tested via an extended mock: font loading (`loadFontAsync` before any text write — the mock throws otherwise), sticky/connector text via the `text.characters` TextSublayer, a render error boundary (failures post `render-error` instead of hanging), find-or-create target page, Cmd/Ctrl+Z undo, and graceful per-instance import failure. STILL OPEN — address before/at the first real-Figma run (the mock structurally cannot verify these):

- **Instance asset → component key resolution is NOT implemented.** `importComponentByKeyAsync` needs a real published component key; the spec carries a friendly `asset` name (e.g. `aws:lambda`). The catalog (`.uxfactory/catalog.json` from `uxfactory scan`) maps friendly→key, but nothing wires it into the plugin. Until then, instance children are skipped (graceful, with a diff). Wiring options: the bridge serves the catalog to the UI, or specs are pre-resolved before publish. **Required before instances render live.**
- **Undo does not re-post a report to the bridge.** After an undo, the bridge's stored render report is stale, so a subsequent `uxfactory verify` gates against the pre-undo state. Consider routing undo through the render/report pipeline or posting a fresh report on undo.
- **No render idempotency.** Re-rendering the same spec APPENDS nodes rather than producing identical canvas state (§7.1). Live re-publish accumulates canvas content. Decide on clear-by-name / namespacing / a render manifest before relying on re-publish.
- **PNG exports (§7.4) are not produced.** Deliberate (the gate ignores pixels, §12), but if the headless-preview/batch phases want page PNGs from the plugin, `exportAsync` must be wired into the report's `pagePng`.
- **Document access is legacy-sync.** The manifest sets no `documentAccess: "dynamic-page"`; `getNodeById`/`currentPage` are sync. If adopting dynamic-page later, switch `findTarget`/selection reads to the async `getNodeByIdAsync` variants.
- **§7.3 undo bound is 50 + Cmd+Z (done); native Figma Cmd+Z remains the cross-session truth.**
