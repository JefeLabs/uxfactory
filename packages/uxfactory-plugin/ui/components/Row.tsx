import React from "react";

export interface RowProps {
  dot?: "green" | "amber" | "hollow";
  name: string;
  meta?: string;
  metaMono?: boolean;
  action?: React.ReactNode;
  onClick?: () => void;
  highlighted?: boolean;
}

const DOT_STYLE: Record<"green" | "amber" | "hollow", string> = {
  green: "bg-success-600 rounded-full",
  amber: "bg-warn-600 rounded-full",
  hollow: "rounded-full border-2 border-gray-300",
};

export function Row({
  dot,
  name,
  meta,
  metaMono = false,
  action,
  onClick,
  highlighted = false,
}: RowProps) {
  const isClickable = !!onClick;

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={[
        "flex items-center gap-3 px-3 py-2 text-sm",
        isClickable && "cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600",
        highlighted && "bg-primary-50",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`w-2 h-2 shrink-0 ${DOT_STYLE[dot]}`}
        />
      )}

      <span className="flex-1 font-medium text-gray-900 truncate">{name}</span>

      {meta && (
        <span
          className={`text-xs text-gray-400 shrink-0 ${metaMono ? "font-mono" : ""}`}
        >
          {meta}
        </span>
      )}

      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
