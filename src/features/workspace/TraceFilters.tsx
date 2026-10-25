import { FlaskConical, Search, X } from 'lucide-react';
import { useId } from 'react';
import type { RefObject } from 'react';
import { KindIcon } from '../../components/EventKindIcon';
import { pluralize } from '../../domain/format';
import { EVENT_KIND_LABELS, EVENT_STATUS_LABELS } from '../../domain/labels';
import { EMPTY_EVENT_FILTERS, hasActiveEventFilters } from '../../domain/search';
import type { EventFilters } from '../../domain/search';
import { EVENT_KINDS, EVENT_STATUSES } from '../../domain/types';
import type { EventKind, EventStatus } from '../../domain/types';

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Event count for a chip; the spaces keep accessible names readable ("Error 3 events"). */
function Count({ value }: { value: number }) {
  return (
    <>
      {' '}
      <span className="chip__count">
        {value} <span className="visually-hidden">events</span>
      </span>
    </>
  );
}

interface TraceFiltersProps {
  filters: EventFilters;
  onChange: (filters: EventFilters) => void;
  kindCounts: Record<EventKind, number>;
  statusCounts: Record<EventStatus, number>;
  evidenceCount: number;
  shown: number;
  total: number;
  searchRef: RefObject<HTMLInputElement | null>;
}

/** Search and filters combine: an event must match the query and every active filter group. */
export function TraceFilters({
  filters,
  onChange,
  kindCounts,
  statusCounts,
  evidenceCount,
  shown,
  total,
  searchRef,
}: TraceFiltersProps) {
  const inputId = useId();
  const active = hasActiveEventFilters(filters);
  // Only kinds present in this run are offered, plus any already selected.
  const kinds = EVENT_KINDS.filter((kind) => kindCounts[kind] > 0 || filters.kinds.includes(kind));

  return (
    <div className="trace-filters">
      <search className="search-field">
        <Search />
        <label className="visually-hidden" htmlFor={inputId}>
          Search events in this run
        </label>
        <input
          id={inputId}
          ref={searchRef}
          type="search"
          placeholder="Search tools, errors, inputs, outputs"
          value={filters.query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filters.query !== '') {
              event.preventDefault();
              onChange({ ...filters, query: '' });
            }
          }}
        />
        <kbd aria-hidden="true">/</kbd>
      </search>

      <fieldset className="chip-row">
        <legend className="visually-hidden">Filter by event type</legend>
        <span className="chip-row__label" aria-hidden="true">
          Type
        </span>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className="chip"
            aria-pressed={filters.kinds.includes(kind)}
            onClick={() => onChange({ ...filters, kinds: toggle(filters.kinds, kind) })}
          >
            <KindIcon kind={kind} size={14} />
            {EVENT_KIND_LABELS[kind]}
            <Count value={kindCounts[kind]} />
          </button>
        ))}
      </fieldset>

      <fieldset className="chip-row">
        <legend className="visually-hidden">Filter by status</legend>
        <span className="chip-row__label" aria-hidden="true">
          Status
        </span>
        {EVENT_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className="chip"
            aria-pressed={filters.statuses.includes(status)}
            disabled={statusCounts[status] === 0 && !filters.statuses.includes(status)}
            onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, status) })}
          >
            {EVENT_STATUS_LABELS[status]}
            <Count value={statusCounts[status]} />
          </button>
        ))}
        <button
          type="button"
          className="chip chip--heuristic"
          aria-pressed={filters.flaggedOnly}
          disabled={evidenceCount === 0 && !filters.flaggedOnly}
          onClick={() => onChange({ ...filters, flaggedOnly: !filters.flaggedOnly })}
        >
          <FlaskConical size={14} />
          Cited as evidence
          <Count value={evidenceCount} />
        </button>
      </fieldset>

      <div className="trace-filters__footer">
        <output>
          {active ? `Showing ${shown} of ${pluralize(total, 'event')}` : pluralize(total, 'event')}
        </output>
        {active && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onChange(EMPTY_EVENT_FILTERS);
              // This button disappears once filters are cleared; keep focus nearby.
              searchRef.current?.focus();
            }}
          >
            <X size={14} />
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
