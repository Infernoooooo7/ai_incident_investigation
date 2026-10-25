import { code, eventRef, joinRich, rich } from '../../domain/richText';
import type { RichText } from '../../domain/richText';
import { findTerminalError, getCallId } from '../../domain/runIndex';
import type { AgentEvent, PermissionDecisionEvent, ToolCallEvent } from '../../domain/types';
import {
  eventsAfter,
  failureLabel,
  isFailedResult,
  orderEvidence,
  position,
  pushTo,
  quote,
  sentenceEnd,
  stoppedAt,
} from '../helpers';
import type {
  Confidence,
  Diagnosis,
  DiagnosticContext,
  DiagnosticRule,
  Evidence,
  FindingImpact,
} from '../types';

export const permissionDeniedRule: DiagnosticRule = {
  id: 'permission-denied',
  title: 'Permission denied a required action',
  description:
    'Flags permission decisions that denied an action, grouped by tool and policy. In a run that did not succeed, the latest denial that was never allowed afterwards is reported as a likely failure point; earlier denials the agent tried to work around are contributing factors. If the same tool was later allowed or used successfully, the denial is only an observation.',
  basis: 'presence',
  evaluate(context) {
    const groups = new Map<string, PermissionDecisionEvent[]>();
    for (const event of context.run.events) {
      if (event.kind === 'permission_decision' && event.decision === 'denied') {
        pushTo(groups, `${event.toolName}\u0000${event.policy ?? event.decidedBy}`, event);
      }
    }
    const analyses = [...groups.values()].flatMap((denials) => analyze(context, denials));
    const latestUnresolved = analyses
      .filter((analysis) => analysis.resolution === undefined)
      .reduce<Analysis | undefined>(
        (latest, analysis) =>
          latest === undefined || analysis.lastPosition > latest.lastPosition ? analysis : latest,
        undefined,
      );
    return analyses.map((analysis) => diagnose(context, analysis, analysis === latestUnresolved));
  },
};

interface Analysis {
  denials: PermissionDecisionEvent[];
  last: PermissionDecisionEvent;
  lastPosition: number;
  /** A later allowed decision or successful result for the same tool. */
  resolution?: AgentEvent;
}

function analyze(context: DiagnosticContext, denials: PermissionDecisionEvent[]): Analysis[] {
  const last = denials.at(-1);
  if (!last) return [];
  const resolution = eventsAfter(context.index, last).find(
    (event) =>
      (event.kind === 'permission_decision' &&
        event.toolName === last.toolName &&
        event.decision === 'allowed') ||
      (event.kind === 'tool_result' &&
        event.toolName === last.toolName &&
        event.outcome === 'success'),
  );
  return [{ denials, last, lastPosition: position(context.index, last), resolution }];
}

