import React, { useId } from "react";

export interface FieldProps {
  label: string;
  error?: string;
  /** When provided, the label gets htmlFor={id}; pass the same id to the child control. */
  id?: string;
  children: React.ReactNode;
}

export function Field({ label, error, id, children }: FieldProps) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-4">
        {/* When id is given: htmlFor links label→control. When absent: label carries its own id
            and children are wrapped in role="group" aria-labelledby so the group is labelled. */}
        <label
          htmlFor={id}
          id={id ? undefined : labelId}
          className="text-sm font-medium text-gray-700 w-24 shrink-0"
        >
          {label}
        </label>
        <div className="flex-1">
          {id ? (
            children
          ) : (
            <div role="group" aria-labelledby={labelId}>
              {children}
            </div>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-fail-600 mt-0.5 pl-28">
          {error}
        </p>
      )}
    </div>
  );
}
