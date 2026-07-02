/**
 * wizard.ts — Setup wizard drafts for classification (step 1) and generation
 * defaults (step 2).  State survives Back navigation.
 *
 * Default values match exactly the PRD 01 screenshot state:
 *   Ecommerce / Corporate / en-US / Desktop+Mobile / Responsive / 18–39 / Start fresh
 *
 * Default defaults match the PRD 02 suggestion for Ecommerce·Corporate:
 *   Mix / High / Medium / Shallow (low) / Medium / High
 *
 * `suggestFor(classification)` produces a suggestion for the defaults draft.
 * `userEdited` flags prevent re-suggestions from clobbering user edits.
 */

import { create } from "zustand";
import type { ProjectSnapshot } from "../lib/bridge.js";

// ─── Classification draft ─────────────────────────────────────────────────────

export type Category = "marketing" | "ecommerce" | "webapp" | "news";
export type Layout = "responsive" | "adaptive";
export type StartingMode = "start-fresh" | "use-existing";

export interface ClassificationDraft {
  category: Category;
  industry: string;
  locale: string;
  platforms: string[];
  layout: Layout;
  ageGroup: string;
  startingMode: StartingMode;
}

// ─── Defaults draft ───────────────────────────────────────────────────────────

export interface DefaultsDraft {
  /** editorial tone — maps to classification.style */
  style: string;
  /** profile.scope.visual */
  visual: string;
  /** profile.scope.editorial */
  editorial: string;
  /** profile.scope.flow */
  flow: string;
  /** profile.scope.coverage */
  coverage: string;
  /** profile.experimental.coherence */
  coherence: string;
}

export type DefaultsField = keyof DefaultsDraft;

// ─── Suggestion engine ────────────────────────────────────────────────────────

export interface DefaultsSuggestion {
  style: string;
  visual: string;
  editorial: string;
  flow: string;
  coverage: string;
  coherence: string;
}

/**
 * Produces suggested generation defaults based on classification.
 * Ecommerce + Corporate (per PRD 02): mix / high / medium / low / medium / high
 * All other combinations: reasonable balanced defaults.
 */
export function suggestFor(classification: Partial<ClassificationDraft>): DefaultsSuggestion {
  const { category, industry } = classification;

  // Primary suggestion: Ecommerce + Corporate
  if (category === "ecommerce" && industry?.toLowerCase() === "corporate") {
    return {
      style: "mix",
      visual: "high",
      editorial: "medium",
      flow: "low",      // Shallow
      coverage: "medium",
      coherence: "high",
    };
  }

  // Marketing sites — more visual, shallower flows
  if (category === "marketing") {
    return {
      style: "informal",
      visual: "high",
      editorial: "low",
      flow: "low",
      coverage: "low",
      coherence: "medium",
    };
  }

  // Web apps — deeper flows, stricter coverage
  if (category === "webapp") {
    return {
      style: "formal",
      visual: "medium",
      editorial: "high",
      flow: "high",
      coverage: "high",
      coherence: "high",
    };
  }

  // Default / news / other
  return {
    style: "mix",
    visual: "medium",
    editorial: "medium",
    flow: "medium",
    coverage: "medium",
    coherence: "medium",
  };
}

// ─── Store state ──────────────────────────────────────────────────────────────

export interface WizardState {
  classification: ClassificationDraft;
  defaults: DefaultsDraft;
  /** Tracks which defaults fields the user has manually edited (prevents re-suggest). */
  userEdited: Record<DefaultsField, boolean>;
}

export interface WizardActions {
  setClassification(patch: Partial<ClassificationDraft>): void;
  setDefault(field: DefaultsField, value: string): void;
  /**
   * Re-run the suggestion engine and apply suggestions to any fields the user
   * has NOT manually edited.
   */
  applySuggestions(classification: Partial<ClassificationDraft>): void;
  /** Pre-fill wizard from a snapshot (re-entering setup on a classified project). */
  prefillFrom(snapshot: ProjectSnapshot): void;
  /** Reset userEdited flags (e.g. after explicit "reset to suggested"). */
  clearUserEdited(): void;
}

export type WizardStore = WizardState & WizardActions;

// ─── Initial values ───────────────────────────────────────────────────────────

