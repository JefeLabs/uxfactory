/**
 * IndustrySelect.tsx — the project-industry droplist shared by
 * SetupClassification and the ContextBar's industry chip editor.
 *
 * Grouped by the taxonomy's 13 sectors (76 industries); the caption below
 * shows the selection's drivers and compliance flags — industry is a flavor
 * modifier, and the caption says what flavor. Legacy stored values
 * (corporate/finance/…) normalize on render; the next save upgrades them.
 */
import React from "react";
import {
  INDUSTRY_SECTORS,
  INDUSTRY_TAXONOMY,
  industryDrivers,
  normalizeIndustry,
} from "@uxfactory/spec";

export interface IndustrySelectProps {
  value: string;
  onChange(value: string): void;
  id?: string;
  ariaLabel?: string;
}

export function IndustrySelect({
  value,
  onChange,
  id,
  ariaLabel = "Industry",
}: IndustrySelectProps): React.JSX.Element {
  const normalized = normalizeIndustry(value);
  return (
    <div className="space-y-1">
      <select
        id={id}
        aria-label={ariaLabel}
        value={normalized}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-gray-300 rounded-[var(--radius-card)] px-3 py-2 bg-white text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        {INDUSTRY_SECTORS.map((sector) => (
          <optgroup key={sector.id} label={sector.label}>
            {Object.entries(INDUSTRY_TAXONOMY)
              .filter(([, profile]) => profile.sector === sector.id)
              .map(([industryId, profile]) => (
                <option key={industryId} value={industryId}>
                  {profile.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs text-gray-500">{industryDrivers(normalized)}</p>
    </div>
  );
}
