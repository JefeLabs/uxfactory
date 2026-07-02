/**
 * CreateArtifactDialog.tsx — guided-prompt modal for artifact generation.
 *
 * Opens when the user clicks Create/Regenerate on an artifact row. Shows
 * artifact-specific guiding copy above a free-form guidance textarea, then
 * hands the (possibly empty) guidance back via onGenerate. The dialog never
 * enqueues anything itself — the parent owns the bridge call.
 *
 * Follows the Radix Dialog composition pattern established by Settings.tsx's
 * LogsDrawer (Portal → Overlay → Content), kit-styled as a centered modal.
 */

import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

// ─── Artifact-specific guiding copy ───────────────────────────────────────────

const GUIDANCE_COPY: Record<string, string> = {
  "brief":
    "Describe the product, its audience, and what success looks like — the agent drafts the product brief from this.",
  "requirements":
    "List the capabilities and acceptance criteria that matter most — the agent turns them into testable requirements.",
  "sitemap":
    "List the main areas or journeys your product needs — the agent proposes the page map.",
  "flows":
    "Name the key user flows (e.g. checkout, returns) and any steps they must include — the agent maps each one screen by screen.",
  "brand-colors":
    "Name anchor colors (hex codes welcome) or describe the brand personality to convey — the agent derives brand colors that fit.",
  "palettes":
    "Describe the mood and contrast you want (e.g. calm neutrals with one bold accent) — the agent builds the full color ramps.",
  "fonts":
    "Mention typefaces you like or the tone to strike (e.g. friendly, editorial, technical) — the agent selects the font pairing.",
  "grid":
    "Note target devices, breakpoints, and how dense layouts should feel — the agent defines the grid and viewports.",
  "tokens":
    "Call out platforms or naming conventions the tokens must serve — the agent assembles the design token set.",
  "icons":
    "Describe the icon style you want (e.g. outlined, rounded, duotone) and any must-have glyphs — the agent curates the set.",
  "photography":
    "Describe subject matter, mood, and treatment (e.g. candid people, warm light, high contrast) — the agent writes the photography direction.",
  "illustrations":
    "Describe the illustration style (e.g. flat geometric, hand-drawn, editorial spot art) and where it will appear — the agent defines the direction.",
};

const DEFAULT_GUIDANCE_COPY =
  "Add any direction you want the agent to follow — goals, constraints, and examples all help ground the result.";

/** Resolve the guiding copy for an artifact key (exported for tests). */
export function guidanceCopyFor(artifactKey: string): string {
  return GUIDANCE_COPY[artifactKey] ?? DEFAULT_GUIDANCE_COPY;
}

// ─── CreateArtifactDialog ─────────────────────────────────────────────────────

export interface CreateArtifactDialogProps {
  artifactKey: string;
  artifactLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired on Generate with the trimmed guidance ("" is allowed). */
  onGenerate: (guidance: string) => void;
}

export function CreateArtifactDialog({
  artifactKey,
  artifactLabel,
  open,
  onOpenChange,
  onGenerate,
}: CreateArtifactDialogProps): React.JSX.Element {
  const [guidance, setGuidance] = useState("");

  // Fresh textarea every time the dialog opens (also covers switching rows).
  useEffect(() => {
    if (open) setGuidance("");
  }, [open, artifactKey]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm bg-white rounded-lg shadow-xl z-50 flex flex-col gap-3 p-4">
          <Dialog.Title className="text-sm font-semibold text-gray-900">
            Create {artifactLabel}
          </Dialog.Title>

          {/* Artifact-specific guiding copy above the prompt */}
          <Dialog.Description className="text-xs text-gray-500">
            {guidanceCopyFor(artifactKey)}
          </Dialog.Description>

          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            rows={4}
            placeholder="Optional — leave empty to let the agent infer from the project"
            aria-label={`Guidance for ${artifactLabel}`}
            className="w-full border border-gray-300 rounded p-2 text-xs text-gray-900 placeholder:text-gray-400 resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          />

          <div className="flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => onGenerate(guidance.trim())}
              className="text-xs px-3 py-1.5 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              Generate
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
