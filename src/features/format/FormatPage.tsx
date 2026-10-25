import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { JsonBlock } from '../../components/CodeBlock';
import { MAX_EVENTS_PER_RUN } from '../../data/validate';
import { useDocumentTitle } from '../../lib/hooks';
import { SampleDownloadButton } from '../runs/SampleDownload';
import { MINIMAL_RUN } from './minimalRun';

interface Field {
  name: string;
  type: ReactNode;
  required?: boolean;
  description: ReactNode;
}

const c = (text: string) => <code className="inline-code">{text}</code>;

const RUN_FIELDS: Field[] = [
  { name: 'id', type: 'text', required: true, description: 'Unique ID of the run.' },
  { name: 'agentName', type: 'text', required: true, description: 'Name of the agent.' },
  { name: 'agentVersion', type: 'text', description: 'Version or build of the agent.' },
  { name: 'task', type: 'text', required: true, description: 'What the agent was asked to do.' },
  { name: 'summary', type: 'text', description: 'One-line outcome, shown on the run card.' },
  {
    name: 'status',
    type: (
      <>
        {c('succeeded')}, {c('failed')}, or {c('cancelled')}
      </>
    ),
    required: true,
    description: 'How the run ended, as reported by the agent.',
  },
  {
    name: 'startedAt, endedAt',
    type: 'date and time',
    required: true,
    description: <>ISO 8601 with a timezone, for example {c('2026-10-24T14:02:11Z')}.</>,
  },
  { name: 'metadata', type: 'object', description: 'Any extra key-value pairs.' },
  {
    name: 'events',
    type: 'list of events',
    required: true,
    description: `Up to ${MAX_EVENTS_PER_RUN.toLocaleString('en-US')} events, ordered by sequence.`,
  },
];

const EVENT_FIELDS: Field[] = [
  { name: 'id', type: 'text', required: true, description: 'Unique within the run.' },
  {
    name: 'sequence',
    type: 'whole number',
    required: true,
    description: 'Position in the run. Events are sorted by it.',
  },
  {
    name: 'timestamp',
    type: 'date and time',
    required: true,
    description: 'When the event was recorded, with a timezone.',
  },
  {
    name: 'kind',
    type: 'one of the kinds below',
    required: true,
    description: 'Decides which other fields are expected.',
  },
  {
    name: 'status',
    type: (
      <>
        {c('ok')}, {c('warning')}, or {c('error')}
      </>
    ),
    required: true,
    description: 'Severity as reported by the producer.',
  },
  { name: 'name', type: 'text', description: 'Optional label, such as "Plan".' },
  { name: 'durationMs', type: 'number', description: 'How long the step took, if measured.' },
  { name: 'input, output', type: 'any JSON', description: 'Recorded payloads.' },
  { name: 'metadata', type: 'object', description: 'Any extra key-value pairs.' },
];

const KINDS: Array<{ kind: string; fields: ReactNode }> = [
  {
    kind: 'agent_message',
    fields: (
      <>
        {c('role')} ({c('user')}, {c('assistant')}, {c('system')}), {c('text')}
      </>
    ),
  },
  {
    kind: 'tool_call',
    fields: (
      <>
        {c('toolName')}, {c('callId')}
      </>
    ),
  },
  {
    kind: 'tool_result',
    fields: (
      <>
        {c('toolName')}, {c('callId')}, {c('outcome')} ({c('success')}, {c('error')}, {c('timeout')}
        ); optional {c('errorCode')}, {c('errorMessage')}
      </>
    ),
  },
  {
    kind: 'retry',
    fields: (
      <>
        {c('attempt')}, {c('reason')}; optional {c('maxAttempts')}, {c('toolName')},{' '}
        {c('previousCallId')}, {c('backoffMs')}
      </>
    ),
  },
  {
    kind: 'error',
    fields: (
      <>
        {c('errorType')}, {c('message')}, {c('fatal')} (true or false); optional {c('callId')}
      </>
    ),
  },
  {
    kind: 'permission_decision',
    fields: (
      <>
        {c('toolName')}, {c('action')}, {c('decision')} ({c('allowed')}, {c('denied')}),{' '}
        {c('decidedBy')} ({c('policy')}, {c('user')}); optional {c('policy')}, {c('reason')},{' '}
        {c('callId')}
      </>
    ),
  },
];

function FieldTable({ caption, fields }: { caption: string; fields: Field[] }) {
  return (
    <div className="table-scroll">
      <table className="field-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name}>
              <th scope="row">
                <code>{field.name}</code>
                {field.required && <span className="field-table__required">required</span>}
              </th>
              <td>{field.type}</td>
              <td>{field.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FormatPage() {
  useDocumentTitle('Import format · Agent Incident Investigator');
  return (
    <div className="page page--format">
      <header className="page-header">
        <div className="page-header__text">
          <h1 tabIndex={-1}>Import format</h1>
          <p className="page-header__lede">
            A run is one JSON object with a list of events. A file can hold one run, a list of runs,
            or an object with a {c('runs')} list, up to 5 MB.
          </p>
        </div>
        <div className="page-header__actions">
          <SampleDownloadButton />
        </div>
      </header>

      <div className="prose-grid">
        <section className="prose-section" aria-labelledby="format-minimal">
          <h2 id="format-minimal">Smallest useful run</h2>
          <p>
            Three events: a tool call, its timed-out result, and the error that stopped the run.
            Tool calls and their results share a {c('callId')}, which is how the trace connects
            them.
          </p>
          <JsonBlock value={MINIMAL_RUN} label="example run JSON" />
        </section>

        <section className="prose-section" aria-labelledby="format-validation">
          <h2 id="format-validation">How validation works</h2>
          <ul className="bullet-list">
            <li>
              Problems with the run itself (a missing {c('id')}, an unknown {c('status')}) reject
              that run, with a message naming the field.
            </li>
            <li>
              An invalid event is left out and listed on the run page with its original record; the
              rest of the run still loads. Findings that depend on a missing event get lower
              confidence.
            </li>
            <li>
              Timestamps need a date, a time, and a timezone. {c('22:19:44')} on its own is
              rejected.
            </li>
            <li>A run whose ID is already imported is reported instead of replacing it.</li>
            <li>Text is always shown as text. Values are never interpreted as HTML or executed.</li>
          </ul>
          <p className="privacy-note">
            <Lock size={14} />
            Files are read in this browser tab. Nothing is uploaded, and imports are cleared when
            the tab closes.
          </p>
        </section>
      </div>

      <section className="prose-section" aria-labelledby="format-run">
        <h2 id="format-run">Run fields</h2>
        <FieldTable caption="Fields of a run object" fields={RUN_FIELDS} />
      </section>

      <section className="prose-section" aria-labelledby="format-event">
        <h2 id="format-event">Event fields</h2>
        <FieldTable caption="Fields shared by every event" fields={EVENT_FIELDS} />
        <div className="table-scroll">
          <table className="field-table">
            <caption>Extra fields for each event kind</caption>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Fields</th>
              </tr>
            </thead>
            <tbody>
              {KINDS.map(({ kind, fields }) => (
                <tr key={kind}>
                  <th scope="row">
                    <code>{kind}</code>
                  </th>
                  <td>{fields}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="prose-section" aria-labelledby="format-source">
        <h2 id="format-source">Getting runs out of your agent</h2>
        <p>
          There is no live connection to an agent framework yet. To investigate a real run, export
          its trace and convert it to this format, for example with a small script over your
          framework&apos;s logs or OpenTelemetry spans. The project README describes what a direct
          integration would need.
        </p>
      </section>
    </div>
  );
}
