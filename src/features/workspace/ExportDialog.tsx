import { Copy, Download } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Notice } from '../../components/Notice';
import type { LoadedRun } from '../../data/types';
import type { RunFacts } from '../../diagnostics/facts';
import type { DiagnosisResult, FindingReview } from '../../diagnostics/types';
import { formatBytes, pluralize } from '../../domain/format';
import { copyText, downloadTextFile, EXPORT_FORMATS, reportFileName } from '../../export/browser';
import type { ExportFormat } from '../../export/browser';
import { renderMarkdownReport } from '../../export/markdown';
import { buildIncidentReport, renderJsonReport } from '../../export/report';
import { cx } from '../../lib/cx';
import type { SummaryResult } from '../../model/summarize';

type BuiltReport =
  | { ok: true; redactedCount: number; outputs: Record<ExportFormat, string> }
  | { ok: false; message: string };

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  loaded: LoadedRun;
  diagnosis: DiagnosisResult;
  facts: RunFacts;
  reviews: ReadonlyMap<string, FindingReview>;
  modelSummary?: SummaryResult;
}

type Status = { tone: 'success' | 'danger'; message: string };

export function ExportDialog({ open, onClose, ...props }: ExportDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Export incident report">
      {open && <ExportBody {...props} onClose={onClose} />}
    </Dialog>
  );
}

function ExportBody({
  loaded,
  diagnosis,
  facts,
  reviews,
  modelSummary,
  onClose,
}: Omit<ExportDialogProps, 'open'>) {
  const formatGroup = useId();
  const previewId = useId();
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [includeModel, setIncludeModel] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);

  // Built from the whole run, so the preview is exactly what gets exported.
  const built = useMemo((): BuiltReport => {
    try {
      const report = buildIncidentReport(loaded, diagnosis, {
        facts,
        reviews,
        ...(includeModel && modelSummary && { modelSummary }),
      });
      return {
        ok: true,
        redactedCount: report.redactedValueCount,
        outputs: { markdown: renderMarkdownReport(report), json: renderJsonReport(report) },
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }, [loaded, diagnosis, facts, reviews, includeModel, modelSummary]);

  const content = built.ok ? built.outputs[format] : '';
  const fileName = reportFileName(loaded.run.id, format);
  const { label, extension, mimeType } = EXPORT_FORMATS[format];

  const download = () => {
    try {
      downloadTextFile(fileName, content, mimeType);
      setStatus({ tone: 'success', message: `Download started: ${fileName}` });
    } catch (error) {
      setStatus({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'The download failed.',
      });
    }
  };

  const copy = async () => {
    try {
      await copyText(content);
      setStatus({ tone: 'success', message: `${label} report copied to the clipboard.` });
    } catch (error) {
      setStatus({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Copying failed.',
      });
    }
  };

  return (
    <>
      <div className="dialog__body export">
        <p className="muted">
          The report covers the whole run ({pluralize(loaded.run.events.length, 'event')},
          regardless of filters): observed facts, every finding with its evidence and your review,
          and data-quality notes. It is built in this tab; nothing is uploaded.
        </p>
        {loaded.source === 'example' && (
          <Notice tone="example" title="This report is about a fictional example">
            <p>
              The export is titled and labelled as example data so it cannot pass for a real
              incident.
            </p>
          </Notice>
        )}
        <Notice tone="warning" title="Review before sharing">
          <p>
            Values that look like API keys, bearer tokens, passwords, and secret assignments are
            replaced with <code className="inline-code">[REDACTED]</code>
            {built.ok ? ` (${pluralize(built.redactedCount, 'value')} in this report)` : ''}.
            Redaction is best-effort: secrets without a recognizable shape can slip through.
          </p>
        </Notice>
        <div className="export__options">
          <fieldset className="segmented">
            <legend className="visually-hidden">Export format</legend>
            {(Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((value) => (
              <label key={value} className="segmented__option">
                <input
                  type="radio"
                  name={formatGroup}
                  checked={format === value}
                  onChange={() => {
                    setFormat(value);
                    setStatus(null);
                  }}
                />
                <span>{EXPORT_FORMATS[value].label}</span>
              </label>
            ))}
          </fieldset>
          {modelSummary && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeModel}
                onChange={(event) => setIncludeModel(event.target.checked)}
              />
              Include the local model summary (labelled as unverified)
            </label>
          )}
        </div>
        {built.ok ? (
          <div className="code-block">
            <div className="code-block__toolbar">
              <label htmlFor={previewId}>
                Preview · {fileName} · {formatBytes(new TextEncoder().encode(content).length)}
              </label>
            </div>
            {/* A read-only textarea scrolls and supports select-all from the keyboard. */}
            <textarea
              id={previewId}
              className="code-preview code-preview--tall"
              readOnly
              spellCheck={false}
              value={content}
            />
          </div>
        ) : (
          <Notice tone="danger" announce="alert" title="The report could not be generated">
            <p>{built.message}</p>
          </Notice>
        )}
      </div>
      <div className="dialog__footer">
        <output className={cx('dialog__status', status && `dialog__status--${status.tone}`)}>
          {status?.message}
        </output>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
        <button type="button" className="button" disabled={!built.ok} onClick={() => void copy()}>
          <Copy size={16} />
          Copy
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={!built.ok}
          onClick={download}
        >
          <Download size={16} />
          Download .{extension}
        </button>
      </div>
    </>
  );
}
