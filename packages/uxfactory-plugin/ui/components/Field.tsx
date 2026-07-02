import React from "react";

export interface FieldProps {
  label: string;
  error?: string;
  children: React.ReactNode;
}

export function Field({ label, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700 w-24 shrink-0">
          {label}
        </label>
        <div className="flex-1">{children}</div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-fail-600 mt-0.5 pl-28">
          {error}
        </p>
      )}
    </div>
  );
}
