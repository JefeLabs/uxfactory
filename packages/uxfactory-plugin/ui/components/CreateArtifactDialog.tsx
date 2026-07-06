/**
 * CreateArtifactDialog.tsx — the artifact ELICITATION modal.
 *
 * Opens when the user clicks Create/Regenerate on an artifact row (or a
 * required-missing chip on the Generate tab). Runs the artifact's interview
 * from the elicitation registry (@uxfactory/spec): [E] questions must be
 * answered before Generate enables; [F] questions arrive prefilled — silence
 * accepts the default. Below the interview sits the free guidance prompt for
 * steering the draft. Answers + guidance compose into ONE guidance string on
 * the existing wire, so the worker and bridge are untouched.
 *
 * The dialog never enqueues anything itself — the parent owns the bridge call.
 * Follows the Radix Dialog composition pattern established by Settings.tsx's
 * LogsDrawer (Portal → Overlay → Content), kit-styled as a centered modal.
 */

import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ARTIFACT_ELICITATION } from "@uxfactory/spec";
import type { ElicitationQuestion } from "@uxfactory/spec";
import { createGuidanceCopyFor } from "../lib/artifact-schemas.js";
import { REGISTRY_ID_BY_KEY } from "../lib/artifact-mapping.js";

// ─── Re-export for backward-compat (tests import guidanceCopyFor from here) ──

/** Resolve the guiding copy for an artifact key (exported for tests). */
export function guidanceCopyFor(artifactKey: string): string {
  return createGuidanceCopyFor(artifactKey);
}

/** The artifact's interview script ([E]+[F] only; [D] is never asked). */
export function questionsFor(artifactKey: string): ElicitationQuestion[] {
  const registryId = REGISTRY_ID_BY_KEY[artifactKey] ?? artifactKey;
  return ARTIFACT_ELICITATION[registryId] ?? [];
}

/** Compose answered questions + free guidance into one wire guidance string. */
function composeGuidance(
  questions: ElicitationQuestion[],
  answers: Record<string, string>,
  guidance: string,
): string {
  const lines: string[] = [];
  for (const q of questions) {
    const answer = (answers[q.id] ?? q.defaultValue ?? "").trim();
    if (answer === "") continue;
    lines.push(`${q.question}\n${answer}`);
  }
  const trimmed = guidance.trim();
  if (trimmed !== "") {
    lines.push(lines.length > 0 ? `Additional guidance:\n${trimmed}` : trimmed);
  }
  return lines.join("\n\n");
}

// ─── CreateArtifactDialog ─────────────────────────────────────────────────────

export interface CreateArtifactDialogProps {
  artifactKey: string;
  artifactLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired on Generate with the composed interview + guidance ("" is allowed). */
  onGenerate: (guidance: string) => void;
  /** Present while running a prerequisite chain — step position + the target. */
  chainInfo?: { step: number; total: number; targetLabel: string };
}

export function CreateArtifactDialog({
  artifactKey,
  artifactLabel,
  open,
  onOpenChange,
  onGenerate,
  chainInfo,
}: CreateArtifactDialogProps): React.JSX.Element {
  const [guidance, setGuidance] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = questionsFor(artifactKey);

  // Fresh interview every time the dialog opens (also covers switching rows).
  useEffect(() => {
    if (open) {
      setGuidance("");
      setAnswers(
        Object.fromEntries(
          questionsFor(artifactKey)
            .filter((q) => q.defaultValue !== undefined)
            .map((q) => [q.id, q.defaultValue!]),
        ),
      );
    }
  }, [open, artifactKey]);

  // [E] questions must be answered; [F] silence accepts the default.
  const unanswered = questions.filter(
    (q) => q.tag === "E" && (answers[q.id] ?? "").trim() === "",
  ).length;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm max-h-[85vh] overflow-y-auto bg-white rounded-lg shadow-xl z-50 flex flex-col gap-3 p-4">
          <Dialog.Title className="text-sm font-semibold text-gray-900">
            Create {artifactLabel}
          </Dialog.Title>

          {/* Prerequisite-chain position — trace-graph order, target last */}
          {chainInfo !== undefined && (
            <p className="text-[11px] font-medium text-primary-600 -mt-2">
              Step {chainInfo.step} of {chainInfo.total}
              {artifactLabel !== chainInfo.targetLabel
                ? ` — needed before ${chainInfo.targetLabel}`
                : ""}
            </p>
          )}

          {/* Artifact-specific guiding copy above the interview */}
          <Dialog.Description className="text-xs text-gray-500">
            {guidanceCopyFor(artifactKey)}
          </Dialog.Description>

          {/* The interview: [E] required, [F] prefilled */}
          {questions.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {questions.map((q) => (
                <label key={q.id} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-700">
                    {q.question}
                    {q.tag === "E" && (
                      <span className="text-red-500" aria-hidden="true"> *</span>
                    )}
                  </span>
                  <textarea
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                    rows={2}
                    placeholder={q.placeholder ?? ""}
                    aria-label={q.question}
                    aria-required={q.tag === "E"}
                    className="w-full border border-gray-300 rounded p-2 text-xs text-gray-900 placeholder:text-gray-400 resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  />
                </label>
              ))}
            </div>
          )}

          {/* Free guidance prompt for steering the draft */}
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            rows={4}
            placeholder="Optional — leave empty to let the agent infer from the project"
            aria-label={`Guidance for ${artifactLabel}`}
            className="w-full border border-gray-300 rounded p-2 text-xs text-gray-900 placeholder:text-gray-400 resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">
              {unanswered > 0
                ? `${unanswered} required question${unanswered === 1 ? "" : "s"} left`
                : ""}
            </span>
            <div className="flex items-center gap-2">
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
                disabled={unanswered > 0}
                onClick={() => onGenerate(composeGuidance(questions, answers, guidance))}
                className="text-xs px-3 py-1.5 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
