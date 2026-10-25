import type { LoadedRun } from '../data/types';
import { diagnoseRun } from '../diagnostics/engine';
import type { DiagnosisResult } from '../diagnostics/types';

// Loaded runs are immutable, so each one is diagnosed once and shared by the
// dashboard and the run view.
const cache = new WeakMap<LoadedRun, DiagnosisResult>();

export function getDiagnosis(loaded: LoadedRun): DiagnosisResult {
  let result = cache.get(loaded);
  if (!result) {
    result = diagnoseRun(loaded.run, { skippedRecordCount: loaded.skipped.length });
    cache.set(loaded, result);
  }
  return result;
}
