import type { AgentRun } from '../domain/types';

/**
 * True when a run's own metadata says it is example data, for instance the
 * bundled sample file imported back into the app. Such runs stay in the
 * imported list (the user chose to import them) but are tagged so they are
 * not mistaken for a real incident.
 */
export function hasExampleMarker(run: AgentRun): boolean {
  const marker = run.metadata.example;
  return marker === true || (typeof marker === 'string' && marker.trim() !== '');
}
