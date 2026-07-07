/**
 * Connect.tsx — First-run and reconnect screen.
 *
 * Lets the user link the current Figma file to a project repository through
 * the local bridge (Local Dev) or a hosted worker (Cloud — stub for now).
 *
 * Props carry the IO clients so tests can inject fakes without mocking modules.
 *
 * SELECTOR DISCIPLINE: every useAppStore() call selects a single primitive or
 * stable function reference. Never return a new object-literal — React 19
 * detects a changed snapshot on every render and throws an infinite-update error.
 */

import React, { useEffect, useId, useState } from "react";
import { Code } from "lucide-react";
import type { Bridge } from "../lib/bridge.js";
import type { PluginBus } from "../lib/plugin-bus.js";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { healthQuery, connectProjectMutation, queryKeys, activeRoot } from "../queries.js";
import { useAppStore } from "../stores/app.js";
import { Card, Field, Segmented, StatusPill } from "../components/index.js";
import type { SegmentedOption, StatusPillStatus } from "../components/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type BridgeStatus = "checking" | "running" | "down";

interface StoredConnection {
  mode: "local" | "cloud";
  endpoint: string;
  repoPath: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODE_OPTIONS: SegmentedOption[] = [
  { label: "Local Dev", value: "local" },
  { label: "Cloud", value: "cloud" },
];

const INSTALL_CMD = "npm install -g @uxfactory/cli";
const LAUNCH_CMD = "uxfactory bridge";
const COMBINED_SETUP_CMD = `${INSTALL_CMD} && ${LAUNCH_CMD}`;

// ─── Helper: text-selection fallback for clipboard ───────────────────────────

function selectText(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// ─── Copyable command row (bridge-down setup hint) ────────────────────────────

function CopyableCommand({
  id,
  step,
  command,
  copyLabel,
}: {
  id: string;
  step: string;
  command: string;
  copyLabel: string;
}): React.JSX.Element {
  const handleCopy = (): void => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(command).catch(() => selectText(id));
    } else {
      selectText(id);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-3 shrink-0" aria-hidden="true">
        {step}
      </span>
      <code
        id={id}
        className="text-xs font-mono bg-gray-100 border border-gray-200 px-2 py-1 rounded text-gray-800 select-all"
      >
        {command}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="text-xs text-primary-600 hover:text-primary-700 hover:underline"
        aria-label={copyLabel}
      >
        Copy
      </button>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Connect({
  bridge,
  bus,
}: {
  bridge: Bridge;
  bus: PluginBus;
}): React.JSX.Element {
  // ── Store selectors (single primitives / stable refs only) ─────────────────
  const fileName = useAppStore((s) => s.fileInfo?.name ?? "this file");
  const fileKey = useAppStore((s) => s.fileInfo?.fileKey ?? "");
  const connectionEndpoint = useAppStore((s) => s.connection.endpoint);
  const connectionRepoPath = useAppStore((s) => s.connection.repoPath);
  const connectionMode = useAppStore((s) => s.connection.mode);
  const connectStart = useAppStore((s) => s.connectStart);
  const connectSucceeded = useAppStore((s) => s.connectSucceeded);
  const connectFailed = useAppStore((s) => s.connectFailed);

  // ── Local state ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"local" | "cloud">(connectionMode);
  const [repoPath, setRepoPath] = useState(connectionRepoPath);
  // isReturning: hide hero band for users who have connected before
  const [isReturning, setIsReturning] = useState(connectionRepoPath !== "");
  const [bridgeCwd, setBridgeCwd] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const repoInputId = useId();

  // ── Bridge health via query (3s refetchInterval, replaces manual poll) ───────
  const healthResult = useQuery(healthQuery(bridge));
  const bridgeStatus: BridgeStatus = healthResult.isPending
    ? "checking"
    : healthResult.data?.ok
      ? "running"
      : "down";

  // ── Repo list query (three-tier degradation: getRepos → getCwd → nothing) ───
  const reposResult = useQuery({
    queryKey: ["repos"],
    queryFn: () => bridge.getRepos!(),
    enabled: typeof bridge.getRepos === "function" && bridgeStatus === "running",
    staleTime: 5_000,
  });
  const repos = reposResult.data?.repos ?? [];
  // Server order is authoritative (cwd pinned first, most-recent-first); only hide the
  // chip whose root already matches the current field value.
  const visibleRepos = repos.filter((r) => r.root !== repoPath.trim());

  // ── Router + connect mutation ─────────────────────────────────────────────────
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connect = useMutation({
    ...connectProjectMutation(bridge),
    onSuccess: (result) => {
      if (!result.ok) {
        let message: string;
        if (result.reason === "not-found") message = "Path not found";
        else if (result.reason === "not-a-root")
          message =
            "Not a repository root — pick the folder containing uxfactory.batch.json or .git";
        else if (result.reason === "bridge-serves-different-root")
          message = result.served
            ? `This bridge serves ${result.served} — start \`uxfactory bridge\` in your repo or connect to that path`
            : "Bridge serves a different repository root";
        else message = "Connection failed";
        setPathError(message);
        setIsConnecting(false);
        return;
      }
      const capturedMode = mode;
      const capturedEndpoint = connectionEndpoint;
      // Use the resolved absolute root from the server, not the raw typed path.
      // setProjectRoot must run BEFORE setQueryData so the seed lands under the
      // rooted key that subsequent reads will use.
      const resolvedRoot = result.snapshot.root;
      bridge.setProjectRoot?.(resolvedRoot);
      queryClient.setQueryData(queryKeys.snapshot(activeRoot(bridge)), result.snapshot);
      connectSucceeded(result.snapshot, resolvedRoot, (payload) => {
        void bus.storageSet(storageKey, {
          ...payload,
          mode: capturedMode,
          endpoint: capturedEndpoint,
        });
      });
      void navigate({
        to: result.snapshot.hasClassification
          ? "/tabs/prompt"
          : "/setup/classification",
      });
    },
    onError: () => {
      connectFailed(
        `Bridge not reachable at ${connectionEndpoint} — start it with \`uxfactory bridge\``,
      );
      setIsConnecting(false);
    },
  });

  // ── Derived ─────────────────────────────────────────────────────────────────
  const storageKey = `connection:${fileKey}`;

  const ctaEnabled =
    bridgeStatus === "running" && repoPath.trim() !== "" && !isConnecting;

  const pillStatus: StatusPillStatus =
    bridgeStatus === "running"
      ? "running"
      : bridgeStatus === "down"
        ? "down"
        : "checking";

  const pillLabel =
    bridgeStatus === "running"
      ? "Running"
      : bridgeStatus === "down"
        ? "Not detected"
        : "Checking…";

  // ── Load stored connection on mount ─────────────────────────────────────────
  useEffect(() => {
    if (storageKey === "connection:") return; // fileInfo not loaded yet
    let cancelled = false;

    bus
      .storageGet<StoredConnection>(storageKey)
      .then((stored) => {
        if (cancelled || !stored) return;
        if (stored.repoPath) {
          setRepoPath(stored.repoPath);
          setIsReturning(true);
        }
        if (stored.mode === "local" || stored.mode === "cloud") {
          setMode(stored.mode);
        }
      })
      .catch(() => {
        // Fail silently — plugin storage is best-effort
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // ── Cwd hint: the bridge's working directory is almost always the repo root ──
  useEffect(() => {
    if (bridgeStatus !== "running" || bridgeCwd !== null) return;
    const pending = bridge.getCwd?.();
    if (!pending) return; // legacy bridge builds don't serve /fs/cwd
    let cancelled = false;
    pending
      .then((res) => {
        if (!cancelled && res.cwd !== "") setBridgeCwd(res.cwd);
      })
      .catch(() => {
        // Hint only — never block connecting on it
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, bridgeStatus, bridgeCwd]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleConnect = async (): Promise<void> => {
    if (!ctaEnabled) return;
    setPathError(null);
    setIsConnecting(true);
    connectStart();
    connect.mutate(repoPath.trim());
  };

  const handleCopyBoth = (): void => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(COMBINED_SETUP_CMD)
        .catch(() => selectText("combined-cmd"));
    } else {
      selectText("combined-cmd");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      {/* ── Hero band (full-width indigo) — hidden for returning users ─── */}
      {!isReturning && (
        <div className="bg-primary-600 px-6 py-8 text-white shrink-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20">
              <Code size={24} className="text-white" aria-hidden="true" />
            </div>
            <p className="text-2xl font-bold">UX Factory</p>
          </div>
          <p className="text-base font-semibold mb-3">
            Generated by AI. Verified against your intent.
          </p>
          <ul className="space-y-1 text-sm text-white/90">
            <li>· Register intent once — stories, personas, features, brand, accessibility</li>
            <li>· Generate pages and flows grounded in those artifacts</li>
            <li>· A deterministic gate blocks renders that miss your stories</li>
            <li>· Every page traces back to the story it serves</li>
          </ul>
        </div>
      )}

      {/* ── Connect section ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 p-6">
        {/* Headline: file name highlighted in primary-600 */}
        <h2 className="text-lg font-bold text-gray-900">
          Connect{" "}
          <span className="text-primary-600">{fileName}</span>
          {" "}to your project
        </h2>

        {/* Mode segmented control */}
        <Segmented
          options={MODE_OPTIONS}
          value={mode}
          onChange={(v) => setMode(v as "local" | "cloud")}
          ariaLabel="Connection mode"
        />

        {/* Mode explainer */}
        {mode === "local" ? (
          <p className="text-sm text-gray-600">
            Link current Figma file to a project repository and leverage your machine&apos;s
            agent setup whether a subscription or local hosted LLM.
          </p>
        ) : (
          <Card className="p-4">
            <p className="text-sm text-gray-600">
              Cloud connect arrives with hosted workers — Local Dev is fully functional today.
            </p>
          </Card>
        )}

        {/* ── Local Dev rows ───────────────────────────────────────────── */}
        {mode === "local" && (
          <>
            {/* Bridge status */}
            <Field label="Bridge:" align="start">
              <div className="flex flex-col gap-2">
                <StatusPill status={pillStatus} label={pillLabel} />

                {/* Setup commands until the bridge is confirmed running: install once, then launch */}
                {bridgeStatus !== "running" && (
                  <div className="flex flex-col gap-1.5">
                    <CopyableCommand
                      id="install-cmd"
                      step="1."
                      command={INSTALL_CMD}
                      copyLabel="Copy npm install command"
                    />
                    <CopyableCommand
                      id="bridge-cmd"
                      step="2."
                      command={LAUNCH_CMD}
                      copyLabel="Copy uxfactory bridge command"
                    />
                    <div className="flex items-center gap-2">
                      <span className="w-3 shrink-0" aria-hidden="true" />
                      {/* Hidden but selectable — the selectText fallback target */}
                      <span id="combined-cmd" className="sr-only">
                        {COMBINED_SETUP_CMD}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyBoth}
                        className="text-xs text-primary-600 hover:text-primary-700 hover:underline"
                        aria-label="Copy both commands as one"
                      >
                        Copy both as one command
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">
                      Requires Node ≥ 20.10. Run the launch command from your
                      repository root and keep it running.
                    </p>
                  </div>
                )}
              </div>
            </Field>

            {/* Repository path input */}
            <Field
              label="Repository:"
              error={pathError ?? undefined}
              id={repoInputId}
            >
              <input
                id={repoInputId}
                type="text"
                value={repoPath}
                onChange={(e) => {
                  setRepoPath(e.target.value);
                  if (pathError) setPathError(null);
                }}
                placeholder="~/path/to/repo"
                disabled={isConnecting}
                className={[
                  "w-full font-mono text-sm border rounded-[var(--radius-card)] px-3 py-2",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
                  "disabled:opacity-60",
                  pathError
                    ? "border-fail-600 bg-red-50"
                    : "border-gray-200 bg-white",
                ].join(" ")}
                aria-invalid={pathError ? "true" : undefined}
              />
            </Field>

            {/* Tier-1: Repo chip list from getRepos — server-ordered (cwd first, most-recent-first).
                Dead (live:false) repos are visually muted but remain clickable.
                Hides when Tier 1 has no chips remaining (all already match the field). */}
            {visibleRepos.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {visibleRepos.map((r) => (
                  <button
                    key={r.root}
                    type="button"
                    onClick={() => {
                      setRepoPath(r.root);
                      if (pathError) setPathError(null);
                    }}
                    className={[
                      "text-xs px-2 py-1 rounded-[var(--radius-card)] border transition-colors",
                      r.live
                        ? "text-primary-700 bg-primary-50 border-primary-100 hover:bg-primary-100"
                        : "text-gray-400 bg-gray-50 border-gray-200",
                    ].join(" ")}
                    title={r.root}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}

            {/* Tier-2: Cwd hint chip — single-chip fallback when getRepos is unavailable.
                Suppressed when Tier-1 chips are present (repos.length > 0). */}
            {repos.length === 0 && bridgeCwd !== null && repoPath.trim() !== bridgeCwd && (
              <button
                type="button"
                onClick={() => {
                  setRepoPath(bridgeCwd);
                  if (pathError) setPathError(null);
                }}
                className="w-full text-left text-xs text-primary-700 bg-primary-50 border border-primary-100 rounded-[var(--radius-card)] px-3 py-2 hover:bg-primary-100 transition-colors"
              >
                Use bridge folder:{" "}
                <span className="font-mono break-all">{bridgeCwd}</span>
              </button>
            )}

            {/* Primary CTA */}
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={!ctaEnabled}
              aria-busy={isConnecting}
              className={[
                "w-full py-3 rounded-[var(--radius-card)] text-sm font-semibold transition-colors",
                ctaEnabled
                  ? "bg-primary-600 text-white hover:bg-primary-700"
                  : "bg-primary-300 text-white cursor-not-allowed",
              ].join(" ")}
            >
              {isConnecting ? "Connecting…" : "Connect"}
            </button>

            {/* Validation caption */}
            <p className="text-xs text-gray-400 text-center">
              Repository root is validated on connect.
            </p>
          </>
        )}

        {/* ── Cloud stub CTA (not a dead-end) ─────────────────────────── */}
        {mode === "cloud" && (
          <button
            type="button"
            disabled
            className="w-full py-3 rounded-[var(--radius-card)] text-sm font-semibold bg-gray-200 text-gray-400 cursor-not-allowed"
          >
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
