import { FolderOpen, OctagonAlert, RefreshCw } from 'lucide-react';
import { useStore } from '../../app/store';
import { Notice } from '../../components/Notice';
import { ExampleBanner } from '../../components/provenance';
import { StateMessage } from '../../components/StateMessage';
import { formatIssue } from '../../data/issueText';
import { pluralize } from '../../domain/format';
import { useDocumentTitle } from '../../lib/hooks';
import { RunCollection } from './RunCollection';

function CardSkeletons() {
  return (
    <div className="run-grid run-grid--loading" aria-busy="true">
      <output className="visually-hidden">Loading example runs…</output>
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="run-card run-card--skeleton" aria-hidden="true">
          <span className="skeleton" style={{ width: '40%' }} />
          <span className="skeleton" style={{ width: '70%', height: 18 }} />
          <span className="skeleton" style={{ width: '100%' }} />
          <span className="skeleton" style={{ width: '55%' }} />
        </div>
      ))}
    </div>
  );
}

export function ExamplesPage() {
  const { examples, reloadExamples } = useStore();
  useDocumentTitle('Example runs · Agent Incident Investigator');
  const count = examples.status === 'ready' ? examples.runs.length : undefined;

  return (
    <div className="page page--examples">
      <ExampleBanner />
      <header className="page-header">
        <div className="page-header__text">
          <h1 tabIndex={-1}>Example runs</h1>
          <p className="page-header__lede">
            {count !== undefined
              ? `${pluralize(count, 'fictional run')} that show what each finding looks like. `
              : 'Fictional runs that show what each finding looks like. '}
            To investigate a real run, import it from <a href="#/">Runs</a>.
          </p>
        </div>
      </header>

      {examples.status === 'loading' && <CardSkeletons />}

      {examples.status === 'error' && (
        <StateMessage
          tone="danger"
          role="alert"
          icon={<OctagonAlert />}
          title="The example runs could not be loaded"
          actions={
            <button type="button" className="button" onClick={reloadExamples}>
              <RefreshCw size={16} />
              Try again
            </button>
          }
        >
          <p>{examples.message}</p>
        </StateMessage>
      )}

      {examples.status === 'ready' && (
        <>
          {examples.rejected.length > 0 && (
            <Notice
              tone="warning"
              title={`${pluralize(examples.rejected.length, 'example file')} failed validation and ${examples.rejected.length === 1 ? 'is' : 'are'} not shown`}
            >
              <ul className="issue-list">
                {examples.rejected.map((rejected) => (
                  <li key={rejected.source}>
                    <strong>{rejected.source}:</strong>{' '}
                    {rejected.issues.map((issue) => formatIssue(issue)).join('; ')}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {examples.runs.length === 0 ? (
            <StateMessage icon={<FolderOpen />} title="No example runs are bundled with this build">
              <p>
                Examples are optional. Import a run from <a href="#/">Runs</a> to get started.
              </p>
            </StateMessage>
          ) : (
            <RunCollection
              source="example"
              runs={examples.runs}
              noun="example runs"
              titleLevel={2}
            />
          )}
        </>
      )}
    </div>
  );
}