function diagnose(
  context: DiagnosticContext,
  analysis: Analysis,
  isLatestBlocker: boolean,
): Diagnosis {
  const { index, run, runFailed } = context;
  const { denials, last, resolution } = analysis;
  const terminal = findTerminalError(run);
  const terminalAfter =
    terminal !== undefined && position(index, terminal) > analysis.lastPosition
      ? terminal
      : undefined;
  const terminalCallId = terminalAfter ? getCallId(terminalAfter) : undefined;
  const deniedCallIds = new Set(
    denials.flatMap((denial) => (denial.callId ? [denial.callId] : [])),
  );
  const terminalLinked = terminalCallId !== undefined && deniedCallIds.has(terminalCallId);
  // Other tool failures between the denial and the end weaken the link to the outcome.
  const laterUnrelatedFailure = eventsAfter(index, last).some(
    (event) =>
      isFailedResult(event) &&
      !deniedCallIds.has(event.callId) &&
      (terminalAfter === undefined || position(index, event) < position(index, terminalAfter)),
  );
  const nextCall = eventsAfter(index, last).find(
    (event): event is ToolCallEvent => event.kind === 'tool_call',
  );

  let impact: FindingImpact;
  let confidence: Confidence;
  let confidenceReason: string;
  if (resolution) {
    impact = 'observation';
    confidence = 'medium';
    confidenceReason = `The same tool was ${resolution.kind === 'permission_decision' ? 'allowed' : 'used successfully'} later (${resolution.id}), so this denial did not block the run.`;
  } else if (!runFailed) {
    impact = 'observation';
    confidence = 'low';
    confidenceReason = 'The run still succeeded, so the denied action may not have been required.';
  } else if (isLatestBlocker) {
    impact = 'failure-point';
    if (terminalAfter && terminalLinked) {
      confidence = 'high';
      confidenceReason = `The run's terminal error (${terminalAfter.id}) refers to the denied call, and the action was never allowed afterwards.`;
    } else if (terminalAfter && !laterUnrelatedFailure) {
      confidence = 'high';
      confidenceReason = `This is the last denial before the run ended (${terminalAfter.id}), no other tool failed in between, and the action was never allowed afterwards.`;
    } else {
      confidence = 'medium';
      confidenceReason =
        'The action was never allowed afterwards, but other failures happened before the run ended.';
    }
  } else {
    impact = 'contributing';
    confidence = 'medium';
    confidenceReason = `The action was never allowed, but the agent tried another approach afterwards${nextCall ? ` (${nextCall.id})` : ''}, and a later problem ended the run.`;
  }

  const decidedBy: RichText =
    last.decidedBy === 'user'
      ? rich`by the user`
      : last.policy
        ? rich`by policy ${code(last.policy)}`
        : rich`by policy`;
  const times = denials.length > 1 ? ` ${denials.length} times` : '';
  const refs = joinRich(
    denials.map((denial) => [eventRef(denial.id)]),
    ', ',
  );
  const reason = last.reason ? quote(last.reason) : undefined;
  const because = reason ? `: ${reason}${sentenceEnd(reason)}` : '.';
  const requested = quote(last.action);

  let consequence: RichText = [];
  if (resolution) {
    consequence = rich` A later attempt ${resolution.kind === 'permission_decision' ? 'was allowed' : 'succeeded'} at ${eventRef(resolution.id)}.`;
  } else if (terminalAfter && terminalLinked) {
    consequence = rich` The run then ${stoppedAt(terminalAfter)}.`;
  } else if (!isLatestBlocker && nextCall) {
    consequence = rich` The agent then tried ${code(nextCall.toolName)} instead (${eventRef(nextCall.id)}).`;
  } else if (terminalAfter && runFailed) {
    consequence = rich` The run ended at ${eventRef(terminalAfter.id)} without this action being allowed.`;
  }

  const evidence: Evidence[] = [];
  for (const denial of denials) {
    evidence.push({
      eventId: denial.id,
      note:
        denial.decidedBy === 'user'
          ? 'Denied by the user'
          : `Denied by policy ${denial.policy ?? ''}`.trim(),
    });
    if (!denial.callId) continue;
    const call = index.callsByCallId.get(denial.callId);
    if (call) evidence.push({ eventId: call.id, note: 'Requested call' });
    index.resultsByCallId
      .get(denial.callId)
      ?.forEach((result) =>
        evidence.push({ eventId: result.id, note: `Tool reported ${failureLabel(result)}` }),
      );
  }
  if (resolution) {
    evidence.push({
      eventId: resolution.id,
      note: resolution.kind === 'permission_decision' ? 'Later allowed' : 'Later call succeeded',
    });
  } else if (terminalAfter && (terminalLinked || isLatestBlocker) && runFailed) {
    evidence.push({ eventId: terminalAfter.id, note: 'Run ended here' });
  } else if (!isLatestBlocker && nextCall && runFailed) {
    evidence.push({ eventId: nextCall.id, note: 'Agent tried another approach' });
  }

  return {
    id: `permission-denied:${last.id}`,
    ruleId: 'permission-denied',
    title: `Permission denied: ${last.toolName}`,
    impact,
    confidence,
    confidenceReason,
    observed: [
      ...rich`${code(last.toolName)} was denied ${decidedBy}${times} (${refs})${because} Requested action: ${requested}${sentenceEnd(requested)}`,
      ...consequence,
    ],
    interpretation: interpret(impact, resolution !== undefined),
    suggestion: suggestFix(last, resolution !== undefined),
    primaryEventId: last.id,
    evidence: orderEvidence(index, evidence),
  };
}

function interpret(impact: FindingImpact, resolved: boolean): RichText {
  if (resolved)
    return rich`The action was allowed later, so this denial probably only slowed the run down.`;
  switch (impact) {
    case 'failure-point':
      return rich`The denied action was likely required: it was never allowed afterwards and the run ended without it.`;
    case 'contributing':
      return rich`This denial probably pushed the agent onto a workaround that also failed.`;
    case 'observation':
      return rich`The run still succeeded, so the denied action may not have been needed.`;
  }
}

function suggestFix(denial: PermissionDecisionEvent, resolved: boolean): RichText {
  if (resolved) {
    return rich`No action is needed for this run. If the agent regularly needs this action, consider pre-approving it for this agent so it does not stall on the first attempt.`;
  }
  if (denial.decidedBy === 'user') {
    return rich`Check with the approver why the request was declined. If this action should not be automated, update the agent's instructions so it hands off to a person instead of retrying.`;
  }
  const policy = denial.policy ? code(denial.policy) : 'the policy';
  return rich`Decide whether the task really needs this action. If it does, run the agent with a profile that grants it narrowly (only the paths, hosts, or commands this task needs) rather than relaxing ${policy} for everyone. If it doesn't, update the agent's instructions or tool list so it plans around the restriction.`;
}
