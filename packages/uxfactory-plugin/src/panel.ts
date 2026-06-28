export type PanelState = "COMPACT" | "EXPANDED" | "CONNECTED_MIN";
export type PanelEvent = "toggle-details" | "connect" | "expand-click" | "disconnect";

export interface PanelView {
  state: PanelState;
  width: number;
  height: number;
}

const DIMENSIONS: Record<PanelState, { width: number; height: number }> = {
  COMPACT: { width: 540, height: 220 },
  EXPANDED: { width: 540, height: 560 },
  CONNECTED_MIN: { width: 156, height: 72 },
};

function view(state: PanelState): PanelView {
  return { state, ...DIMENSIONS[state] };
}

/** The §7.6 panel transitions. Unhandled (state, event) pairs are no-ops. */
export function nextPanel(state: PanelState, event: PanelEvent): PanelView {
  switch (event) {
    case "toggle-details":
      if (state === "COMPACT") return view("EXPANDED");
      if (state === "EXPANDED") return view("COMPACT");
      return view(state);
    case "connect":
      return view("CONNECTED_MIN");
    case "expand-click":
      return state === "CONNECTED_MIN" ? view("COMPACT") : view(state);
    case "disconnect":
      return view("COMPACT");
  }
}
