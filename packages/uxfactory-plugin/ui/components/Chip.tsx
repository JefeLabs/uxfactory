import React from "react";

export interface ChipProps {
  label: string;
  value?: string;
  selected?: boolean;
  onSelect?: () => void;
  tone?: "default" | "dial";
}

export function Chip({ label, value, selected = false, onSelect, tone = "default" }: ChipProps) {
  const base =
    "inline-flex items-center px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors select-none";

  const selectedStyle =
    "bg-primary-50 border-primary-600 text-primary-600 font-semibold";

  // "dial" chips have a lighter border to distinguish them from plain filter chips.
  // Their label prefix is rendered muted and the value part semibold (see tone branch below).
  const unselectedStyle =
    tone === "dial"
      ? "bg-white border-gray-200 text-gray-600 hover:border-gray-300 gap-1"
      : "bg-white border-gray-300 text-gray-700 hover:border-gray-400";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      data-value={value}
      onClick={onSelect}
      className={`${base} ${selected ? selectedStyle : unselectedStyle}`}
    >
      {tone === "dial" ? (
        // "Visual High" style: muted prefix label + semibold value (e.g. label="Visual" value="High")
        <>
          <span className="text-gray-400">{label}</span>
          <span className="font-semibold text-gray-900">{value ?? label}</span>
        </>
      ) : (
        label
      )}
    </button>
  );
}
