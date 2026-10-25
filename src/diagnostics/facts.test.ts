import { describe, expect, it } from 'vitest';
import missingResult from '../data/examples/example-missing-result.json';
import permissionDenied from '../data/examples/example-permission-denied.json';
import success from '../data/examples/example-success.json';
import toolTimeout from '../data/examples/example-tool-timeout.json';
import { parseSample } from '../test/factories';
import { computeRunFacts } from './facts';

describe('computeRunFacts', () => {
  it('records where a failed run stopped and what came immediately before', () => {
    const facts = computeRunFacts(parseSample(toolTimeout).run);
    expect(facts.stop?.terminal.id).toBe('evt_08');
    expect(facts.stop?.after?.id).toBe('evt_07');
    expect(facts.stop?.gapMs).toBe(12);
    expect(facts.counts).toEqual({
      events: 9,
      toolCalls: 2,
      failedToolResults: 2,
      timeouts: 2,
      retries: 1,
      permissionDenials: 0,
      missingResults: 0,
      errorEvents: 1,
    });
    expect(facts.durationMs).toBe(66_308);
    expect(facts.longestGap).toMatchObject({ ms: 30_019 });
    expect(facts.longestGap?.from.id).toBe('evt_06');
  });

  it('measures the silence before a cancelled run ended', () => {
    const facts = computeRunFacts(parseSample(missingResult).run);
    expect(facts.stop?.terminal.id).toBe('evt_10');
    expect(facts.stop?.after?.id).toBe('evt_08');
    expect(facts.stop?.gapMs).toBe(605_208);
    expect(facts.counts.missingResults).toBe(1);
    expect(facts.longestGap?.to.id).toBe('evt_10');
  });

  it('counts permission denials without treating denied calls as missing results', () => {
    const facts = computeRunFacts(parseSample(permissionDenied).run);
    expect(facts.counts.permissionDenials).toBe(2);
    expect(facts.counts.missingResults).toBe(0);
  });

  it('reports no stop for a successful run', () => {
    const facts = computeRunFacts(parseSample(success).run);
    expect(facts.stop).toBeUndefined();
    expect(facts.counts.failedToolResults).toBe(0);
    expect(facts.longestGap?.to.id).toBe('evt_08');
  });
});
