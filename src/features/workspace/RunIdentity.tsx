import { ArrowLeft, Download } from 'lucide-react';
import { RunStatusBadge } from '../../components/badges';
import { CopyButton } from '../../components/CopyButton';
import { SourceTags } from '../../components/provenance';
import type { LoadedRun } from '../../data/types';
import {
  formatDuration,
  formatShortDateTime,
  formatUtcDateTime,
  pluralize,
} from '../../domain/format';

interface RunIdentityProps {
  loaded: LoadedRun;
  durationMs?: number;
  onExport: () => void;
}

/** Who ran, what was asked, when, and how it ended, plus where the data came from. */
export function RunIdentity({ loaded, durationMs, onExport }: RunIdentityProps) {
  const { run, source, origin, skipped } = loaded;
  const backHref = source === 'example' ? '#/examples' : '#/';
  const backLabel = source === 'example' ? 'Example runs' : 'Runs';

  return (
    <header className="run-identity">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          <li>
            <a href={backHref}>
              <ArrowLeft size={14} />
              {backLabel}
            </a>
          </li>
          <li aria-current="page">{run.id}</li>
        </ol>
      </nav>

      <div className="run-identity__top">
        <div className="run-identity__title">
          <h1 tabIndex={-1}>{run.agentName}</h1>
          <RunStatusBadge status={run.status} />
          <SourceTags loaded={loaded} />
        </div>
        <button type="button" className="button button--primary" onClick={onExport}>
          <Download size={16} />
          Export report
        </button>
      </div>

      <p className="run-identity__task">
        <span className="run-identity__task-label">Task</span> {run.task}
      </p>

      <dl className="meta-list">
        <div>
          <dt>Run ID</dt>
          <dd className="meta-list__id">
            <code>{run.id}</code>
            <CopyButton text={run.id} label="run ID" compact />
          </dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd title={formatUtcDateTime(run.startedAt)}>
            <time dateTime={run.startedAt}>{formatShortDateTime(run.startedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(durationMs)}</dd>
        </div>
        <div>
          <dt>Events</dt>
          <dd>
            {run.events.length}
            {skipped.length > 0 && (
              <span className="muted"> + {pluralize(skipped.length, 'skipped record')}</span>
            )}
          </dd>
        </div>
        {run.agentVersion && (
          <div>
            <dt>Agent version</dt>
            <dd>{run.agentVersion}</dd>
          </div>
        )}
        {origin && (
          <div>
            <dt>Imported from</dt>
            <dd>
              {origin.fileName} · {formatShortDateTime(origin.importedAt)}
            </dd>
          </div>
        )}
      </dl>
    </header>
  );
}
