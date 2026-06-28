import { Ajv } from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import schema from "../schema/uxfactory.schema.json" with { type: "json" };
import type { Spec } from "./types.js";

/** A single validation problem, with a JSON Pointer to where it occurred. */
export interface ValidationError {
  /** JSON Pointer to the offending location, e.g. "/frames/0/children/2". "/" for the root. */
  path: string;
  /** Human-readable description. */
  message: string;
}

/** The result of validating an unknown value against the spec schema. */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateFn: ValidateFunction = ajv.compile(schema);

/** Validate an unknown value against the authoritative UXFactory spec schema. */
export function validate(input: unknown): ValidationResult {
  const valid = validateFn(input) === true;
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateFn.errors ?? []).map(toValidationError);
  return { valid: false, errors };
}

/** Type guard: true when `input` is a structurally valid spec. */
export function isSpec(input: unknown): input is Spec {
  return validate(input).valid;
}

function toValidationError(err: ErrorObject): ValidationError {
  const path = err.instancePath === "" ? "/" : err.instancePath;
  if (err.keyword === "additionalProperties") {
    const extra = (err.params as { additionalProperty?: string }).additionalProperty ?? "";
    return { path, message: `unknown property "${extra}"` };
  }
  return { path, message: err.message ?? "invalid" };
}
