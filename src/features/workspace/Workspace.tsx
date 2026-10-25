import { ChevronDown, ChevronUp, MousePointerClick } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { navigate } from '../../app/router';
import { runKey, useStore } from '../../app/store';
import type { WorkspacePanel } from '../../app/store';
import { ExampleBanner } from '../../components/provenance';
import { StateMessage } from '../../components/StateMessage';
import type { LoadedRun } from '../../data/types';
import { getLikelyFailurePoint } from '../../diagnostics/engine';
import { computeRunFacts } from '../../diagnostics/facts';
import type { Diagnosis, FindingReview } from '../../diagnostics/types';
import { buildRunIndex, findTerminalError } from '../../domain/runIndex';
import { buildEventSearchIndex, filterEvents, tokenizeQuery } from '../../domain/search';
import type { EventFilters } from '../../domain/search';
import { cx } from '../../lib/cx';
import { prefersReducedMotion, useDocumentTitle, useMediaQuery } from '../../lib/hooks';
import { getDiagnosis } from '../diagnosisCache';
import { AnalysisPane } from './AnalysisPane';
import { DataQualityNotice } from './DataQualityNotice';
import { EventDetails } from './EventDetails';
import { ExportDialog } from './ExportDialog';
import { findingDomId } from './ids';
import { RunIdentity } from './RunIdentity';
import { computeTimeMarks, describeCalls } from './traceLayout';
import { TracePane } from './TracePane';
import type { FocusRequest } from './TracePane';

type Layout = 'wide' | 'medium' | 'narrow';

/** Three panes side by side from this width. */
const WIDE_QUERY = '(min-width: 1240px)';
/** Trace and analysis side by side, event details inline in the trace. */
const MEDIUM_QUERY = '(min-width: 860px)';

function useWorkspaceLayout(): Layout {
  const wide = useMediaQuery(WIDE_QUERY);
  const medium = useMediaQuery(MEDIUM_QUERY);
  return wide ? 'wide' : medium ? 'medium' : 'narrow';
}

interface TabsProps {
  panel: WorkspacePanel;
  onChange: (panel: WorkspacePanel) => void;
  idPrefix: string;
  findings: number;
  events: number;
}

