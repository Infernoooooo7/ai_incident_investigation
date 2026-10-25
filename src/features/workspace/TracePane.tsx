import { FlaskConical, Hourglass, SearchX } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { EventOutcomeBadge } from '../../components/badges';
import { EventKindIcon } from '../../components/EventKindIcon';
import { Highlight } from '../../components/Highlight';
import { Notice } from '../../components/Notice';
import { StateMessage } from '../../components/StateMessage';
import { EVENT_STATUS_TONES } from '../../components/tones';
import {
  formatDuration,
  formatOffset,
  formatUtcTime,
  msBetween,
  pluralize,
} from '../../domain/format';
import { EVENT_KIND_LABELS, getEventPreview, getEventTitle } from '../../domain/labels';
import type { RunIndex } from '../../domain/runIndex';
import { EMPTY_EVENT_FILTERS, findOffscreenMatches } from '../../domain/search';
import type { EventFilters } from '../../domain/search';
import { EVENT_KINDS, EVENT_STATUSES } from '../../domain/types';
import type { AgentEvent, EventKind, EventStatus } from '../../domain/types';
import { cx } from '../../lib/cx';
import { prefersReducedMotion, useSlashToFocus } from '../../lib/hooks';
import { computeLanes, describeRelation } from './traceLayout';
import type { CallInfo, LaneLayout, LaneMark, TimeMark } from './traceLayout';
import { TraceFilters } from './TraceFilters';

/** Idle stretches at least this long are called out; they often mean a hang or a wait. */
const GAP_THRESHOLD_MS = 20_000;
/** Rows rendered at first; long traces reveal more on request. */
const PAGE_SIZE = 300;
const NO_LANES: LaneLayout = { laneCount: 0, marks: new Map() };

/** A request to move focus to an event (from a finding, link, or related event). */
export interface FocusRequest {
  eventId: string;
  /** Distinguishes repeated requests for the same event. */
  nonce: number;
  /** False scrolls the row into view without moving keyboard focus. */
  moveFocus?: boolean;
}

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

/** Lines that connect a tool call to its permission decisions, results, and errors. */
function Lanes({ marks }: { marks?: readonly LaneMark[] }) {
  return (
    <span className="lanes" aria-hidden="true">
      {marks?.map((mark) => (
        <span
          key={mark.lane}
          className={cx('lane', `lane--${mark.segment}`, `lane--${mark.outcome}`)}
          style={{ '--lane-index': mark.lane } as CSSProperties}
        />
      ))}
    </span>
  );
}

/** Position on the run's time axis: a span for tool calls, a tick for everything else. */
function TimeBar({ mark }: { mark: TimeMark }) {
  return (
    <span className="timebar" aria-hidden="true">
      {mark.kind === 'span' ? (
        <span
          className={cx('timebar__span', `timebar__span--${mark.outcome}`, mark.open && 'is-open')}
          style={{
            left: percent(mark.start),
            width: `max(3px, ${percent(mark.end - mark.start)})`,
          }}
        />
      ) : (
        <span className="timebar__tick" style={{ left: percent(mark.at) }} />
      )}
    </span>
  );
}

interface TraceRowProps {
  event: AgentEvent;
  selected: boolean;
  tabbable: boolean;
  citedBy: number;
  runStartedAt: string;
  terms: readonly string[];
  relation?: string;
  laneCount: number;
  lanes?: readonly LaneMark[];
  timeMark?: TimeMark;
  /** Time since the previous event, when it is long enough to point out. */
  gapBeforeMs?: number;
  /** Inline details, rendered under the row when the layout has no event pane. */
  details?: ReactNode;
  inline: boolean;
  onSelect: (eventId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, eventId: string) => void;
  register: (eventId: string, element: HTMLButtonElement | null) => void;
}

