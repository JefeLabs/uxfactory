/**
 * DesignStylePicker.tsx — the design-style select shared by SetupDefaults
 * (Generation defaults) and the ContextBar's inline style editor.
 *
 * Design style is a GENERATIVE DEFAULT with an explicit exploring state:
 * "" means "no default yet" — nothing is auto-committed, the composer's
 * per-request override is the exploration tool, and the advisory style
 * gate is not owed. The industry/category suggestion is a marker on the
 * suggested option, never a silently-submitted value.
 */
import React from "react";
import { DESIGN_STYLES, DESIGN_STYLE_GROUPS } from "../lib/design-styles.js";

export interface DesignStylePickerProps {
  /** Current value; "" = exploring (no project default). */
  value: string;
  onChange(value: string): void;
  /** Style slug to mark "(suggested)" — from category/industry. */
  suggested?: string;
  id?: string;
  /** Accessible name — distinguish call sites (the composer's per-request
   *  override select is already named "Design style"). */
  ariaLabel?: string;
}

export function DesignStylePicker({
  value,
  onChange,
  suggested,
  id,
  ariaLabel = "Design style",
}: DesignStylePickerProps): React.JSX.Element {
  const traits = DESIGN_STYLES.find((s) => s.value === value)?.traits ?? [];
  return (
    <div className="space-y-1">
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-300 rounded-[var(--radius-card)] px-3 py-2 bg-white text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        <option value="">Exploring — no default yet</option>
        {DESIGN_STYLE_GROUPS.map((group) => (
          <optgroup key={group.id} label={group.label}>
            {DESIGN_STYLES.filter((s) => s.group === group.id).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
                {s.value === suggested ? " (suggested)" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs text-gray-500">
        {value === ""
          ? "Try styles per generate from the composer — adopt a default when one clicks."
          : traits.join(" · ")}
      </p>
    </div>
  );
}
