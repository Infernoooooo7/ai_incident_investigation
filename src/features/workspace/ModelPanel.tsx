import {
  ChevronRight,
  CircleCheck,
  Cpu,
  LoaderCircle,
  Plug,
  RefreshCw,
  Send,
  Settings,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../app/store';
import { TextBlock } from '../../components/CodeBlock';
import { Notice } from '../../components/Notice';
import { EventLink, RichTextView } from '../../components/RichTextView';
import type { Tone } from '../../components/tones';
import type { LoadedRun } from '../../data/types';
import { formatDuration, formatShortDateTime, pluralize } from '../../domain/format';
import { cx } from '../../lib/cx';
import { ModelError, probeRuntime } from '../../model/ollama';
import type { ModelErrorKind, RuntimeStatus } from '../../model/ollama';
import { buildSummaryPrompt } from '../../model/prompt';
import type { ModelPrompt } from '../../model/prompt';
import { summarizeRun } from '../../model/summarize';
import type { SummaryResult } from '../../model/summarize';
import { ModelSettingsDialog } from './ModelSettingsDialog';

type ReadyStatus = Extract<RuntimeStatus, { state: 'ready' }>;

type Phase =
  | { name: 'idle' }
  | { name: 'checking' }
  | { name: 'checked'; status: RuntimeStatus }
  | { name: 'running'; status: ReadyStatus; received: number; startedAt: number }
  | { name: 'failed'; status: ReadyStatus; error: ModelError };

const FAILURE_COPY: Record<ModelErrorKind, { tone: Tone; title: string; hint?: string }> = {
  timeout: {
    tone: 'warning',
    title: 'The model did not finish in time',
    hint: 'Increase the timeout in settings or choose a smaller model.',
  },
  malformed: {
    tone: 'warning',
    title: 'The answer could not be used',
    hint: 'It did not match the expected format, so it is not shown as a summary. Nothing was run or changed.',
  },
  cancelled: { tone: 'neutral', title: 'Cancelled', hint: 'Nothing was saved.' },
  http: { tone: 'danger', title: 'Ollama returned an error' },
  unreachable: { tone: 'danger', title: 'Lost the connection to Ollama' },
  'model-missing': { tone: 'warning', title: 'The model is no longer installed' },
  blocked: { tone: 'danger', title: 'Not sent' },
};

function isLocalPage(): boolean {
  return /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])$/.test(window.location.hostname);
}

