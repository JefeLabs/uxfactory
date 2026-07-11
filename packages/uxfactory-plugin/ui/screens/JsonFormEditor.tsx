/**
 * JsonFormEditor.tsx — structured-data (JSON) artifact editor.
 *
 * Driven by a declarative field spec (artifact-forms.ts): React Hook Form owns
 * the state (dirty tracking, `useFieldArray` for repeatable groups, nested field
 * paths) while the panel's own Tailwind inputs render each field `kind`. A
 * well-formed form yields a validator-clean artifact (segments[] + primarySegment
 * for audience). Save serializes the values back to pretty JSON and PUTs them.
 *
 * Field-value types are dynamic (per spec), so the form is typed loosely as a
 * record; the spec is the real contract for what each path holds.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo } from "react";
import {
  useForm,
  useFieldArray,
  useWatch,
  Controller,
  type Control,
} from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ArtifactStatus, Bridge } from "../lib/bridge.js";
import type { ArtifactFormSpec, FieldSpec, ExternalOption } from "../lib/artifact-forms.js";
import { ActionTooltip, ArtifactEditorHeader, Field } from "../components/index.js";
import { useAppStore } from "../stores/app.js";
import { putArtifactMutation, queryKeys, activeRoot } from "../queries.js";

// ─── Shared input styling (matches CategorySelect / the panel's form controls) ──

const INPUT_CLS =
  "w-full text-sm border border-gray-300 rounded-[var(--radius-card)] px-3 py-2 bg-white text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600";

/**
 * Host-supplied option sets for `multiselect` fields keyed by external source
 * (e.g. "featureIds"). Contexted so recursive field renderers don't thread it.
 */
const ExternalOptionsContext = React.createContext<Record<string, ExternalOption[]>>({});

// ─── Path helpers ───────────────────────────────────────────────────────────

/** Full RHF path for a child key under a parent path (`""` at the top level). */
const childPath = (parent: string, key: string): string =>
  parent === "" ? key : `${parent}.${key}`;
/** The parent path of a full path (`"segments.0.name"` → `"segments.0"`). */
const parentOf = (path: string): string => path.split(".").slice(0, -1).join(".");

// ─── Leaf inputs ────────────────────────────────────────────────────────────

/** A 0..1 ratio edited as a whole/decimal percent. Stored value stays 0..1. */
function PercentInput({
  control,
  path,
  id,
  ariaLabel,
}: {
  control: Control<any>;
  path: string;
  /** When Field-labelled via htmlFor. */
  id?: string;
  /** When rendered inline without a Field (e.g. deviceMix). */
  ariaLabel?: string;
}): React.JSX.Element {
  return (
    <Controller
      control={control}
      name={path}
      render={({ field }) => {
        const ratio = typeof field.value === "number" ? field.value : 0;
        // Round the display to strip float noise (0.35*100 → 35, not 35.0000001).
        const shown = String(Math.round(ratio * 10000) / 100);
        return (
          <div className="inline-flex items-center gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={1}
              id={id}
              aria-label={ariaLabel}
              className={`${INPUT_CLS} w-20`}
              value={shown}
              onChange={(e) => {
                const pct = e.target.value === "" ? 0 : Number(e.target.value);
                field.onChange(Number.isFinite(pct) ? pct / 100 : 0);
              }}
              onBlur={field.onBlur}
            />
            <span className="text-sm text-gray-400">%</span>
          </div>
        );
      }}
    />
  );
}

