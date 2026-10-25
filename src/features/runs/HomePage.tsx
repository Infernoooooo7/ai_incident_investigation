import { ArrowRight, FileUp, Lock, Theater } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { pluralize } from '../../domain/format';
import { useDocumentTitle } from '../../lib/hooks';
import { ImportAttemptNotice } from './ImportAttemptNotice';
import { ImportPanel } from './ImportPanel';
import type { ImportAttempt } from './ImportPanel';
import { RunCollection } from './RunCollection';

export const PRODUCT_SENTENCE =
  'Import a recorded AI-agent run to step through its messages, tool calls, retries, and permission decisions, with heuristic findings that link to the events behind them.';

function ExamplesTeaser() {
  const { examples } = useStore();
  const headingId = useId();
  const count = examples.status === 'ready' ? examples.runs.length : undefined;
  return (
    <section className="examples-teaser" aria-labelledby={headingId}>
      <span className="examples-teaser__icon" aria-hidden="true">
        <Theater />
      </span>
      <div className="examples-teaser__text">
        <h2 id={headingId}>Not ready to import? Explore the examples</h2>
        <p>
          {count ? `${pluralize(count, 'fictional run')}, ` : 'Fictional runs, '}
          written by hand, show each kind of finding. They are labelled as examples everywhere and
          never mixed into your imported runs.
        </p>
      </div>
      <a className="button" href="#/examples">
        Browse examples
        <ArrowRight size={16} />
      </a>
    </section>
  );
}

function ClearImports({ count, onClear }: { count: number; onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className="button button--ghost button--small"
        onClick={() => setConfirming(true)}
      >
        Clear imported runs
      </button>
    );
  }
  return (
    <fieldset className="confirm-inline">
      <legend className="visually-hidden">Confirm clearing imported runs</legend>
      <span>Remove {pluralize(count, 'run')} from this tab?</span>
      <button type="button" className="button button--danger button--small" onClick={onClear}>
        Remove
      </button>
      <button
        type="button"
        className="button button--ghost button--small"
        onClick={() => setConfirming(false)}
      >
        Keep
      </button>
    </fieldset>
  );
}

export function HomePage() {
  const { imports, clearImports } = useStore();
  const [attempt, setAttempt] = useState<ImportAttempt | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const listHeadingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasImports = imports.length > 0;
  useDocumentTitle('Runs · Agent Incident Investigator');

  return (
    <div className="page page--home">
      <header className="page-header">
        <div className="page-header__text">
          <h1 ref={headingRef} tabIndex={-1}>
            Runs
          </h1>
          <p className="page-header__lede">{PRODUCT_SENTENCE}</p>
        </div>
        {hasImports && !importOpen && (
          <div className="page-header__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setAttempt(null);
                setImportOpen(true);
              }}
            >
              <FileUp size={16} />
              Import run
            </button>
          </div>
        )}
      </header>

      {attempt && <ImportAttemptNotice attempt={attempt} onDismiss={() => setAttempt(null)} />}

      {(!hasImports || importOpen) && (
        <ImportPanel
          empty={!hasImports}
          onAttempt={(result) => {
            setAttempt(result);
            if (result.runs.length > 0) setImportOpen(false);
          }}
          onCancel={hasImports ? () => setImportOpen(false) : undefined}
        />
      )}

      {hasImports && (
        <section className="section" aria-labelledby={listHeadingId}>
          <div className="section__header">
            <h2 id={listHeadingId}>
              Imported runs <span className="count-pill">{imports.length}</span>
            </h2>
            <p className="section__note">
              <Lock size={14} />
              Kept in this tab only; reloading or closing it clears them.
            </p>
            <ClearImports
              count={imports.length}
              onClear={() => {
                clearImports();
                setAttempt(null);
                // The clear controls are about to disappear; keep focus on the page.
                headingRef.current?.focus();
              }}
            />
          </div>
          <RunCollection source="import" runs={imports} noun="imported runs" titleLevel={3} />
        </section>
      )}

      <ExamplesTeaser />
    </div>
  );
}
