import type { AgentRun } from '../domain/types';
import type { LoadedRun, ValidationIssue } from './types';
import { parseRun } from './validate';

// Example runs are fictional traces bundled with the app. Each is a separate
// JSON chunk, loaded on demand and validated exactly like a user import.
const exampleModules = import.meta.glob<unknown>('./examples/*.json', { import: 'default' });

/** Lets reviewers preview the examples' loading, empty, and error states: `?demo=slow|empty|error`. */
export type DemoMode = 'slow' | 'empty' | 'error';

export interface RejectedSource {
  source: string;
  issues: ValidationIssue[];
}

export interface ExampleLoadResult {
  runs: LoadedRun[];
  /** Example files whose run envelope failed validation. */
  rejected: RejectedSource[];
}

export function parseDemoMode(search: string): DemoMode | undefined {
  const value = new URLSearchParams(search).get('demo');
  return value === 'slow' || value === 'empty' || value === 'error' ? value : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sortNewestFirst(runs: readonly LoadedRun[]): LoadedRun[] {
  return [...runs].sort((a, b) => Date.parse(b.run.startedAt) - Date.parse(a.run.startedAt));
}

export async function loadExampleRuns(demo?: DemoMode): Promise<ExampleLoadResult> {
  if (demo === 'slow') await delay(1500);
  if (demo === 'error') {
    await delay(300);
    throw new Error('Simulated failure while loading the example runs (demo mode).');
  }
  if (demo === 'empty') return { runs: [], rejected: [] };

  const entries = Object.entries(exampleModules).sort(([a], [b]) => a.localeCompare(b));
  const sources = await Promise.all(
    entries.map(async ([path, load]) => ({ path, raw: await load() })),
  );

  const runs: LoadedRun[] = [];
  const rejected: RejectedSource[] = [];
  for (const { path, raw } of sources) {
    const parsed = parseRun(raw);
    if (parsed.ok) {
      runs.push({
        run: parsed.run,
        source: 'example',
        skipped: parsed.skipped,
        warnings: parsed.warnings,
      });
    } else {
      rejected.push({ source: path.replace('./examples/', ''), issues: parsed.issues });
    }
  }
  return { runs: sortNewestFirst(runs), rejected };
}

/** Serializes a validated run in the documented import format (used for "Download sample JSON"). */
export function toRunJson(run: AgentRun): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}
