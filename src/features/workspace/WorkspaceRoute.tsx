import { FileUp, OctagonAlert, RefreshCw, SearchX } from 'lucide-react';
import { runKey, useStore } from '../../app/store';
import { StateMessage } from '../../components/StateMessage';
import type { RunSource } from '../../data/types';
import { useDocumentTitle } from '../../lib/hooks';
import { Workspace } from './Workspace';

function WorkspaceSkeleton() {
  return (
    <div className="workspace-skeleton" aria-busy="true">
      <output className="visually-hidden">Loading run…</output>
      <span className="skeleton" style={{ width: 120, height: 14 }} />
      <span className="skeleton" style={{ width: '32%', height: 28 }} />
      <span className="skeleton" style={{ width: '60%' }} />
      <span className="skeleton" style={{ width: '100%', height: 240 }} />
    </div>
  );
}

function RunUnavailable({ source, runId }: { source: RunSource; runId: string }) {
  useDocumentTitle('Run not found · Agent Incident Investigator');
  const { examples, reloadExamples } = useStore();

  if (source === 'example' && examples.status === 'error') {
    return (
      <div className="page">
        <h1 className="visually-hidden" tabIndex={-1}>
          Example could not be loaded
        </h1>
        <StateMessage
          tone="danger"
          role="alert"
          icon={<OctagonAlert />}
          title="The example runs could not be loaded"
          actions={
            <>
              <button type="button" className="button" onClick={reloadExamples}>
                <RefreshCw size={16} />
                Try again
              </button>
              <a className="button button--ghost" href="#/examples">
                Back to examples
              </a>
            </>
          }
        >
          <p>{examples.message}</p>
        </StateMessage>
      </div>
    );
  }

  if (source === 'example') {
    return (
      <div className="page">
        <h1 className="visually-hidden" tabIndex={-1}>
          Example not found
        </h1>
        <StateMessage
          icon={<SearchX />}
          title={
            <>
              There is no example with ID <code className="inline-code">{runId}</code>
            </>
          }
          actions={
            <a className="button" href="#/examples">
              Browse examples
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="visually-hidden" tabIndex={-1}>
        Imported run not loaded
      </h1>
      <StateMessage
        icon={<FileUp />}
        title={
          <>
            The imported run <code className="inline-code">{runId}</code> is not loaded
          </>
        }
        actions={
          <a className="button button--primary" href="#/">
            Go to Runs to import it
          </a>
        }
      >
        <p>
          Imported runs exist only in the browser tab they were imported into, so a reload or a new
          tab starts empty. Import the file again to continue.
        </p>
      </StateMessage>
    </div>
  );
}

interface WorkspaceRouteProps {
  source: RunSource;
  runId: string;
  eventId?: string;
}

export function WorkspaceRoute({ source, runId, eventId }: WorkspaceRouteProps) {
  const { examples, imports } = useStore();
  if (source === 'example' && examples.status === 'loading') return <WorkspaceSkeleton />;
  const runs = source === 'example' ? (examples.status === 'ready' ? examples.runs : []) : imports;
  const loaded = runs.find((candidate) => candidate.run.id === runId);
  if (!loaded) return <RunUnavailable source={source} runId={runId} />;
  // Keyed by run so transient state (dialogs, pending focus) resets between runs.
  return <Workspace key={runKey(source, runId)} loaded={loaded} eventId={eventId} />;
}
