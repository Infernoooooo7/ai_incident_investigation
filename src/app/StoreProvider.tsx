import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { loadExampleRuns, sortNewestFirst } from '../data/examples';
import type { DemoMode } from '../data/examples';
import type { LoadedRun, RunSource } from '../data/types';
import type { FindingReview } from '../diagnostics/types';
import { loadModelConfig, saveModelConfig } from '../model/config';
import type { ModelConfig } from '../model/config';
import type { SummaryResult } from '../model/summarize';
import { DEFAULT_LIST_FILTERS, DEFAULT_WORKSPACE, StoreContext } from './store';
import type { ExamplesState, ListFilters, Store, WorkspaceUi } from './store';

export function StoreProvider({ demo, children }: { demo?: DemoMode; children: ReactNode }) {
  const [examples, setExamples] = useState<ExamplesState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [imports, setImports] = useState<LoadedRun[]>([]);
  const [listFilters, setListFiltersState] = useState<Record<RunSource, ListFilters>>({
    import: DEFAULT_LIST_FILTERS,
    example: DEFAULT_LIST_FILTERS,
  });
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceUi>>({});
  const [reviewState, setReviewState] = useState<Record<string, Record<string, FindingReview>>>({});
  const [modelResults, setModelResults] = useState<Record<string, SummaryResult>>({});
  const [modelConfig, setModelConfigState] = useState<ModelConfig>(loadModelConfig);

  useEffect(() => {
    let cancelled = false;
    loadExampleRuns(demo).then(
      (result) => {
        if (!cancelled) setExamples({ status: 'ready', ...result });
      },
      (error: unknown) => {
        if (!cancelled) {
          setExamples({
            status: 'error',
            message: error instanceof Error ? error.message : 'An unknown error occurred.',
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [demo, attempt]);

  const reloadExamples = useCallback(() => {
    setExamples({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  const addImports = useCallback((runs: LoadedRun[]) => {
    setImports((current) => sortNewestFirst([...runs, ...current]));
  }, []);

  const clearImports = useCallback(() => {
    setImports([]);
    const isImportKey = (key: string) => key.startsWith('import:');
    const drop = <T,>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => !isImportKey(key)));
    setWorkspaces(drop);
    setReviewState(drop);
    setModelResults(drop);
  }, []);

  const setListFilters = useCallback((source: RunSource, filters: ListFilters) => {
    setListFiltersState((current) => ({ ...current, [source]: filters }));
  }, []);

  const workspace = useCallback(
    (key: string) => workspaces[key] ?? DEFAULT_WORKSPACE,
    [workspaces],
  );
  const updateWorkspace = useCallback((key: string, update: Partial<WorkspaceUi>) => {
    setWorkspaces((current) => ({
      ...current,
      [key]: { ...(current[key] ?? DEFAULT_WORKSPACE), ...update },
    }));
  }, []);

  const reviews = useCallback(
    (key: string): ReadonlyMap<string, FindingReview> =>
      new Map(Object.entries(reviewState[key] ?? {})),
    [reviewState],
  );
  const setReview = useCallback(
    (key: string, findingId: string, review: FindingReview | undefined) => {
      setReviewState((current) => {
        const next = { ...(current[key] ?? {}) };
        if (review) next[findingId] = review;
        else delete next[findingId];
        return { ...current, [key]: next };
      });
    },
    [],
  );

  const modelResult = useCallback((key: string) => modelResults[key], [modelResults]);
  const setModelResult = useCallback((key: string, result: SummaryResult | undefined) => {
    setModelResults((current) => {
      const next = { ...current };
      if (result) next[key] = result;
      else delete next[key];
      return next;
    });
  }, []);

  const setModelConfig = useCallback((config: ModelConfig) => {
    setModelConfigState(config);
    saveModelConfig(config);
  }, []);

  const value = useMemo<Store>(
    () => ({
      examples,
      reloadExamples,
      imports,
      addImports,
      clearImports,
      listFilters,
      setListFilters,
      workspace,
      updateWorkspace,
      reviews,
      setReview,
      modelResult,
      setModelResult,
      modelConfig,
      setModelConfig,
    }),
    [
      examples,
      reloadExamples,
      imports,
      addImports,
      clearImports,
      listFilters,
      setListFilters,
      workspace,
      updateWorkspace,
      reviews,
      setReview,
      modelResult,
      setModelResult,
      modelConfig,
      setModelConfig,
    ],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
