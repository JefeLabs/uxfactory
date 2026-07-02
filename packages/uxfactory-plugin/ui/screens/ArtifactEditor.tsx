/**
 * ArtifactEditor.tsx — In-panel artifact editor with MDXEditor section cards.
 *
 * Renders markdown artifacts split by `## ` headings into section cards, each
 * with schema-matched guidance text and an MDXEditor instance.  JSON artifacts
 * show a read-only pretty-print view.
 *
 * Props:
 *   artifactKey  — concern registry key (e.g. "brief")
 *   label        — human-readable display name (e.g. "Brief")
 *   status       — freshness status from the snapshot row (drives the dot)
 *   bridge       — Bridge client (getArtifact / putArtifact)
 *   onBack       — called when Back is clicked; Artifacts mounts/unmounts this
 *   onRegenerate — opens the guided Create/Regenerate dialog
 *
 * Section parsing:
 *   Content is split on `\n(?=## )` — a newline followed by `## `.  Content
 *   before the first `## ` is kept as an unnamed preamble section.  Each named
 *   section: first line → title (strip `## `), remainder → body.
 *
 * Save:
 *   Sections reassembled as `## <title>\n<body>` joined by `\n`.  Preamble
 *   sections (title = null) emit their body directly.  Put via putArtifact;
 *   on success clears dirty state + fires "Saved" toast.  Failure toasts an
 *   error and leaves the editor open.
 *
 * MDXEditor CSS:
 *   Import `@mdxeditor/editor/style.css` in your app's root CSS for styling.
 *   It is intentionally omitted here to avoid side-effect imports in tests.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  linkPlugin,
  markdownShortcutPlugin,
} from "@mdxeditor/editor";
import type { Bridge, ArtifactStatus, ArtifactContent } from "../lib/bridge.js";
import { BridgeError } from "../lib/bridge.js";
import { sectionGuidanceFor } from "../lib/artifact-schemas.js";
import { useAppStore } from "../stores/app.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Plugins used by every section editor (defined once; no per-render recreation). */
const EDITOR_PLUGINS = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  linkPlugin(),
  markdownShortcutPlugin(),
];

const DOT_CLASS: Record<ArtifactStatus, string> = {
  "up-to-date": "bg-success-600",
  draft: "bg-warn-600",
  missing: "border-2 border-gray-300",
};

// ─── Section types ─────────────────────────────────────────────────────────────

