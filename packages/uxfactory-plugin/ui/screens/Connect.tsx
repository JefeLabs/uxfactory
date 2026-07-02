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
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("checking");
  const [bridgeCwd, setBridgeCwd] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const repoInputId = useId();

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

  // ── Bridge health polling (every 3s, cleanup on unmount) ────────────────────
  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const result = await bridge.health();
        if (!cancelled) setBridgeStatus(result.ok ? "running" : "down");
      } catch {
        if (!cancelled) setBridgeStatus("down");
      }
    };

    void poll(); // immediate first check
    const interval = setInterval(() => void poll(), 3_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [bridge]);

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

    try {
      const result = await bridge.connectProject(repoPath.trim());

      if (result.ok) {
        // Capture local state before the async store action changes it
        const capturedMode = mode;
        const capturedEndpoint = connectionEndpoint;

        connectSucceeded(result.snapshot, repoPath.trim(), (payload) => {
          void bus.storageSet(storageKey, {
            ...payload,
            mode: capturedMode,
            endpoint: capturedEndpoint,
          });
        });
        // Navigation happens via store; don't reset isConnecting — screen unmounts
      } else {
        let message: string;
        if (result.reason === "not-found") {
          message = "Path not found";
        } else if (result.reason === "not-a-root") {
          message =
            "Not a repository root — pick the folder containing uxfactory.batch.json or .git";
        } else if (result.reason === "bridge-serves-different-root") {
          message = result.served
            ? `This bridge serves ${result.served} — start \`uxfactory bridge\` in your repo or connect to that path`
            : "Bridge serves a different repository root";
        } else {
          message = "Connection failed";
        }
        setPathError(message);
        setIsConnecting(false);
      }
    } catch {
      connectFailed(`Bridge not reachable at ${connectionEndpoint} — start it with \`uxfactory bridge\``);
      setIsConnecting(false);
    }
  };

  const handleCopyCommand = (): void => {
    const cmd = "uxfactory bridge";
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(cmd).catch(() => selectText("bridge-cmd"));
    } else {
      selectText("bridge-cmd");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 overflow-y-auto bg-gray-50">
      {/* ── Hero band (full-width indigo) — hidden for returning users ─── */}
      {!isReturning && (
        <div className="bg-primary-600 px-6 py-8 text-white shrink-0">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20 mb-4">
            <Code size={24} className="text-white" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold mb-3">UX artifacts at your fingertips.</p>
          <ul className="space-y-1 text-sm text-white/90">
            <li>
              · Create and maintain specifications for product, IA, UX and design concerns.
            </li>
            <li>· Verify your designs.</li>
            <li>· Generate goal-oriented AI-rendered designs.</li>
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
            <Field label="Bridge:">
              <div className="flex flex-col gap-2">
                <StatusPill status={pillStatus} label={pillLabel} />

                {/* Copyable command when bridge is down */}
                {bridgeStatus === "down" && (
                  <div className="flex items-center gap-2">
                    <code
                      id="bridge-cmd"
                      className="text-xs font-mono bg-gray-100 border border-gray-200 px-2 py-1 rounded text-gray-800 select-all"
                    >
                      uxfactory bridge
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyCommand}
                      className="text-xs text-primary-600 hover:text-primary-700 hover:underline"
                      aria-label="Copy uxfactory bridge command"
                    >
                      Copy
                    </button>
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

            {/* Cwd hint chip — one-click fill from the bridge's directory */}
            {bridgeCwd !== null && repoPath.trim() !== bridgeCwd && (
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
