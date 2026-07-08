/**
 * InfoTooltip — a small info-icon button that reveals guidance on hover/focus.
 *
 * Shared across the panel wherever a label needs an unobtrusive explanation
 * (setup dials, artifact-editor section headers). The `aria-label` carries the
 * full text so it's reachable without opening the tooltip (and testable).
 */

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

export interface InfoTooltipProps {
  /** Accessible label (full guidance text) on the trigger button. */
  label: string;
  /** Tooltip body shown on hover/focus. */
  content: string;
  /** Icon size in px (default 12). */
  size?: number;
}

export function InfoTooltip({ label, content, size = 12 }: InfoTooltipProps): React.JSX.Element {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex items-center justify-center w-4 h-4 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 rounded"
          >
            <Info size={size} aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={4}
            className="max-w-xs rounded-[var(--radius-card)] bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg z-50"
          >
            {content}
            <Tooltip.Arrow className="fill-gray-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
