/**
 * CategorySelect.tsx — the project-category droplist shared by
 * SetupClassification and the ContextBar's category chip editor.
 *
 * Grouped by the taxonomy's 8 groups (34 categories); the caption below
 * previews the CONSEQUENCES the selection sets (dial defaults, activations,
 * compliance posture) — category is a defaults-driver, not a label. Legacy
 * stored values (marketing/ecommerce/webapp/news) normalize on render; the
 * next save upgrades them.
 */
import React from "react";
import {
  CATEGORY_GROUPS,
  CATEGORY_TAXONOMY,
  categoryConsequences,
  normalizeCategory,
} from "@uxfactory/spec";

export interface CategorySelectProps {
  value: string;
  onChange(value: string): void;
  id?: string;
  ariaLabel?: string;
}

export function CategorySelect({
  value,
  onChange,
  id,
  ariaLabel = "Category",
}: CategorySelectProps): React.JSX.Element {
  const normalized = normalizeCategory(value);
  return (
    <div className="space-y-1">
      <select
        id={id}
        aria-label={ariaLabel}
        value={normalized}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-300 rounded-[var(--radius-card)] px-3 py-2 bg-white text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        {CATEGORY_GROUPS.map((group) => (
          <optgroup key={group.id} label={group.label}>
            {Object.entries(CATEGORY_TAXONOMY)
              .filter(([, profile]) => profile.group === group.id)
              .map(([categoryId, profile]) => (
                <option key={categoryId} value={categoryId}>
                  {profile.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs text-gray-500">{categoryConsequences(normalized)}</p>
    </div>
  );
}
