import type { EventStatus, RunStatus } from '../domain/types';

/**
 * Visual tones. Besides the usual status tones there are three provenance
 * tones: `example` for fictional data, `heuristic` for rule-based
 * interpretation, and `model` for local-model output. Each is always paired
 * with a text label, never conveyed by color alone.
 */
export type Tone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent'
  | 'example'
  | 'heuristic'
  | 'model';

export const RUN_STATUS_TONES: Record<RunStatus, Tone> = {
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

/** Routine (OK) events stay neutral so problems stand out. */
export const EVENT_STATUS_TONES: Record<EventStatus, Tone> = {
  ok: 'neutral',
  warning: 'warning',
  error: 'danger',
};
