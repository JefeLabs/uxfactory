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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  linkPlugin,
  tablePlugin,
  thematicBreakPlugin,
  codeBlockPlugin,
  markdownShortcutPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
} from "@mdxeditor/editor";
// Editor styling — vite inlines this into the singlefile ui.html (vitest stubs css imports).
import "@mdxeditor/editor/style.css";
import type { Bridge, ArtifactStatus, ArtifactContent } from "../lib/bridge.js";
import { BridgeError } from "../lib/bridge.js";
import { sectionGuidanceFor } from "../lib/artifact-schemas.js";
import { formSpecFor, externalSourcesFor } from "../lib/artifact-forms.js";
import type { ExternalOption } from "../lib/artifact-forms.js";
import { InfoTooltip, ArtifactEditorHeader } from "../components/index.js";
import { JsonFormEditor } from "./JsonFormEditor.js";
import { useAppStore } from "../stores/app.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { artifactQuery, putArtifactMutation, queryKeys, activeRoot, traceQuery } from "../queries.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fenced code blocks edit as a plain textarea — codeMirrorPlugin would inline
 * all of CodeMirror (~1.7MB) into ui.html and blow the 2MB singlefile budget. */
const plainTextCodeEditor: CodeBlockEditorDescriptor = {
  match: () => true,
  priority: 0,
  Editor: (props) => {
    const { setCode } = useCodeBlockEditorContext();
    return (
      <div onKeyDown={(e) => e.nativeEvent.stopImmediatePropagation()}>
        <textarea
          className="w-full font-mono text-xs bg-gray-50 border border-gray-200 rounded p-2"
          rows={Math.max(3, props.code.split("\n").length)}
          defaultValue={props.code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
    );
  },
};

/** Plugins used by every section editor (defined once; no per-render recreation).
 * Must cover every construct generated artifacts contain — a construct without
 * its plugin renders as raw source text (tables did, before tablePlugin). */
const EDITOR_PLUGINS = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  linkPlugin(),
  tablePlugin(),
  thematicBreakPlugin(),
  codeBlockPlugin({ codeBlockEditorDescriptors: [plainTextCodeEditor] }),
  markdownShortcutPlugin(),
];

// ─── Section types ─────────────────────────────────────────────────────────────

interface Section {
  /** Heading title, or null for content that appears before the first `## `. */
  title: string | null;
  originalBody: string;
  currentBody: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip the empty lines that pad a section grouping into extra vertical space:
 * blank lines at the top or bottom of the body, and runs of 2+ blank lines
 * between blocks collapsed to a single paragraph break. A single trailing
 * newline (the terminator) is preserved, so an already-tidy body — the shape
 * the fixtures use — round-trips unchanged. Single blank-line paragraph breaks
 * are kept, so distinct paragraphs and label groups stay separate.
 */
function normalizeSectionBody(body: string): string {
  return body
    .replace(/\n{3,}/g, "\n\n") // 2+ blank lines between blocks → one break
    .replace(/^\n+/, "") // leading blank lines
    .replace(/\n{2,}$/, "\n"); // trailing blank lines → single terminator
}

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
      const body = normalizeSectionBody(nlIdx === -1 ? "" : part.slice(nlIdx + 1));
      sections.push({ title, originalBody: body, currentBody: body });
    } else if (part.trim().length > 0) {
      // preamble — content before the first ##
      const body = normalizeSectionBody(part);
      sections.push({ title: null, originalBody: body, currentBody: body });
    }
  }

  // Fallback: a document with NO `## ` headings but bold-label paragraphs
  // (`**Problem.** …`) — a common brief shape — still deserves section cards.
  // Re-split the single preamble on bold labels at line start.
  if (sections.length === 1 && sections[0]!.title === null) {
    const boldSections = parseBoldLabelSections(sections[0]!.originalBody);
    if (boldSections.length > 1) return boldSections;
  }

  return sections;
}

/** A bold `**Label.**` at the very start of a line marks a section. */
const BOLD_LABEL_RE = /^\*\*([^*\n]{1,48}?)\*\*/;

/**
 * Split content on leading bold-label paragraphs. Any content before the first
 * label (e.g. a `# Title` line) becomes an untitled preamble; each `**Label.**`
 * starts a titled section (trailing `.`/`:` stripped from the title). Returns
 * the single preamble unchanged when no bold labels are present.
 */
