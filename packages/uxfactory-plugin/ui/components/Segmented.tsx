import React from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";

export interface SegmentedOption {
  label: string;
  value: string;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}

export function Segmented({ options, value, onChange, ariaLabel }: SegmentedProps) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={onChange}
      aria-label={ariaLabel}
      className="flex w-full border border-gray-200 rounded-[var(--radius-card)] overflow-hidden"
    >
      {options.map((opt, i) => {
        const isSelected = value === opt.value;
        const isFirst = i === 0;
        const isLast = i === options.length - 1;

        return (
          <RadioGroup.Item
            key={opt.value}
            value={opt.value}
            aria-label={opt.label}
            className={[
              "flex-1 py-2 text-sm text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-inset",
              isSelected
                ? "bg-primary-50 text-primary-600 font-semibold"
                : "bg-white text-gray-600 hover:bg-gray-50",
              !isFirst && "border-l border-gray-200",
              isFirst && "rounded-l-[var(--radius-card)]",
              isLast && "rounded-r-[var(--radius-card)]",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {opt.label}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
