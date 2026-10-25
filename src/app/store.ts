/**
 * App-wide state shared through context. Imported runs and example runs are
 * held separately and are never merged into one list. UI context (filters,
 * reviews, model summaries) is kept per run so navigating away and back does
 * not lose it. Everything is in memory for this tab only; nothing is uploaded
 * or persisted, except the local-model settings, which contain no trace data.
 * The provider lives in StoreProvider.tsx.
 */
import { createContext, useContext } from 'react';
import type { RejectedSource } from '../data/examples';
import type { LoadedRun, RunSource } from '../data/types';
import type { FindingReview } from '../diagnostics/types';
import { EMPTY_EVENT_FILTERS } from '../domain/search';
import type { EventFilters, RunStatusFilter } from '../domain/search';
import type { ModelConfig } from '../model/config';
import type { SummaryResult } from '../model/summarize';

export type ExamplesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; runs: LoadedRun[]; rejected: RejectedSource[] };

export interface ListFilters {
  query: string;
  status: RunStatusFilter;
}

export type WorkspacePanel = 'analysis' | 'trace';

export interface WorkspaceUi {
  filters: EventFilters;
  /** The tab shown on narrow screens, where the panes cannot sit side by side. */
  panel: WorkspacePanel;
  /** Restored when returning to the run without an event in the URL. */
  selectedEventId?: string;
}

export const DEFAULT_LIST_FILTERS: ListFilters = { query: '', status: 'all' };
export const DEFAULT_WORKSPACE: WorkspaceUi = { filters: EMPTY_EVENT_FILTERS, panel: 'analysis' };

export function runKey(source: RunSource, runId: string): string {
  return `${source}:${runId}`;
}

export interface Store {
  examples: ExamplesState;
  reloadExamples: () => void;
  imports: LoadedRun[];
  addImports: (runs: LoadedRun[]) => void;
  clearImports: () => void;
  listFilters: Record<RunSource, ListFilters>;
  setListFilters: (source: RunSource, filters: ListFilters) => void;
  workspace: (key: string) => WorkspaceUi;
  updateWorkspace: (key: string, update: Partial<WorkspaceUi>) => void;
  reviews: (key: string) => ReadonlyMap<string, FindingReview>;
  setReview: (key: string, findingId: string, review: FindingReview | undefined) => void;
  modelResult: (key: string) => SummaryResult | undefined;
  setModelResult: (key: string, result: SummaryResult | undefined) => void;
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig) => void;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>.');
  return store;
}
