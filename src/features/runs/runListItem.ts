import type { LoadedRun } from '../../data/types';
import type { Diagnosis } from '../../diagnostics/types';
import { msBetween } from '../../domain/format';
import { buildRunSearchText } from '../../domain/search';
import type { RunStatusFilter } from '../../domain/search';
import { getDiagnosis } from '../diagnosisCache';

/** Everything a run card needs, computed once per loaded run. */
export interface RunListItem {
  loaded: LoadedRun;
  durationMs?: number;
  topFinding?: Diagnosis;
  searchText: string;
}

export function toRunListItem(loaded: LoadedRun): RunListItem {
  const { run } = loaded;
  const diagnosis = getDiagnosis(loaded);
  const durationMs = msBetween(run.startedAt, run.endedAt);
  return {
    loaded,
    durationMs: durationMs !== undefined && durationMs >= 0 ? durationMs : undefined,
    topFinding: diagnosis.findings[0],
    searchText: buildRunSearchText(run, [
      ...diagnosis.findings.map((finding) => finding.title),
      ...(loaded.origin ? [loaded.origin.fileName] : []),
    ]),
  };
}

export function countByStatus(items: readonly RunListItem[]): Record<RunStatusFilter, number> {
  const counts: Record<RunStatusFilter, number> = {
    all: items.length,
    failed: 0,
    cancelled: 0,
    succeeded: 0,
  };
  for (const item of items) counts[item.loaded.run.status] += 1;
  return counts;
}
