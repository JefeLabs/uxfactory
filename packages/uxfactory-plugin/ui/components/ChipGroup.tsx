import React from "react";
import * as ToggleGroup from "@radix-ui/react-toggle-group";

export interface ChipGroupOption {
  label: string;
  value: string;
}

export interface ChipGroupProps {
  options: ChipGroupOption[];
  value?: string;
  values?: string[];
  onChange: (v: string | string[]) => void;
  multi?: boolean;
  ariaLabel: string;
}

const selectedStyle =
  "bg-primary-50 border-primary-600 text-primary-600 font-semibold";
const unselectedStyle =
  "bg-white border-gray-300 text-gray-700 hover:border-gray-400";
const chipBase =
  "inline-flex items-center px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600";

export function ChipGroup({
  options,
  value,
  values,
  onChange,
  multi = false,
  ariaLabel,
}: ChipGroupProps) {
  if (multi) {
    const current = values ?? [];
    return (
      <ToggleGroup.Root
        type="multiple"
        value={current}
        onValueChange={(v) => onChange(v)}
        aria-label={ariaLabel}
        className="flex flex-wrap gap-2"
      >
        {options.map((opt) => {
          const isSelected = current.includes(opt.value);
          return (
            <ToggleGroup.Item
              key={opt.value}
              value={opt.value}
              aria-label={opt.label}
              className={`${chipBase} ${isSelected ? selectedStyle : unselectedStyle}`}
            >
              {opt.label}
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup.Root>
    );
  }

  return (
    <ToggleGroup.Root
      type="single"
      value={value ?? ""}
      onValueChange={(v) => { if (v) onChange(v); }}
      aria-label={ariaLabel}
      className="flex flex-wrap gap-2"
    >
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <ToggleGroup.Item
            key={opt.value}
            value={opt.value}
            aria-label={opt.label}
            className={`${chipBase} ${isSelected ? selectedStyle : unselectedStyle}`}
          >
            {opt.label}
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
