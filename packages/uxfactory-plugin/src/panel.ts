export type PanelState = "COMPACT" | "EXPANDED" | "CONNECTED_MIN" | "PIPELINE";
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
  // The pipeline panel needs room for the header (project ▾ + 3 job tabs + gate
  // strip) plus the active-job body (scope dials, seed line, artifact list).
  PIPELINE: { width: 600, height: 640 },
};

function view(state: PanelState): PanelView {
  return { state, ...DIMENSIONS[state] };
}

/**
 * The fixed size the panel resizes to when the pipeline panel mounts. Not part
 * of the §7.6 event FSM (mounting is driven by health-connect in `ui.ts`, not a
 * `PanelEvent`), so it is exposed as its own view rather than a `nextPanel` case.
 */
export function pipelineView(): PanelView {
  return view("PIPELINE");
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
