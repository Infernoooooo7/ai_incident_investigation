/**
 * Deterministic diagnostic engine.
 *
 * Runs a fixed set of explainable rules over a run's recorded events. Findings
 * are heuristics that point at likely failure points; the engine performs no
 * causal analysis and uses no language model.
 */
import { pluralize } from '../domain/format';
import { buildRunIndex } from '../domain/runIndex';
import type { RunIndex } from '../domain/runIndex';
import type { AgentRun } from '../domain/types';
import { lowerConfidence } from './helpers';
import { malformedInputRule } from './rules/malformedInput';
import { missingToolResultRule } from './rules/missingToolResult';
import { permissionDeniedRule } from './rules/permissionDenied';
import { retryLoopRule } from './rules/retryLoop';
import { toolFailureRule } from './rules/toolFailure';
import { unexplainedFailureRule } from './rules/unexplainedFailure';
import type {
  Confidence,
  Diagnosis,
  DiagnosisResult,
  DiagnosticContext,
  DiagnosticRule,
  FindingImpact,
  RuleFailure,
} from './types';

const PRIMARY_RULES: readonly DiagnosticRule[] = [
  toolFailureRule,
  retryLoopRule,
  permissionDeniedRule,
  missingToolResultRule,
  malformedInputRule,
];

/** Every rule, in the order shown in the "How findings are produced" panel. */
export const RULE_CATALOG: readonly DiagnosticRule[] = [...PRIMARY_RULES, unexplainedFailureRule];

export interface DiagnoseOptions {
  /** Event records that failed validation; absence-based findings are less certain when > 0. */
  skippedRecordCount?: number;
  /** Overrides the primary rule set (used by tests). The fallback rule always applies. */
  rules?: readonly DiagnosticRule[];
}

const IMPACT_RANK: Record<FindingImpact, number> = {
  'failure-point': 0,
  contributing: 1,
  observation: 2,
};
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export function diagnoseRun(run: AgentRun, options: DiagnoseOptions = {}): DiagnosisResult {
  const index = buildRunIndex(run);
  const context: DiagnosticContext = { run, index, runFailed: run.status !== 'succeeded' };
  const skipped = options.skippedRecordCount ?? 0;
  const ruleFailures: RuleFailure[] = [];

  // One misbehaving rule must not take down the whole diagnosis.
  const evaluate = (rule: DiagnosticRule): Diagnosis[] => {
    try {
      return rule.evaluate(context).map((finding) => adjustForDataQuality(finding, rule, skipped));
    } catch (error) {
      ruleFailures.push({
        ruleId: rule.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };

  const findings = (options.rules ?? PRIMARY_RULES).flatMap(evaluate);
  if (context.runFailed && !findings.some((finding) => finding.impact === 'failure-point')) {
    findings.push(...evaluate(unexplainedFailureRule));
  }

  const ordered = uniqueIds(findings).sort(compareFindings(index));
  return { findings: ordered, findingsByEvent: indexEvidence(ordered), ruleFailures };
}

/** Lowers confidence for findings that infer something from a missing event. */
function adjustForDataQuality(
  finding: Diagnosis,
  rule: DiagnosticRule,
  skipped: number,
): Diagnosis {
  if (skipped === 0 || rule.basis !== 'absence') return finding;
  const lowered = lowerConfidence(finding.confidence);
  if (lowered === finding.confidence) return finding;
  return {
    ...finding,
    confidence: lowered,
    confidenceReason:
      `${finding.confidenceReason} Lowered from ${finding.confidence} because ` +
      `${pluralize(skipped, 'record')} in this trace failed validation and ${skipped === 1 ? 'was' : 'were'} skipped; ` +
      'the missing event could be among them.',
  };
}

function compareFindings(index: RunIndex) {
  const at = (finding: Diagnosis) => index.positionById.get(finding.primaryEventId) ?? 0;
  return (a: Diagnosis, b: Diagnosis) =>
    IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] ||
    CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
    at(a) - at(b);
}

function uniqueIds(findings: Diagnosis[]): Diagnosis[] {
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const count = (seen.get(finding.id) ?? 0) + 1;
    seen.set(finding.id, count);
    return count === 1 ? finding : { ...finding, id: `${finding.id}#${count}` };
  });
}

function indexEvidence(findings: Diagnosis[]): Map<string, string[]> {
  const byEvent = new Map<string, string[]>();
  for (const finding of findings) {
    for (const { eventId } of finding.evidence) {
      const list = byEvent.get(eventId) ?? [];
      if (!list.includes(finding.id)) list.push(finding.id);
      byEvent.set(eventId, list);
    }
  }
  return byEvent;
}

/** The finding to surface first: the top-ranked one, if it is a likely failure point. */
export function getLikelyFailurePoint(result: DiagnosisResult): Diagnosis | undefined {
  const top = result.findings[0];
  return top?.impact === 'failure-point' ? top : undefined;
}
