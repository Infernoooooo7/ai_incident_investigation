import { Search, SearchX, X } from 'lucide-react';
import { useDeferredValue, useId, useMemo, useRef } from 'react';
import { useStore } from '../../app/store';
import { StateMessage } from '../../components/StateMessage';
import type { LoadedRun, RunSource } from '../../data/types';
import { pluralize } from '../../domain/format';
import { RUN_STATUS_LABELS } from '../../domain/labels';
import { matchesAllTerms, tokenizeQuery } from '../../domain/search';
import type { RunStatusFilter } from '../../domain/search';
import { useSlashToFocus } from '../../lib/hooks';
import { RunCard } from './RunCard';
import { countByStatus, toRunListItem } from './runListItem';

const STATUS_OPTIONS: ReadonlyArray<{ value: RunStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'failed', label: RUN_STATUS_LABELS.failed },
  { value: 'cancelled', label: RUN_STATUS_LABELS.cancelled },
  { value: 'succeeded', label: RUN_STATUS_LABELS.succeeded },
];

interface RunCollectionProps {
  source: RunSource;
  runs: readonly LoadedRun[];
  /** Names the list and its search field, e.g. "imported runs". */
  noun: string;
  /** Heading level of the card titles; one below the heading the list sits under. */
  titleLevel: 2 | 3;
}

/** Searchable, status-filterable list of run cards. Filters persist per source. */
export function RunCollection({ source, runs, noun, titleLevel }: RunCollectionProps) {
  const { listFilters, setListFilters } = useStore();
  const filters = listFilters[source];
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const statusName = useId();
  useSlashToFocus(searchRef);

  const items = useMemo(() => runs.map(toRunListItem), [runs]);
  const counts = useMemo(() => countByStatus(items), [items]);
  const query = useDeferredValue(filters.query);
  const terms = useMemo(() => tokenizeQuery(query), [query]);
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (filters.status === 'all' || item.loaded.run.status === filters.status) &&
          matchesAllTerms(item.searchText, terms),
      ),
    [items, filters.status, terms],
  );
  const active = filters.query.trim() !== '' || filters.status !== 'all';
  const clear = () => {
    setListFilters(source, { query: '', status: 'all' });
    searchRef.current?.focus();
  };

  return (
    <div className="run-collection">
      <div className="list-toolbar">
        <search className="search-field">
          <Search />
          <label className="visually-hidden" htmlFor={searchId}>
            Search {noun}
          </label>
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            placeholder="Search agent, task, tool, error"
            value={filters.query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setListFilters(source, { ...filters, query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && filters.query !== '') {
                event.preventDefault();
                setListFilters(source, { ...filters, query: '' });
              }
            }}
          />
          <kbd aria-hidden="true">/</kbd>
        </search>
        <fieldset className="segmented">
          <legend className="visually-hidden">Filter {noun} by status</legend>
          {STATUS_OPTIONS.map(({ value, label }) => (
            <label key={value} className="segmented__option">
              <input
                type="radio"
                name={statusName}
                checked={filters.status === value}
                disabled={value !== 'all' && counts[value] === 0 && filters.status !== value}
                onChange={() => setListFilters(source, { ...filters, status: value })}
              />
              <span>
                {label} <span className="segmented__count">{counts[value]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <output className="list-toolbar__count">
          {active
            ? `${visible.length} of ${pluralize(items.length, 'run')} match`
            : pluralize(items.length, 'run')}
        </output>
        {active && (
          <button type="button" className="link-button" onClick={clear}>
            <X size={14} />
            Clear filters
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <StateMessage
          icon={<SearchX />}
          title={`No ${noun} match these filters`}
          actions={
            <button type="button" className="button" onClick={clear}>
              Clear filters
            </button>
          }
        />
      ) : (
        <ul className="run-grid" aria-label={noun[0]?.toUpperCase() + noun.slice(1)}>
          {visible.map((item) => (
            <li key={item.loaded.run.id}>
              <RunCard item={item} terms={terms} titleLevel={titleLevel} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
