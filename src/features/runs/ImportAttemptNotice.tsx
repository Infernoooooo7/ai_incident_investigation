import { ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { runHref } from '../../app/router';
import { Notice } from '../../components/Notice';
import { formatIssue } from '../../data/issueText';
import { pluralize } from '../../domain/format';
import type { ImportAttempt } from './ImportPanel';

const MAX_LISTED_ISSUES = 8;

function describeSources(sources: readonly string[]): string {
  if (sources.length === 1) return sources[0] ?? 'the file';
  return `${sources.length} files`;
}

function IssueList({ attempt }: { attempt: ImportAttempt }) {
  const multipleSources = attempt.sources.length > 1;
  const issues = attempt.problems.flatMap((problem) =>
    problem.issues.map((issue) => {
      const owner = problem.label === 'file' ? problem.source : problem.label;
      const prefix = multipleSources && problem.label !== 'file' ? `${problem.source} › ` : '';
      return { owner: `${prefix}${owner}`, text: formatIssue(issue) };
    }),
  );
  const shown = issues.slice(0, MAX_LISTED_ISSUES);
  return (
    <ul className="issue-list">
      {shown.map((issue, index) => (
        <li key={index}>
          <strong>{issue.owner}:</strong> {issue.text}
        </li>
      ))}
      {issues.length > shown.length && (
        <li>…and {pluralize(issues.length - shown.length, 'more problem')}</li>
      )}
    </ul>
  );
}

/**
 * Result of an import. When nothing was imported it is an error summary
 * (role="alert") and receives focus, so the problems are announced and the
 * user starts from them.
 */
export function ImportAttemptNotice({
  attempt,
  onDismiss,
}: {
  attempt: ImportAttempt;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const imported = attempt.runs.length;
  const from = describeSources(attempt.sources);

  useEffect(() => {
    ref.current?.focus();
  }, [attempt]);

  if (imported === 0) {
    return (
      <Notice
        focusRef={ref}
        tone="danger"
        announce="alert"
        title={`Nothing was imported from ${from}`}
        onDismiss={onDismiss}
        className="import-result"
      >
        <IssueList attempt={attempt} />
        <p>
          Fix the listed fields and import the file again. The <a href="#/format">import format</a>{' '}
          describes every field.
        </p>
      </Notice>
    );
  }

  const skipped = attempt.runs.reduce((total, loaded) => total + loaded.skipped.length, 0);
  const single = imported === 1 ? attempt.runs[0] : undefined;
  return (
    <Notice
      focusRef={ref}
      tone={attempt.problems.length > 0 ? 'warning' : 'success'}
      announce="status"
      title={`Imported ${pluralize(imported, 'run')} from ${from}`}
      onDismiss={onDismiss}
      className="import-result"
    >
      {skipped > 0 && (
        <p>
          {pluralize(skipped, 'event record')} failed validation and{' '}
          {skipped === 1 ? 'was' : 'were'} left out. The run page lists them, and findings that
          depend on missing events get lower confidence.
        </p>
      )}
      {attempt.problems.length > 0 && (
        <>
          <p>Some runs were not imported:</p>
          <IssueList attempt={attempt} />
        </>
      )}
      {single && (
        <p>
          <a className="notice__action" href={runHref('import', single.run.id)}>
            Open {single.run.agentName} · {single.run.id}
            <ArrowRight size={14} />
          </a>
        </p>
      )}
    </Notice>
  );
}
