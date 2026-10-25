import { formatDuration, formatUtcDateTime, msBetween, pluralize } from '../../domain/format';
import { code, eventRef, rich } from '../../domain/richText';
import type { RichText } from '../../domain/richText';
import { findTerminalError } from '../../domain/runIndex';
import type { RunStatus, ToolCallEvent } from '../../domain/types';
import {
  eventsAfter,
  findRequestIds,
  findTimeoutSetting,
  orderEvidence,
  position,
} from '../helpers';
import type {
  Confidence,
  Diagnosis,
  DiagnosticContext,
  DiagnosticRule,
  Evidence,
  FindingImpact,
} from '../types';

const ENDED_PHRASES: Record<RunStatus, string> = {
  cancelled: 'was cancelled',
  failed: 'failed',
  succeeded: 'finished',
};

export const missingToolResultRule: DiagnosticRule = {
  id: 'missing-tool-result',
  title: 'Expected tool result is missing',
  description:
    'Flags tool calls that have no matching tool result (matched by call ID), unless a permission decision denied the call. It is a likely failure point when the call was the last one in a run that did not succeed. Because it reasons from an absence, its confidence is lowered when the trace has skipped records.',
  basis: 'absence',
  evaluate(context) {
    const { index, run } = context;
    return run.events.flatMap((event) => {
      if (event.kind !== 'tool_call' || index.resultsByCallId.has(event.callId)) return [];
      const denied = (index.permissionsByCallId.get(event.callId) ?? []).some(
        (decision) => decision.decision === 'denied',
      );
      return denied ? [] : [diagnose(context, event)];
    });
  },
};

function diagnose(context: DiagnosticContext, call: ToolCallEvent): Diagnosis {
  const { index, run, runFailed } = context;
  const later = eventsAfter(index, call);
  const laterCalls = later.filter((event) => event.kind === 'tool_call');
  const isLastCall = laterCalls.length === 0;
  const terminal = findTerminalError(run);
  const terminalAfter =
    terminal !== undefined && position(index, terminal) > position(index, call)
      ? terminal
      : undefined;
  const relatedErrors = (index.errorsByCallId.get(call.callId) ?? []).filter(
    (error) => error.id !== terminalAfter?.id,
  );
  const waitedMs = msBetween(call.timestamp, run.endedAt);

  let impact: FindingImpact;
  let confidence: Confidence;
  let confidenceReason: string;
  if (!runFailed) {
    impact = 'observation';
    confidence = 'low';
    confidenceReason = 'The run still succeeded, so the result may not have been needed.';
  } else if (isLastCall) {
    impact = 'failure-point';
    confidence = 'high';
    confidenceReason =
      'This was the last tool call, no result was ever recorded for it, and the run ended without succeeding.';
  } else {
    impact = 'contributing';
    confidence = 'medium';
    confidenceReason = `No result was recorded, but the agent made ${pluralize(laterCalls.length, 'more tool call')} afterwards, so the run may have failed for another reason.`;
  }

  let afterwards: RichText = [];
  if (isLastCall && waitedMs !== undefined && waitedMs >= 0) {
    const where = terminalAfter ? rich` (${eventRef(terminalAfter.id)})` : [];
    afterwards = rich` The run ${ENDED_PHRASES[run.status]} ${formatDuration(waitedMs)} later${where} without receiving a response.`;
  } else if (!isLastCall) {
    afterwards = rich` The agent continued with ${pluralize(laterCalls.length, 'more tool call')} without it.`;
  }
  const setting = findTimeoutSetting(call);
  const noTimeout =
    setting && (setting.value === null || setting.value === 0)
      ? rich` No timeout was configured for the call (${code(`${setting.key}: ${String(setting.value)}`)}).`
      : [];

  const requestIds = findRequestIds(call);
  const requestNote = requestIds[0] ? rich` (request ${code(requestIds[0])})` : [];

  const evidence: Evidence[] = [{ eventId: call.id, note: 'Call with no recorded result' }];
  relatedErrors.forEach((error) =>
    evidence.push({ eventId: error.id, note: 'Error recorded for this call' }),
  );
  if (terminalAfter && runFailed) {
    evidence.push({
      eventId: terminalAfter.id,
      note:
        waitedMs !== undefined && isLastCall
          ? `Run ended ${formatDuration(msBetween(call.timestamp, terminalAfter.timestamp))} after the call`
          : 'Run ended here',
    });
  }

  return {
    id: `missing-tool-result:${call.id}`,
    ruleId: 'missing-tool-result',
    title: 'Expected tool result is missing',
    impact,
    confidence,
    confidenceReason,
    observed: [
      ...rich`${code(call.toolName)} was called at ${eventRef(call.id)} (call ID ${code(call.callId)}), but no matching tool result was recorded.`,
      ...afterwards,
      ...noTimeout,
    ],
    interpretation:
      impact === 'failure-point'
        ? rich`The call probably hung, leaving the agent waiting until the run ended. The result may also have been produced but never recorded.`
        : impact === 'contributing'
          ? rich`A lost result may have left the agent working with incomplete information.`
          : rich`The run succeeded without this result, so it may not have been needed.`,
    suggestion: rich`Check the ${code(call.toolName)} logs for call ${code(call.callId)}${requestNote} around ${formatUtcDateTime(call.timestamp)}. Make sure the tool returns a result or an explicit error on every code path, and set a per-tool timeout so a hung call surfaces as an error the agent can handle.`,
    primaryEventId: call.id,
    evidence: orderEvidence(index, evidence),
  };
}
