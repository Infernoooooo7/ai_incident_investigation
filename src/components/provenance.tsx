import { FileUp, Tag, Theater } from 'lucide-react';
import { hasExampleMarker } from '../data/provenance';
import type { LoadedRun } from '../data/types';
import { cx } from '../lib/cx';
import { Badge } from './badges';

/**
 * Where a run came from. Examples are always labelled as fictional; imported
 * runs that call themselves example data get an extra tag.
 */
export function SourceTags({ loaded }: { loaded: LoadedRun }) {
  if (loaded.source === 'example') {
    return (
      <Badge tone="example" icon={<Theater />}>
        Fictional example
      </Badge>
    );
  }
  return (
    <>
      <Badge tone="info" icon={<FileUp />}>
        Imported
      </Badge>
      {hasExampleMarker(loaded.run) && (
        <Badge tone="example" icon={<Tag />}>
          Marked as example data
        </Badge>
      )}
    </>
  );
}

interface ExampleBannerProps {
  /** One line for the workspace; the full explanation on the examples page. */
  compact?: boolean;
  className?: string;
}

export function ExampleBanner({ compact = false, className }: ExampleBannerProps) {
  return (
    <aside
      className={cx('example-banner', compact && 'example-banner--compact', className)}
      aria-label="About example data"
    >
      <Theater size={compact ? 16 : 20} />
      {compact ? (
        <p>
          <strong>Fictional example.</strong> Not a real incident. Hand-written to show how findings
          work.
        </p>
      ) : (
        <div>
          <p className="example-banner__title">These runs are fictional examples</p>
          <p>
            Each one was written by hand to show a failure pattern the rules can detect. None of
            them is a real incident, and the agents, accounts, and systems in them do not exist.
            Your imported runs are listed separately under Runs.
          </p>
        </div>
      )}
    </aside>
  );
}
