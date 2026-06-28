/**
 * The committed component map (`uxfactory.map.json`) — the join between code, spec, and
 * canvas (PRD §11.1). You maintain `component`/`spec`/`node`/`source`; UXFactory
 * auto-fills `figmaId`/`lastSynced` on render and never edits the maintained fields.
 */

/** The maintained code/infra binding for a component. */
export interface MapSource {
  /** Which source kind the `ref` points into. */
  kind: "terraform" | "k8s" | "compose";
  /** `file#identifier`, e.g. `infra/main.tf#aws_apigatewayv2_api.main`. */
  ref: string;
  /** Optional logical-field → source-attribute bindings enabling the precise field diff. */
  compare?: Record<string, string>;
}

/** What UXFactory auto-fills on every render. */
export interface MapLastSynced {
  render: string;
  commit: string;
}

/** One row of the map: implemented component ↔ spec node ↔ Figma node. */
export interface MapEntry {
  /** Logical id — the stable join key (MAINTAINED). */
  component: string;
  /** Which spec file renders it (MAINTAINED). */
  spec: string;
  /** Which node within that spec (MAINTAINED). */
  node: string;
  /** The code/infra binding (MAINTAINED). */
  source: MapSource;
  /** Auto-filled from the render report — NEVER hand-maintained. */
  figmaId?: string;
  /** Auto-filled on render — NEVER hand-maintained. */
  lastSynced?: MapLastSynced;
}

/** The whole committed map. */
export interface ComponentMap {
  version: 1;
  components: MapEntry[];
}

/** The fields UXFactory must NEVER edit (only a human/agent maintains these). */
export const MAINTAINED_FIELDS = ["component", "spec", "node", "source"] as const;

/** The outcome of validating an unknown value as a ComponentMap. */
export interface MapValidation {
  valid: boolean;
  errors: string[];
}

/** Hand-rolled structural validation of an unknown value as a ComponentMap. Never throws. */
export function validateMap(input: unknown): MapValidation {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["map must be a JSON object"] };
  }
  const obj = input as Record<string, unknown>;
  if (obj.version !== 1) {
    errors.push(`version must be 1 (got ${JSON.stringify(obj.version)})`);
  }
  if (!Array.isArray(obj.components)) {
    errors.push("components must be an array");
    return { valid: errors.length === 0, errors };
  }
  obj.components.forEach((raw, i) => {
    const where = `components[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`${where} must be an object`);
      return;
    }
    const e = raw as Record<string, unknown>;
    for (const f of ["component", "spec", "node"] as const) {
      if (typeof e[f] !== "string" || (e[f] as string).length === 0) {
        errors.push(`${where}.${f} must be a non-empty string`);
      }
    }
    const src = e.source;
    if (typeof src !== "object" || src === null || Array.isArray(src)) {
      errors.push(`${where}.source must be an object`);
      return;
    }
    const s = src as Record<string, unknown>;
    if (s.kind !== "terraform" && s.kind !== "k8s" && s.kind !== "compose") {
      errors.push(`${where}.source.kind must be terraform | k8s | compose`);
    }
    if (typeof s.ref !== "string" || (s.ref as string).length === 0) {
      errors.push(`${where}.source.ref must be a non-empty string`);
    }
    if (s.compare !== undefined) {
      if (typeof s.compare !== "object" || s.compare === null || Array.isArray(s.compare)) {
        errors.push(`${where}.source.compare must be an object of string → string`);
      } else if (
        !Object.values(s.compare as Record<string, unknown>).every((v) => typeof v === "string")
      ) {
        errors.push(`${where}.source.compare values must all be strings`);
      }
    }
  });
  return { valid: errors.length === 0, errors };
}
