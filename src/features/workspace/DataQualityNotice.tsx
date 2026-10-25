import { ChevronRight } from 'lucide-react';
import { JsonBlock } from '../../components/CodeBlock';
import { Notice } from '../../components/Notice';
import { formatIssue, formatIssueLocation } from '../../data/issueText';
import type { LoadedRun } from '../../data/types';
import { isJsonValue } from '../../data/validate';
import { pluralize } from '../../domain/format';

/** Explains records that failed validation; they are left out of the trace but still readable. */
export function DataQualityNotice({ loaded }: { loaded: LoadedRun }) {
  const { skipped, warnings } = loaded;
  if (skipped.length === 0 && warnings.length === 0) return null;

  const title =
    skipped.length > 0
      ? `${pluralize(skipped.length, 'record')} in this trace failed validation and ${skipped.length === 1 ? 'was' : 'were'} left out`
      : `${pluralize(warnings.length, 'data warning')} for this trace`;

  return (
    <Notice tone="warning" title={title} className="data-quality">
      {skipped.length > 0 && (
        <p>
          The rest of the run is shown. Findings that depend on a missing event get lower
          confidence, because the missing event could be among the skipped records.
        </p>
      )}
      <details className="disclosure">
        <summary>
          <ChevronRight size={16} />
          Show validation details
        </summary>
        <ul className="data-quality__list">
          {skipped.map((record) => (
            <li key={`skipped-${record.index}`}>
              <p>
                <strong>
                  {formatIssueLocation(`events[${record.index}]`)}
                  {record.id ? ` (${record.id})` : ''}:
                </strong>{' '}
                {record.issues.map(formatIssue).join('; ')}
              </p>
              {isJsonValue(record.raw) && (
                <JsonBlock value={record.raw} label={`original record ${record.index + 1}`} />
              )}
            </li>
          ))}
          {warnings.map((warning, position) => (
            <li key={`warning-${position}`}>
              <p>
                <strong>Warning:</strong> {formatIssue(warning)}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </Notice>
  );
}
