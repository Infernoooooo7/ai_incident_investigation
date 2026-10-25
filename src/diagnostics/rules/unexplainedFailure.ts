import { formatUtcDateTime } from '../../domain/format';
import { code, eventRef, rich } from '../../domain/richText';
import type { RichText } from '../../domain/richText';
import { findTerminalError } from '../../domain/runIndex';
import { position, quote, sentenceEnd } from '../helpers';
import type { DiagnosticRule, Evidence } from '../types';

/**
 * Fallback rule. The engine runs it only when a run did not succeed and no
 * other rule produced a likely failure point.
 */
export const unexplainedFailureRule: DiagnosticRule = {
  id: 'unexplained-failure',
  title: 'Unrecognized failure pattern',
  description:
    'Runs only when a run did not succeed and no other rule found a likely failure point. It marks the last recorded error (or the last event) with low confidence, so there is a starting point. It does not explain why the run failed.',
  basis: 'presence',
  evaluate({ run, index, runFailed }) {
    if (!runFailed) return [];
    const terminal = findTerminalError(run) ?? run.events.at(-1);
    if (!terminal) return [];
    const previous = run.events[position(index, terminal) - 1];

    let what: RichText;
    if (terminal.kind === 'error') {
      const message = quote(terminal.message);
      what = rich`The run ended (${run.status}) with ${code(terminal.errorType)} at ${eventRef(terminal.id)}: ${message}${sentenceEnd(message)}`;
    } else {
      what = rich`The run ended (${run.status}) without a recorded fatal error. The last notable event was ${eventRef(terminal.id)}.`;
    }
    const before = previous ? rich` (such as ${eventRef(previous.id)})` : [];

    const evidence: Evidence[] = [];
    if (previous) evidence.push({ eventId: previous.id, note: 'Immediately preceding event' });
    evidence.push({ eventId: terminal.id, note: 'Where the run stopped' });

    return [
      {
        id: `unexplained-failure:${terminal.id}`,
        ruleId: 'unexplained-failure',
        title: 'Unrecognized failure pattern',
        impact: 'failure-point',
        confidence: 'low',
        confidenceReason:
          'No rule matched, so this only marks where the run stopped. It is not an explanation of why.',
        observed: what,
        interpretation: rich`None of the built-in rules matched this run, so this marks where it stopped, not why.`,
        suggestion: rich`Start from ${eventRef(terminal.id)} and work backwards: compare the inputs and outputs of the events just before it${before}, and check the logs of the services involved around ${formatUtcDateTime(terminal.timestamp)}.`,
        primaryEventId: terminal.id,
        evidence,
      },
    ];
  },
};
