import { Code } from "lucide-react";

export function App() {
  function handleClose() {
    // T2: wire up close message to code.ts
    // parent.postMessage({ pluginMessage: { type: "close" } }, "*");
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
        {/* Logo tile */}
        <div className="flex items-center justify-center w-6 h-6 rounded bg-primary-600 shrink-0">
          <Code size={14} className="text-white" />
        </div>
        {/* Title */}
        <span className="flex-1 text-sm font-medium truncate">
          UXFactory (Developer VM)
        </span>
        {/* Close */}
        <button
          type="button"
          aria-label="Close"
          onClick={handleClose}
          className="text-gray-400 hover:text-white text-base leading-none px-1"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-gray-500">Loading…</span>
      </div>
    </div>
  );
}