const DEFAULT_CLASSIFICATION: ClassificationDraft = {
  category: "ecommerce",
  industry: "corporate",
  locale: "en-US",
  platforms: ["desktop", "mobile"],
  layout: "responsive",
  ageGroup: "18-39",
  startingMode: "start-fresh",
};

const DEFAULT_DEFAULTS: DefaultsDraft = {
  style: "mix",
  visual: "high",
  editorial: "medium",
  flow: "low",
  coverage: "medium",
  coherence: "high",
};

function freshUserEdited(): Record<DefaultsField, boolean> {
  return {
    style: false,
    visual: false,
    editorial: false,
    flow: false,
    coverage: false,
    coherence: false,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useWizardStore = create<WizardStore>((set, get) => ({
  classification: { ...DEFAULT_CLASSIFICATION },
  defaults: { ...DEFAULT_DEFAULTS },
  userEdited: freshUserEdited(),

  setClassification(patch) {
    set((s) => ({
      classification: { ...s.classification, ...patch },
    }));
  },

  setDefault(field, value) {
    set((s) => ({
      defaults: { ...s.defaults, [field]: value },
      userEdited: { ...s.userEdited, [field]: true },
    }));
  },

  applySuggestions(classification) {
    const suggestion = suggestFor(classification);
    set((s) => {
      const next = { ...s.defaults };
      const fields = Object.keys(suggestion) as DefaultsField[];
      for (const field of fields) {
        if (!s.userEdited[field]) {
          next[field] = suggestion[field] as string;
        }
      }
      return { defaults: next };
    });
  },

  prefillFrom(snapshot) {
    const cls = snapshot.classification;
    const profile = snapshot.profile;

    if (cls) {
      const patch: Partial<ClassificationDraft> = {};
      if (typeof cls["category"] === "string") patch.category = cls["category"] as Category;
      if (typeof cls["industry"] === "string") patch.industry = cls["industry"];
      if (typeof cls["locale"] === "string") patch.locale = cls["locale"];
      if (Array.isArray(cls["platforms"])) {
        patch.platforms = cls["platforms"] as string[];
      }
      if (typeof cls["layout"] === "string") patch.layout = cls["layout"] as Layout;
      if (typeof cls["ageGroup"] === "string") patch.ageGroup = cls["ageGroup"];
      set((s) => ({ classification: { ...s.classification, ...patch } }));
    }

    if (profile) {
      const scope =
        profile["scope"] !== null &&
        typeof profile["scope"] === "object" &&
        !Array.isArray(profile["scope"])
          ? (profile["scope"] as Record<string, unknown>)
          : {};
      const experimental =
        profile["experimental"] !== null &&
        typeof profile["experimental"] === "object" &&
        !Array.isArray(profile["experimental"])
          ? (profile["experimental"] as Record<string, unknown>)
          : {};

      const patchDefaults: Partial<DefaultsDraft> = {};
      if (typeof scope["visual"] === "string") patchDefaults.visual = scope["visual"];
      if (typeof scope["editorial"] === "string") patchDefaults.editorial = scope["editorial"];
      if (typeof scope["flow"] === "string") patchDefaults.flow = scope["flow"];
      if (typeof scope["coverage"] === "string") patchDefaults.coverage = scope["coverage"];
      if (typeof experimental["coherence"] === "string") {
        patchDefaults.coherence = experimental["coherence"];
      }
      // style lives in classification
      if (typeof cls?.["style"] === "string") patchDefaults.style = cls["style"] as string;

      if (Object.keys(patchDefaults).length > 0) {
        // Mark every restored defaults field as userEdited so that Screen 2's
        // applySuggestions effect does not overwrite persisted profile values
        // when the screen re-mounts (acceptance criteria: re-entry shows
        // persisted values, not re-suggested ones).
        const userEditedPatch = Object.fromEntries(
          Object.keys(patchDefaults).map((k) => [k, true]),
        ) as Partial<Record<DefaultsField, boolean>>;
        set((s) => ({
          defaults: { ...s.defaults, ...patchDefaults },
          userEdited: { ...s.userEdited, ...userEditedPatch },
        }));
      }
    }
  },

  clearUserEdited() {
    set({ userEdited: freshUserEdited() });
  },
}));

// Re-export suggestFor so tests can import it alongside the store.
export { suggestFor as suggestForClassification };