const TraceRow = memo(function TraceRow({
  event,
  selected,
  tabbable,
  citedBy,
  runStartedAt,
  terms,
  relation,
  laneCount,
  lanes,
  timeMark,
  gapBeforeMs,
  details,
  inline,
  onSelect,
  onKeyDown,
  register,
}: TraceRowProps) {
  const title = getEventTitle(event);
  const preview = getEventPreview(event);
  const matchedIn =
    terms.length > 0 ? findOffscreenMatches(event, terms, `${title}\n${preview}`) : [];
  const metaId = useId();
  const previewId = useId();
  const asideId = useId();
  const hasPreview = preview !== '' || matchedIn.length > 0;
  const outcome = <EventOutcomeBadge event={event} />;
  const describedBy = [metaId, hasPreview && previewId, asideId].filter(Boolean).join(' ');

  // Card pattern: the button holds only the title, so its accessible name is
  // short and matches what is visible; a CSS overlay makes the whole row
  // clickable, and the surrounding details are linked as its description.
  return (
    <li
      className={cx(
        'trace-row',
        selected && 'is-selected',
        gapBeforeMs !== undefined && 'has-gap',
        citedBy > 0 && 'is-cited',
      )}
      style={{ '--lanes': laneCount } as CSSProperties}
    >
      {laneCount > 0 && <Lanes marks={lanes} />}
      {gapBeforeMs !== undefined && (
        <p className="trace-row__gap">
          <Hourglass size={13} />
          {formatDuration(gapBeforeMs)} with no recorded events
        </p>
      )}
      <div className={cx('trace-row__main', `tone-${EVENT_STATUS_TONES[event.status]}`)}>
        <span className="trace-row__node" aria-hidden="true">
          <EventKindIcon event={event} size={13} />
        </span>
        <div className="trace-row__body">
          <button
            ref={(element) => register(event.id, element)}
            type="button"
            className="trace-row__button"
            aria-describedby={describedBy}
            aria-current={selected ? 'true' : undefined}
            aria-expanded={inline ? selected : undefined}
            tabIndex={tabbable ? 0 : -1}
            data-event-id={event.id}
            onClick={() => onSelect(event.id)}
            onKeyDown={(keyEvent) => onKeyDown(keyEvent, event.id)}
          >
            <Highlight text={title} terms={terms} />
          </button>
          <p id={metaId} className="trace-row__meta">
            <span className="trace-row__seq">#{event.sequence}</span>{' '}
            <span>{EVENT_KIND_LABELS[event.kind]}</span>{' '}
            <span title={`${formatUtcTime(event.timestamp)} UTC`}>
              {formatOffset(msBetween(runStartedAt, event.timestamp))}
            </span>
            {relation && (
              <>
                {' '}
                <span className="trace-row__relation">{relation}</span>
              </>
            )}
          </p>
          {hasPreview && (
            <p id={previewId} className="trace-row__preview">
              {preview && <Highlight text={preview} terms={terms} />}{' '}
              {matchedIn.length > 0 && (
                <span className="trace-row__match">Match in {matchedIn.join(', ')}</span>
              )}
            </p>
          )}
        </div>
        <p id={asideId} className="trace-row__aside">
          {outcome}{' '}
          {event.durationMs !== undefined && (
            <span className="trace-row__duration">{formatDuration(event.durationMs)}</span>
          )}{' '}
          {citedBy > 0 && (
            <span className="trace-row__cited">
              <FlaskConical size={12} />
              Evidence{citedBy > 1 ? ` ×${citedBy}` : ''}
            </span>
          )}
        </p>
        {timeMark && <TimeBar mark={timeMark} />}
      </div>
      {details && <div className="trace-row__details">{details}</div>}
    </li>
  );
});

function countBy<K extends string>(keys: readonly K[], values: readonly K[]): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

interface TracePaneProps {
  index: RunIndex;
  calls: ReadonlyMap<string, CallInfo>;
  timeMarks: ReadonlyMap<string, TimeMark>;
  visibleEvents: readonly AgentEvent[];
  filters: EventFilters;
  onFiltersChange: (filters: EventFilters) => void;
  selectedId?: string;
  findingsByEvent: ReadonlyMap<string, readonly string[]>;
  terms: readonly string[];
  onSelect: (eventId: string) => void;
  focusRequest: FocusRequest | null;
  /** When there is no separate event pane, the selected event's details render inside the list. */
  inlineDetails?: ReactNode;
}

