/**
 * Components.tsx — Design-unit ↔ requirement linking workspace.
 *
 * PRD: .plans/panel/05-components-PRD.md
 *
 * Contract: export function Components({bridge, bus}: {bridge: Bridge, bus: PluginBus})
 *
 * Key behaviors:
 * - Selection card: live canvas selection via bus.onSelection
 * - Link composer: creates unit↔AC pairs via bridge.putLinks (whole-set write)
 * - Linked components list: green/hollow dots, rollup, unlink on hover
 * - Zero-ACs callout when snapshot.requirements is empty → links to Artifacts
 * - Sticky footer "Check my design" → enqueue check-design job → navigate to /tabs/checks?run=<id>
 * - Interpret → enqueue identity-interpret job (Task 11, Phase-3 vision proposals)
 *   for the active root; disabled until a scan has produced a node-identity
 *   manifest (identityManifestQuery). Completion is detected by polling
 *   GET /pipeline/result/:id (bridge.getPipelineResult) — the accurate
 *   done/error signal; bridge.events() SSE failure frames are an early-fail
 *   fast path layered on top, and a timeout bounds an unresponsive job. Not
 *   a new progress surface — reuses Scan's inline label-swap state and
 *   Artifacts.tsx's amber error-note idiom.
 *
 * V1 seams (documented per spec honesty table):
 * - Sync badge is always "not mapped" (no bridge read for drift state in v1)
 * - Row click copies node id + notifies (no canvas select/zoom API in v1)
 * - Missing-node row flag deferred (requires canvas lookup API)
 *
 * SELECTOR DISCIPLINE: every useAppStore() call selects a single primitive or
 * stable stored reference. Never return a new object literal from a selector.
 */

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComponentTypeEntry, IdentityExtraction } from "@uxfactory/spec";
import type { Bridge, Link } from "../lib/bridge.js";
import { BridgeError } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { bytesToBase64 } from "../lib/base64.js";
import { useAppStore } from "../stores/app.js";
import { Card } from "../components/index.js";
import {
  linksQuery,
  putLinksMutation,
  enqueueMutation,
  identityManifestQuery,
  queryKeys,
  activeRoot,
} from "../queries.js";
import { IdentityInventory } from "./components/IdentityInventory.js";

/** "Interpret" gives up polling for a terminal result after this long — the
 *  button re-enables (not necessarily a failure judgment; see the timeout's
 *  own comment). Same ceiling as Artifacts.tsx's PENDING_TIMEOUT_MS. */
const INTERPRET_TIMEOUT_MS = 5 * 60 * 1000;
/** How often to poll GET /pipeline/result/:id while an interpret job runs. */
const INTERPRET_POLL_MS = 1800;

// ─── Local types ──────────────────────────────────────────────────────────────

/** Mirrored from SelectionPayload (src/messages.ts). UI must not import from src/. */
interface SelectionInfo {
  page: string;
  fileName: string;
  fileKey: string;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  stylesInUse: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNIT_TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: "Page", value: "Page" },
  { label: "Template", value: "Template" },
  { label: "Organism", value: "Organism" },
  { label: "Molecule", value: "Molecule" },
];

// ─── Components ───────────────────────────────────────────────────────────────

