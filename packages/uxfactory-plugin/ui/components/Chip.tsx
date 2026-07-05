import React from "react";

export interface ChipProps {
  label: string;
  value?: string;
  selected?: boolean;
  onSelect?: () => void;
  tone?: "default" | "dial";
  /** "sm" renders a compact chip for dense bars (e.g. the header chips bar). */
  size?: "md" | "sm";
}

export function Chip({
  label,
  value,
  selected = false,
  onSelect,
  tone = "default",
  size = "md",
}: ChipProps) {
  const sizing = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-sm";
  // Dial chips always keep a gap between the label and value spans.
  const base = `inline-flex items-center ${sizing} rounded-full border cursor-pointer transition-colors select-none${
    tone === "dial" ? " gap-1" : ""
  }`;

  const selectedStyle =
    "bg-primary-50 border-primary-600 text-primary-600 font-semibold";

  // "dial" chips are quiet by default: the outline matches the chip background
  // (selection brings the primary border). Label muted, value semibold.
  const unselectedStyle =
    tone === "dial"
      ? "bg-white border-white text-gray-600 hover:border-gray-300"
      : "bg-white border-gray-300 text-gray-700 hover:border-gray-400";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      // Dial chips render label+value as adjacent spans, which would compute a
      // spaceless accessible name ("VisualHigh") — give them an explicit one.
      aria-label={tone === "dial" ? `${label} ${value ?? ""}`.trim() : undefined}
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
