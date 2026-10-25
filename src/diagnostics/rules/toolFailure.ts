import { formatDuration, formatUtcDateTime } from '../../domain/format';
import { code, eventRef, joinRich, rich } from '../../domain/richText';
import type { RichText } from '../../domain/richText';
import { findTerminalError, getCallId } from '../../domain/runIndex';
import type { ToolResultEvent } from '../../domain/types';
import {
  classifyFailure,
  classifyMalformedCall,
  eventsAfter,
  failureLabel,
  failureSignature,
  findRequestIds,
  findTimeoutSetting,
  isFailedResult,
  isSuccessfulResultFor,
  orderEvidence,
  pushTo,
  quote,
  stoppedAt,
  stringMetadata,
} from '../helpers';
import type {
  Confidence,
  Diagnosis,
  DiagnosticContext,
  DiagnosticRule,
  Evidence,
  FindingImpact,
} from '../types';

const RATE_LIMIT = /RATE_LIMIT|THROTTL|\b429\b|too many requests/i;
const AUTH_FAILURE = /UNAUTHORI[SZ]ED|FORBIDDEN|\b40[13]\b|expired token|invalid token/i;

export const toolFailureRule: DiagnosticRule = {
  id: 'tool-failure',
  title: 'Tool call failed or timed out',
  description:
    'Flags tool results that report an error or a timeout, grouped by tool. Failures that are better explained by a permission denial or by empty or malformed input are left to those rules. If a later call to the same tool succeeded, the failure is reported as recovered.',
  basis: 'presence',
  evaluate(context) {
    const failuresByTool = new Map<string, ToolResultEvent[]>();
    for (const event of context.run.events) {
      if (!isFailedResult(event)) continue;
      const denied = (context.index.permissionsByCallId.get(event.callId) ?? []).some(
        (decision) => decision.decision === 'denied',
      );
      if (denied || classifyMalformedCall(context.index, event)) continue;
      pushTo(failuresByTool, event.toolName, event);
    }
    return [...failuresByTool].flatMap(([toolName, failures]) =>
      diagnose(context, toolName, failures),
    );
  },
};

function describeFailure(context: DiagnosticContext, result: ToolResultEvent): RichText {
  if (result.outcome === 'timeout') {
    const call = context.index.callsByCallId.get(result.callId);
    const setting = call ? findTimeoutSetting(call) : undefined;
    const limit =
      setting && typeof setting.value === 'number'
        ? rich` (limit ${code(`${setting.key}: ${setting.value}`)})`
        : [];
    const after =
      result.durationMs === undefined ? '' : ` after ${formatDuration(result.durationMs)}`;
    return rich`timed out${after}${limit}`;
  }
  const message = result.errorMessage ? rich`: ${quote(result.errorMessage)}` : [];
  return rich`returned ${result.errorCode ? code(result.errorCode) : 'an error'}${message}`;
}

function diagnose(
  context: DiagnosticContext,
  toolName: string,
  failures: ToolResultEvent[],
): Diagnosis[] {
  const { index, run, runFailed } = context;
  const last = failures.at(-1);
  if (!last) return [];

  const later = eventsAfter(index, last);
  const recovery = later.find(isSuccessfulResultFor(toolName));
  const terminal = findTerminalError(run);
  // Without a fatal error event, the terminal error can be one of these failures itself.
  const terminalIsFailure =
    terminal !== undefined && failures.some((failure) => failure.id === terminal.id);
  const terminalCallId = terminal && !terminalIsFailure ? getCallId(terminal) : undefined;
  const terminalLinked =
    terminalCallId !== undefined && failures.some((failure) => failure.callId === terminalCallId);
  const lastFailureOfRun = !later.some(isFailedResult);

  let impact: FindingImpact;
  let confidence: Confidence;
  let confidenceReason: string;
  if (recovery) {
    impact = 'observation';
    confidence = 'high';
    confidenceReason = `A later call to ${toolName} succeeded (${recovery.id}), so this failure did not stop the run.`;
  } else if (!runFailed) {
    impact = 'observation';
    confidence = 'low';
    confidenceReason =
      'The run still succeeded, so this failure may not have affected the outcome.';
  } else if (terminalLinked && terminal) {
    impact = 'failure-point';
    confidence = 'high';
    confidenceReason = `The run's terminal error (${terminal.id}) refers to this call, and no later call to ${toolName} succeeded.`;
  } else if (lastFailureOfRun) {
    impact = 'failure-point';
    confidence = 'high';
    confidenceReason = `This is the last tool failure before the run ended, and no later call to ${toolName} succeeded.`;
  } else {
    impact = 'contributing';
    confidence = 'medium';
    confidenceReason = `${toolName} never recovered, but other tool failures happened later in the run.`;
  }

  const allTimeouts = failures.every((failure) => failure.outcome === 'timeout');
  const repeated = failures.length > 1 ? ` (${failures.length}×)` : '';
  const title = recovery
    ? 'Recovered tool failure'
    : `${allTimeouts ? 'Tool call timed out' : 'Tool call failed'}${repeated}`;

  const sameFailure = failures.every(
    (failure) => failureSignature(failure) === failureSignature(last),
  );
  let what: RichText;
  if (failures.length === 1) {
    what = rich`${code(toolName)} ${describeFailure(context, last)} at ${eventRef(last.id)}.`;
  } else if (sameFailure) {
    const refs = joinRich(
      failures.map((failure) => [eventRef(failure.id)]),
      ', ',
    );
    what = rich`${code(toolName)} ${describeFailure(context, last)} on each of ${failures.length} attempts (${refs}).`;
  } else {
    const steps = failures.map(
      (failure) => rich`${describeFailure(context, failure)} at ${eventRef(failure.id)}`,
    );
    what = rich`${code(toolName)} failed ${failures.length} times: it ${joinRich(steps, '; then ')}.`;
  }

  let outcome: RichText = [];
  if (recovery) {
    outcome = rich` A later call succeeded at ${eventRef(recovery.id)}.`;
  } else if (terminal && terminalLinked) {
    outcome = rich` The run then ${stoppedAt(terminal)}.`;
  } else if (runFailed && lastFailureOfRun) {
    const where = terminal && !terminalIsFailure ? rich` at ${eventRef(terminal.id)}` : [];
    outcome = rich` The run ended${where} without a successful call to ${code(toolName)}.`;
  }

  const evidence: Evidence[] = [];
  for (const failure of failures) {
    const call = index.callsByCallId.get(failure.callId);
    if (call) evidence.push({ eventId: call.id, note: `Call to ${toolName}` });
    evidence.push({
      eventId: failure.id,
      note:
        failure.outcome === 'timeout'
          ? `Timed out after ${formatDuration(failure.durationMs)}`
          : `Failed with ${failureLabel(failure)}`,
    });
  }
  if (recovery) evidence.push({ eventId: recovery.id, note: 'Later call succeeded' });
  if (
    terminal &&
    !recovery &&
    !terminalIsFailure &&
    (terminalLinked || (runFailed && lastFailureOfRun))
  ) {
    evidence.push({ eventId: terminal.id, note: 'Run ended here' });
  }

  return [
    {
      id: `tool-failure:${last.id}`,
      ruleId: 'tool-failure',
      title,
      impact,
      confidence,
      confidenceReason,
      observed: [...what, ...outcome],
      interpretation: interpret(impact, toolName, recovery !== undefined),
      suggestion: suggestFix(context, toolName, failures, last, recovery !== undefined),
      primaryEventId: last.id,
      evidence: orderEvidence(index, evidence),
    },
  ];
}