/** A free string[] edited as removable pills + an add-on-Enter input. */
function ChipsInput({
  control,
  path,
  label,
}: {
  control: Control<any>;
  path: string;
  label: string;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState("");
  return (
    <Controller
      control={control}
      name={path}
      render={({ field }) => {
        const items: string[] = Array.isArray(field.value) ? field.value : [];
        const add = (): void => {
          const v = draft.trim();
          if (v !== "" && !items.includes(v)) field.onChange([...items, v]);
          setDraft("");
        };
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {items.map((item, i) => (
              <span
                key={`${item}-${i}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700 border border-gray-200"
              >
                {item}
                <ActionTooltip label={`Remove ${item}`}>
                  <button
                    type="button"
                    aria-label={`Remove ${item}`}
                    onClick={() => field.onChange(items.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 rounded"
                  >
                    ×
                  </button>
                </ActionTooltip>
              </span>
            ))}
            <input
              type="text"
              aria-label={`Add ${label}`}
              className={`${INPUT_CLS} w-28`}
              value={draft}
              placeholder="add…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              onBlur={add}
            />
          </div>
        );
      }}
    />
  );
}

/** A `string[]` picked from a known option set: removable pills + an "add…" dropdown. */
function MultiSelectInput({
  control,
  path,
  field,
}: {
  control: Control<any>;
  path: string;
  field: Extract<FieldSpec, { kind: "multiselect" }>;
}): React.JSX.Element {
  const externals = React.useContext(ExternalOptionsContext);
  const options: ExternalOption[] =
    field.options !== undefined
      ? field.options.map((v) => ({ value: v, label: v }))
      : field.optionsFrom !== undefined
        ? externals[field.optionsFrom.external] ?? []
        : [];
  const labelOf = (v: string): string => options.find((o) => o.value === v)?.label ?? v;

  return (
    <Controller
      control={control}
      name={path}
      render={({ field: f }) => {
        const selected: string[] = Array.isArray(f.value) ? f.value : [];
        const available = options.filter((o) => !selected.includes(o.value));
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {selected.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary-50 text-primary-700 border border-primary-100"
              >
                {labelOf(v)}
                <ActionTooltip label={`Remove ${v}`}>
                  <button
                    type="button"
                    aria-label={`Remove ${v}`}
                    onClick={() => f.onChange(selected.filter((x) => x !== v))}
                    className="text-primary-300 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 rounded"
                  >
                    ×
                  </button>
                </ActionTooltip>
              </span>
            ))}
            {available.length > 0 && (
              <select
                aria-label={`Add ${field.label}`}
                className={`${INPUT_CLS} w-auto`}
                value=""
                onChange={(e) => {
                  if (e.target.value !== "") f.onChange([...selected, e.target.value]);
                }}
              >
                <option value="">add…</option>
                {available.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      }}
    />
  );
}

/** A single-select whose options are the `nameKey` values of a sibling array. */
function EnumInput({
  control,
  path,
  id,
  field,
}: {
  control: Control<any>;
  path: string;
  id?: string;
  field: Extract<FieldSpec, { kind: "enum" }>;
}): React.JSX.Element {
  const from = field.optionsFrom;
  // Where to read dynamic options: a root-level array, or a sibling. For static
  // `options`, watch self (cheap) — the watched value is ignored.
  const arrayPath = from
    ? from.scope === "root"
      ? from.array
      : childPath(parentOf(path), from.array)
    : path;
  const watched = useWatch({ control, name: arrayPath }) as any;
  // For excludeSelf: the current row's own value of the referenced key (e.g. this
  // node's nodeId), so a node can't list itself as its parent.
  const selfIdPath = from?.excludeSelf === true ? childPath(parentOf(path), from.nameKey) : path;
  const selfId = useWatch({ control, name: selfIdPath }) as any;
  const dynamic =
    from !== undefined && Array.isArray(watched)
      ? watched
          .map((item) => (item != null ? (item as any)[from.nameKey] : undefined))
          .filter((v): v is string => typeof v === "string" && v !== "")
      : [];
  const filtered =
    from?.excludeSelf === true && typeof selfId === "string"
      ? dynamic.filter((v) => v !== selfId)
      : dynamic;
  const options = field.options ?? filtered;
  return (
    <Controller
      control={control}
      name={path}
      render={({ field: f }) => {
        const current = typeof f.value === "string" ? f.value : "";
        return (
          <select
            id={id}
            aria-label={field.label}
            className={INPUT_CLS}
            value={current}
            onChange={(e) =>
              f.onChange(field.nullable === true && e.target.value === "" ? null : e.target.value)
            }
            onBlur={f.onBlur}
          >
            {field.nullable === true && <option value="">(none)</option>}
            {/* Keep the current value selectable even if it no longer matches an option. */}
            {current !== "" && !options.includes(current) && <option value={current}>{current}</option>}
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      }}
    />
  );
}

// ─── Field dispatch ─────────────────────────────────────────────────────────

/** Render one spec field at `path`. Groups/objects recurse. */
function FieldEditor({
  spec,
  path,
  control,
  register,
}: {
  spec: FieldSpec;
  path: string;
  control: Control<any>;
  register: any;
}): React.JSX.Element {
  switch (spec.kind) {
    case "text":
      return (
        <Field label={spec.label} id={path}>
          <input
            type="text"
            id={path}
            placeholder={spec.placeholder}
            className={INPUT_CLS}
            {...register(path, spec.nullable ? { setValueAs: (v: string) => (v === "" ? null : v) } : {})}
          />
        </Field>
      );
    case "textarea":
      return (
        <Field label={spec.label} id={path} align="start">
          <textarea
            id={path}
            rows={2}
            className={`${INPUT_CLS} resize-y`}
            {...register(path, spec.nullable ? { setValueAs: (v: string) => (v === "" || v == null ? null : v) } : {})}
          />
        </Field>
      );
    case "percent":
      return (
        <Field label={spec.label} id={path}>
          <PercentInput control={control} path={path} id={path} />
        </Field>
      );
    case "chips":
      return (
        <Field label={spec.label} align="start">
          <ChipsInput control={control} path={path} label={spec.label} />
        </Field>
      );
    case "multiselect":
      return (
        <Field label={spec.label} align="start">
          <MultiSelectInput control={control} path={path} field={spec} />
        </Field>
      );
    case "enum":
      return (
        <Field label={spec.label} id={path}>
          <EnumInput control={control} path={path} id={path} field={spec} />
        </Field>
      );
    case "object":
      return (
        <Field label={spec.label} align="start">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {spec.fields.map((sub) => (
              <div key={sub.key} className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">{sub.label}</span>
                {sub.kind === "percent" ? (
                  <PercentInput control={control} path={childPath(path, sub.key)} ariaLabel={`${spec.label} ${sub.label}`} />
                ) : (
                  <FieldEditor spec={sub} path={childPath(path, sub.key)} control={control} register={register} />
                )}
              </div>
            ))}
          </div>
        </Field>
      );
    case "group":
      return <GroupEditor spec={spec} path={path} control={control} register={register} />;
  }
}

/** A repeatable array-of-objects rendered as add/remove cards. */
function GroupEditor({
  spec,
  path,
  control,
  register,
}: {
  spec: Extract<FieldSpec, { kind: "group" }>;
  path: string;
  control: Control<any>;
  register: any;
}): React.JSX.Element {
  const { fields, append, remove } = useFieldArray({ control, name: path });
  const watched = useWatch({ control, name: path }) as any[] | undefined;

  const blankItem = useMemo(() => makeBlank(spec.fields), [spec.fields]);

  return (
    <div className="space-y-3" role="group" aria-label={spec.label}>
      {fields.map((f, i) => {
        const titleVal = spec.itemTitleKey
          ? (watched?.[i]?.[spec.itemTitleKey] as string | undefined)
          : undefined;
        const title = titleVal && titleVal !== "" ? titleVal : `${spec.itemLabel} ${i + 1}`;
        return (
          <div key={f.id} className="bg-white border border-gray-200 rounded-[var(--radius-card)] overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-100">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide truncate">{title}</h4>
              <ActionTooltip label={`Remove ${spec.itemLabel} ${i + 1}`}>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${spec.itemLabel} ${i + 1}`}
                  className="text-gray-400 hover:text-fail-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 rounded shrink-0"
                >
                  ×
                </button>
              </ActionTooltip>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {spec.fields.map((sub) => (
                <FieldEditor
                  key={sub.key}
                  spec={sub}
                  path={`${path}.${i}.${sub.key}`}
                  control={control}
                  register={register}
                />
              ))}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => append(blankItem)}
        className="text-xs px-3 py-1.5 rounded border border-dashed border-gray-300 text-gray-600 hover:border-primary-600 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
      >
        + Add {spec.itemLabel}
      </button>
    </div>
  );
}

/** A blank item for `append` — sensible empty per field kind. */
function makeBlank(fields: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    switch (f.kind) {
      case "percent":
        out[f.key] = 0;
        break;
      case "chips":
      case "multiselect":
        out[f.key] = [];
        break;
      case "object":
        out[f.key] = makeBlank(f.fields);
        break;
      case "textarea":
      case "text":
        out[f.key] = f.nullable ? null : "";
        break;
      default:
        out[f.key] = "";
    }
  }
  return out;
}

// ─── Tree preview ───────────────────────────────────────────────────────────

/** Read-only hierarchy derived live from a flat parent-referencing array. */
function TreePreview({
  control,
  spec,
}: {
  control: Control<any>;
  spec: NonNullable<ArtifactFormSpec["treePreview"]>;
}): React.JSX.Element | null {
  const items = (useWatch({ control, name: spec.array }) as any[] | undefined) ?? [];
  if (items.length === 0) return null;

  const ids = new Set(items.map((it) => it?.[spec.idKey]).filter((v) => typeof v === "string"));
  const childrenOf = new Map<string | null, any[]>();
  for (const it of items) {
    const p = it?.[spec.parentKey];
    // A missing or dangling parent makes the node a root.
    const bucket = typeof p === "string" && ids.has(p) ? p : null;
    (childrenOf.get(bucket) ?? childrenOf.set(bucket, []).get(bucket)!).push(it);
  }

  const rows: React.JSX.Element[] = [];
  const walk = (parentId: string | null, depth: number, seen: Set<string>): void => {
    for (const it of childrenOf.get(parentId) ?? []) {
      const id = it?.[spec.idKey];
      if (typeof id === "string" && seen.has(id)) continue; // cycle guard
      const title = (it?.[spec.titleKey] as string) || (id as string) || "(untitled)";
      const badge = spec.badgeKey ? (it?.[spec.badgeKey] as string | undefined) : undefined;
      rows.push(
        <div
          key={id ?? `${parentId}-${rows.length}`}
          className="flex items-center gap-1.5 text-sm text-gray-700 py-0.5"
          style={{ paddingLeft: depth * 16 }}
        >
          <span aria-hidden="true" className="text-gray-300">
            {depth === 0 ? "•" : "└"}
          </span>
          <span className="truncate">{title}</span>
          {badge !== undefined && badge !== "" && (
            <span className="text-[11px] text-gray-400">{badge}</span>
          )}
        </div>,
      );
      if (typeof id === "string") walk(id, depth + 1, new Set([...seen, id]));
    }
  };
  walk(null, 0, new Set());

  return (
    <div
      className="bg-gray-50 border border-gray-200 rounded-[var(--radius-card)] px-3 py-2.5"
      role="tree"
      aria-label="Hierarchy"
      data-testid="tree-preview"
    >
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Hierarchy</p>
      {rows}
    </div>
  );
}

// ─── Sum-check advisory ─────────────────────────────────────────────────────

function SumChecks({
  spec,
  control,
}: {
  spec: ArtifactFormSpec;
  control: Control<any>;
}): React.JSX.Element | null {
  const values = useWatch({ control }) as Record<string, any>;
  const checks = spec.sumChecks ?? [];
  if (checks.length === 0) return null;
  return (
    <div className="space-y-1">
      {checks.map((c) => {
        const arr = Array.isArray(values?.[c.array]) ? (values[c.array] as any[]) : [];
        const sum = arr.reduce((a, item) => a + (typeof item?.[c.field] === "number" ? item[c.field] : 0), 0);
        const ok = Math.abs(sum - c.target) <= 0.005;
        const pct = Math.round(sum * 100);
        return (
          <p
            key={`${c.array}.${c.field}`}
            role="status"
            data-testid={`sumcheck-${c.array}-${c.field}`}
            className={`text-xs ${ok ? "text-success-600" : "text-warn-600"}`}
          >
            {ok ? "✓" : "⚠"} {c.label} sum to {pct}%
            {ok ? "" : ` (should be ${Math.round(c.target * 100)}%)`}
          </p>
        );
      })}
    </div>
  );
}

// ─── Editor ─────────────────────────────────────────────────────────────────

export interface JsonFormEditorProps {
  artifactKey: string;
  label: string;
  status: ArtifactStatus;
  spec: ArtifactFormSpec;
  /** Parsed JSON content — the form's initial values. */
  value: Record<string, unknown>;
  /** Resolved option sets for `multiselect` fields, keyed by external source. */
  externalOptions?: Record<string, ExternalOption[]>;
  bridge: Bridge;
  onBack: () => void;
  onRegenerate: () => void;
  /** Root gate: true disables Regenerate (e.g. the product brief is missing). */
  regenerateDisabled?: boolean;
  /** Tooltip shown on the disabled Regenerate button. */
  regenerateDisabledReason?: string;
}

export function JsonFormEditor({
  artifactKey,
  label,
  status,
  spec,
  value,
  externalOptions,
  bridge,
  onBack,
  onRegenerate,
  regenerateDisabled,
  regenerateDisabledReason,
}: JsonFormEditorProps): React.JSX.Element {
  const toast = useAppStore((s) => s.toast);
  const queryClient = useQueryClient();

  const { control, register, handleSubmit, reset, formState } = useForm<Record<string, any>>({
    defaultValues: value,
  });
  const { isDirty } = formState;

  const save = useMutation({
    ...putArtifactMutation(bridge),
    onSuccess: (_data, variables) => {
      reset(JSON.parse(variables.content) as Record<string, any>); // re-baseline → clean
      void queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(activeRoot(bridge)) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifact(activeRoot(bridge), artifactKey) });
      toast("Saved");
    },
    onError: () => toast("Save failed — is the bridge running?"),
  });
  const saving = save.isPending;

  const onSubmit = handleSubmit((values) => {
    const content = `${JSON.stringify(values, null, 2)}\n`;
    save.mutate({ key: artifactKey, content });
  });

  function handleBack(): void {
    if (isDirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    onBack();
  }

  return (
    <ExternalOptionsContext.Provider value={externalOptions ?? {}}>
      <div className="flex flex-col flex-1 min-h-0">
        <ArtifactEditorHeader
          label={label}
          status={status}
          onBack={handleBack}
          onRegenerate={onRegenerate}
          onSave={() => void onSubmit()}
          saveDisabled={!isDirty || saving}
          regenerateDisabled={regenerateDisabled}
          regenerateDisabledReason={regenerateDisabledReason}
        />

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
          data-testid="json-form-editor"
        >
          {spec.treePreview !== undefined && <TreePreview control={control} spec={spec.treePreview} />}
          {spec.fields.map((f) => (
            <FieldEditor key={f.key} spec={f} path={f.key} control={control} register={register} />
          ))}
          <SumChecks spec={spec} control={control} />
        </form>
      </div>
    </ExternalOptionsContext.Provider>
  );
}
