/**
 * Settings.tsx — Runtime status, account, agent skills, and file storage.
 *
 * PRD: .plans/panel/08-settings-PRD.md
 *
 * Four cards:
 *   1. Bridge daemon   — stats (polled 10s), endpoint edit, restart command, logs drawer
 *   2. Subscription    — local-only state; Keys row always rendered (security invariant)
 *   3. Agent skills    — server-side read-only list from GET /skills
 *   4. File storage    — meter of plugin storage vs 100kb budget, Compact action
 *
 * V1 decisions (from PRD §7 Decisions):
 *   - Endpoint editable here; Reconnect updates the store + toast "Reconnect from the
 *     Connect screen to apply". No in-place reconnect in Settings.
 *   - Restart = copyable `uxfactory bridge` command (no control endpoint v1).
 *   - Skills read-only; pinned field always false from bridge v1.
 *
 * SELECTOR DISCIPLINE: every useAppStore() call selects a single primitive or
 * stable stored reference. Never return a new object literal from a selector.
 */

import React, { useEffect, useId, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import type { Bridge, BridgeStats, SkillEntry } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { useAppStore } from "../stores/app.js";
import { Card, SectionHeader } from "../components/index.js";
import { statsQuery, skillsQuery, logsQuery } from "../queries.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_BUDGET_BYTES = 100 * 1024; // 100 kb
const LOGS_REPOLL_MS = 2_000;
const RESTART_COMMAND = "uxfactory bridge";
/** Known plugin storage key prefixes (the bus has no key-listing). */
const STORAGE_PREFIXES = ["conn:v1", "runs:v1", "checks:v1"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format uptime in ms as "Xh Ym" or "Xm Ys". */
function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Format token count, or "—" when absent. */
function formatTokenCount(n: number | null): string {
  if (n === null) return "—";
  return `${n.toLocaleString()} resolved tokens · cached on disk`;
}

/** Format storage bytes as "X.X / 100 kb". */
function formatStorageKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} / 100 kb`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sum JSON-stringified byte lengths for all known storage prefixes under a
 * given fileKey. Non-fatal: missing/errored keys are counted as 0.
 */
async function computeStorageUsed(bus: PluginBus, fileKey: string): Promise<number> {
  let total = 0;
  for (const prefix of STORAGE_PREFIXES) {
    try {
      const val = await bus.storageGet(`${prefix}:${fileKey}`);
      if (val !== undefined && val !== null) {
        total += JSON.stringify(val).length;
      }
    } catch {
      // non-fatal
    }
  }
  return total;
}

// ─── LogsDrawer ───────────────────────────────────────────────────────────────

interface LogsDrawerProps {
  bridge: Bridge;
  open: boolean;
  onClose(): void;
}

function LogsDrawer({ bridge, open, onClose }: LogsDrawerProps): React.JSX.Element {
  const [autoRepoll, setAutoRepoll] = useState(false);

  const logsResult = useQuery(
    logsQuery(bridge, 200, {
      enabled: open,
      refetchInterval: open && autoRepoll ? LOGS_REPOLL_MS : false,
    }),
  );
  const lines = logsResult.data?.lines ?? [];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setAutoRepoll(false);
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content
          className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-xl z-50 flex flex-col"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <Dialog.Title className="text-sm font-semibold text-gray-900">
              Bridge logs
            </Dialog.Title>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoRepoll}
                  onChange={(e) => setAutoRepoll(e.target.checked)}
                  aria-label="Live repoll"
                />
                Live
              </label>
              <button
                type="button"
                onClick={() => void logsResult.refetch()}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Refresh
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close logs"
                  className="text-gray-400 hover:text-gray-600 text-sm px-1"
                >
                  ✕
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 font-mono">
            {lines.length === 0 ? (
              <p className="text-xs text-gray-400">No logs yet.</p>
            ) : (
              <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                {lines.join("\n")}
              </pre>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function Settings({
  bridge,
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  // ── Store selectors (single primitives / stable refs only) ─────────────────
  const endpoint = useAppStore((s) => s.connection.endpoint);
  const toast = useAppStore((s) => s.toast);

  // ── Stats (Query-driven, 10s refetchInterval) ──────────────────────────────
  const statsResult = useQuery(statsQuery(bridge));
  const stats: BridgeStats | null = statsResult.data ?? null;
  const statsError = statsResult.isError;

  // ── Skills (Query-driven, fetched once, 60s staleTime) ────────────────────
  const skillsResult = useQuery(skillsQuery(bridge));
  const skills: SkillEntry[] = skillsResult.data?.skills ?? [];

  // ── Storage state ──────────────────────────────────────────────────────────
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [storageUsed, setStorageUsed] = useState(0);

  // ── Endpoint edit state ────────────────────────────────────────────────────
  const [isEditingEndpoint, setIsEditingEndpoint] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState(endpoint);
  const endpointInputId = useId();

  // ── Restart popover state ──────────────────────────────────────────────────
  const [restartOpen, setRestartOpen] = useState(false);

  // ── Logs drawer state ──────────────────────────────────────────────────────
  const [logsOpen, setLogsOpen] = useState(false);

  // ── Escape key closes the restart popover ─────────────────────────────────
  useEffect(() => {
    if (!restartOpen) return;
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setRestartOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [restartOpen]);

  // ── Storage meter computation ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadStorage(): Promise<void> {
      let fk: string;
      try {
        const fi = await bus.fileInfo();
        fk = fi.fileKey;
        if (!cancelled) setFileKey(fk);
      } catch {
        return;
      }

      const total = await computeStorageUsed(bus, fk);
      if (!cancelled) setStorageUsed(total);
    }

    void loadStorage();
    return () => {
      cancelled = true;
    };
  }, [bus]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleCopyEndpoint(): void {
    void navigator.clipboard?.writeText(endpoint).catch(() => {});
    toast("Endpoint copied");
  }

  function handleEndpointEditOpen(): void {
    setEndpointDraft(endpoint);
    setIsEditingEndpoint(true);
  }

  function handleEndpointReconnect(): void {
    useAppStore.setState((s) => ({
      connection: { ...s.connection, endpoint: endpointDraft },
    }));
    setIsEditingEndpoint(false);
    toast("Reconnect from the Connect screen to apply");
  }

  function handleCopyRestartCommand(): void {
    void navigator.clipboard?.writeText(RESTART_COMMAND).catch(() => {});
    setRestartOpen(false);
    toast("Command copied");
  }

  async function handleCompact(): Promise<void> {
    if (!fileKey) return;
    try {
      const stored = await bus.storageGet<unknown[]>(`runs:v1:${fileKey}`);
      if (Array.isArray(stored)) {
        await bus.storageSet(`runs:v1:${fileKey}`, stored.slice(0, 5));
      }
    } catch {
      // best-effort — storage failure is non-fatal
    }
    setStorageUsed(await computeStorageUsed(bus, fileKey));
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const storagePercent = Math.min(100, (storageUsed / STORAGE_BUDGET_BYTES) * 100);
  const storageAmber = storagePercent > 80;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="flex flex-col gap-3 p-4">

        {/* ── Card 1: Bridge daemon ─────────────────────────────────────────── */}
        <Card>
          {/* Header row: dot + title + version badge */}
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                  statsError ? "bg-red-500" : "bg-success-600"
                }`}
                aria-hidden="true"
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Bridge daemon
              </span>
            </div>
            {stats !== null && (
              <span className="text-xs font-mono text-gray-500" aria-label={`version ${stats.version}`}>
                v{stats.version}
              </span>
            )}
          </div>

          {statsError ? (
            /* Down state */
            <div className="px-3 py-3 flex flex-col gap-2 border-t border-gray-100">
              <p className="text-sm text-red-600 font-medium">Bridge not reachable</p>
              <p className="text-xs text-gray-500">
                Start with:{" "}
                <code
                  id="bridge-start-cmd"
                  className="font-mono text-xs text-gray-900 bg-gray-100 rounded px-1 py-0.5"
                >
                  {RESTART_COMMAND}
                </code>
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 border-t border-gray-100">

              {/* Endpoint row */}
              <div className="px-3 py-2 flex items-start gap-2">
                <span className="text-xs text-gray-500 shrink-0 pt-0.5 w-20">Endpoint</span>
                <div className="flex-1 min-w-0">
                  {isEditingEndpoint ? (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={endpointInputId} className="sr-only">
                        Bridge endpoint
                      </label>
                      <input
                        id={endpointInputId}
                        type="text"
                        value={endpointDraft}
                        onChange={(e) => setEndpointDraft(e.target.value)}
                        className="text-xs font-mono border border-gray-300 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-primary-500"
                        aria-label="Bridge endpoint"
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={handleEndpointReconnect}
                          className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          Reconnect
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingEndpoint(false)}
                          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={handleCopyEndpoint}
                        title="Click to copy endpoint"
                        aria-label={`Bridge endpoint: ${endpoint}`}
                        className="text-xs font-mono text-gray-900 hover:text-primary-600 truncate max-w-xs"
                      >
                        {endpoint}
                      </button>
                      <button
                        type="button"
                        onClick={handleEndpointEditOpen}
                        aria-label="Edit endpoint"
                        className="text-xs text-gray-400 hover:text-gray-700 shrink-0"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Uptime row */}
              {stats !== null && (
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs text-gray-500">Uptime</span>
                  <span className="text-xs text-gray-900">
                    {formatUptime(stats.uptimeMs)} · {stats.runsRelayed} runs relayed
                  </span>
                </div>
              )}

              {/* Token index row */}
              {stats !== null && (
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs text-gray-500">Token index</span>
                  <span className="text-xs text-gray-900 text-right">
                    {formatTokenCount(stats.tokenCount)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Actions row */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 relative">
            {/* Restart button + popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setRestartOpen((v) => !v)}
                aria-label="Restart bridge"
                aria-expanded={restartOpen}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Restart
              </button>
              {restartOpen && (
                <div
                  role="dialog"
                  aria-label="Restart options"
                  className="absolute bottom-full left-0 mb-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-10"
                >
                  <p className="text-xs text-gray-500 mb-2">
                    Stop and restart the bridge daemon:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-gray-900 bg-gray-100 rounded px-2 py-1 flex-1">
                      {RESTART_COMMAND}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyRestartCommand}
                      aria-label="Copy restart command"
                      className="text-xs text-primary-600 hover:underline shrink-0 font-medium"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setLogsOpen(true)}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              View logs
            </button>
          </div>
        </Card>

        {/* ── Card 2: Subscription ─────────────────────────────────────────── */}
        <Card>
          <SectionHeader>Subscription</SectionHeader>
          <div className="divide-y divide-gray-100">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-gray-500">Account</span>
              <span className="text-xs text-gray-700">Local only</span>
            </div>
            {/* Keys row: ALWAYS rendered — the security invariant as UI copy */}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-gray-500">Keys</span>
              <span className="text-xs text-gray-700">
                Held by bridge — never in this plugin{" "}
                <span className="text-success-600" aria-hidden="true">✓</span>
              </span>
            </div>
          </div>
        </Card>

        {/* ── Card 3: Agent skills ──────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Agent skills
            </span>
            <span className="text-xs text-gray-400 normal-case tracking-normal font-normal">
              server-side, read-only
            </span>
          </div>
          {skills.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 pb-3">No skills loaded.</p>
          ) : (
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              {skills.map((skill) => (
                <div
                  key={skill.name}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="text-xs font-mono text-gray-900">{skill.name}</span>
                  <span className="text-xs text-gray-400 font-mono">
                    rev {skill.rev}
                    {skill.pinned && (
                      <span className="text-gray-600"> · pinned</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Card 4: File storage ─────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              File storage
            </span>
            <span className="text-xs text-gray-500 tabular-nums">
              {formatStorageKb(storageUsed)}
            </span>
          </div>
          <div className="px-3 pb-3 flex flex-col gap-2">
            {/* Progress bar */}
            <div
              className="w-full h-2 bg-gray-100 rounded-full overflow-hidden"
              aria-label="Storage used"
            >
              <div
                role="progressbar"
                aria-valuenow={Math.round(storagePercent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${Math.round(storagePercent)}% of 100 kb used`}
                className={`h-full rounded-full transition-all duration-300 ${
                  storageAmber ? "bg-warn-600" : "bg-primary-600"
                }`}
                style={{ width: `${storagePercent}%` }}
              />
            </div>

            <p className="text-xs text-gray-400">
              Only IDs + hashes stored in file. Heavy payloads live in the bridge cache.
            </p>

            {storageAmber && (
              <button
                type="button"
                onClick={() => void handleCompact()}
                className="self-start text-xs px-3 py-1.5 rounded border border-warn-400 text-warn-700 hover:bg-warn-50"
                aria-label="Compact storage"
              >
                Compact
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* ── Logs drawer ───────────────────────────────────────────────────── */}
      <LogsDrawer
        bridge={bridge}
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
      />
    </div>
  );
}
