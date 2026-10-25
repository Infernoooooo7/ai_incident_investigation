import { describe, expect, it } from 'vitest';
import { loadExampleRuns, parseDemoMode, toRunJson } from './examples';
import { parseRun } from './validate';

describe('loadExampleRuns', () => {
  it('loads every bundled example, newest first, without rejecting any', async () => {
    const { runs, rejected } = await loadExampleRuns();
    expect(rejected).toEqual([]);
    expect(runs.map((loaded) => loaded.run.id)).toEqual([
      'example-tool-timeout',
      'example-permission-denied',
      'example-success',
      'example-malformed-input',
      'example-missing-result',
      'example-recovered-retry',
    ]);
  });

  it('marks every example as fictional, never as imported data', async () => {
    const { runs } = await loadExampleRuns();
    for (const loaded of runs) {
      expect(loaded.source).toBe('example');
      expect(loaded.origin).toBeUndefined();
      expect(loaded.run.metadata.example).toMatch(/^Fictional run/);
      expect(loaded.run.metadata).not.toHaveProperty('environment');
    }
  });

  it('covers the required scenarios', async () => {
    const { runs } = await loadExampleRuns();
    const statuses = runs.map((loaded) => loaded.run.status);
    expect(statuses.filter((status) => status === 'succeeded')).toHaveLength(2);
    expect(statuses.filter((status) => status !== 'succeeded')).toHaveLength(4);
  });

  it('keeps example data valid apart from the one intentionally malformed record', async () => {
    const { runs } = await loadExampleRuns();
    const skipped = runs.flatMap((loaded) =>
      loaded.skipped.map((record) => ({ run: loaded.run.id, record })),
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.run).toBe('example-missing-result');
    expect(skipped[0]?.record).toMatchObject({ index: 8, id: 'evt_09' });
    expect(runs.flatMap((loaded) => loaded.warnings)).toEqual([]);
  });

  it('supports demo modes for previewing empty and error states', async () => {
    await expect(loadExampleRuns('empty')).resolves.toEqual({ runs: [], rejected: [] });
    await expect(loadExampleRuns('error')).rejects.toThrow('Simulated failure');
  });
});

describe('toRunJson', () => {
  it('produces JSON that validates as the same run (used for the downloadable sample)', async () => {
    const { runs } = await loadExampleRuns();
    const run = runs.find((loaded) => loaded.run.id === 'example-success')?.run;
    if (!run) throw new Error('missing example');
    const reparsed = parseRun(JSON.parse(toRunJson(run)));
    expect(reparsed.ok && reparsed.run).toEqual(run);
  });
});

describe('parseDemoMode', () => {
  it('accepts only known modes', () => {
    expect(parseDemoMode('?demo=slow')).toBe('slow');
    expect(parseDemoMode('?demo=error&x=1')).toBe('error');
    expect(parseDemoMode('?demo=explode')).toBeUndefined();
    expect(parseDemoMode('')).toBeUndefined();
  });
});
