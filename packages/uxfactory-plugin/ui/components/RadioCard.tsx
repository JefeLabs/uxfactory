import React from "react";

export interface RadioCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge?: string;
  children: React.ReactNode;
}

export function RadioCard({ selected, onSelect, title, badge, children }: RadioCardProps) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        "w-full rounded-[var(--radius-card)] border p-4 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
        selected
          ? "border-primary-600 bg-primary-50"
          : "border-gray-200 bg-white hover:border-gray-300",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        {/* Radio dot */}
        <span
          aria-hidden="true"
          className={[
            "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
            selected
              ? "border-primary-600"
              : "border-gray-300",
          ].join(" ")}
        >
          {selected && (
            <span className="w-2 h-2 rounded-full bg-primary-600" />
          )}
        </span>

        <span className="flex-1 font-semibold text-sm text-gray-900">
          {title}
        </span>

        {badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 font-medium">
            {badge}
          </span>
        )}
      </div>

      <div className="mt-2 pl-7 text-xs text-gray-500">{children}</div>
    </div>
  );
}
