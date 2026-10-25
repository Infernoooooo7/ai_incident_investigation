import { Compass } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { StateMessage } from '../components/StateMessage';
import { parseDemoMode } from '../data/examples';
import { FormatPage } from '../features/format/FormatPage';
import { ExamplesPage } from '../features/runs/ExamplesPage';
import { HomePage } from '../features/runs/HomePage';
import { WorkspaceRoute } from '../features/workspace/WorkspaceRoute';
import { cx } from '../lib/cx';
import { useDocumentTitle } from '../lib/hooks';
import { AppHeader } from './AppHeader';
import { useRoute } from './router';
import type { Route } from './router';
import { runKey } from './store';
import { StoreProvider } from './StoreProvider';

function NotFoundPage() {
  useDocumentTitle('Page not found · Agent Incident Investigator');
  return (
    <div className="page">
      <h1 className="visually-hidden" tabIndex={-1}>
        Page not found
      </h1>
      <StateMessage
        icon={<Compass />}
        title="This page does not exist"
        actions={
          <a className="button" href="#/">
            Go to Runs
          </a>
        }
      />
    </div>
  );
}

/** Quotes a value for an attribute selector (CSS.escape is missing in some test DOMs). */
function attributeValue(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
}

function pageKeyOf(route: Route): string {
  return route.name === 'run' ? `run:${runKey(route.source, route.runId)}` : route.name;
}

function Shell({ demo }: { demo?: ReturnType<typeof parseDemoMode> }) {
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const pageKey = pageKeyOf(route);
  const lastPageKey = useRef(pageKey);
  const scrollPositions = useRef(new Map<string, number>());

  // Changing the event within a run keeps focus where it is. Changing pages
  // moves focus to the new page's heading so screen readers announce it;
  // returning to a list restores its scroll position and focuses the card of
  // the run just left, so going back keeps your place.
  useEffect(() => {
    const previous = lastPageKey.current;
    if (previous === pageKey) return;
    lastPageKey.current = pageKey;
    const main = mainRef.current;
    const card = previous.startsWith('run:')
      ? main?.querySelector<HTMLElement>(`[data-run-key="${attributeValue(previous.slice(4))}"]`)
      : null;
    if (card) {
      card.focus({ preventScroll: true });
      window.scrollTo(0, scrollPositions.current.get(pageKey) ?? 0);
      card.scrollIntoView({ block: 'nearest' });
    } else {
      window.scrollTo(0, 0);
      const heading = main?.querySelector<HTMLElement>('h1');
      (heading ?? main)?.focus({ preventScroll: true });
    }
  }, [pageKey]);

  // A file dropped anywhere but the import area would make the browser open
  // it in place of the app, discarding everything imported in this tab.
  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files') || event.defaultPrevented) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  // Remember where each list page was scrolled to.
  useEffect(() => {
    if (route.name === 'run') return;
    const onScroll = () => scrollPositions.current.set(pageKey, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [route.name, pageKey]);

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          // The URL hash is used for routing, so move focus without changing it.
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to main content
      </a>
      <AppHeader route={route} demo={demo} />
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={cx('app-main', route.name === 'run' && 'app-main--workspace')}
      >
        <ErrorBoundary key={pageKey}>
          {route.name === 'home' && <HomePage />}
          {route.name === 'examples' && <ExamplesPage />}
          {route.name === 'format' && <FormatPage />}
          {route.name === 'run' && (
            <WorkspaceRoute source={route.source} runId={route.runId} eventId={route.eventId} />
          )}
          {route.name === 'not-found' && <NotFoundPage />}
        </ErrorBoundary>
      </main>
    </>
  );
}

export function App() {
  const demo = useMemo(() => parseDemoMode(window.location.search), []);
  return (
    <StoreProvider demo={demo}>
      <Shell demo={demo} />
    </StoreProvider>
  );
}
