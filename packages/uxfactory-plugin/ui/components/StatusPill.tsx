import React from "react";

export type StatusPillStatus =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "running"
  | "checking"
  | "down";

export interface StatusPillProps {
  status: StatusPillStatus;
  label?: string;
}

const DOT_CLASSES: Record<StatusPillStatus, string> = {
  connected: "bg-green-500",
  disconnected: "bg-gray-400",
  reconnecting: "bg-warn-600",
  running: "bg-green-500 animate-pulse",
  checking: "bg-gray-300",
  down: "bg-fail-600",
};

const DEFAULT_LABELS: Record<StatusPillStatus, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  reconnecting: "Reconnecting…",
  running: "Running",
  checking: "Checking",
  down: "Down",
};

const PILL_BORDER: Record<StatusPillStatus, string> = {
  connected: "border-green-200 bg-green-50 text-green-700",
  disconnected: "border-gray-200 bg-gray-50 text-gray-600",
  reconnecting: "border-amber-200 bg-amber-50 text-amber-700",
  running: "border-green-200 bg-green-50 text-green-700",
  checking: "border-gray-200 bg-gray-50 text-gray-500",
  down: "border-red-200 bg-red-50 text-red-700",
};

export function StatusPill({ status, label }: StatusPillProps) {
  const displayLabel = label ?? DEFAULT_LABELS[status];

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={displayLabel}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium ${PILL_BORDER[status]}`}
    >
      <span
        aria-hidden="true"
        className={`w-2 h-2 rounded-full ${DOT_CLASSES[status]}`}
      />
      {displayLabel}
    </span>
  );
}