export function Components({
  bridge,
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  // ── Store selectors — single primitives / stable stored refs only ──────────
  const snapshot = useAppStore((s) => s.snapshot);
  const toast = useAppStore((s) => s.toast);

  const navigate = useNavigate();

  // ── Server state — links via TanStack Query ───────────────────────────────
  const queryClient = useQueryClient();
  const linksResult = useQuery(linksQuery(bridge));
  const links = linksResult.data?.links ?? [];
  const putLinks = useMutation({ ...putLinksMutation(bridge) });
  const enqueue = useMutation(enqueueMutation(bridge));

  /**
   * Optimistic write: update cache immediately, persist via mutation, roll back
   * to the current `links` snapshot on error so the UI stays honest.
   */
  function commitLinks(next: Link[], failMsg = "Failed to save link — is the bridge running?"): void {
    // Cancel in-flight refetches first — a fetch resolving after the optimistic
    // write would clobber it (and a rollback could clobber a newer refetch).
    void queryClient.cancelQueries({ queryKey: queryKeys.links(activeRoot(bridge)) });
    queryClient.setQueryData(queryKeys.links(activeRoot(bridge)), { links: next });
    putLinks.mutate(next, {
      onError: () => {
        queryClient.setQueryData(queryKeys.links(activeRoot(bridge)), { links });
        toast(failMsg);
      },
    });
  }

  // ── Local state ───────────────────────────────────────────────────────────
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [selectedAcId, setSelectedAcId] = useState("");
  const [unitType, setUnitType] = useState("Page");
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [isCheckLoading, setIsCheckLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ nodes: number; components: number } | null>(null);
  const [identityResult, setIdentityResult] = useState<{ count: number; addresses: string[] } | null>(null);

  // ── Interpret identities (Task 11 — Phase 3 vision proposals) ──────────────
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  /**
   * Enqueue id of the in-flight identity-interpret job. STATE (not a ref) —
   * both the SSE-failure effect and the result-poll effect below need to
   * react to it being set (a ref mutation alone would not re-run them).
   */
  const [interpretJobId, setInterpretJobId] = useState<string | null>(null);
  const interpretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interpretPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The node-identity manifest gates Interpret: disabled until a scan has
  // produced at least one record (bridge.getIdentityManifest, Task 8).
  const manifestResult = useQuery(identityManifestQuery(bridge));
  const manifestRecordCount = Object.keys(manifestResult.data?.manifest.records ?? {}).length;

  // ── Subscribe to canvas selection ─────────────────────────────────────────
  useEffect(() => {
    const unsub = bus.onSelection((raw) => {
      if (raw !== null && typeof raw === "object") {
        const payload = raw as SelectionInfo;
        if (Array.isArray(payload.nodes)) {
          setSelection(payload);
        }
      }
    });
    return unsub;
  }, [bus]);

  // ── Subscribe to identity-extraction replies (Scan identities) ─────────────
  useEffect(() => {
    const unsub = bus.onIdentityExtraction?.((raw) => {
      setIsScanning(false);
      if (raw === null || typeof raw !== "object") return;
      const payload = raw as {
        extraction: IdentityExtraction;
        components: ComponentTypeEntry[];
        truncated: number;
      };
      setScanResult({
        nodes: payload.extraction.nodes.length,
        components: payload.components.length,
      });
      setIdentityResult(null);

      void bridge.putIdentityComponents?.(payload.components).catch(() => {
        toast("Failed to save components — is the bridge running?");
      });

      // Tolerate a 404 (older bridge build without this route) — toast, no
      // crash — rather than surfacing a generic failure. Only on a
      // SUCCESSFUL extraction POST do we go on to request root-tier crops
      // (Task 9) — a failed/missing extraction has nothing worth screenshotting.
      void bridge
        .postIdentityExtraction?.(payload.extraction)
        .then((res) => {
          setIdentityResult({ count: res.count, addresses: res.addresses });
          bus.requestIdentityCrops?.();
          // A fresh extraction may have written the manifest for the first
          // time (or added records) — refetch so Interpret's gate + any
          // manifest-driven UI picks it up.
          void queryClient.invalidateQueries({
            queryKey: queryKeys.identityManifest(activeRoot(bridge)),
          });
        })
        .catch((err: unknown) => {
          if (err instanceof BridgeError && err.status === 404) {
            toast("Bridge not ready for identity extraction yet");
          } else {
            toast("Failed to post identity extraction — is the bridge running?");
          }
        });
    });
    return () => unsub?.();
  }, [bus, bridge, toast, queryClient]);

  // ── Subscribe to identity-crops replies — base64-encode + POST them ────────
  useEffect(() => {
    const unsub = bus.onIdentityCrops?.((raw) => {
      if (raw === null || typeof raw !== "object") return;
      const payload = raw as {
        crops: Array<{ durableId: string; figmaNodeId: string; bytes: Uint8Array }>;
      };
      const crops = payload.crops.map((c) => ({
        durableId: c.durableId,
        base64: bytesToBase64(c.bytes),
      }));

      // Same 404-tolerant discipline as the extraction POST above.
      void bridge
        .postIdentityCrops?.(crops)
        .catch((err: unknown) => {
          if (err instanceof BridgeError && err.status === 404) {
            toast("Bridge not ready for identity crops yet");
          } else {
            toast("Failed to post identity crops — is the bridge running?");
          }
        });
    });
    return () => unsub?.();
  }, [bus, bridge, toast]);

  // ── Scan identities ────────────────────────────────────────────────────────
  function handleScanIdentities(): void {
    setIsScanning(true);
    bus.requestIdentityScan?.();
  }

  // ── Interpret identities ────────────────────────────────────────────────────

  /** Clear ALL running-job bookkeeping (timer + poll interval + tracked id). */
  function clearInterpretTracking(): void {
    if (interpretTimerRef.current !== null) {
      clearTimeout(interpretTimerRef.current);
      interpretTimerRef.current = null;
    }
    if (interpretPollRef.current !== null) {
      clearInterval(interpretPollRef.current);
      interpretPollRef.current = null;
    }
    setInterpretJobId(null);
  }

  // SSE: surface a failed identity-interpret run inline, fast — same
  // heuristic Artifacts.tsx uses for generate-artifact failures (an adapter
  // {type:"error"} chunk tied to this screen's tracked enqueue id). This is
  // an early-failure signal only; the poll effect below (GET
  // /pipeline/result/:id) is the actual completion signal, since the SSE
  // never broadcasts a terminal SUCCESS frame (POST /pipeline/result is
  // stored, not broadcast).
  useEffect(() => {
    if (!isInterpreting || interpretJobId === null) return;
    const teardown = bridge.events((ev) => {
      if (ev.requestId !== interpretJobId) return;
      const payload = ev.event as { type?: unknown } | null;
      if (payload !== null && typeof payload === "object" && payload.type === "error") {
        clearInterpretTracking();
        setIsInterpreting(false);
        setInterpretError("Interpretation failed — see worker logs");
        void queryClient.invalidateQueries({
          queryKey: queryKeys.identityManifest(activeRoot(bridge)),
        });
      }
    });
    return teardown;
  }, [isInterpreting, interpretJobId, bridge, queryClient]);

  // Poll GET /pipeline/result/:id — the accurate completion signal (200 =
  // done with the worker's exit status, 202 = still running, 404 = unknown
  // to the bridge). While pending/unknown we just keep polling; the timeout
  // backstop below is what bounds an unresponsive/unknown id, not this loop.
  useEffect(() => {
    if (!isInterpreting || interpretJobId === null) return;
    if (typeof bridge.getPipelineResult !== "function") return;
    const id = interpretJobId;
    let inFlight = false;

    async function poll(): Promise<void> {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await bridge.getPipelineResult!(id);
        if (res.state === "done") {
          const failed = res.status !== 0;
          clearInterpretTracking();
          setIsInterpreting(false);
          if (failed) setInterpretError("Interpretation failed — see worker logs");
          void queryClient.invalidateQueries({
            queryKey: queryKeys.identityManifest(activeRoot(bridge)),
          });
        }
        // "pending" / "unknown" — nothing to do this tick, keep polling.
      } catch {
        // Transient network hiccup — keep polling; the timeout backstop
        // still bounds how long we wait overall.
      } finally {
        inFlight = false;
      }
    }

    const interval = setInterval(() => void poll(), INTERPRET_POLL_MS);
    interpretPollRef.current = interval;
    void poll(); // check once immediately rather than waiting a full interval

    return () => {
      clearInterval(interval);
      if (interpretPollRef.current === interval) interpretPollRef.current = null;
    };
  }, [isInterpreting, interpretJobId, bridge, queryClient]);

  // Clear any outstanding Interpret timer/poll on unmount.
  useEffect(() => {
    return () => {
      if (interpretTimerRef.current !== null) clearTimeout(interpretTimerRef.current);
      if (interpretPollRef.current !== null) clearInterval(interpretPollRef.current);
    };
  }, []);

  async function handleInterpret(): Promise<void> {
    setIsInterpreting(true);
    setInterpretError(null);
    let id: string;
    try {
      ({ id } = await enqueue.mutateAsync({
        kind: "identity-interpret",
        payload: { root: activeRoot(bridge) },
      }));
    } catch {
      setIsInterpreting(false);
      toast("Interpret failed to enqueue — is the bridge running?");
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: queryKeys.identityManifest(activeRoot(bridge)),
    });

    // "Running" persists until the poll effect above sees a done result for
    // this id, the SSE effect sees an early failure, or this timeout gives
    // up tracking it (not a failure judgment — just stop occupying the
    // button; still invalidates, since a silent success could have outrun
    // the timeout). Clear any stale timer/poll from a prior run first
    // (defensive; shouldn't happen since the button is disabled while
    // isInterpreting is true).
    clearInterpretTracking();
    setInterpretJobId(id);
    interpretTimerRef.current = setTimeout(() => {
      clearInterpretTracking();
      setIsInterpreting(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.identityManifest(activeRoot(bridge)),
      });
    }, INTERPRET_TIMEOUT_MS);
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const requirements = snapshot?.requirements ?? [];
  const primaryNode = selection?.nodes[0] ?? null;

  // Rollup: y = distinct unit names in links ∪ current selection name
  const linkedUnitNames = new Set(links.map((l) => l.unitName));
  if (primaryNode !== null) linkedUnitNames.add(primaryNode.name);
  const rollupY = linkedUnitNames.size;
  const rollupX = links.length;

  // Is the current selection already linked to the selected AC?
  const isDuplicate =
    primaryNode !== null && selectedAcId !== ""
      ? links.some((l) => l.nodeId === primaryNode.id && l.acId === selectedAcId)
      : false;

  const canLink = primaryNode !== null && selectedAcId !== "" && !isDuplicate;

  // ── Link handler ──────────────────────────────────────────────────────────
  function handleLink(): void {
    if (!canLink || primaryNode === null) return;

    const newLink: Link = {
      nodeId: primaryNode.id,
      unitName: primaryNode.name,
      unitType,
      acId: selectedAcId,
    };
    commitLinks([...links, newLink]);
  }

  // ── Unlink handler ────────────────────────────────────────────────────────
  function handleUnlink(link: Link): void {
    const nextLinks = links.filter(
      (l) => !(l.nodeId === link.nodeId && l.acId === link.acId),
    );
    commitLinks(nextLinks, "Failed to remove link — is the bridge running?");
  }

  // ── Unit-type change: persist on any linked rows for this node ─────────────
  function handleUnitTypeChange(newType: string): void {
    setUnitType(newType);
    if (primaryNode === null) return;

    const hasLinkedRows = links.some((l) => l.nodeId === primaryNode.id);
    if (!hasLinkedRows) return;

    const nextLinks = links.map((l) =>
      l.nodeId === primaryNode.id ? { ...l, unitType: newType } : l,
    );
    commitLinks(nextLinks, "Failed to update link — is the bridge running?");
  }

  // ── Check my design ────────────────────────────────────────────────────────
  async function handleCheck(): Promise<void> {
    const nodeIds = [...new Set(links.map((l) => l.nodeId))];
    setIsCheckLoading(true);
    try {
      // NOTE: no worker handler for "check-design" yet (PP2) — the job enqueues and waits; Checks still shows the latest render's verification.
      const { id } = await enqueue.mutateAsync({ kind: "check-design", payload: { nodeIds } });
      void navigate({ to: "/tabs/checks", search: { run: id } });
    } catch {
      toast("Check failed to enqueue — is the bridge running?");
    } finally {
      setIsCheckLoading(false);
    }
  }

  // ── AC id click: open stories file path from requirements artifact ─────────
  function handleAcClick(_acId: string): void {
    const reqArtifact = snapshot?.artifacts.find((a) => a.key === "stories");
    const path = reqArtifact?.path ?? null;
    if (path !== null) {
      void bridge.openPath(path).catch(() => {});
    }
  }

  // ── Node id click: select on canvas (primary) + copy (secondary) ─────────
  function handleCopyNodeId(nodeId: string): void {
    // Primary: select the node on canvas and scroll into view.
    bus.selectNodes([nodeId]);
    // Secondary: copy id to clipboard for reference.
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(nodeId).catch(() => {});
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="flex flex-col gap-4 p-4 pb-20">

        {/* ── Scan identities + Interpret — node-identity scaffolding ─────── */}
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleScanIdentities()}
              disabled={isScanning}
              aria-label="Scan identities"
              className={[
                "flex-1 py-2 px-4 rounded font-medium text-sm transition-colors",
                !isScanning
                  ? "bg-primary-600 text-white hover:bg-primary-700"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed",
              ].join(" ")}
            >
              {isScanning ? "Scanning…" : "Scan identities"}
            </button>
            <button
              type="button"
              onClick={() => void handleInterpret()}
              disabled={isInterpreting || manifestRecordCount === 0}
              aria-label="Interpret"
              title={
                manifestRecordCount === 0
                  ? "Scan identities first — Interpret needs a node-identity manifest"
                  : undefined
              }
              className={[
                "flex-1 py-2 px-4 rounded font-medium text-sm transition-colors",
                !isInterpreting && manifestRecordCount > 0
                  ? "bg-primary-600 text-white hover:bg-primary-700"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed",
              ].join(" ")}
            >
              {isInterpreting ? "Interpreting…" : "Interpret"}
            </button>
          </div>
          {scanResult !== null && (
            <p className="mt-2 text-xs text-gray-500 text-center">
              {scanResult.nodes} nodes scanned, {scanResult.components} components harvested
            </p>
          )}
          {identityResult !== null && (
            <p className="mt-1 text-xs text-gray-500 text-center">
              {identityResult.count} node {identityResult.count === 1 ? "identity" : "identities"} assembled
              {identityResult.addresses.length > 0
                ? ` (e.g. ${identityResult.addresses.slice(0, 3).join(", ")})`
                : ""}
            </p>
          )}
          {interpretError !== null && (
            <p className="mt-1 text-xs text-warn-600 text-center" role="alert">
              {interpretError}
            </p>
          )}
        </div>

        {/* ── Identity inventory (Task 13) — suggest→confirm surface over
             the node-identity manifest Scan/Interpret above produce. Renders
             nothing until there's at least one manifest record. ──────────── */}
        <IdentityInventory bridge={bridge} bus={bus} />

        {/* ── Selection card ───────────────────────────────────────────── */}
        <Card>
          {primaryNode !== null ? (
            <div className="flex flex-col gap-2 px-3 py-3">
              {/* Unit name + unit-type native select */}
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-medium text-gray-900 truncate">
                  {primaryNode.name}
                </span>
                <select
                  value={unitType}
                  onChange={(e) => void handleUnitTypeChange(e.target.value)}
                  aria-label="Unit type"
                  className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-700 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                >
                  {UNIT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Meta row: node id (mono, click=copy) + styles count + sync badge */}
              <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleCopyNodeId(primaryNode.id)}
                  title="Copy node id"
                  aria-label={`Copy node id ${primaryNode.id}`}
                  className="font-mono text-gray-500 hover:text-primary-600 transition-colors"
                >
                  {primaryNode.id}
                </button>
                <span className="shrink-0">
                  {selection?.stylesInUse ?? 0} styles in use
                </span>
                {/* Sync badge — always "not mapped" in v1 */}
                <span
                  title="Code mapping arrives with drift integration"
                  className="shrink-0 text-gray-400 italic"
                >
                  not mapped
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center px-3">
              <p className="text-sm text-gray-500">
                Select a frame on the canvas to link it
              </p>
            </div>
          )}
        </Card>

        {/* ── Trace hint: the trace tree now lives on the Requirements tab ── */}
        <button
          type="button"
          onClick={() => void navigate({ to: "/tabs/requirements" })}
          className="px-3 text-left text-xs text-gray-400 hover:text-primary-600 hover:underline transition-colors"
        >
          Trace moved — see the Requirements tab
        </button>

        {/* ── Zero-ACs callout ─────────────────────────────────────────── */}
        {requirements.length === 0 && (
          <div className="p-3 bg-gray-100 rounded-[var(--radius-card)] text-xs text-gray-600">
            No requirements yet — create them in{" "}
            <button
              type="button"
              onClick={() => void navigate({ to: "/tabs/artifacts", search: {} })}
              className="text-primary-600 hover:underline font-medium"
            >
              Artifacts →
            </button>
          </div>
        )}

        {/* ── Link composer ────────────────────────────────────────────── */}
        {requirements.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="req-select"
              className="text-xs text-gray-600 shrink-0"
            >
              Requirement:
            </label>
            <select
              id="req-select"
              value={selectedAcId}
              onChange={(e) => setSelectedAcId(e.target.value)}
              aria-label="Requirement to link"
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 text-gray-700 bg-white min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <option value="">Select AC…</option>
              {requirements.map((req) => (
                <option key={req.id} value={req.id}>
                  {req.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleLink()}
              disabled={!canLink}
              aria-label="Link unit to requirement"
              className={[
                "text-xs px-3 py-1.5 rounded font-medium shrink-0 transition-colors",
                canLink
                  ? "bg-primary-600 text-white hover:bg-primary-700"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed",
              ].join(" ")}
            >
              Link
            </button>
          </div>
        )}

        {/* ── Linked components section ─────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Linked Components
            </span>
            {rollupY > 0 && (
              <span className="text-xs text-gray-400">
                {rollupX} of {rollupY} linked
              </span>
            )}
          </div>

          <Card>
            {links.length === 0 && primaryNode === null ? (
              <p className="text-sm text-gray-400 text-center py-6">
                No linked components yet
              </p>
            ) : (
              <div>
                {/* Linked rows */}
                {links.map((link, idx) => {
                  const rowId = `${link.nodeId}:${link.acId}`;
                  const isHovered = hoveredRowId === rowId;
                  return (
                    <div
                      key={rowId}
                      className={[
                        "flex items-center gap-2 px-3 py-2 text-xs",
                        idx < links.length - 1 ? "border-b border-gray-100" : "",
                        isHovered ? "bg-gray-50" : "",
                      ].join(" ")}
                      onMouseEnter={() => setHoveredRowId(rowId)}
                      onMouseLeave={() => setHoveredRowId(null)}
                    >
                      {/* Status dot: green (linked) */}
                      <span
                        className="w-2 h-2 rounded-full bg-green-500 shrink-0"
                        aria-hidden="true"
                      />

                      {/* Unit name — click to copy node id */}
                      <button
                        type="button"
                        onClick={() => handleCopyNodeId(link.nodeId)}
                        className="flex-1 text-left text-gray-800 truncate hover:text-primary-600 transition-colors"
                        title={`Node: ${link.nodeId}`}
                      >
                        {link.unitName}
                      </button>

                      {/* Unit-type chip */}
                      <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 shrink-0">
                        {link.unitType}
                      </span>

                      {/* AC id — click to open requirements file */}
                      <button
                        type="button"
                        onClick={() => handleAcClick(link.acId)}
                        className="text-indigo-600 hover:underline font-mono shrink-0 transition-colors"
                        title="Open requirement file"
                        aria-label={`Open ${link.acId}`}
                      >
                        {link.acId}
                      </button>

                      {/* Unlink button — visible on hover */}
                      {isHovered && (
                        <button
                          type="button"
                          onClick={() => void handleUnlink(link)}
                          className="text-red-500 hover:text-red-700 text-xs ml-1 shrink-0 transition-colors"
                          aria-label={`Unlink ${link.unitName} from ${link.acId}`}
                        >
                          Unlink
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Current selection — not yet linked (selection-known unlinked unit) */}
                {primaryNode !== null &&
                  !links.some((l) => l.nodeId === primaryNode.id) && (
                    <div
                      className={[
                        "flex items-center gap-2 px-3 py-2 text-xs",
                        links.length > 0 ? "border-t border-gray-100" : "",
                      ].join(" ")}
                    >
                      {/* Status dot: hollow */}
                      <span
                        className="w-2 h-2 rounded-full border-2 border-gray-300 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="flex-1 text-gray-500 truncate">
                        {primaryNode.name}
                      </span>
                      <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-400 shrink-0">
                        {unitType}
                      </span>
                      <span className="text-amber-500 shrink-0">not linked yet</span>
                    </div>
                  )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Sticky footer: Check my design ──────────────────────────────── */}
      <div className="sticky bottom-0 border-t border-gray-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={links.length === 0 || isCheckLoading}
          aria-label="Check my design"
          className={[
            "w-full py-2 px-4 rounded font-medium text-sm transition-colors",
            links.length > 0 && !isCheckLoading
              ? "bg-primary-600 text-white hover:bg-primary-700"
              : "bg-gray-200 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          {isCheckLoading ? "Enqueuing…" : "Check my design"}
        </button>
      </div>
    </div>
  );
}
