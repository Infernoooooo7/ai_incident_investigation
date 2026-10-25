import type { ValidationIssue } from './types';

/**
 * Turns a technical issue path into a readable location:
 * `events[8].timestamp` → "Event 9 › timestamp", `runs[1].task` → "Run 2 › task".
 * A bare `[1]` is a run in a top-level list of runs.
 * Positions are 1-based because that is how people count records in a file.
 */
export function formatIssueLocation(path: string): string {
  if (path === '' || path === 'run') return 'Run';
  if (path === '(file)' || path === '(root)') return 'File';
  if (path.startsWith('event ')) return `Event ${path.slice('event '.length)}`;
  return path
    .split('.')
    .map((segment) => {
      const indexed = /^(runs|events)?\[(\d+)\]$/.exec(segment);
      if (!indexed) return segment;
      const position = Number(indexed[2]) + 1;
      return indexed[1] === 'events' ? `Event ${position}` : `Run ${position}`;
    })
    .join(' › ');
}

/** "Event 9 › timestamp should be a full date and time …" */
export function formatIssue(issue: ValidationIssue): string {
  return `${formatIssueLocation(issue.path)} ${issue.message}`;
}
