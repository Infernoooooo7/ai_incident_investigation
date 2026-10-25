import { code, eventRef, joinRich, rich } from '../../domain/richText';
import type { RichText } from '../../domain/richText';
import type { RetryEvent, ToolResultEvent } from '../../domain/types';
import {
  changedArgumentNames,
  classifyFailure,
  failureLabel,
  failureSignature,
  jsonEqual,
  orderEvidence,
  position,
} from '../helpers';
import type { Diagnosis, DiagnosticContext, DiagnosticRule, Evidence } from '../types';

export const retryLoopRule: DiagnosticRule = {
  id: 'retry-loop',
  title: 'Retries repeated the same failure',
  description:
    'Flags a tool that failed two or more times in a row with the same error signature (the error code, or the error message with IDs and numbers normalized) and never succeeded afterwards. Identical arguments on every attempt raise confidence, because an unchanged retry of the same failure is unlikely to succeed.',
  basis: 'presence',
  evaluate(context) {
    // Consecutive failures per tool; a success resets the streak.
    const streaks = new Map<string, ToolResultEvent[]>();
    for (const event of context.run.events) {
      if (event.kind !== 'tool_result') continue;
      if (event.outcome === 'success') {
        streaks.delete(event.toolName);
      } else {
        streaks.set(event.toolName, [...(streaks.get(event.toolName) ?? []), event]);
      }
    }
    // Streaks still open at the end of the run were never followed by a success.
    return [...streaks].flatMap(([toolName, streak]) => {
      const repeated = trailingSameFailure(streak);
      return repeated.length >= 2 ? [diagnose(context, toolName, repeated)] : [];
    });
  },
};

/** The longest run of failures at the end of the streak that share one signature. */
function trailingSameFailure(streak: ToolResultEvent[]): ToolResultEvent[] {
  const last = streak.at(-1);
  if (!last) return [];
  const signature = failureSignature(last);
  let start = streak.length - 1;
  while (start > 0 && failureSignature(streak[start - 1] as ToolResultEvent) === signature) start--;
  return streak.slice(start);
}

function diagnose(
  context: DiagnosticContext,
  toolName: string,
  failures: ToolResultEvent[],
): Diagnosis {
  const { index, run, runFailed } = context;
  const first = failures[0] as ToolResultEvent;
  const last = failures.at(-1) as ToolResultEvent;
  const calls = failures.map((failure) => index.callsByCallId.get(failure.callId));
  const inputs = calls.map((call) => call?.input);
  const identicalInputs =
    calls.every((call) => call !== undefined) &&
    inputs.every((input) => jsonEqual(input, inputs[0]));
  const changed = identicalInputs ? [] : changedArgumentNames(inputs);

  // Retry events recorded between the first and the last failure of the streak.
  const callIds = new Set(failures.map((failure) => failure.callId));
  const retries = run.events.filter(
    (event): event is RetryEvent =>
      event.kind === 'retry' &&
      (event.toolName === toolName ||
        (event.previousCallId !== undefined && callIds.has(event.previousCallId))) &&
      position(index, event) > position(index, first) &&
      position(index, event) < position(index, last),
  );
  const exhausted = retries.find(
    (retry) => retry.maxAttempts !== undefined && retry.attempt >= retry.maxAttempts,
  );

  const refs = joinRich(
    failures.map((failure) => [eventRef(failure.id)]),
    ', ',
  );
  const label = failureLabel(last);
  let argumentsNote: RichText;
  if (identicalInputs) {
    argumentsNote = rich` Every attempt used identical arguments.`;
  } else if (changed.length > 0) {
    const names = joinRich(
      changed.map((name) => [code(name)]),
      ', ',
    );
    argumentsNote = rich` The arguments changed between attempts (${names}).`;
  } else {
    argumentsNote = rich` The arguments could not be compared across attempts.`;
  }
  const budget = exhausted
    ? rich` The retry budget was used up (attempt ${exhausted.attempt} of ${exhausted.maxAttempts ?? exhausted.attempt}, ${eventRef(exhausted.id)}).`
    : [];

  const evidence: Evidence[] = [];
  failures.forEach((failure, attemptIndex) => {
    const call = calls[attemptIndex];
    if (call) evidence.push({ eventId: call.id, note: `Attempt ${attemptIndex + 1} call` });
    evidence.push({ eventId: failure.id, note: `Attempt ${attemptIndex + 1} failed (${label})` });
  });
  retries.forEach((retry) =>
    evidence.push({
      eventId: retry.id,
      note: retry.maxAttempts
        ? `Retry, attempt ${retry.attempt} of ${retry.maxAttempts}`
        : `Retry, attempt ${retry.attempt}`,
    }),
  );

  return {
    id: `retry-loop:${last.id}`,
    ruleId: 'retry-loop',
    title: 'Retries repeated the same failure',
    impact: runFailed ? 'contributing' : 'observation',
    confidence: identicalInputs ? 'high' : 'medium',
    confidenceReason: identicalInputs
      ? 'Every attempt sent identical arguments and failed with the same error signature.'
      : 'The error signature repeated, but the arguments changed between attempts, so the retries were not exact repeats.',
    observed: [
      ...rich`${code(toolName)} failed ${failures.length} times in a row with the same error (${label}): ${refs}.`,
      ...argumentsNote,
      ...budget,
    ],
    interpretation: identicalInputs
      ? rich`Retrying an identical request was unlikely to succeed, so the retries probably added time without changing the outcome.`
      : rich`The changes between attempts did not address the error, so the retries probably could not succeed as written.`,
    suggestion: suggestFix(last),
    primaryEventId: last.id,
    evidence: orderEvidence(index, evidence),
  };
}

function suggestFix(last: ToolResultEvent): RichText {
  switch (classifyFailure(last)) {
    case 'deterministic':
      return rich`Don't retry deterministic errors unchanged. Make the retry policy error-aware (retry timeouts, rate limits, and 5xx responses; stop on validation and permission errors) and report the error to the user or planner instead.`;
    case 'transient':
      return rich`Use exponential backoff with jitter, check upstream health before retrying, and change something between attempts, such as a smaller request or a deliberately longer timeout. A circuit breaker would let repeated failures fail fast.`;
    case 'unknown':
      return rich`Make retries conditional on the error type and change something between attempts, or stop early and report the error.`;
  }
}