/** Re-renders every second while `active`, for an elapsed-time display. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function SendDisclosure({ prompt, endpoint }: { prompt: ModelPrompt; endpoint: string }) {
  const { disclosure } = prompt;
  const previewId = useId();
  const allSent = disclosure.sentEvents === disclosure.totalEvents;
  return (
    <div className="send-disclosure">
      <p className="send-disclosure__title">What will be sent</p>
      <ul className="bullet-list">
        <li>
          Only this run:{' '}
          {allSent
            ? `all ${pluralize(disclosure.totalEvents, 'event')}`
            : `${disclosure.sentEvents} of ${pluralize(disclosure.totalEvents, 'event')} (the start, the end, and every warning or error; ${disclosure.omittedEvents} left out)`}
          , about {disclosure.characters.toLocaleString('en-US')} characters in total.
        </li>
        <li>
          Values that look like keys, tokens, or passwords are replaced with{' '}
          <code className="inline-code">[REDACTED]</code> first (
          {pluralize(disclosure.redactedValues, 'value')})
          {disclosure.truncatedValues > 0 &&
            `, and ${pluralize(disclosure.truncatedValues, 'long value')} ${disclosure.truncatedValues === 1 ? 'is' : 'are'} shortened`}
          .
        </li>
        <li>
          Destination: <code className="inline-code">{endpoint}/api/chat</code>, the Ollama server
          on this computer. Nothing is sent to a cloud service.
        </li>
        <li>
          The model is told to treat the trace as untrusted data, cite event IDs for every claim,
          and say when the evidence is not enough. Its answer is shown separately and cannot run
          tools or change anything.
        </li>
      </ul>
      <details className="disclosure">
        <summary>
          <ChevronRight size={16} />
          Preview the exact trace data
        </summary>
        <label className="visually-hidden" htmlFor={previewId}>
          Trace data that will be sent to the local model
        </label>
        <textarea
          id={previewId}
          className="code-preview"
          readOnly
          spellCheck={false}
          value={prompt.data}
        />
      </details>
    </div>
  );
}

function ModelResultView({
  result,
  stale,
  onRevealEvent,
}: {
  result: SummaryResult;
  stale: boolean;
  onRevealEvent: (eventId: string) => void;
}) {
  const { summary, model, disclosure } = result;
  const { grounding } = summary;
  const details = [model.parameterSize, model.quantization].filter(Boolean).join(', ');
  return (
    <div className={cx('model-result', stale && 'is-stale')}>
      <p className="model-result__label">
        <Cpu size={14} />
        Model-generated · unverified
      </p>
      {summary.insufficientEvidence && (
        <p className="model-result__insufficient">
          <TriangleAlert size={14} />
          The model said the trace does not contain enough evidence to explain the outcome.
        </p>
      )}
      <p className="model-result__summary">
        <RichTextView value={summary.summary} onSelectEvent={onRevealEvent} />
      </p>
      {summary.claims.length > 0 && (
        <>
          <p className="model-result__grounding">
            {grounding.grounded} of {pluralize(grounding.claims, 'claim')} cite only events in this
            run.
            {grounding.uncited > 0 && ` ${grounding.uncited} cite no events.`}
            {grounding.unknownCitations > 0 &&
              ` ${pluralize(grounding.unknownCitations, 'citation')} point to events that do not exist.`}
          </p>
          <ol className="claim-list">
            {summary.claims.map((claim, position) => (
              <li key={position} className={cx('claim', !claim.grounded && 'claim--ungrounded')}>
                <span className={cx('claim__kind', `claim__kind--${claim.kind}`)}>
                  {claim.kind === 'observation' ? 'Observation' : 'Hypothesis'}
                </span>
                <p className="claim__text">{claim.statement}</p>
                <p className="claim__refs">
                  {claim.eventIds.map((eventId) => (
                    <EventLink key={eventId} eventId={eventId} onSelect={onRevealEvent} />
                  ))}
                  {claim.unknownIds.map((eventId) => (
                    <span key={eventId} className="claim__unknown">
                      {eventId} · not in this run
                    </span>
                  ))}
                  {!claim.grounded && (
                    <span className="claim__flag">
                      <TriangleAlert size={12} />
                      {claim.eventIds.length + claim.unknownIds.length === 0
                        ? 'No events cited'
                        : 'Cites events that do not exist'}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
      {summary.nextCheck && (
        <p className="model-result__next">
          <strong>Model&apos;s suggested next check:</strong> {summary.nextCheck}
        </p>
      )}
      <p className="model-result__meta">
        {model.name}
        {details && ` (${details})`}
        {result.runtimeVersion && ` · Ollama ${result.runtimeVersion}`} ·{' '}
        {formatShortDateTime(result.generatedAt)}
        {result.durationMs !== undefined && ` · ${formatDuration(result.durationMs)}`} · sent{' '}
        {disclosure.sentEvents} of {pluralize(disclosure.totalEvents, 'event')}
      </p>
    </div>
  );
}

interface ModelPanelProps {
  loaded: LoadedRun;
  storeKey: string;
  onRevealEvent: (eventId: string) => void;
}

/**
 * Optional, opt-in summary by a local model. Checking the runtime sends no
 * trace data; sending happens only after the disclosure is shown and the user
 * confirms. Output is labelled, kept apart from the rule-based findings, and
 * never acted on.
 */
