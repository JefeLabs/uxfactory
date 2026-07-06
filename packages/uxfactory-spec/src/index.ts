export * from "./types.js";
export { validate, isSpec } from "./validate.js";
export type { ValidationError, ValidationResult } from "./validate.js";
export {
  ARTIFACT_REGISTRY,
  COMPONENT_TYPE_MAPPING,
  QUADRANT_MODIFIERS,
  resolveRequirements,
} from "./component-type-mapping.js";
export type {
  ArtifactRegistryEntry,
  ProjectQuadrant,
  RegistryStatus,
  RequirementLevel,
  ResolvedRequirement,
  TypeGroup,
  TypeMappingEntry,
} from "./component-type-mapping.js";
