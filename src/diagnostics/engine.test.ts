import { describe, expect, it } from 'vitest';
import billingRecovered from '../data/examples/example-recovered-retry.json';
import docsSuccess from '../data/examples/example-success.json';
import financeMalformed from '../data/examples/example-malformed-input.json';
import oncallMissing from '../data/examples/example-missing-result.json';
import repoPermission from '../data/examples/example-permission-denied.json';
import supportTimeout from '../data/examples/example-tool-timeout.json';
import { toPlainText } from '../domain/richText';
import { buildRun, ev, events, parseSample } from '../test/factories';
import { diagnoseRun, getLikelyFailurePoint } from './engine';
import type { DiagnosisResult, DiagnosticRule } from './types';

function diagnoseSample(raw: unknown): DiagnosisResult {
  const parsed = parseSample(raw);
  return diagnoseRun(parsed.run, { skippedRecordCount: parsed.skipped.length });
}

function summarize(result: DiagnosisResult) {
  return result.findings.map(({ ruleId, impact, confidence, primaryEventId }) => ({
    ruleId,
    impact,
    confidence,
    primaryEventId,
  }));
}

const evidenceIds = (result: DiagnosisResult, index: number) =>
  result.findings[index]?.evidence.map((item) => item.eventId);

describe('diagnoseRun on the bundled samples', () => {
  it('flags the timeout and the unchanged retry in the support triage run', () => {
    const result = diagnoseSample(supportTimeout);
    expect(summarize(result)).toEqual([
      {
        ruleId: 'tool-failure',
        impact: 'failure-point',
        confidence: 'high',
        primaryEventId: 'evt_07',
      },
      {
        ruleId: 'retry-loop',
        impact: 'contributing',
        confidence: 'high',
        primaryEventId: 'evt_07',
      },
    ]);
    expect(result.findings[0]?.title).toBe('Tool call timed out (2×)');
    expect(evidenceIds(result, 0)).toEqual(['evt_03', 'evt_04', 'evt_06', 'evt_07', 'evt_08']);
    expect(evidenceIds(result, 1)).toEqual(['evt_03', 'evt_04', 'evt_05', 'evt_06', 'evt_07']);
    expect(toPlainText(result.findings[1]?.observed ?? [])).toContain('identical arguments');
    expect(toPlainText(result.findings[0]?.suggestion ?? [])).toContain('req_5c1e0b72');
  });

  it('separates the blocking denial from the earlier one in the repo maintenance run', () => {
    const result = diagnoseSample(repoPermission);
    expect(summarize(result)).toEqual([
      {
        ruleId: 'permission-denied',
        impact: 'failure-point',
        confidence: 'high',
        primaryEventId: 'evt_10',
      },
      {
        ruleId: 'permission-denied',
        impact: 'contributing',
        confidence: 'medium',
        primaryEventId: 'evt_06',
      },
    ]);
    expect(result.findings[0]?.title).toBe('Permission denied: fs.write_file');
    expect(evidenceIds(result, 0)).toEqual(['evt_09', 'evt_10', 'evt_11', 'evt_12']);
    expect(toPlainText(result.findings[1]?.observed ?? [])).toContain(
      'fs.write_file instead (evt_09)',
    );
  });

  it('reports nothing for the successful docs run', () => {
    const result = diagnoseSample(docsSuccess);
    expect(result.findings).toEqual([]);
    expect(getLikelyFailurePoint(result)).toBeUndefined();
  });

  it('blames the empty chart input and links it to the empty query result', () => {
    const result = diagnoseSample(financeMalformed);
    expect(summarize(result)).toEqual([
      {
        ruleId: 'malformed-input',
        impact: 'failure-point',
        confidence: 'high',
        primaryEventId: 'evt_10',
      },
      {
        ruleId: 'retry-loop',
        impact: 'contributing',
        confidence: 'medium',
        primaryEventId: 'evt_10',
      },
    ]);
    expect(evidenceIds(result, 0)).toEqual([
      'evt_04',
      'evt_06',
      'evt_07',
      'evt_09',
      'evt_10',
      'evt_11',
    ]);
    const explanation = toPlainText(result.findings[0]?.observed ?? []);
    expect(explanation).toContain('series is null');
    expect(explanation).toContain('rows is an empty list');
    expect(toPlainText(result.findings[1]?.observed ?? [])).toContain(
      'arguments changed between attempts (series)',
    );
  });

  it('lowers confidence in the missing result because a record was skipped', () => {
    const parsed = parseSample(oncallMissing);
    const complete = diagnoseRun(parsed.run);
    const incomplete = diagnoseRun(parsed.run, { skippedRecordCount: parsed.skipped.length });
    expect(summarize(complete)).toEqual([
      {
        ruleId: 'missing-tool-result',
        impact: 'failure-point',
        confidence: 'high',
        primaryEventId: 'evt_08',
      },
    ]);
    expect(incomplete.findings[0]?.confidence).toBe('medium');
    expect(incomplete.findings[0]?.confidenceReason).toContain(
      'Lowered from high because 1 record',
    );
    const explanation = toPlainText(incomplete.findings[0]?.observed ?? []);
    expect(explanation).toContain('was cancelled 10m 05s later (evt_10)');
    expect(explanation).toContain('timeout_ms: null');
  });

  it('treats the recovered rate limit as an observation', () => {
    const result = diagnoseSample(billingRecovered);
    expect(summarize(result)).toEqual([
      {
        ruleId: 'tool-failure',
        impact: 'observation',
        confidence: 'high',
        primaryEventId: 'evt_04',
      },
    ]);
    expect(result.findings[0]?.title).toBe('Recovered tool failure');
    expect(getLikelyFailurePoint(result)).toBeUndefined();
  });

  it('only cites events that exist and always explains itself', () => {
    for (const raw of [
      supportTimeout,
      repoPermission,
      financeMalformed,
      oncallMissing,
      billingRecovered,
    ]) {
      const parsed = parseSample(raw);
      const ids = new Set(parsed.run.events.map((event) => event.id));
      const result = diagnoseRun(parsed.run, { skippedRecordCount: parsed.skipped.length });
      expect(result.ruleFailures).toEqual([]);
      for (const finding of result.findings) {
        expect(finding.evidence.length).toBeGreaterThan(0);
        expect(ids.has(finding.primaryEventId)).toBe(true);
        expect(finding.evidence.every((item) => ids.has(item.eventId))).toBe(true);
        expect(toPlainText(finding.observed).length).toBeGreaterThan(20);
        expect(toPlainText(finding.suggestion).length).toBeGreaterThan(20);
        expect(finding.confidenceReason.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('diagnoseRun edge cases', () => {
  it('does not report a missing result for a call that permission denied', () => {
    const run = buildRun(
      events(
        ev.call('fs.write', 'c1', { path: 'a' }),
        ev.deny('fs.write', 'c1'),
        ev.error('Blocked', 'stop'),
      ),
    );
    const rules = diagnoseRun(run).findings.map((finding) => finding.ruleId);
    expect(rules).toEqual(['permission-denied']);
  });

  it('falls back to a low-confidence pointer when no rule matches a failed run', () => {
    const run = buildRun(
      events(ev.user('go'), ev.assistant('thinking'), ev.error('ModelOverloaded', 'try later')),
    );
    const result = diagnoseRun(run);
    expect(summarize(result)).toEqual([
      {
        ruleId: 'unexplained-failure',
        impact: 'failure-point',
        confidence: 'low',
        primaryEventId: 'e3',
      },
    ]);
  });

  it('does not run the fallback for successful runs', () => {
    const run = buildRun(events(ev.user('go'), ev.assistant('done')), { status: 'succeeded' });
    expect(diagnoseRun(run).findings).toEqual([]);
  });

  it('downgrades an unrecovered failure in a successful run to a low-confidence observation', () => {
    const run = buildRun(
      events(ev.call('kv.get', 'c1'), ev.fail('kv.get', 'c1', 'NOT_FOUND', 'missing key')),
      {
        status: 'succeeded',
      },
    );
    expect(summarize(diagnoseRun(run))).toEqual([
      { ruleId: 'tool-failure', impact: 'observation', confidence: 'low', primaryEventId: 'e2' },
    ]);
  });

  it('does not report a retry loop when the tool eventually succeeds', () => {
    const run = buildRun(
      events(
        ev.call('api.get', 'c1'),
        ev.timeout('api.get', 'c1'),
        ev.call('api.get', 'c2'),
        ev.timeout('api.get', 'c2'),
        ev.call('api.get', 'c3'),
        ev.ok('api.get', 'c3', { ok: true }),
      ),
      { status: 'succeeded' },
    );
    const rules = diagnoseRun(run).findings.map((finding) => finding.ruleId);
    expect(rules).toEqual(['tool-failure']);
  });

  it('treats unparseable tool arguments as malformed input', () => {
    const run = buildRun(
      events(
        ev.call('db.insert', 'c1', '{"rows": [1, 2'),
        ev.fail('db.insert', 'c1', 'BAD_REQUEST', 'Could not parse JSON body'),
      ),
    );
    const [finding] = diagnoseRun(run).findings;
    expect(finding?.ruleId).toBe('malformed-input');
    expect(finding?.confidence).toBe('high');
    expect(toPlainText(finding?.observed ?? [])).toContain('not valid JSON');
  });

  it('does not repeat a failure as its own consequence when no fatal error was recorded', () => {
    const run = buildRun(
      events(ev.call('x.tool', 'c1'), ev.fail('x.tool', 'c1', 'BOOM', 'exploded')),
    );
    const [finding] = diagnoseRun(run).findings;
    expect(finding?.confidenceReason).toContain('last tool failure before the run ended');
    expect(toPlainText(finding?.observed ?? [])).toBe(
      'x.tool returned BOOM: "exploded" at e2. The run ended without a successful call to x.tool.',
    );
    expect(finding?.evidence.map((item) => item.note)).toEqual([
      'Call to x.tool',
      'Failed with BOOM',
    ]);
  });

  it('does not blame empty optional fields for unrelated errors', () => {
    const run = buildRun(
      events(
        ev.call('search.query', 'c1', { q: 'x', cursor: null }),
        ev.fail('search.query', 'c1', 'UPSTREAM_502', 'Bad gateway from search cluster'),
      ),
    );
    const rules = diagnoseRun(run).findings.map((finding) => finding.ruleId);
    expect(rules).toEqual(['tool-failure']);
  });

  it('keeps going when a rule throws, and reports the failure', () => {
    const broken: DiagnosticRule = {
      id: 'retry-loop',
      title: 'Broken',
      description: 'Always throws',
      basis: 'presence',
      evaluate: () => {
        throw new Error('boom');
      },
    };
    const run = buildRun(events(ev.call('a.b', 'c1'), ev.timeout('a.b', 'c1')));
    const result = diagnoseRun(run, { rules: [broken] });
    expect(result.ruleFailures).toEqual([{ ruleId: 'retry-loop', message: 'boom' }]);
    expect(result.findings[0]?.ruleId).toBe('unexplained-failure');
  });

  it('indexes which findings cite each event', () => {
    const result = diagnoseSample(supportTimeout);
    expect(result.findingsByEvent.get('evt_05')).toEqual(['retry-loop:evt_07']);
    expect(result.findingsByEvent.get('evt_07')).toEqual([
      'tool-failure:evt_07',
      'retry-loop:evt_07',
    ]);
    expect(result.findingsByEvent.has('evt_01')).toBe(false);
  });
});
