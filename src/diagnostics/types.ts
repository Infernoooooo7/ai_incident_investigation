import type { RichText } from '../domain/richText';
import type { RunIndex } from '../domain/runIndex';
import type { AgentRun } from '../domain/types';

export type Confidence = 'low' | 'medium' | 'high';

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** How a finding relates to the run's outcome. */
export type FindingImpact = 'failure-point' | 'contributing' | 'observation';

export const IMPACT_LABELS: Record<FindingImpact, string> = {
  'failure-point': 'Likely failure point',
  contributing: 'Contributing factor',
  observation: 'Observation',
};

/** A developer's review of a finding: confirmed by checking the evidence, or set aside. */
export type FindingReview = 'checked' | 'dismissed';

export const REVIEW_LABELS: Record<FindingReview | 'open', string> = {
  open: 'Not reviewed',
  checked: 'Checked',
  dismissed: 'Dismissed',
};

export type RuleId =
  | 'tool-failure'
  | 'retry-loop'
  | 'permission-denied'
  | 'missing-tool-result'
  | 'malformed-input'
  | 'unexplained-failure';

export interface Evidence {
  eventId: string;
  /** Why this event supports the finding. */
  note: string;
}

/** A heuristic finding. Never a confirmed root cause. */
export interface Diagnosis {
  /** Stable within a run. */
  id: string;
  ruleId: RuleId;
  title: string;
  impact: FindingImpact;
  confidence: Confidence;
  /** Plain-language justification for the confidence level. */
  confidenceReason: string;
  /** What the trace shows, citing events. Facts only, no inference. */
  observed: RichText;
  /** The heuristic reading of those facts. Never a confirmed root cause. */
  interpretation: RichText;
  /** A concrete next check or fix. */
  suggestion: RichText;
  /** The most relevant event; selected when the finding is opened. */
  primaryEventId: string;
  /** Supporting events in run order. */
  evidence: Evidence[];
}

export interface DiagnosticContext {
  run: AgentRun;
  index: RunIndex;
  /** True when the run did not succeed (failed or cancelled). */
  runFailed: boolean;
}

export interface DiagnosticRule {
  id: RuleId;
  title: string;
  /** What the rule looks for; shown in the "How findings are produced" panel. */
  description: string;
  /**
   * Rules that reason from the absence of events become less reliable when
   * records were skipped during validation, so the engine lowers their confidence.
   */
  basis: 'presence' | 'absence';
  evaluate(context: DiagnosticContext): Diagnosis[];
}

export interface RuleFailure {
  ruleId: RuleId;
  message: string;
}

export interface DiagnosisResult {
  /** Sorted: likely failure points first, then by confidence, then by run order. */
  findings: Diagnosis[];
  /** Event ID to the IDs of findings that cite it as evidence. */
  findingsByEvent: ReadonlyMap<string, readonly string[]>;
  /** Rules that threw while evaluating; their findings are missing from the result. */
  ruleFailures: RuleFailure[];
}