export function ModelPanel({ loaded, storeKey, onRevealEvent }: ModelPanelProps) {
  const { modelConfig, setModelConfig, modelResult, setModelResult } = useStore();
  const result = modelResult(storeKey);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const controller = useRef<AbortController | null>(null);
  const headingId = useId();
  const now = useTicker(phase.name === 'running');
  useEffect(() => () => controller.current?.abort(), []);

  const readyStatus =
    phase.name === 'checked' && phase.status.state === 'ready'
      ? phase.status
      : phase.name === 'failed'
        ? phase.status
        : undefined;
  const isReady = readyStatus !== undefined;
  const prompt = useMemo(
    () => (isReady ? buildSummaryPrompt(loaded.run) : undefined),
    [isReady, loaded.run],
  );

  const begin = () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    return next.signal;
  };

  const check = async () => {
    const signal = begin();
    setPhase({ name: 'checking' });
    try {
      const status = await probeRuntime(modelConfig, { signal });
      if (!signal.aborted) setPhase({ name: 'checked', status });
    } catch {
      // Cancelled because a newer request started or the panel closed.
    }
  };

  const send = async (status: ReadyStatus) => {
    const signal = begin();
    setAnnouncement('');
    setPhase({ name: 'running', status, received: 0, startedAt: Date.now() });
    try {
      const summary = await summarizeRun(loaded.run, modelConfig, {
        signal,
        onProgress: (received) =>
          setPhase((current) => (current.name === 'running' ? { ...current, received } : current)),
      });
      setModelResult(storeKey, summary);
      setPhase({ name: 'checked', status });
      setAnnouncement('The local model summary is ready.');
    } catch (error) {
      const failure =
        error instanceof ModelError
          ? error
          : new ModelError('unreachable', error instanceof Error ? error.message : String(error));
      setPhase({ name: 'failed', status, error: failure });
      setAnnouncement(FAILURE_COPY[failure.kind].title);
    }
  };

  const configured = (
    <p className="model-panel__target">
      Configured: <code className="inline-code">{modelConfig.model}</code> at{' '}
      <code className="inline-code">{modelConfig.endpoint}</code>
    </p>
  );
  const checkButton = (label: string) => (
    <button type="button" className="button" onClick={() => void check()}>
      <Plug size={16} />
      {label}
    </button>
  );
  const settingsButton = (
    <button type="button" className="button button--ghost" onClick={() => setSettingsOpen(true)}>
      <Settings size={16} />
      Settings
    </button>
  );

  let body: ReactNode;
  switch (phase.name) {
    case 'idle':
      body = (
        <>
          {!result && (
            <p className="analysis-section__intro">
              Ask a model running on this computer, through Ollama, to summarize this run in plain
              language. It does not replace the findings above, and nothing is sent until you
              confirm.
            </p>
          )}
          {configured}
          <div className="model-panel__actions">
            {checkButton(result ? 'Check model to regenerate' : 'Check local model')}
            {settingsButton}
          </div>
          <p className="field-hint">Checking only asks Ollama which models are installed.</p>
        </>
      );
      break;
    case 'checking':
      body = (
        <output className="model-panel__status">
          <LoaderCircle size={16} className="spin" />
          Looking for Ollama at {modelConfig.endpoint}…
        </output>
      );
      break;
    case 'checked': {
      const { status } = phase;
      if (status.state === 'ready') {
        body = (
          <>
            <p className="model-panel__ready">
              <CircleCheck size={16} />
              Ready: <strong>{status.model.name}</strong>
              {status.model.parameterSize && ` (${status.model.parameterSize})`}
              {status.version && ` on Ollama ${status.version}`}
            </p>
            {prompt && <SendDisclosure prompt={prompt} endpoint={modelConfig.endpoint} />}
            <div className="model-panel__actions">
              <button
                type="button"
                className="button button--model"
                onClick={() => void send(status)}
              >
                <Send size={16} />
                {result ? 'Regenerate summary' : 'Send this run to the local model'}
              </button>
              {settingsButton}
            </div>
          </>
        );
      } else if (status.state === 'unreachable') {
        body = (
          <>
            <Notice tone="neutral" title="No local model is available">
              <p>{status.message}</p>
              <p>
                This feature is optional; everything else works without it. To turn it on, install
                Ollama, run <code className="inline-code">ollama pull {modelConfig.model}</code>,
                keep Ollama running, and check again.
              </p>
              {!isLocalPage() && (
                <p>
                  This page is served from{' '}
                  <code className="inline-code">{window.location.origin}</code>. Ollama accepts
                  browser requests from localhost pages by default; to allow this address, set{' '}
                  <code className="inline-code">OLLAMA_ORIGINS</code> to it before starting Ollama.
                </p>
              )}
            </Notice>
            <div className="model-panel__actions">
              {checkButton('Check again')}
              {settingsButton}
            </div>
          </>
        );
      } else if (status.state === 'model-missing') {
        body = (
          <>
            <Notice tone="warning" title={`${modelConfig.model} is not installed`}>
              <p>
                Ollama{status.version ? ` ${status.version}` : ''} is running, but this model is not
                installed.{' '}
                {status.installed.length > 0
                  ? `Installed: ${status.installed.join(', ')}.`
                  : 'No models are installed yet.'}
              </p>
              <p>
                Run <code className="inline-code">ollama pull {modelConfig.model}</code>, or choose
                an installed model in settings.
              </p>
            </Notice>
            <div className="model-panel__actions">
              {checkButton('Check again')}
              {settingsButton}
            </div>
          </>
        );
      } else {
        body = (
          <>
            <Notice tone="danger" title="Not sent: trace data would leave this computer">
              <p>{status.message}</p>
            </Notice>
            <div className="model-panel__actions">{settingsButton}</div>
          </>
        );
      }
      break;
    }
    case 'running': {
      const seconds = Math.max(0, Math.round((now - phase.startedAt) / 1000));
      body = (
        <>
          <div className="model-panel__progress">
            <LoaderCircle size={16} className="spin" />
            <p>
              <output>Generating with {phase.status.model.name}…</output>{' '}
              <span className="muted" aria-hidden="true">
                {phase.received > 0
                  ? `${phase.received.toLocaleString('en-US')} characters received`
                  : 'waiting for the first output'}{' '}
                · {seconds}s
              </span>
            </p>
          </div>
          <div className="model-panel__actions">
            <button type="button" className="button" onClick={() => controller.current?.abort()}>
              <Square size={14} />
              Cancel
            </button>
          </div>
        </>
      );
      break;
    }
    case 'failed': {
      const copy = FAILURE_COPY[phase.error.kind];
      body = (
        <>
          <Notice tone={copy.tone} title={copy.title}>
            {phase.error.kind !== 'cancelled' && <p>{phase.error.message}</p>}
            {copy.hint && <p>{copy.hint}</p>}
            {phase.error.raw !== undefined && (
              <details className="disclosure">
                <summary>
                  <ChevronRight size={16} />
                  Show the raw reply
                </summary>
                <TextBlock text={phase.error.raw} label="raw model reply" />
              </details>
            )}
          </Notice>
          <div className="model-panel__actions">
            <button type="button" className="button" onClick={() => void send(phase.status)}>
              <RefreshCw size={16} />
              Try again
            </button>
            {checkButton('Check model')}
            {settingsButton}
          </div>
        </>
      );
      break;
    }
  }

  return (
    <section className="analysis-section model-panel" aria-labelledby={headingId}>
      <div className="analysis-section__header">
        <h3 id={headingId}>Local model summary</h3>
        <span className="kind-label kind-label--model">
          <Cpu size={13} />
          Optional · model-generated
        </span>
      </div>
      {result && (
        <>
          <ModelResultView
            result={result}
            stale={phase.name === 'running'}
            onRevealEvent={onRevealEvent}
          />
          {phase.name !== 'running' && (
            <p className="model-panel__discard">
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setModelResult(storeKey, undefined);
                  setAnnouncement('Summary discarded.');
                }}
              >
                Discard this summary
              </button>
            </p>
          )}
        </>
      )}
      {body}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <ModelSettingsDialog
        open={settingsOpen}
        config={modelConfig}
        onClose={() => setSettingsOpen(false)}
        onSave={(config) => {
          setModelConfig(config);
          setSettingsOpen(false);
          controller.current?.abort();
          setPhase({ name: 'idle' });
        }}
      />
    </section>
  );
}