interface Section {
  /** Heading title, or null for content that appears before the first `## `. */
  title: string | null;
  originalBody: string;
  currentBody: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split markdown content into sections on `## ` headings.
 *
 * Content before the first heading is kept as a preamble section (title=null).
 * Each heading line becomes a section title; the lines that follow are the body.
 */
export function parseSections(content: string): Section[] {
  const parts = content.split(/\n(?=## )/);
  const sections: Section[] = [];

  for (const part of parts) {
    if (part.startsWith("## ")) {
      const nlIdx = part.indexOf("\n");
      const title =
        nlIdx === -1 ? part.slice(3).trim() : part.slice(3, nlIdx).trim();
      const body = nlIdx === -1 ? "" : part.slice(nlIdx + 1);
      sections.push({ title, originalBody: body, currentBody: body });
    } else if (part.trim().length > 0) {
      // preamble — content before the first ##
      sections.push({ title: null, originalBody: part, currentBody: part });
    }
  }

  return sections;
}

/**
 * Reassemble sections into a single markdown string.
 * Named sections → `## <title>\n<body>`, preambles → `<body>`, joined by `\n`.
 */
export function assembleSections(sections: Section[]): string {
  return sections
    .map((s) =>
      s.title === null ? s.currentBody : `## ${s.title}\n${s.currentBody}`,
    )
    .join("\n");
}

// ─── Load-state discriminated union ──────────────────────────────────────────

type LoadState =
  | { phase: "loading" }
  | { phase: "not-found" }
  | { phase: "error"; message: string }
  | { phase: "ready"; artifact: ArtifactContent };

// ─── ArtifactEditor ──────────────────────────────────────────────────────────

export interface ArtifactEditorProps {
  artifactKey: string;
  label: string;
  status: ArtifactStatus;
  bridge: Bridge;
  onBack: () => void;
  onRegenerate: () => void;
}

export function ArtifactEditor({
  artifactKey,
  label,
  status,
  bridge,
  onBack,
  onRegenerate,
}: ArtifactEditorProps): React.JSX.Element {
  const toast = useAppStore((s) => s.toast);

  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [sections, setSections] = useState<Section[]>([]);
  const [saving, setSaving] = useState(false);

  const isDirty = sections.some((s) => s.currentBody !== s.originalBody);

  // ── Load artifact on mount / key change ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoadState({ phase: "loading" });
    setSections([]);

    if (!bridge.getArtifact) {
      setLoadState({
        phase: "error",
        message: "Artifact editing requires a newer bridge version.",
      });
      return;
    }

    bridge.getArtifact(artifactKey).then(
      (artifact) => {
        if (cancelled) return;
        setLoadState({ phase: "ready", artifact });
        if (artifact.format === "markdown") {
          setSections(parseSections(artifact.content));
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof BridgeError && err.status === 404) {
          setLoadState({ phase: "not-found" });
        } else {
          setLoadState({ phase: "error", message: "Failed to load artifact." });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [artifactKey, bridge]);

  // ── Section change handler ───────────────────────────────────────────────────

  const handleSectionChange = useCallback((index: number, newBody: string) => {
    setSections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, currentBody: newBody } : s)),
    );
  }, []);

  // ── Save ─────────────────────────────────────────────────────────────────────

  async function handleSave(): Promise<void> {
    if (!isDirty || saving || !bridge.putArtifact) return;
    setSaving(true);
    try {
      const content = assembleSections(sections);
      await bridge.putArtifact(artifactKey, content);
      // Clear dirty state: original catches up to current
      setSections((prev) =>
        prev.map((s) => ({ ...s, originalBody: s.currentBody })),
      );
      toast("Saved");
    } catch {
      toast("Save failed — is the bridge running?");
    } finally {
      setSaving(false);
    }
  }

  // ── Back with dirty guard ────────────────────────────────────────────────────

  function handleBack(): void {
    if (
      isDirty &&
      !window.confirm("You have unsaved changes. Leave without saving?")
    ) {
      return;
    }
    onBack();
  }

  // ── Shared header ─────────────────────────────────────────────────────────────

  function EditorHeader({
    showSave = false,
  }: {
    showSave?: boolean;
  }): React.JSX.Element {
    return (
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <button
          type="button"
          onClick={handleBack}
          className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          aria-label="Back to artifacts"
        >
          ← Back
        </button>

        <span
          aria-hidden="true"
          className={`w-2 h-2 shrink-0 rounded-full ${DOT_CLASS[status]}`}
        />

        <span className="flex-1 text-sm font-semibold text-gray-900 truncate">
          {label}
        </span>

        <button
          type="button"
          onClick={onRegenerate}
          className="text-xs text-gray-600 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 shrink-0"
        >
          Regenerate
        </button>

        {showSave && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isDirty || saving}
            className="text-xs px-3 py-1.5 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            aria-label="Save artifact"
          >
            Save
          </button>
        )}
      </div>
    );
  }

  // ── Render: loading ───────────────────────────────────────────────────────────

  if (loadState.phase === "loading") {
    return (
      <div
        className="flex flex-col flex-1 items-center justify-center p-8"
        aria-live="polite"
        data-testid="artifact-editor-loading"
      >
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  // ── Render: not found (404) ───────────────────────────────────────────────────

  if (loadState.phase === "not-found") {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
          <button
            type="button"
            onClick={handleBack}
            className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            aria-label="Back to artifacts"
          >
            ← Back
          </button>
          <span className="flex-1 text-sm font-semibold text-gray-900">
            {label}
          </span>
        </div>

        <div className="flex flex-col flex-1 items-center justify-center p-8 gap-4">
          <p className="text-sm text-gray-500" data-testid="not-created-yet">
            Not created yet.
          </p>
          <button
            type="button"
            onClick={onRegenerate}
            className="text-xs px-3 py-1.5 rounded bg-primary-600 text-white hover:bg-primary-700 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            aria-label={`Create ${label}`}
          >
            Create
          </button>
        </div>
      </div>
    );
  }

  // ── Render: error ─────────────────────────────────────────────────────────────

  if (loadState.phase === "error") {
    return (
      <div className="flex flex-col flex-1 items-center justify-center p-8">
        <p className="text-sm text-red-500" role="alert">
          {loadState.message}
        </p>
      </div>
    );
  }

  const { artifact } = loadState;

  // ── Render: JSON (read-only pretty view) ──────────────────────────────────────

  if (artifact.format === "json") {
    let prettyJson = artifact.content;
    try {
      prettyJson = JSON.stringify(JSON.parse(artifact.content), null, 2);
    } catch {
      // use raw content if unparseable
    }

    return (
      <div className="flex flex-col flex-1 min-h-0">
        <EditorHeader />

        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 gap-3">
          <p className="text-xs text-gray-400 italic" data-testid="json-editing-note">
            JSON editing arrives later.
          </p>
          <pre
            className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto font-mono text-gray-700 leading-relaxed"
            data-testid="json-preview"
          >
            {prettyJson}
          </pre>
        </div>
      </div>
    );
  }

  // ── Render: markdown sections ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <EditorHeader showSave />

      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 gap-4">
        {sections.map((section, i) => (
          <div
            key={i}
            className="bg-white border border-gray-200 rounded-[var(--radius-card)] overflow-hidden"
            data-testid={`section-card-${section.title ?? "preamble"}`}
          >
            {section.title !== null && (
              <div className="px-4 pt-3 pb-1 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  {section.title}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {sectionGuidanceFor(artifactKey, section.title)}
                </p>
              </div>
            )}

            <div className="px-1 py-1">
              <MDXEditor
                markdown={section.currentBody}
                onChange={(val) => handleSectionChange(i, val)}
                plugins={EDITOR_PLUGINS}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
