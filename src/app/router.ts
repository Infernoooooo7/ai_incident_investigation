/**
 * Minimal hash router. Hash URLs keep deep links (including a selected event)
 * working on any static host without server rewrites.
 *
 * Imported runs and example runs live in separate URL spaces
 * (`#/runs/...` and `#/examples/...`) so the two are never confused.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { RunSource } from '../data/types';

export type Route =
  | { name: 'home' }
  | { name: 'examples' }
  | { name: 'format' }
  | { name: 'run'; source: RunSource; runId: string; eventId?: string }
  | { name: 'not-found'; path: string };

function safeDecode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '' || path === '/') return { name: 'home' };
  if (path === '/examples' || path === '/examples/') return { name: 'examples' };
  if (path === '/format' || path === '/format/') return { name: 'format' };

  const match = /^\/(runs|examples)\/([^/]+)(?:\/events\/([^/]+))?\/?$/.exec(path);
  const source: RunSource = match?.[1] === 'examples' ? 'example' : 'import';
  const runId = match?.[2] ? safeDecode(match[2]) : undefined;
  const eventId = match?.[3] ? safeDecode(match[3]) : undefined;
  if (runId && (match?.[3] === undefined || eventId)) {
    return eventId ? { name: 'run', source, runId, eventId } : { name: 'run', source, runId };
  }
  return { name: 'not-found', path };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'examples':
      return '#/examples';
    case 'format':
      return '#/format';
    case 'run': {
      const base = route.source === 'example' ? 'examples' : 'runs';
      const event = route.eventId ? `/events/${encodeURIComponent(route.eventId)}` : '';
      return `#/${base}/${encodeURIComponent(route.runId)}${event}`;
    }
    case 'not-found':
      return `#${route.path}`;
  }
}

export function runHref(source: RunSource, runId: string): string {
  return routeToHash({ name: 'run', source, runId });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const readHash = () => window.location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash, () => '');
  return useMemo(() => parseHash(hash), [hash]);
}

/**
 * Navigates to `route`. `replace` updates the current history entry instead of
 * adding one, used for event selection so Back returns to the previous page.
 */
export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const hash = routeToHash(route);
  if (hash === window.location.hash) return;
  if (options.replace) {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`);
    // replaceState does not fire hashchange, so notify subscribers ourselves.
    window.dispatchEvent(new Event('hashchange'));
  } else {
    window.location.hash = hash;
  }
}
