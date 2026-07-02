import React from "react";

export interface ToastItem {
  id: string;
  message: string;
}

export interface ToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function Toast({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 max-w-xs"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="flex items-start gap-2 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg"
        >
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            aria-label={`Dismiss: ${toast.message}`}
            onClick={() => onDismiss(toast.id)}
            className="text-gray-400 hover:text-white leading-none shrink-0 mt-px"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