function interpret(impact: FindingImpact, toolName: string, recovered: boolean): RichText {
  if (recovered) {
    return rich`The run recovered from this failure, so it probably did not decide the outcome.`;
  }
  switch (impact) {
    case 'failure-point':
      return rich`This is likely where the run failed: ${code(toolName)} never succeeded, and nothing after it changed the outcome.`;
    case 'contributing':
      return rich`This probably contributed to the failure, but later problems also stopped the run.`;
    case 'observation':
      // The run reported success although this call never succeeded: a verification gap.
      return rich`The run still reported success even though this call never succeeded, so its final answer may rest on missing data.`;
  }
}

function suggestFix(
  context: DiagnosticContext,
  toolName: string,
  failures: ToolResultEvent[],
  last: ToolResultEvent,
  recovered: boolean,
): RichText {
  const errorText = `${last.errorCode ?? ''} ${last.errorMessage ?? ''}`;
  const upstream = stringMetadata(last, 'upstream');
  const service = upstream ? code(upstream) : 'the upstream service';

  if (recovered) {
    if (RATE_LIMIT.test(errorText)) {
      return rich`No action is needed for this run. If rate limiting recurs, add client-side throttling or stagger the schedule so the retry is not needed.`;
    }
    if (last.outcome === 'timeout') {
      return rich`No action is needed for this run. If timeouts recur, check ${service} latency and consider smaller requests or a deliberately longer timeout.`;
    }
    return rich`No action is needed for this run. If this error recurs, inspect ${eventRef(last.id)} to see whether it is transient or caused by the input.`;
  }

  if (RATE_LIMIT.test(errorText)) {
    return rich`Honor the ${code('Retry-After')} header and add client-side throttling or exponential backoff with jitter. If every scheduled run hits the limit, stagger the schedule or request a higher quota.`;
  }
  if (last.outcome === 'timeout' || classifyFailure(last) === 'transient') {
    const requestIds = [...new Set(failures.flatMap((failure) => findRequestIds(failure)))];
    const lookup =
      requestIds.length > 0
        ? rich`, starting with request ${joinRich(
            requestIds.map((id) => [code(id)]),
            ' and ',
          )}`
        : [];
    return rich`Check ${service} latency and health around ${formatUtcDateTime(last.timestamp)}${lookup}. If the request is legitimately slow, narrow it (fewer results, fewer included fields, or pagination) or raise the timeout deliberately; retrying an identical request rarely helps.`;
  }
  if (AUTH_FAILURE.test(errorText)) {
    return rich`Check the credentials and scopes that ${code(toolName)} uses. An expired or under-scoped token fails the same way on every retry.`;
  }
  const call = context.index.callsByCallId.get(last.callId);
  const sent = call ? rich` and the arguments sent at ${eventRef(call.id)}` : [];
  return rich`Inspect the error at ${eventRef(last.id)}${sent}. Reproduce the call outside the agent with the same arguments to tell a tool bug from bad input.`;
}
