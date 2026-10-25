import type { AgentRun } from '../domain/types';

export interface ValidationIssue {
  /** Location of the problem, e.g. `events[3].timestamp`. */
  path: string;
  /** Plain-language description, written to follow the field name. */
  message: string;
}

/** An event record that failed validation and was left out of its run. */
export interface SkippedRecord {
  /** Position of the record in the source `events` array. */
  index: number;
  /** The record's `id`, when it had a readable one. */
  id?: string;
  issues: ValidationIssue[];
  /** The original record, kept so investigators can still read it. */
  raw: unknown;
}

/**
 * Where a run came from. Examples are fictional runs bundled with the app;
 * imports are files the user loaded. The two are never mixed in one list.
 */
export type RunSource = 'example' | 'import';

export interface ImportOrigin {
  fileName: string;
  /** ISO timestamp of when the file was imported in this browser tab. */
  importedAt: string;
}

/** A validated run plus the data-quality information gathered while loading it. */
export interface LoadedRun {
  run: AgentRun;
  source: RunSource;
  /** Present for imported runs. */
  origin?: ImportOrigin;
  skipped: SkippedRecord[];
  /** Problems that did not prevent loading, such as events outside the run window. */
  warnings: ValidationIssue[];
}
