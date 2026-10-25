import { code, eventRef, joinRich, rich } from '../../domain/richText';
import type { RichText } from '../../domain/richText';
import { findTerminalError, getCallId } from '../../domain/runIndex';
import type { ToolCallEvent, ToolResultEvent } from '../../domain/types';
import {
  classifyMalformedCall,
  describeEmptyOutput,
  eventsAfter,
  failureLabel,
  isSuccessfulResultFor,
  orderEvidence,
  position,
  pushTo,
  quote,
  sentenceEnd,
  stoppedAt,
} from '../helpers';
import type { EmptyOutput, InputProblem, MalformedCall } from '../helpers';
import type { Diagnosis, DiagnosticContext, DiagnosticRule, Evidence } from '../types';

export const malformedInputRule: DiagnosticRule = {
  id: 'malformed-input',
  title: 'Error after malformed or empty input',
  description:
    'Flags failed tool calls whose arguments were empty, null, or not valid JSON, when the error reads like a validation error or names the empty field. It also checks whether the nearest earlier tool result came back empty, a common source of the missing data.',
  basis: 'presence',
  evaluate(context) {
    const byTool = new Map<string, MalformedCall[]>();
    for (const event of context.run.events) {
      if (event.kind !== 'tool_result') continue;
      const malformed = classifyMalformedCall(context.index, event);
      if (malformed) pushTo(byTool, event.toolName, malformed);
    }
    return [...byTool].flatMap(([toolName, occurrences]) =>
      diagnose(context, toolName, occurrences),
    );
  },
};

interface EmptyUpstream {
  result: ToolResultEvent;
  call?: ToolCallEvent;
  empty: EmptyOutput;
}

/** The nearest successful result from another tool before `call`, if it came back empty. */
function findEmptyUpstream(
  context: DiagnosticContext,
  call: ToolCallEvent,
): EmptyUpstream | undefined {
  const before = context.run.events.slice(0, position(context.index, call)).reverse();
  const nearest = before.find(
    (event): event is ToolResultEvent =>
      event.kind === 'tool_result' &&
      event.outcome === 'success' &&
      event.toolName !== call.toolName,
  );
  const empty = nearest ? describeEmptyOutput(nearest.output) : undefined;
  if (!nearest || !empty) return undefined;
  return { result: nearest, call: context.index.callsByCallId.get(nearest.callId), empty };
}

function describeProblem(problem: InputProblem): RichText {
  return problem.field ? rich`${code(problem.field)} ${problem.issue}` : rich`${problem.issue}`;
}

function describeProblems(problems: InputProblem[]): RichText {
  const shown = problems.slice(0, 3).map(describeProblem);
  const more = problems.length > 3 ? [rich`${problems.length - 3} more`] : [];
  return joinRich([...shown, ...more], ', ');
}

function describeEmpty(empty: EmptyOutput): RichText {
  return empty.field ? rich`${code(empty.field)} ${empty.issue}` : rich`it ${empty.issue}`;
}

function plainProblem(problem: InputProblem | undefined): string {
  if (!problem) return 'empty input';
  return problem.field ? `${problem.field} ${problem.issue}` : problem.issue;
}

