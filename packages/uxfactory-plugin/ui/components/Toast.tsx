import React from "react";
import { ActionTooltip } from "./ActionTooltip.js";

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
    // No aria-live here — each role="status" item below is its own implicit live region
    // (polite). A single aria-live on the container would duplicate announcements.
    <div
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
          <ActionTooltip label={`Dismiss: ${toast.message}`}>
            <button
              type="button"
              aria-label={`Dismiss: ${toast.message}`}
              onClick={() => onDismiss(toast.id)}
              className="text-gray-400 hover:text-white leading-none shrink-0 mt-px"
            >
              ×
            </button>
          </ActionTooltip>
        </div>
      ))}
    </div>
  );
}
