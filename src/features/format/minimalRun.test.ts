import { describe, expect, it } from 'vitest';
import { parseRun } from '../../data/validate';
import { diagnoseRun } from '../../diagnostics/engine';
import { MINIMAL_RUN } from './minimalRun';

describe('documented minimal run', () => {
  it('passes validation without skipped records or warnings', () => {
    const parsed = parseRun(MINIMAL_RUN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skipped).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.run.events.map((event) => event.kind)).toEqual([
      'tool_call',
      'tool_result',
      'error',
    ]);
  });

  it('produces the timeout finding it is meant to illustrate', () => {
    const parsed = parseRun(MINIMAL_RUN);
    if (!parsed.ok) throw new Error('minimal run is invalid');
    const { findings } = diagnoseRun(parsed.run);
    expect(findings[0]?.ruleId).toBe('tool-failure');
    expect(findings[0]?.evidence.map((item) => item.eventId)).toContain('e2');
  });
});
