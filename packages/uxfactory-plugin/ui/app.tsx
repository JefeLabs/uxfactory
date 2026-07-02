/**
 * app.tsx — Shell: TitleBar + ContextBar + TabNav + screen switch.
 *
 * Screen switch:
 *   connect   → ConnectScreen (placeholder until Task 6)
 *   setup-1   → SetupClassificationScreen (placeholder until Task 7)
 *   setup-2   → SetupDefaultsScreen (placeholder until Task 8)
 *   tabs      → ContextBar + TabNav with per-tab placeholder Cards
 *
 * ContextBar: collapsed by default — shows project name, category + layout
 * chips, +N overflow chip, StatusPill, and a chevron to expand all chip rows.
 *
 * SELECTOR DISCIPLINE: every useAppStore() call selects a single primitive or
 * a stable object/function reference already stored in Zustand.  Never return a
 * new object-literal `{}` from a selector — React 19 will detect a changed
 * snapshot on every render and throw an infinite-update error.
 */

import React, { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Code, ChevronDown, ChevronUp } from "lucide-react";
import { useAppStore } from "./stores/app.js";
import type { Tab } from "./stores/app.js";
import { Chip, Card, StatusPill } from "./components/index.js";
import type { StatusPillStatus } from "./components/index.js";

// ─── TitleBar ────────────────────────────────────────────────────────────────

