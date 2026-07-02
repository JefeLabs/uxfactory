import React from "react";

export interface SectionHeaderProps {
  children: React.ReactNode;
}

export function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-3 pt-3 pb-1">
      {children}
    </p>
  );
}