function diagnose(
  context: DiagnosticContext,
  toolName: string,
  occurrences: MalformedCall[],
): Diagnosis[] {
  const { index, run, runFailed } = context;
  const first = occurrences[0];
  const last = occurrences.at(-1);
  if (!first || !last) return [];

  const recovery = eventsAfter(index, last.result).find(isSuccessfulResultFor(toolName));
  const upstream = findEmptyUpstream(context, first.call);
  const terminal = findTerminalError(run);
  // Without a fatal error event, the terminal error can be one of these failed results itself.
  const terminalIsOccurrence =
    terminal !== undefined &&
    occurrences.some((occurrence) => occurrence.result.id === terminal.id);
  const terminalCallId = terminal && !terminalIsOccurrence ? getCallId(terminal) : undefined;
  const terminalLinked =
    terminalCallId !== undefined &&
    occurrences.some((occurrence) => occurrence.call.callId === terminalCallId);

  const strong = occurrences.some((o) => o.validationLike && o.fieldMentioned);
  const validationLike = occurrences.some((o) => o.validationLike);
  const fields = [
    ...new Set(occurrences.flatMap((o) => o.problems.flatMap((p) => (p.field ? [p.field] : [])))),
  ];
  let confidenceReason = strong
    ? `The error reads like a validation error and names the empty input${fields.length > 0 ? ` (${fields.join(', ')})` : ''}.`
    : validationLike
      ? 'The error reads like a validation error, but it does not name the empty field.'
      : 'The error names the empty field, but it does not read like a validation error.';
  if (recovery)
    confidenceReason += ` A later call succeeded (${recovery.id}), so the run recovered.`;

  const steps = occurrences.map(
    (o) =>
      rich`${describeProblems(o.problems)} (${eventRef(o.call.id)} → ${eventRef(o.result.id)})`,
  );
  const errorText = quote(last.result.errorMessage ?? last.result.errorCode ?? 'error');
  const upstreamNote = upstream
    ? rich` The nearest earlier tool result, ${code(upstream.result.toolName)} at ${eventRef(upstream.result.id)}, came back empty (${describeEmpty(upstream.empty)}).`
    : [];
  let interpretation: RichText = rich`The empty or malformed argument likely caused the rejection.`;
  if (upstream) {
    interpretation = rich`The empty argument likely caused the rejection, and the empty result from ${code(upstream.result.toolName)} may be where the missing data came from.`;
  }
  if (recovery) {
    interpretation = rich`The empty argument likely caused the rejection, but a later call succeeded, so the run recovered.`;
  }
  let outcome: RichText = [];
  if (recovery) {
    outcome = rich` A later call succeeded at ${eventRef(recovery.id)}.`;
  } else if (terminal && terminalLinked) {
    outcome = rich` The run then ${stoppedAt(terminal)}.`;
  }

  const source = upstream
    ? rich`${code(upstream.result.toolName)} returned no data (review its input at ${eventRef(upstream.call?.id ?? upstream.result.id)})`
    : rich`the step that should have produced these values left them empty`;

  const evidence: Evidence[] = [];
  if (upstream) {
    const detail = upstream.empty.field
      ? `${upstream.empty.field} ${upstream.empty.issue}`
      : upstream.empty.issue;
    evidence.push({ eventId: upstream.result.id, note: `Earlier result was empty (${detail})` });
  }
  for (const occurrence of occurrences) {
    evidence.push({
      eventId: occurrence.call.id,
      note: `Called with ${plainProblem(occurrence.problems[0])}`,
    });
    evidence.push({
      eventId: occurrence.result.id,
      note: `Rejected with ${failureLabel(occurrence.result)}`,
    });
  }
  if (recovery) evidence.push({ eventId: recovery.id, note: 'Later call succeeded' });
  else if (terminal && terminalLinked)
    evidence.push({ eventId: terminal.id, note: 'Run ended here' });

  return [
    {
      id: `malformed-input:${last.result.id}`,
      ruleId: 'malformed-input',
      title: 'Error after malformed or empty input',
      impact: recovery || !runFailed ? 'observation' : 'failure-point',
      confidence: strong ? 'high' : 'medium',
      confidenceReason,
      observed: [
        ...rich`${code(toolName)} was called with empty or malformed arguments and rejected ${occurrences.length > 1 ? 'them each time' : 'them'}: ${joinRich(steps, '; then ')}. The error said ${errorText}${sentenceEnd(errorText)}`,
        ...upstreamNote,
        ...outcome,
      ],
      interpretation,
      suggestion: rich`Check why ${source}. Validate arguments against the tool's schema before calling, and have the agent stop and report when a required upstream result is empty instead of calling the next tool with placeholder values.`,
      primaryEventId: last.result.id,
      evidence: orderEvidence(index, evidence),
    },
  ];
}