export function TracePane({
  index,
  calls,
  timeMarks,
  visibleEvents,
  filters,
  onFiltersChange,
  selectedId,
  findingsByEvent,
  terms,
  onSelect,
  focusRequest,
  inlineDetails,
}: TracePaneProps) {
  const allEvents = index.run.events;
  const headingId = useId();
  const items = useRef(new Map<string, HTMLButtonElement>());
  const revealButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const initialSelection = useRef(selectedId);
  const [limit, setLimit] = useState(PAGE_SIZE);
  useSlashToFocus(searchRef);

  // Open with the selected event in view. Only the pane's own scroll area
  // moves (when it has one); the page is left where it is.
  useEffect(() => {
    const body = bodyRef.current;
    const eventId = initialSelection.current;
    const row = eventId ? items.current.get(eventId)?.closest('li') : undefined;
    if (!body || !row || body.scrollHeight <= body.clientHeight) return;
    const offset = row.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop += offset - body.clientHeight / 3;
  }, []);

  const kindCounts = useMemo(
    () =>
      countBy<EventKind>(
        EVENT_KINDS,
        allEvents.map((event) => event.kind),
      ),
    [allEvents],
  );
  const statusCounts = useMemo(
    () =>
      countBy<EventStatus>(
        EVENT_STATUSES,
        allEvents.map((event) => event.status),
      ),
    [allEvents],
  );
  const evidenceCount = useMemo(
    () => allEvents.filter((event) => findingsByEvent.has(event.id)).length,
    [allEvents, findingsByEvent],
  );
  const relations = useMemo(
    () => new Map(allEvents.map((event) => [event.id, describeRelation(event, index, calls)])),
    [allEvents, index, calls],
  );

  // Lanes and idle gaps describe neighbours, so they are only drawn when no
  // events are hidden between rows.
  const complete = visibleEvents.length === allEvents.length;
  const lanes = useMemo(
    () => (complete ? computeLanes(visibleEvents, calls) : NO_LANES),
    [complete, visibleEvents, calls],
  );

  const selectedPosition =
    selectedId === undefined ? -1 : visibleEvents.findIndex((event) => event.id === selectedId);
  const selectedVisible = selectedPosition !== -1;
  const shownCount = Math.min(visibleEvents.length, Math.max(limit, selectedPosition + 1));
  const shown = visibleEvents.slice(0, shownCount);
  // Roving tab stop: one row in the tab order, arrow keys move between rows.
  const tabbableId = selectedVisible ? selectedId : visibleEvents[0]?.id;
  const inline = inlineDetails !== undefined;

  const register = useCallback((eventId: string, element: HTMLButtonElement | null) => {
    if (element) items.current.set(eventId, element);
    else items.current.delete(eventId);
  }, []);

  const bringIntoView = useCallback(
    (element: HTMLElement, moveFocus = true) => {
      if (moveFocus) element.focus({ preventScroll: true });
      // Scroll the whole row (gap marker, inline details), not just the title.
      (element.closest('li') ?? element).scrollIntoView({
        block: inline ? 'start' : 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    },
    [inline],
  );

  const handleKeyDown = useCallback(
    (keyEvent: KeyboardEvent<HTMLButtonElement>, eventId: string) => {
      const position = visibleEvents.findIndex((event) => event.id === eventId);
      if (position === -1) return;
      const last = visibleEvents.length - 1;
      const targets: Record<string, number> = {
        ArrowDown: Math.min(position + 1, last),
        ArrowUp: Math.max(position - 1, 0),
        Home: 0,
        End: last,
      };
      const next = targets[keyEvent.key];
      if (next === undefined) return;
      keyEvent.preventDefault();
      const target = visibleEvents[next];
      if (!target || target.id === eventId) return;
      onSelect(target.id);
      pendingFocus.current = target.id;
    },
    [visibleEvents, onSelect],
  );

  useEffect(() => {
    if (!focusRequest) return;
    const target = items.current.get(focusRequest.eventId) ?? revealButton.current;
    if (target) bringIntoView(target, focusRequest.moveFocus !== false);
  }, [focusRequest, bringIntoView]);

  // Focus moves after the target row has rendered: keyboard moves past the
  // rendered rows, and clearing filters from a control that then disappears.
  useEffect(() => {
    const eventId = pendingFocus.current;
    const target = eventId ? items.current.get(eventId) : undefined;
    if (!target) return;
    pendingFocus.current = null;
    bringIntoView(target);
  });

  const revealAll = () => {
    pendingFocus.current = selectedId ?? allEvents[0]?.id ?? null;
    onFiltersChange(EMPTY_EVENT_FILTERS);
  };
  const selectedHidden = selectedId !== undefined && !selectedVisible && visibleEvents.length > 0;
  const remaining = visibleEvents.length - shown.length;

  return (
    <section className="pane trace-pane" aria-labelledby={headingId}>
      <div className="pane__header">
        <h2 id={headingId} className="pane__title">
          Trace
        </h2>
        <span className="kind-label kind-label--observed">Recorded events</span>
        <span className="pane__hint" aria-hidden="true">
          <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>/</kbd> search
        </span>
      </div>
      <div ref={bodyRef} className="pane__body">
        <TraceFilters
          filters={filters}
          onChange={onFiltersChange}
          kindCounts={kindCounts}
          statusCounts={statusCounts}
          evidenceCount={evidenceCount}
          shown={visibleEvents.length}
          total={allEvents.length}
          searchRef={searchRef}
        />
        {selectedHidden && (
          <Notice tone="info" className="trace-pane__notice">
            <p>
              The selected event <code className="inline-code">{selectedId}</code> is hidden by the
              current filters.{' '}
              <button ref={revealButton} type="button" className="link-button" onClick={revealAll}>
                Show all events
              </button>
            </p>
          </Notice>
        )}
        {visibleEvents.length === 0 ? (
          <StateMessage
            icon={<SearchX />}
            title={
              allEvents.length === 0
                ? 'This run has no valid events'
                : 'No events match these filters'
            }
            actions={
              allEvents.length > 0 && (
                <button ref={revealButton} type="button" className="button" onClick={revealAll}>
                  Clear filters
                </button>
              )
            }
          />
        ) : (
          <ol className="trace" aria-label="Events in run order">
            {shown.map((event, position) => {
              const selected = event.id === selectedId;
              const previous = position > 0 ? shown[position - 1] : undefined;
              const gap =
                complete && previous ? msBetween(previous.timestamp, event.timestamp) : undefined;
              return (
                <TraceRow
                  key={event.id}
                  event={event}
                  selected={selected}
                  tabbable={event.id === tabbableId}
                  citedBy={findingsByEvent.get(event.id)?.length ?? 0}
                  runStartedAt={index.run.startedAt}
                  terms={terms}
                  relation={relations.get(event.id)}
                  laneCount={lanes.laneCount}
                  lanes={lanes.marks.get(event.id)}
                  timeMark={timeMarks.get(event.id)}
                  gapBeforeMs={gap !== undefined && gap >= GAP_THRESHOLD_MS ? gap : undefined}
                  details={selected ? inlineDetails : undefined}
                  inline={inline}
                  onSelect={onSelect}
                  onKeyDown={handleKeyDown}
                  register={register}
                />
              );
            })}
          </ol>
        )}
        {remaining > 0 && (
          <div className="trace-pane__more">
            <button
              type="button"
              className="button"
              onClick={() => setLimit(shown.length + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, remaining)} more
            </button>
            <span className="muted">{pluralize(remaining, 'event')} not shown yet</span>
          </div>
        )}
      </div>
    </section>
  );
}