function TitleBar() {
  // Inline the close handler rather than selecting it from the store — avoids
  // creating a new closure reference on every render.
  function handleClose() {
    if (typeof parent !== "undefined" && parent !== window) {
      parent.postMessage({ pluginMessage: { type: "close" } }, "*");
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
      <div className="flex items-center justify-center w-6 h-6 rounded bg-primary-600 shrink-0">
        <Code size={14} className="text-white" aria-hidden="true" />
      </div>
      <span className="flex-1 text-sm font-medium truncate text-white">
        UXFactory (Developer VM)
      </span>
      <button
        type="button"
        aria-label="Close"
        onClick={handleClose}
        className="text-gray-400 hover:text-white text-base leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}

// ─── Connection status → StatusPill status mapping ────────────────────────────

function connectionStatusToPill(status: string): StatusPillStatus {
  switch (status) {
    case "connected": return "connected";
    case "connecting":
    case "reconnecting": return "reconnecting";
    case "error": return "down";
    default: return "disconnected";
  }
}

// ─── ContextBar ───────────────────────────────────────────────────────────────

function ContextBar() {
  // Select stable store slices individually to avoid new-object-literal pitfall.
  const connection = useAppStore((s) => s.connection);
  const snapshot = useAppStore((s) => s.snapshot);
  const goto = useAppStore((s) => s.goto);
  const [expanded, setExpanded] = useState(false);

  const pillStatus = connectionStatusToPill(connection.status);
  const projectName =
    snapshot?.name ??
    (connection.repoPath ? connection.repoPath.split("/").pop() ?? "Project" : "Project");

  // Build classification chips from snapshot
  const cls = snapshot?.classification ?? null;
  const category = typeof cls?.["category"] === "string" ? cls["category"] : null;
  const layout = typeof cls?.["layout"] === "string" ? cls["layout"] : null;
  const industry = typeof cls?.["industry"] === "string" ? cls["industry"] : null;
  const locale = typeof cls?.["locale"] === "string" ? cls["locale"] : null;
  const ageGroup = typeof cls?.["ageGroup"] === "string" ? cls["ageGroup"] : null;
  const platforms = Array.isArray(cls?.["platforms"])
    ? (cls?.["platforms"] as string[])
    : [];

  // Collapsed: show category + layout + "+N" for the rest
  const primaryChips = [category, layout].filter(Boolean) as string[];
  const secondaryChips = [industry, locale, ageGroup, ...platforms].filter(Boolean) as string[];
  const overflowCount = expanded ? 0 : secondaryChips.length;

  // Reconnecting state — compact row with cancel button only
  if (connection.status === "reconnecting") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 text-sm shrink-0">
        <StatusPill status="reconnecting" />
        <button
          type="button"
          onClick={() => goto("connect")}
          className="ml-auto text-xs text-gray-500 hover:text-gray-700 underline"
          aria-label="Cancel reconnect"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border-b border-gray-200 shrink-0">
      {/* Collapsed row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0">
          {projectName}
        </span>

        <div className="flex items-center gap-1 flex-wrap">
          {primaryChips.map((label) => (
            <Chip
              key={label}
              label={label}
              selected
              tone="default"
            />
          ))}
          {overflowCount > 0 && (
            <Chip
              label={`+${overflowCount}`}
              selected={false}
              tone="default"
            />
          )}
        </div>

        <StatusPill status={pillStatus} />

        <button
          type="button"
          aria-label={expanded ? "Collapse project details" : "Expand project details"}
          onClick={() => setExpanded((v) => !v)}
          className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded rows */}
      {expanded && secondaryChips.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {secondaryChips.map((label) => (
            <Chip key={label} label={label} selected tone="default" />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TAB_DEFS: { value: Tab; label: string }[] = [
  { value: "prompt", label: "Prompt" },
  { value: "artifacts", label: "Artifacts" },
  { value: "components", label: "Components" },
  { value: "assets", label: "Assets" },
  { value: "checks", label: "Checks" },
  { value: "settings", label: "Settings" },
];

// ─── TabNav ───────────────────────────────────────────────────────────────────

function TabNav() {
  // Select individual primitives/stable references to avoid new-object-literal.
  const tab = useAppStore((s) => s.route.tab);
  const setTab = useAppStore((s) => s.setTab);

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="flex flex-col flex-1 min-h-0"
    >
      {/* Tab list */}
      <Tabs.List
        aria-label="Panel tabs"
        className="flex border-b border-gray-200 bg-white shrink-0 overflow-x-auto"
      >
        {TAB_DEFS.map(({ value, label }) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className={[
              "px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              "border-b-2 -mb-px",
              "data-[state=active]:border-primary-600 data-[state=active]:text-primary-600",
              "data-[state=inactive]:border-transparent data-[state=inactive]:text-gray-500",
              "data-[state=inactive]:hover:text-gray-700",
            ].join(" ")}
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {/* Tab panels — placeholder cards until each task lands */}
      {TAB_DEFS.map(({ value, label }) => (
        <Tabs.Content
          key={value}
          value={value}
          className="flex-1 overflow-y-auto p-4"
        >
          <Card>
            <p className="text-sm text-gray-500 text-center py-8">
              {label} arrives in a later task
            </p>
          </Card>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

// ─── Placeholder screens ──────────────────────────────────────────────────────

function ConnectScreen() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card>
        <p className="text-sm text-gray-500 text-center py-8">
          Connect arrives in a later task
        </p>
      </Card>
    </div>
  );
}

function SetupClassificationScreen() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card>
        <p className="text-sm text-gray-500 text-center py-8">
          Project Setup (Classification) arrives in a later task
        </p>
      </Card>
    </div>
  );
}

function SetupDefaultsScreen() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card>
        <p className="text-sm text-gray-500 text-center py-8">
          Project Setup (Generation Defaults) arrives in a later task
        </p>
      </Card>
    </div>
  );
}

// ─── App / Shell ─────────────────────────────────────────────────────────────

export function App() {
  // Select individual primitives/stable references only.
  const screen = useAppStore((s) => s.route.screen);
  const connectionStatus = useAppStore((s) => s.connection.status);
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  // Show the context bar on all post-connect screens, and also when
  // auto-reconnecting (which temporarily shows on the connect screen).
  const showContextBar =
    screen !== "connect" || connectionStatus === "reconnecting";

  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 overflow-hidden">
      <TitleBar />

      {showContextBar && <ContextBar />}

      {/* Screen switch */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {screen === "connect" && <ConnectScreen />}
        {screen === "setup-1" && <SetupClassificationScreen />}
        {screen === "setup-2" && <SetupDefaultsScreen />}
        {screen === "tabs" && <TabNav />}
      </div>

      {/* Toast overlay */}
      {toasts.length > 0 && (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 z-50"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 bg-gray-900 text-white text-sm rounded-lg px-3 py-2 shadow-lg"
            >
              <span className="flex-1">{t.message}</span>
              <button
                type="button"
                aria-label={`Dismiss: ${t.message}`}
                onClick={() => dismissToast(t.id)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
