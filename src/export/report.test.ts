import { describe, expect, it } from 'vitest';
import { loadExampleRuns } from '../data/examples';
import type { LoadedRun } from '../data/types';
import { diagnoseRun } from '../diagnostics/engine';
import { eventRef, rich } from '../domain/richText';
import type { SummaryResult } from '../model/summarize';
import { buildRun, ev, events } from '../test/factories';
import { codeSpan, escapeInline, fencedBlock, renderMarkdownReport } from './markdown';
import type { ReportOptions } from './report';
import { buildIncidentReport, renderJsonReport, MODEL_NOTICE, REDACTION_NOTICE } from './report';

const GENERATED_AT = new Date('2026-10-25T12:00:00.000Z');

/** Secret values planted in the example traces; none may survive an export. */
const PLANTED_SECRETS = [
  'ZmFrZS1zaWduYXR1cmUtZm9yLWRlbW8',
  'npm-demo-token-not-real',
  'example-password-123',
  'kube-demo-token-not-real',
  'pk-demo-not-a-real-key',
];

function reportFor(loaded: LoadedRun, options: ReportOptions = {}) {
  const diagnosis = diagnoseRun(loaded.run, { skippedRecordCount: loaded.skipped.length });
  return buildIncidentReport(loaded, diagnosis, { generatedAt: GENERATED_AT, ...options });
}

async function example(id: string): Promise<LoadedRun> {
  const { runs } = await loadExampleRuns();
  const loaded = runs.find((item) => item.run.id === id);
  if (!loaded) throw new Error(`missing example ${id}`);
  return loaded;
}

