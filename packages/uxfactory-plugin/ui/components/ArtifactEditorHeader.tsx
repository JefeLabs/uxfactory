/**
 * ArtifactEditorHeader — the shared top bar for every artifact editor mode
 * (markdown sections, JSON form, read-only). Presentational: the caller owns
 * dirty/save state and passes an `onSave` only when a Save button should show.
 */

import React from "react";
import type { ArtifactStatus } from "../lib/bridge.js";
import { ActionTooltip } from "./ActionTooltip.js";

const DOT_CLASS: Record<ArtifactStatus, string> = {
  "up-to-date": "bg-success-600",
  draft: "bg-warn-600",
  missing: "border-2 border-gray-300",
};

export interface ArtifactEditorHeaderProps {
  label: string;
  status: ArtifactStatus;
  onBack: () => void;
  onRegenerate: () => void;
  /** When provided, a Save button renders; omit it for read-only modes. */
  onSave?: () => void;
  /** Disables the Save button (nothing to save, or a save in flight). */
  saveDisabled?: boolean;
  /** Root gate: true disables Regenerate (e.g. the product brief is missing). */
  regenerateDisabled?: boolean;
  /** Tooltip shown on the disabled Regenerate button. */
  regenerateDisabledReason?: string;
}

export function ArtifactEditorHeader({
  label,
  status,
  onBack,
  onRegenerate,
  onSave,
  saveDisabled = false,
  regenerateDisabled = false,
  regenerateDisabledReason,
}: ArtifactEditorHeaderProps): React.JSX.Element {
  const regenerateButton = (
    <button
      type="button"
      onClick={onRegenerate}
      disabled={regenerateDisabled}
      className="text-xs text-gray-600 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 shrink-0 disabled:text-gray-300 disabled:cursor-not-allowed"
    >
      Regenerate
    </button>
  );

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        aria-label="Back to artifacts"
      >
        ← Back
      </button>

      <span
        aria-hidden="true"
        className={`w-2 h-2 shrink-0 rounded-full ${DOT_CLASS[status]}`}
      />

      <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{label}</span>

      {regenerateDisabled ? (
        <ActionTooltip label={regenerateDisabledReason ?? "Regenerate is unavailable"}>
          <span tabIndex={0}>{regenerateButton}</span>
        </ActionTooltip>
      ) : (
        regenerateButton
      )}

      {onSave !== undefined && (
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          className="text-xs px-3 py-1.5 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          aria-label="Save artifact"
        >
          Save
        </button>
      )}
    </div>
  );
}
