/**
 * Renders an incident report as Markdown.
 *
 * Recorded content is untrusted, so it is escaped before it reaches the
 * document: inline text escapes Markdown and HTML control characters, and code
 * spans/fences are sized so embedded backticks cannot close them early.
 */
import { CONFIDENCE_LABELS, IMPACT_LABELS, REVIEW_LABELS } from '../diagnostics/types';
import {
  formatDuration,
  formatOffset,
  formatUtcDateTime,
  formatUtcTime,
  msBetween,
} from '../domain/format';
import {
  EVENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  RUN_STATUS_LABELS,
  getEventPreview,
  getEventTitle,
} from '../domain/labels';
import type { RichText } from '../domain/richText';
import type { AgentEvent, JsonValue } from '../domain/types';
import {
  EXAMPLE_NOTICE,
  HEURISTIC_DISCLAIMER,
  MODEL_NOTICE,
  REDACTION_NOTICE,
  REPORT_SCHEMA_VERSION,
} from './report';
import type { IncidentReport } from './report';

/** Escapes characters that could create formatting, links, HTML, or table breaks. */
function escapeText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>|#]/g, (character) => `\\${character}`);
}

/** Escaped single-line text with surrounding whitespace removed. */
export function escapeInline(text: string): string {
  return escapeText(text).trim();
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
}

/** Inline code span that survives backticks in its content. */
export function codeSpan(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ');
  const fence = '`'.repeat(longestBacktickRun(singleLine) + 1);
  const padded = /^`|`$/.test(singleLine) ? ` ${singleLine} ` : singleLine;
  return `${fence}${padded}${fence}`;
}

