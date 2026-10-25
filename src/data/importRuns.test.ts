import { describe, expect, it } from 'vitest';
import { loadExampleRuns } from './examples';
import { MAX_IMPORT_BYTES, parseImportText, readImportFile } from './importRuns';

const ORIGIN = { fileName: 'trace.json', importedAt: '2026-10-26T09:00:00.000Z' };

describe('parseImportText', () => {
  it('explains empty input and invalid JSON in plain language', () => {
    expect(parseImportText('   ', new Set(), ORIGIN).problems).toEqual([
      { label: 'file', issues: [{ path: '(file)', message: 'is empty' }] },
    ]);
    const outcome = parseImportText('{ not json', new Set(), ORIGIN);
    expect(outcome.runs).toEqual([]);
    expect(outcome.problems[0]?.issues[0]?.message).toMatch(/^is not valid JSON \(/);
  });

  it('explains a file that contains no runs', () => {
    for (const text of ['[]', '{"runs": []}']) {
      expect(parseImportText(text, new Set(), ORIGIN).problems).toEqual([
        { label: 'file', issues: [{ path: '(file)', message: 'contains no runs' }] },
      ]);
    }
  });

  it('imports valid runs as imported data with their origin', async () => {
    const { runs } = await loadExampleRuns();
    const example = runs[0]?.run;
    const outcome = parseImportText(
      JSON.stringify({ ...example, id: 'run_new' }),
      new Set(),
      ORIGIN,
    );
    expect(outcome.problems).toEqual([]);
    expect(outcome.runs[0]).toMatchObject({ source: 'import', origin: ORIGIN });
    expect(outcome.runs[0]?.run.id).toBe('run_new');
  });

  it('refuses to replace a run that is already imported', async () => {
    const { runs } = await loadExampleRuns();
    const example = runs[0]?.run;
    const outcome = parseImportText(JSON.stringify(example), new Set([example?.id ?? '']), ORIGIN);
    expect(outcome.runs).toEqual([]);
    expect(outcome.problems[0]?.issues[0]?.message).toContain('already imported');
  });

  it('imports the valid runs from a file and reports the invalid ones', async () => {
    const { runs } = await loadExampleRuns();
    const good = { ...runs[0]?.run, id: 'good' };
    const bad = { ...runs[0]?.run, id: 'bad', status: 'exploded' };
    const outcome = parseImportText(JSON.stringify({ runs: [good, bad] }), new Set(), ORIGIN);
    expect(outcome.runs.map((loaded) => loaded.run.id)).toEqual(['good']);
    expect(outcome.problems[0]?.label).toBe('bad');
    expect(outcome.problems[0]?.issues[0]).toEqual({
      path: 'runs[1].status',
      message: 'should be one of: succeeded, failed, cancelled, but it is text ("exploded")',
    });
  });
});

describe('readImportFile', () => {
  it('rejects files over the size limit before reading them', async () => {
    const big = new File(['x'], 'huge.json');
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_BYTES + 1 });
    await expect(readImportFile(big)).rejects.toThrow('the import limit is 5 MB');
  });

  it('reads small files as text', async () => {
    await expect(readImportFile(new File(['{"a":1}'], 'run.json'))).resolves.toBe('{"a":1}');
  });
});
