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
export { ARTIFACT_ELICITATION } from "./artifact-elicitation.js";
export type { ElicitationQuestion } from "./artifact-elicitation.js";
export { ARTIFACT_PREREQS, resolveCreationChain } from "./artifact-elicitation.js";
export { AUTHORING_ORDER } from "./artifact-elicitation.js";
export {
  CATEGORY_GROUPS,
  CATEGORY_TAXONOMY,
  LEGACY_CATEGORY_ALIASES,
  normalizeCategory,
  categoryLabel,
  categoryConsequences,
} from "./category-taxonomy.js";
export type {
  CategoryDialDefaults,
  CategoryOrientation,
  CategoryProfile,
} from "./category-taxonomy.js";
