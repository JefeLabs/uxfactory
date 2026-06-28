export interface DriftFinding {
  component?: string;
  node?: string;
  kind?: string;
  detail?: string;
}
export interface DriftResult {
  findings?: DriftFinding[];
}
export declare function buildDriftCommand(): string[];
export declare function formatDriftContext(result: DriftResult | null | undefined): string;
export declare function main(): Promise<void>;
