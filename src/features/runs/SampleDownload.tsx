import { Download } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../../app/store';
import { toRunJson } from '../../data/examples';
import { downloadTextFile } from '../../export/browser';
import { cx } from '../../lib/cx';

/** The example offered as a sample file: it exercises timeouts, retries, and a fatal error. */
const SAMPLE_RUN_ID = 'example-tool-timeout';
export const SAMPLE_FILE_NAME = 'sample-agent-run.json';

/**
 * Downloads one of the bundled (fictional) examples in the import format, so
 * people can see a complete file and try the import flow with it.
 */
export function SampleDownloadButton({ className }: { className?: string }) {
  const { examples } = useStore();
  const [error, setError] = useState<string | null>(null);
  const sample =
    examples.status === 'ready'
      ? (examples.runs.find((loaded) => loaded.run.id === SAMPLE_RUN_ID) ?? examples.runs[0])
      : undefined;

  const download = () => {
    if (!sample) return;
    try {
      downloadTextFile(SAMPLE_FILE_NAME, toRunJson(sample.run), 'application/json');
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The download failed.');
    }
  };

  return (
    <>
      <button
        type="button"
        className={cx('button', className)}
        disabled={!sample}
        onClick={download}
      >
        <Download size={16} />
        Download sample JSON
      </button>
      {error && (
        <p className="inline-error" role="alert">
          The sample could not be downloaded. {error}
        </p>
      )}
    </>
  );
}