/** Fenced code block whose fence is longer than any backtick run inside it. */
export function fencedBlock(text: string, language = ''): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function richToMarkdown(value: RichText): string {
  return value
    .map((segment) => {
      // Segments keep their edge spaces; the joined result is trimmed once.
      if (segment.type === 'text') return escapeText(segment.text);
      if (segment.type === 'code') return codeSpan(segment.text);
      return codeSpan(segment.eventId);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function json(value: JsonValue): string {
  return fencedBlock(JSON.stringify(value, null, 2), 'json');
}

function eventDetails(event: AgentEvent, startedAt: string): string[] {
  const lines = [`### ${codeSpan(event.id)} ${escapeInline(getEventTitle(event))}`, ''];
  const facts = [
    `Kind: ${EVENT_KIND_LABELS[event.kind]}`,
    `Status: ${EVENT_STATUS_LABELS[event.status]}`,
    `Time: ${formatUtcDateTime(event.timestamp)} (${formatOffset(msBetween(startedAt, event.timestamp))})`,
  ];
  if (event.durationMs !== undefined) facts.push(`Duration: ${formatDuration(event.durationMs)}`);
  lines.push(...facts.map((fact) => `- ${fact}`));

  if (event.kind === 'tool_call' || event.kind === 'tool_result') {
    lines.push(`- Tool: ${codeSpan(event.toolName)} (call ${codeSpan(event.callId)})`);
  }
  if (event.kind === 'tool_result' && (event.errorCode || event.errorMessage)) {
    const code = event.errorCode ? `${codeSpan(event.errorCode)} ` : '';
    lines.push(`- Error: ${code}${escapeInline(event.errorMessage ?? '')}`);
  }
  if (event.kind === 'error') {
    lines.push(`- Error: ${codeSpan(event.errorType)} ${escapeInline(event.message)}`);
  }
  if (event.kind === 'permission_decision') {
    const policy = event.policy ? ` (policy ${codeSpan(event.policy)})` : '';
    lines.push(`- Decision: ${event.decision} by ${event.decidedBy}${policy}`);
    lines.push(`- Requested action: ${escapeInline(event.action)}`);
    if (event.reason) lines.push(`- Reason: ${escapeInline(event.reason)}`);
  }
  if (event.kind === 'retry') {
    const of = event.maxAttempts ? ` of ${event.maxAttempts}` : '';
    lines.push(`- Attempt: ${event.attempt}${of}; reason: ${escapeInline(event.reason)}`);
  }
  if (event.kind === 'agent_message') {
    lines.push('', '**Message**', '', fencedBlock(event.text, 'text'));
  }
  if (event.input !== undefined) lines.push('', '**Input**', '', json(event.input));
  if (event.output !== undefined) lines.push('', '**Output**', '', json(event.output));
  if (Object.keys(event.metadata).length > 0) {
    lines.push('', '**Metadata**', '', json(event.metadata));
  }
  lines.push('');
  return lines;
}

function observedSection(report: IncidentReport): string[] {
  const { stop, counts, longestGap } = report.observed;
  const lines = ['## Observed facts', ''];
  if (stop) {
    const after = stop.afterEventId
      ? `, ${formatDuration(stop.gapMs)} after ${codeSpan(stop.afterEventId)} ${escapeInline(stop.afterTitle ?? '')}`
      : '';
    lines.push(`- Stopped at ${codeSpan(stop.eventId)} ${escapeInline(stop.title)}${after}`);
  }
  lines.push(
    `- Tool calls: ${counts.toolCalls}; failed tool results: ${counts.failedToolResults} (${counts.timeouts} timed out); retries: ${counts.retries}; permission denials: ${counts.permissionDenials}; calls without a result: ${counts.missingResults}; error events: ${counts.errorEvents}`,
  );
  if (longestGap) {
    lines.push(
      `- Longest gap between events: ${formatDuration(longestGap.ms)} (${codeSpan(longestGap.fromEventId)} to ${codeSpan(longestGap.toEventId)})`,
    );
  }
  lines.push('');
  return lines;
}

function modelSection(report: IncidentReport): string[] {
  const model = report.modelSummary;
  if (!model) return [];
  const version = model.runtimeVersion ? ` ${escapeInline(model.runtimeVersion)}` : '';
  const lines = [
    '## Local model summary (model-generated, unverified)',
    '',
    `> ${escapeInline(MODEL_NOTICE)}`,
    '',
    `- Model: ${codeSpan(model.model)} on ${model.runtime}${version}, generated ${model.generatedAt}`,
    `- Grounding check: ${model.grounding.grounded} of ${model.grounding.claims} claims cite only events in this run; ${model.grounding.unknownCitations} citation(s) to unknown events`,
  ];
  if (model.insufficientEvidence) {
    lines.push('- The model reported that the trace does not contain enough evidence.');
  }
  lines.push('', richToMarkdown(model.summary), '');
  model.claims.forEach((claim) => {
    const cites = [...claim.eventIds, ...claim.unknownIds].map(codeSpan).join(', ') || 'no events';
    const flag = claim.grounded ? '' : ' (not grounded)';
    lines.push(
      `- ${claim.kind === 'observation' ? 'Observation' : 'Hypothesis'}${flag}: ${escapeInline(claim.statement)} [${cites}]`,
    );
  });
  if (model.nextCheck)
    lines.push('', `**Model's suggested next check:** ${escapeInline(model.nextCheck)}`);
  lines.push('');
  return lines;
}

export function renderMarkdownReport(report: IncidentReport): string {
  const { run } = report;
  const lines: string[] = [];
  const push = (...items: string[]) => lines.push(...items);
  const isExample = report.source === 'example';

  push(
    `# ${isExample ? 'Example incident report (fictional data)' : 'Incident report'}: ${escapeInline(run.agentName)} (${codeSpan(run.id)})`,
    '',
  );
  if (isExample) push(`> **Example data.** ${escapeInline(EXAMPLE_NOTICE)}`, '>');
  push(`> **Heuristic findings.** ${HEURISTIC_DISCLAIMER}`, '>');
  push(
    `> **Redaction.** ${escapeInline(REDACTION_NOTICE)} Values redacted in this report: ${report.redactedValueCount}.`,
    '',
  );

  push('## Summary', '', '| Field | Value |', '| --- | --- |');
  const rows: Array<[string, string]> = [
    ['Source', isExample ? 'Bundled example (fictional)' : 'Imported run'],
    ['Status', RUN_STATUS_LABELS[run.status]],
    [
      'Agent',
      `${escapeInline(run.agentName)}${run.agentVersion ? ` ${escapeInline(run.agentVersion)}` : ''}`,
    ],
    ['Task', escapeInline(run.task)],
    ['Started', formatUtcDateTime(run.startedAt)],
    ['Ended', formatUtcDateTime(run.endedAt)],
    ['Duration', formatDuration(run.durationMs)],
    ['Events', String(run.eventCount)],
  ];
  if (report.origin) {
    rows.push([
      'Imported from',
      `${escapeInline(report.origin.fileName)} at ${report.origin.importedAt}`,
    ]);
  }
  if (report.terminalError) {
    const { type, message, eventId } = report.terminalError;
    rows.push([
      'Terminal error',
      `${codeSpan(type)} at ${codeSpan(eventId)}: ${escapeInline(message)}`,
    ]);
  }
  rows.forEach(([field, value]) => push(`| ${field} | ${value} |`));
  if (run.summary) push('', `**Run summary:** ${escapeInline(run.summary)}`);
  push('');

  push(...observedSection(report));

  push('## Findings (heuristic)', '');
  if (report.findings.length === 0) {
    push('No failure patterns were detected by the built-in rules.', '');
  }
  report.findings.forEach((finding, position) => {
    push(`### ${position + 1}. ${escapeInline(finding.title)}`, '');
    push(
      `- **Assessment:** ${IMPACT_LABELS[finding.impact]}, ${CONFIDENCE_LABELS[finding.confidence].toLowerCase()} confidence`,
      `- **Why this confidence:** ${escapeInline(finding.confidenceReason)}`,
      `- **Review:** ${REVIEW_LABELS[finding.review]}`,
      '',
      `**Observed:** ${richToMarkdown(finding.observed)}`,
      '',
      `**Interpretation (heuristic):** ${richToMarkdown(finding.interpretation)}`,
      '',
      '**Evidence**',
      '',
      ...finding.evidence.map((item) => `- ${codeSpan(item.eventId)}: ${escapeInline(item.note)}`),
      '',
      `**Next check:** ${richToMarkdown(finding.suggestion)}`,
      '',
    );
  });

  push(...modelSection(report));

  push('## Timeline', '');
  push('| # | Time (UTC) | Offset | Event | Kind | Summary | Status | Duration |');
  push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const event of report.events) {
    const summary = [getEventTitle(event), getEventPreview(event, 100)].filter(Boolean).join(': ');
    push(
      `| ${event.sequence} | ${formatUtcTime(event.timestamp)} | ${formatOffset(msBetween(run.startedAt, event.timestamp))} | ${codeSpan(event.id)} | ${EVENT_KIND_LABELS[event.kind]} | ${escapeInline(summary)} | ${EVENT_STATUS_LABELS[event.status]} | ${event.durationMs === undefined ? '' : formatDuration(event.durationMs)} |`,
    );
  }
  push('');

  const citedIds = new Set(
    report.findings.flatMap((finding) => finding.evidence.map((item) => item.eventId)),
  );
  const cited = report.events.filter((event) => citedIds.has(event.id));
  if (cited.length > 0) {
    push('## Evidence details', '');
    cited.forEach((event) => push(...eventDetails(event, run.startedAt)));
  }

  push('## Data quality', '');
  const { skippedRecords, warnings, ruleFailures } = report.dataQuality;
  if (skippedRecords.length === 0 && warnings.length === 0 && ruleFailures.length === 0) {
    push('All event records passed validation.', '');
  }
  skippedRecords.forEach((record) => {
    const label = record.id ? ` (${codeSpan(record.id)})` : '';
    push(
      `- Skipped record at position ${record.index}${label}: ${escapeInline(record.issues.join('; '))}`,
    );
  });
  warnings.forEach((warning) => push(`- Warning: ${escapeInline(warning)}`));
  ruleFailures.forEach((failure) => push(`- Rule failed to run: ${escapeInline(failure)}`));
  if (skippedRecords.length + warnings.length + ruleFailures.length > 0) push('');

  push(
    '---',
    '',
    `Generated by Agent Incident Investigator on ${report.generatedAt} (report format v${REPORT_SCHEMA_VERSION}).`,
    '',
  );
  return lines.join('\n');
}
