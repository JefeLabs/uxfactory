import React from "react";

export interface ChipProps {
  label: string;
  value?: string;
  selected?: boolean;
  onSelect?: () => void;
  tone?: "default" | "dial";
}

export function Chip({ label, selected = false, onSelect, tone = "default" }: ChipProps) {
  const base =
    "inline-flex items-center px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors select-none";

  const selectedStyle =
    "bg-primary-50 border-primary-600 text-primary-600 font-semibold";
  const unselectedStyle =
    tone === "dial"
      ? "bg-white border-gray-300 text-gray-700 hover:border-gray-400"
      : "bg-white border-gray-300 text-gray-700 hover:border-gray-400";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onSelect}
      className={`${base} ${selected ? selectedStyle : unselectedStyle}`}
    >
      {label}
    </button>
  );
}