describe('incident report exports', () => {
  it('removes every planted secret from both formats for every example', async () => {
    const { runs } = await loadExampleRuns();
    for (const loaded of runs) {
      const report = reportFor(loaded);
      for (const output of [renderJsonReport(report), renderMarkdownReport(report)]) {
        for (const secret of PLANTED_SECRETS) expect(output).not.toContain(secret);
      }
    }
  });

  it('counts redactions and keeps the run content otherwise intact', async () => {
    const report = reportFor(await example('example-tool-timeout'));
    expect(report.redactedValueCount).toBe(2);
    expect(report.events).toHaveLength(9);
    expect(report.terminalError).toEqual({
      eventId: 'evt_08',
      type: 'ToolTimeoutError',
      message: 'tickets.search timed out on 2 of 2 attempts; retry budget exhausted',
    });
    expect(report.observed.stop).toMatchObject({ eventId: 'evt_08', afterEventId: 'evt_07' });
  });

  it('labels examples as fictional and imports with their origin', async () => {
    const exampleReport = reportFor(await example('example-tool-timeout'));
    expect(exampleReport.source).toBe('example');
    const document = JSON.parse(renderJsonReport(exampleReport)) as Record<string, unknown>;
    expect(document.source).toBe('example');
    expect(document.exampleNotice).toMatch(/fictional example/);
    expect(renderMarkdownReport(exampleReport)).toContain(
      '# Example incident report (fictional data): support-triage-agent',
    );

    const imported: LoadedRun = {
      ...(await example('example-tool-timeout')),
      source: 'import',
      origin: { fileName: 'trace.json', importedAt: '2026-10-26T09:00:00.000Z' },
    };
    const importedMarkdown = renderMarkdownReport(reportFor(imported));
    expect(importedMarkdown).toContain('# Incident report: support-triage-agent');
    expect(importedMarkdown).not.toContain('Example data');
    expect(importedMarkdown).toContain(
      '| Imported from | trace.json at 2026-10-26T09:00:00.000Z |',
    );
  });

  it('renders JSON with plain-text findings, notices, and review status', async () => {
    const loaded = await example('example-malformed-input');
    const diagnosis = diagnoseRun(loaded.run);
    const reviews = new Map([[diagnosis.findings[0]?.id ?? '', 'checked' as const]]);
    const document = JSON.parse(renderJsonReport(reportFor(loaded, { reviews }))) as {
      schemaVersion: number;
      generatedAt: string;
      disclaimer: string;
      redaction: { notice: string };
      findings: Array<{
        observed: unknown;
        interpretation: unknown;
        review: string;
        evidence: unknown[];
      }>;
    };
    expect(document.schemaVersion).toBe(2);
    expect(document.generatedAt).toBe('2026-10-25T12:00:00.000Z');
    expect(document.redaction.notice).toBe(REDACTION_NOTICE);
    expect(document.disclaimer).toContain('not confirmed root causes');
    expect(typeof document.findings[0]?.observed).toBe('string');
    expect(typeof document.findings[0]?.interpretation).toBe('string');
    expect(document.findings.map((finding) => finding.review)).toEqual(['checked', 'open']);
    expect(document.findings[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('renders Markdown with observed facts, findings, evidence, the timeline, and data quality', async () => {
    const markdown = renderMarkdownReport(reportFor(await example('example-missing-result')));
    expect(markdown).toContain('## Observed facts');
    expect(markdown).toContain(
      '- Stopped at `evt_10` RunCancelled (fatal), 10m 05s after `evt_08`',
    );
    expect(markdown).toContain('### 1. Expected tool result is missing');
    expect(markdown).toContain('- **Assessment:** Likely failure point, medium confidence');
    expect(markdown).toContain('- **Review:** Not reviewed');
    expect(markdown).toContain('**Interpretation (heuristic):** The call probably hung');
    expect(markdown).toContain('- `evt_08`: Call with no recorded result');
    expect(markdown).toContain('| 8 | 22:15:14.102 | +00:44.1 | `evt_08` | Tool call |');
    expect(markdown).toContain('## Evidence details');
    expect(markdown).toContain('- Skipped record at position 8 (`evt_09`)');
  });

  it('says so when a run has no findings', async () => {
    const markdown = renderMarkdownReport(reportFor(await example('example-success')));
    expect(markdown).toContain('No failure patterns were detected by the built-in rules.');
    expect(markdown).not.toContain('## Evidence details');
  });

  it('includes a model summary only when given, labelled as unverified and redacted', async () => {
    const loaded = await example('example-tool-timeout');
    expect(renderMarkdownReport(reportFor(loaded))).not.toContain('Local model summary');
    const modelSummary: SummaryResult = {
      summary: {
        summary: rich`tickets.search timed out twice ${eventRef('evt_04')}. password=hunter2`,
        claims: [
          {
            kind: 'observation',
            statement: 'Both calls timed out.',
            eventIds: ['evt_04', 'evt_07'],
            unknownIds: [],
            grounded: true,
          },
          {
            kind: 'hypothesis',
            statement: 'The API was down.',
            eventIds: [],
            unknownIds: ['evt_99'],
            grounded: false,
          },
        ],
        insufficientEvidence: false,
        nextCheck: 'Check tickets-api health.',
        grounding: { claims: 2, grounded: 1, uncited: 0, unknownCitations: 1 },
      },
      model: { name: 'granite4.2:3b' },
      runtimeVersion: '0.20.0',
      endpoint: 'http://127.0.0.1:11434',
      generatedAt: '2026-10-26T10:00:00.000Z',
      disclosure: {
        totalEvents: 9,
        sentEvents: 9,
        omittedEvents: 0,
        truncatedValues: 0,
        redactedValues: 2,
        characters: 4000,
      },
    };
    const report = reportFor(loaded, { modelSummary });
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain('## Local model summary (model-generated, unverified)');
    expect(markdown).toContain(escapeInline(MODEL_NOTICE));
    expect(markdown).toContain('- Grounding check: 1 of 2 claims cite only events in this run');
    expect(markdown).toContain('- Hypothesis (not grounded): The API was down. [`evt_99`]');
    expect(markdown).not.toContain('hunter2');
    expect(JSON.parse(renderJsonReport(report)).modelSummary.notice).toBe(MODEL_NOTICE);
  });

  it('keeps hostile content from breaking the Markdown structure', () => {
    const run = buildRun(
      events(
        ev.call('x.tool', 'c1', { note: 'ends with ``` fence' }),
        ev.fail(
          'x.tool',
          'c1',
          'BOOM',
          'bad | pipe <img src=x onerror=alert(1)> [link](http://evil)',
        ),
      ),
    );
    const loaded: LoadedRun = { run, source: 'import', skipped: [], warnings: [] };
    const markdown = renderMarkdownReport(reportFor(loaded));
    // Only unescaped markup is dangerous; `\<img` renders as literal text.
    expect(markdown).not.toMatch(/(?<!\\)<img/);
    expect(markdown).not.toMatch(/(?<!\\)\]\(http:\/\/evil\)/);
    expect(markdown).toContain('bad \\| pipe \\<img src=x onerror=alert(1)\\>');
    expect(markdown).toContain('````json');
    expect(markdown).toContain('`x.tool` returned `BOOM`: ');
  });
});

describe('markdown helpers', () => {
  it('escapes inline control characters and collapses newlines', () => {
    expect(escapeInline('a|b *c*\n_d_ `e` <f>')).toBe('a\\|b \\*c\\* \\_d\\_ \\`e\\` \\<f\\>');
  });

  it('sizes code spans and fences around embedded backticks', () => {
    expect(codeSpan('plain')).toBe('`plain`');
    expect(codeSpan('a `b` c')).toBe('``a `b` c``');
    expect(codeSpan('`edge')).toBe('`` `edge ``');
    expect(fencedBlock('x\n```\ny', 'text')).toBe('````text\nx\n```\ny\n````');
  });
});