export function parseBoldLabelSections(content: string): Section[] {
  const parts = content.split(/\n(?=\*\*[^*\n]{1,48}?\*\*)/);
  const sections: Section[] = [];
  for (const part of parts) {
    const m = BOLD_LABEL_RE.exec(part);
    if (m !== null) {
      const title = m[1]!.replace(/[.:]\s*$/, "").trim();
      const body = normalizeSectionBody(part.slice(m[0].length).replace(/^\s+/, ""));
      sections.push({ title, originalBody: body, currentBody: body });
    } else if (part.trim().length > 0) {
      const body = normalizeSectionBody(part);
      sections.push({ title: null, originalBody: body, currentBody: body });
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
  /** Root gate: true disables Regenerate (e.g. the product brief is missing). */
  regenerateDisabled?: boolean;
  /** Tooltip shown on the disabled Regenerate button. */
  regenerateDisabledReason?: string;
}

export function ArtifactEditor({
  artifactKey,
  label,
  status,
  bridge,
  onBack,
  onRegenerate,
  regenerateDisabled = false,
  regenerateDisabledReason,
}: ArtifactEditorProps): React.JSX.Element {
  const toast = useAppStore((s) => s.toast);
  const queryClient = useQueryClient();
  const artifactResult = useQuery(artifactQuery(bridge, artifactKey));

  // Resolve external option sets a JSON form needs (e.g. featureIds → the trace's
  // registered features). Fetched at the top level; enabled only when the spec asks.
  const formSpec = formSpecFor(artifactKey);
  const needsFeatures =
    formSpec !== undefined && externalSourcesFor(formSpec).includes("featureIds");
  const traceResult = useQuery({ ...traceQuery(bridge), enabled: needsFeatures && typeof bridge.trace === "function" });
  const externalOptions = useMemo<Record<string, ExternalOption[]>>(() => {
    if (!needsFeatures) return {};
    const features = traceResult.data?.features ?? [];
    return {
      featureIds: features.map((f) => ({ value: f.featureId, label: `${f.featureId} · ${f.name}` })),
    };
  }, [needsFeatures, traceResult.data]);

  const loadState: LoadState = !bridge.getArtifact
    ? { phase: "error", message: "Artifact editing requires a newer bridge version." }
    : artifactResult.isPending
      ? { phase: "loading" }
      : artifactResult.isError
        ? artifactResult.error instanceof BridgeError &&
          artifactResult.error.status === 404
          ? { phase: "not-found" }
          : { phase: "error", message: "Failed to load artifact." }
        : { phase: "ready", artifact: artifactResult.data };

  const [sections, setSections] = useState<Section[]>([]);

  // Sections the user has actually focused. MDXEditor fires onChange at mount
  // when it normalizes the source markdown — a change on a never-focused
  // section is that normalization and must re-baseline, not dirty the editor.
  const touchedSections = useRef<Set<number>>(new Set());

  const isDirty = sections.some((s) => s.currentBody !== s.originalBody);

  // ── Seed sections when artifact data arrives (also resets touchedSections) ───

  useEffect(() => {
    touchedSections.current = new Set();
    if (artifactResult.data && artifactResult.data.format === "markdown") {
      setSections(parseSections(artifactResult.data.content));
    } else {
      setSections([]);
    }
  }, [artifactResult.data]);

  // ── Section change handler ───────────────────────────────────────────────────

  const handleSectionChange = useCallback((index: number, newBody: string) => {
    const isUserEdit = touchedSections.current.has(index);
    setSections((prev) =>
      prev.map((s, i) =>
        i === index
          ? isUserEdit
            ? { ...s, currentBody: newBody }
            : // Mount-time normalization — swap the baseline, stay clean.
              { ...s, originalBody: newBody, currentBody: newBody }
          : s,
      ),
    );
  }, []);

  // ── Save via mutation ─────────────────────────────────────────────────────────

  const save = useMutation({
    ...putArtifactMutation(bridge),
    onSuccess: () => {
      setSections((prev) => prev.map((s) => ({ ...s, originalBody: s.currentBody })));
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifact(activeRoot(bridge), artifactKey) });
      toast("Saved");
    },
    onError: () => toast("Save failed — is the bridge running?"),
  });
  const saving = save.isPending;

  async function handleSave(): Promise<void> {
    if (!isDirty || saving || !bridge.putArtifact) return;
    const content = assembleSections(sections);
    await save.mutateAsync({ key: artifactKey, content }).catch(() => {
      /* onError handled the toast */
    });
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
      <ArtifactEditorHeader
        label={label}
        status={status}
        onBack={handleBack}
        onRegenerate={onRegenerate}
        onSave={showSave ? () => void handleSave() : undefined}
        saveDisabled={!isDirty || saving}
        regenerateDisabled={regenerateDisabled}
        regenerateDisabledReason={regenerateDisabledReason}
      />
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

  // ── Render: JSON — structured form when a field spec exists, else read-only ───

  if (artifact.format === "json") {
    const spec = formSpecFor(artifactKey);
    let parsed: Record<string, unknown> | null = null;
    try {
      const p: unknown = JSON.parse(artifact.content);
      if (p !== null && typeof p === "object" && !Array.isArray(p)) {
        parsed = p as Record<string, unknown>;
      }
    } catch {
      // fall through to the read-only view for unparseable content
    }

    if (spec !== undefined && parsed !== null) {
      return (
        <JsonFormEditor
          artifactKey={artifactKey}
          label={label}
          status={status}
          spec={spec}
          value={parsed}
          externalOptions={externalOptions}
          bridge={bridge}
          onBack={onBack}
          onRegenerate={onRegenerate}
          regenerateDisabled={regenerateDisabled}
          regenerateDisabledReason={regenerateDisabledReason}
        />
      );
    }

    const prettyJson = parsed !== null ? JSON.stringify(parsed, null, 2) : artifact.content;

    return (
      <div className="flex flex-col flex-1 min-h-0">
        <EditorHeader />

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
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

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {sections.map((section, i) => (
          <div
            key={i}
            className="bg-white border border-gray-200 rounded-[var(--radius-card)] overflow-hidden"
            data-testid={`section-card-${section.title ?? "preamble"}`}
          >
            {section.title !== null && (
              <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  {section.title}
                </h3>
                {(() => {
                  const guidance = sectionGuidanceFor(artifactKey, section.title);
                  return guidance !== "" ? (
                    <InfoTooltip label={`${section.title}: ${guidance}`} content={guidance} />
                  ) : null;
                })()}
              </div>
            )}

            <div
              className="px-1 py-1"
              onFocusCapture={() => touchedSections.current.add(i)}
            >
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
