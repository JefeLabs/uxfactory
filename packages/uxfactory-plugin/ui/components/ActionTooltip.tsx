/**
 * ActionTooltip — wraps an existing action button in a fast, styled tooltip
 * (same bubble as InfoTooltip). Use for icon-only buttons whose meaning isn't
 * visible: the child keeps its own aria-label (the accessible/test contract);
 * this only adds the hover/focus bubble. Don't ALSO put a native `title` on
 * the child — that would show two tooltips.
 */

import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

export interface ActionTooltipProps {
  /** Tooltip body shown on hover/focus (usually the child's aria-label text). */
  label: string;
  /** Exactly one focusable element (the action button). */
  children: React.ReactElement;
}

export function ActionTooltip({ label, children }: ActionTooltipProps): React.JSX.Element {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={4}
            className="max-w-xs rounded-[var(--radius-card)] bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg z-50"
          >
            {label}
            <Tooltip.Arrow className="fill-gray-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
