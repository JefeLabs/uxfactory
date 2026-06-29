export { EXIT, TransportError } from "./exit.js";
export { BridgeClient } from "./client.js";
export type { VerifyBody } from "./client.js";
export { writeQueueFile, newJobId } from "./queue.js";
export { loadSpec, printSpecProblem } from "./spec-file.js";
export type { LoadResult } from "./spec-file.js";
export { lintCmd } from "./commands/lint.js";
export { verifyCmd, reportVerify } from "./commands/verify.js";
export type { VerifyResult } from "./commands/verify.js";
export { publishCmd } from "./commands/publish.js";
export type { PublishFlags } from "./commands/publish.js";
export { selectionCmd } from "./commands/selection.js";
export { scanCmd } from "./commands/scan.js";
export { bridgeCmd } from "./commands/bridge.js";
export { stubCmd } from "./commands/stub.js";
export { consoleIO } from "./io.js";
export type { IO } from "./io.js";
export * from "./drift/map-schema.js";
export { readMap, writeMap, serializeMap, setAutoFilled } from "./drift/map-io.js";
export type { AutoFill } from "./drift/map-io.js";
export { resolveSource, getByPath, parseRef, extractBraceBody } from "./drift/sources.js";
export type { ResolvedSource } from "./drift/sources.js";
export { computeDrift, syncMapFromReport, findSpecNode } from "./drift/drift-core.js";
export type { DriftFinding, DriftReport, DriftInput, DriftKind } from "./drift/drift-core.js";
export { mapScaffoldCmd, mapCheckCmd } from "./commands/map.js";
export { discoverComponents, readSpecNodes } from "./commands/discover.js";
export type { DiscoveredComponent, SpecNodes } from "./commands/discover.js";
export { driftCmd, defaultGitLastCommit } from "./commands/drift.js";
export type { DriftFlags, GitLastCommit } from "./commands/drift.js";
export { specToSvg } from "./render/svg.js";
export { svgToPng } from "./render/raster.js";
export { figmaImageExport } from "./render/figma-export.js";
export type { FigmaExportOptions, FigmaImageResult, FetchLike } from "./render/figma-export.js";
export { renderCmd } from "./commands/render.js";
export type { RenderFlags } from "./commands/render.js";
export { readRegistry, validateRegistry, resolveInputs } from "./batch/registry.js";
export type { BatchRegistry, BatchInputs, ResolvedInputs, ReadRegistryResult } from "./batch/registry.js";
export { tokenConformance, reuse, requirementCoverage, flowReachability } from "./batch/checks.js";
export type {
  CheckResult,
  CheckStatus,
  Severity,
  BatchFinding,
  LoadedSpec,
  TokenSet,
  StorySet,
  Story,
  AcceptanceCriterion,
  ImpliedState,
  Flow,
} from "./batch/checks.js";
export { runBatch } from "./batch/run.js";
export type { RunBatchInput, BatchReport } from "./batch/run.js";