/** Narrow screens show one view at a time: analysis first, the trace one tap away. */
function WorkspaceTabs({ panel, onChange, idPrefix, findings, events }: TabsProps) {
  const tabs: Array<{ id: WorkspacePanel; label: string; count: number; unit: string }> = [
    { id: 'analysis', label: 'Analysis', count: findings, unit: 'findings' },
    { id: 'trace', label: 'Trace', count: events, unit: 'events' },
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = panel === 'analysis' ? 'trace' : 'analysis';
    onChange(next);
    document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
  };
  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspace views">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${idPrefix}-tab-${tab.id}`}
          type="button"
          role="tab"
          className="workspace-tabs__tab"
          aria-selected={panel === tab.id}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={panel === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={onKeyDown}
        >
          {tab.label}{' '}
          <span className="count-pill">
            {tab.count} <span className="visually-hidden">{tab.unit}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

interface EvidencePaneProps {
  details: ReactNode;
  canStep: { previous: boolean; next: boolean };
  onStep: (direction: -1 | 1) => void;
}

function EvidencePane({ details, canStep, onStep }: EvidencePaneProps) {
  const headingId = useId();
  return (
    <section className="pane evidence-pane" aria-labelledby={headingId}>
      <div className="pane__header">
        <h2 id={headingId} className="pane__title">
          Event
        </h2>
        <span className="kind-label kind-label--observed">Recorded data</span>
        <div className="pane__tools">
          <button
            type="button"
            className="icon-button"
            disabled={!canStep.previous}
            onClick={() => onStep(-1)}
          >
            <ChevronUp size={16} />
            <span className="visually-hidden">Previous event</span>
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!canStep.next}
            onClick={() => onStep(1)}
          >
            <ChevronDown size={16} />
            <span className="visually-hidden">Next event</span>
          </button>
        </div>
      </div>
      <div className="pane__body">
        {details ?? (
          <StateMessage icon={<MousePointerClick />} title="Select an event">
            <p>Choose an event in the trace to see its input, output, and metadata.</p>
          </StateMessage>
        )}
      </div>
    </section>
  );
}

interface WorkspaceProps {
  loaded: LoadedRun;
  /** Event selected through the URL, if any. */
  eventId?: string;
}

/**
 * The investigation view for one run: identity, the recorded trace, the
 * selected event, and the analysis (observed facts, heuristic findings, and
 * the optional local-model summary).
 */
export function Workspace({ loaded, eventId }: WorkspaceProps) {
  const { run, source } = loaded;
  const key = runKey(source, run.id);
  const store = useStore();
  const { updateWorkspace, setReview } = store;
  const ui = store.workspace(key);
  const { reviews: reviewsFor } = store;
  const reviews = useMemo(() => reviewsFor(key), [reviewsFor, key]);
  const modelResult = store.modelResult(key);
  const layout = useWorkspaceLayout();
  const tabsId = useId();
  const [exportOpen, setExportOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const pendingFinding = useRef<string | null>(null);
  useDocumentTitle(
    `${run.agentName} · ${run.id}${source === 'example' ? ' (example)' : ''} · Agent Incident Investigator`,
  );

  const diagnosis = getDiagnosis(loaded);
  const index = useMemo(() => buildRunIndex(run), [run]);
  const facts = useMemo(() => computeRunFacts(run, index), [run, index]);
  const calls = useMemo(() => describeCalls(index), [index]);
  const timeMarks = useMemo(() => computeTimeMarks(index, calls), [index, calls]);
  const searchIndex = useMemo(() => buildEventSearchIndex(run.events), [run]);

  const setFilters = useCallback(
    (filters: EventFilters) => updateWorkspace(key, { filters }),
    [key, updateWorkspace],
  );
  // Filtering trails typing slightly so long traces stay responsive.
  const deferredFilters = useDeferredValue(ui.filters);
  const visibleEvents = useMemo(
    () =>
      filterEvents(run.events, deferredFilters, searchIndex, (id) =>
        diagnosis.findingsByEvent.has(id),
      ),
    [run.events, deferredFilters, searchIndex, diagnosis],
  );
  const terms = useMemo(() => tokenizeQuery(deferredFilters.query), [deferredFilters.query]);

  // Without an event in the URL, reopen the last one viewed, else the likely
  // failure point, else where the run stopped.
  const defaultEventId =
    getLikelyFailurePoint(diagnosis)?.primaryEventId ??
    findTerminalError(run)?.id ??
    run.events[0]?.id;
  const requestedId = eventId ?? ui.selectedEventId;
  const selectedId =
    requestedId !== undefined && index.byId.has(requestedId) ? requestedId : defaultEventId;
  const selected = selectedId !== undefined ? index.byId.get(selectedId) : undefined;

  const findingsById = useMemo(
    () => new Map(diagnosis.findings.map((finding) => [finding.id, finding])),
    [diagnosis],
  );
  const citingFindings = useMemo(
    () =>
      (selectedId ? (diagnosis.findingsByEvent.get(selectedId) ?? []) : [])
        .map((id) => findingsById.get(id))
        .filter((finding): finding is Diagnosis => finding !== undefined),
    [selectedId, diagnosis, findingsById],
  );

  const selectEvent = useCallback(
    (id: string) => {
      updateWorkspace(key, { selectedEventId: id });
      navigate({ name: 'run', source, runId: run.id, eventId: id }, { replace: true });
    },
    [key, source, run.id, updateWorkspace],
  );

  /** Selects an event and brings it into view in the trace. */
  const revealEvent = useCallback(
    (id: string, moveFocus = true) => {
      if (layout === 'narrow') updateWorkspace(key, { panel: 'trace' });
      selectEvent(id);
      setFocusRequest({ eventId: id, nonce: Date.now(), moveFocus });
    },
    [layout, key, updateWorkspace, selectEvent],
  );

  const revealFinding = useCallback(
    (findingId: string) => {
      const finding = findingsById.get(findingId);
      if (!finding) return;
      if (layout === 'narrow') updateWorkspace(key, { panel: 'analysis' });
      selectEvent(finding.primaryEventId);
      pendingFinding.current = findingId;
    },
    [findingsById, layout, key, updateWorkspace, selectEvent],
  );

  // The finding card may only exist after the analysis tab renders.
  useEffect(() => {
    const findingId = pendingFinding.current;
    const card = findingId ? document.getElementById(findingDomId(findingId)) : null;
    if (!card) return;
    pendingFinding.current = null;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });

  const onReview = useCallback(
    (findingId: string, review: FindingReview | undefined) => setReview(key, findingId, review),
    [key, setReview],
  );

  const stepList =
    selectedId && visibleEvents.some((event) => event.id === selectedId)
      ? visibleEvents
      : run.events;
  const position = stepList.findIndex((event) => event.id === selectedId);
  const step = (direction: -1 | 1) => {
    const target = stepList[position + direction];
    if (target) revealEvent(target.id, false);
  };

  const details = selected ? (
    <EventDetails
      event={selected}
      index={index}
      calls={calls}
      runStartedAt={run.startedAt}
      citingFindings={citingFindings}
      terms={terms}
      onSelectEvent={revealEvent}
      onSelectFinding={revealFinding}
    />
  ) : null;

  const trace = (
    <TracePane
      index={index}
      calls={calls}
      timeMarks={timeMarks}
      visibleEvents={visibleEvents}
      filters={ui.filters}
      onFiltersChange={setFilters}
      selectedId={selectedId}
      findingsByEvent={diagnosis.findingsByEvent}
      terms={terms}
      onSelect={selectEvent}
      focusRequest={focusRequest}
      inlineDetails={layout === 'wide' ? undefined : (details ?? undefined)}
    />
  );
  const analysis = (
    <AnalysisPane
      loaded={loaded}
      storeKey={key}
      diagnosis={diagnosis}
      facts={facts}
      reviews={reviews}
      onReview={onReview}
      selectedEventId={selectedId}
      onRevealEvent={revealEvent}
    />
  );

  return (
    <div className={cx('workspace', `workspace--${layout}`)}>
      {source === 'example' && <ExampleBanner compact />}
      <RunIdentity
        loaded={loaded}
        durationMs={facts.durationMs}
        onExport={() => setExportOpen(true)}
      />
      <DataQualityNotice loaded={loaded} />
      {layout === 'wide' && (
        <div className="workspace__panes">
          {trace}
          <EvidencePane
            details={details}
            canStep={{
              previous: position > 0,
              next: position !== -1 && position < stepList.length - 1,
            }}
            onStep={step}
          />
          {analysis}
        </div>
      )}
      {layout === 'medium' && (
        <div className="workspace__panes">
          {trace}
          {analysis}
        </div>
      )}
      {layout === 'narrow' && (
        <>
          <WorkspaceTabs
            panel={ui.panel}
            onChange={(panel) => updateWorkspace(key, { panel })}
            idPrefix={tabsId}
            findings={diagnosis.findings.length}
            events={run.events.length}
          />
          {/* Both views stay mounted so switching tabs keeps scroll position,
              filters, and any model request in progress. */}
          <div
            id={`${tabsId}-panel-analysis`}
            role="tabpanel"
            className="workspace__tabpanel"
            aria-labelledby={`${tabsId}-tab-analysis`}
            hidden={ui.panel !== 'analysis'}
          >
            {analysis}
          </div>
          <div
            id={`${tabsId}-panel-trace`}
            role="tabpanel"
            className="workspace__tabpanel"
            aria-labelledby={`${tabsId}-tab-trace`}
            hidden={ui.panel !== 'trace'}
          >
            {trace}
          </div>
        </>
      )}
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        loaded={loaded}
        diagnosis={diagnosis}
        facts={facts}
        reviews={reviews}
        modelSummary={modelResult}
      />
    </div>
  );
}
