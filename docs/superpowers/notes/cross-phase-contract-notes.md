# Cross-phase contract notes

Living notes for obligations that span phases — surfaced by reviews while building an earlier phase, to be honored by a later one. Fold the relevant items into each phase's plan when it is written.

## For Phase 1c — `uxfactory-bridge` (`POST /verify`)

- **`verifyId` is the bridge's to generate.** `gate()` is pure and never invents ids. The bridge must generate `verifyId` (timestamp-based, per PRD §10.1 `v_…`) and pass it to `gate(spec, report, { verifyId })`. `renderId` is echoed by the gate from the report.
- **Map the HTTP tolerance shape to the gate option.** The §10.1 request body uses `tolerance: { geometryPx }`; the gate option is `tolerancePx`. The bridge adapts `tolerance.geometryPx → options.tolerancePx` (default 0.5 when absent).
- **`checks` subset passthrough.** The §10.1 request may include a `checks` subset; pass it as `options.checks`. (The gate now treats an empty array as "all" to avoid a vacuous PASS, but the bridge should still validate input.)
- **`GateResult.summary` includes `skipped`.** Beyond the PRD §10.1 example (`{ checks, passed, failed }`), the implemented summary is `{ checks, passed, failed, skipped }` — necessary because `passed + failed ≠ checks` whenever a check is SKIP (the common case for edit-only specs). The `/verify` response serializer and any response schema must include `skipped`.
- **HTTP status vs body.** Gate outcomes (PASS/FAIL) are HTTP `200` with the verdict in the body. HTTP status is reserved for transport problems: `409` no render report yet, `404` unknown `renderId`, `503` plugin never connected (PRD §10.1).
- **Validate before gating.** The gate assumes a structurally valid spec. The bridge should run `@uxfactory/spec`'s `validate()` on the incoming spec before calling `gate()`.

## For Phase 2 — `uxfactory-plugin` (the render report producer)

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

## Known accepted limitations

- **`findNode` first-match-by-name:** duplicate-named nodes collapse to the first match in `presence`/`geometry`; the `counts` check catches the cardinality mismatch. This is per PRD ("by `id`, else first-match `name`").
