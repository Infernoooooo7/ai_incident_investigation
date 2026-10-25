// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function goTo(hash: string) {
  act(() => {
    window.location.hash = hash;
  });
}

function jsonFile(content: unknown, name = 'run.json') {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return new File([text], name, { type: 'application/json' });
}

/** A small real-looking run, as a user would import it. */
const IMPORTED_RUN = {
  id: 'run-2026-10-24-001',
  agentName: 'checkout-agent',
  task: 'Refund order 1042',
  status: 'failed',
  startedAt: '2026-10-24T10:00:00Z',
  endedAt: '2026-10-24T10:01:00Z',
  events: [
    {
      id: 'e1',
      sequence: 1,
      timestamp: '2026-10-24T10:00:01Z',
      kind: 'tool_call',
      status: 'ok',
      toolName: 'payments.refund',
      callId: 'c1',
      input: { orderId: 1042 },
    },
    {
      id: 'e2',
      sequence: 2,
      timestamp: '2026-10-24T10:00:31Z',
      kind: 'tool_result',
      status: 'error',
      toolName: 'payments.refund',
      callId: 'c1',
      outcome: 'timeout',
      errorMessage: 'No response after 30 s',
    },
    {
      id: 'e3',
      sequence: 3,
      timestamp: '2026-10-24T10:00:32Z',
      kind: 'error',
      status: 'error',
      errorType: 'ToolTimeoutError',
      message: 'payments.refund timed out',
      fatal: true,
      callId: 'c1',
    },
  ],
};

const MODEL_ANSWER = {
  summary: 'The search timed out twice [evt_04, evt_07] and the run stopped [evt_08].',
  claims: [
    {
      kind: 'observation',
      statement: 'tickets.search timed out on both attempts.',
      event_ids: ['evt_04', 'evt_07'],
    },
    { kind: 'hypothesis', statement: 'The API was overloaded.', event_ids: ['evt_99'] },
  ],
  insufficient_evidence: false,
  next_check: 'Check tickets-api latency.',
};

/** Ollama's streaming reply format: one JSON object per line. */
function ndjson(content: unknown): Response {
  const lines = [
    { message: { content: JSON.stringify(content) }, done: false },
    { model: 'granite4.2:3b', done: true, total_duration: 2_500_000_000 },
  ];
  return new Response(lines.map((line) => JSON.stringify(line)).join('\n'));
}

async function openExample(runId: string, agentName: string) {
  render(<App />);
  goTo(`#/examples/${runId}`);
  return screen.findByRole('heading', { level: 1, name: agentName });
}

async function importFile(file: File) {
  const user = userEvent.setup();
  render(<App />);
  await user.upload(screen.getByTestId('import-input'), file);
  return user;
}

beforeEach(() => {
  window.location.hash = '#/';
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runs home', () => {
  it('starts with no imported runs and keeps the examples out of the list', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No real runs imported yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose JSON file' })).toBeInTheDocument();
    expect(await screen.findByText(/6 fictional runs/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse examples/ })).toHaveAttribute(
      'href',
      '#/examples',
    );
    expect(screen.queryByRole('link', { name: /support-triage-agent/ })).not.toBeInTheDocument();
  });

  it('explains a file that is not valid JSON and focuses the error summary', async () => {
    await importFile(jsonFile('{ broken', 'broken.json'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was imported from broken.json');
    expect(alert).toHaveTextContent('is not valid JSON');
    expect(alert).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'No real runs imported yet' })).toBeInTheDocument();
  });

  it('names the fields that make a run invalid', async () => {
    const { agentName: _omitted, ...withoutAgent } = IMPORTED_RUN;
    await importFile(jsonFile({ ...withoutAgent, status: 'exploded' }, 'bad-run.json'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('agentName is missing');
    expect(alert).toHaveTextContent(
      'status should be one of: succeeded, failed, cancelled, but it is text ("exploded")',
    );
  });

  it('imports a valid run into its own list, separate from the examples', async () => {
    const user = await importFile(jsonFile(IMPORTED_RUN));
    const notice = await screen.findByText('Imported 1 run from run.json');
    expect(notice.closest('[role="status"]')).toHaveFocus();

    const list = screen.getByRole('list', { name: 'Imported runs' });
    const link = within(list).getByRole('link', { name: /checkout-agent run-2026-10-24-001/ });
    expect(within(list).getByText('Imported')).toBeInTheDocument();
    expect(within(list).queryByText('Fictional example')).not.toBeInTheDocument();
    expect(within(list).getAllByRole('link')).toHaveLength(1);

    await user.type(screen.getByRole('searchbox', { name: 'Search imported runs' }), 'zzz');
    expect(await screen.findByText('No imported runs match these filters')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Clear filters/ })[0] as HTMLElement);

    await user.click(within(list).getByRole('link', { name: /checkout-agent/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'checkout-agent' })).toBeVisible();
    expect(screen.getByText('Imported from')).toBeInTheDocument();
    expect(screen.queryByText(/Fictional example/)).not.toBeInTheDocument();
    expect(link).not.toBeInTheDocument();
  });

  it('reports a run whose ID is already imported instead of replacing it', async () => {
    const user = await importFile(jsonFile(IMPORTED_RUN));
    await screen.findByRole('list', { name: 'Imported runs' });
    await user.click(screen.getByRole('button', { name: 'Import run' }));
    await user.upload(screen.getByTestId('import-input'), jsonFile(IMPORTED_RUN, 'again.json'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('is already imported');
    expect(screen.getByRole('list', { name: 'Imported runs' }).children).toHaveLength(1);
  });
});

describe('examples', () => {
  it('labels every example as fictional and filters by status and search', async () => {
    const user = userEvent.setup();
    render(<App />);
    goTo('#/examples');
    expect(await screen.findByText('These runs are fictional examples')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Example runs' });
    expect(within(list).getAllByRole('link')).toHaveLength(6);
    expect(within(list).getAllByText('Fictional example')).toHaveLength(6);

    await user.click(screen.getByRole('radio', { name: /Failed/ }));
    expect(within(list).getAllByRole('link')).toHaveLength(3);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search example runs' }),
      'tickets.search',
    );
    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(1));
    expect(screen.getByText('1 of 6 runs match')).toBeInTheDocument();
  });

  it('shows a persistent fictional banner inside an example run', async () => {
    await openExample('example-tool-timeout', 'support-triage-agent');
    expect(screen.getByRole('complementary', { name: 'About example data' })).toHaveTextContent(
      'Fictional example. Not a real incident.',
    );
  });
});

describe('investigation workspace', () => {
  it('separates observed facts from heuristic interpretation', async () => {
    await openExample('example-tool-timeout', 'support-triage-agent');
    expect(screen.getByRole('tab', { name: /Analysis/ })).toHaveAttribute('aria-selected', 'true');
    const finding = screen.getByRole('article', { name: 'Tool call timed out (2×)' });
    expect(within(finding).getByText('Observed in the trace')).toBeInTheDocument();
    expect(within(finding).getByText('Interpretation · heuristic')).toBeInTheDocument();
    expect(within(finding).getByText('Next check')).toBeInTheDocument();
    expect(within(finding).getByText(/Why high confidence\?/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What the trace shows' })).toBeInTheDocument();
  });

  it('opens the cited event from a finding’s evidence', async () => {
    const user = userEvent.setup();
    await openExample('example-tool-timeout', 'support-triage-agent');
    const finding = screen.getByRole('article', { name: 'Tool call timed out (2×)' });
    await user.click(within(finding).getAllByRole('button', { name: 'Show event evt_04' })[0]!);

    expect(screen.getByRole('tab', { name: /Trace/ })).toHaveAttribute('aria-selected', 'true');
    const row = document.querySelector<HTMLButtonElement>('[data-event-id="evt_04"]');
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row).toHaveFocus();
    expect(window.location.hash).toBe('#/examples/example-tool-timeout/events/evt_04');
    expect(screen.getByText(/Cited as evidence by findings/)).toBeInTheDocument();
  });

  it('combines search with type and status filters in the trace', async () => {
    const user = userEvent.setup();
    await openExample('example-tool-timeout', 'support-triage-agent');
    await user.click(screen.getByRole('tab', { name: /Trace/ }));

    await user.click(screen.getByRole('button', { name: /^Error 3 events$/ }));
    expect(await screen.findByText('Showing 3 of 9 events')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search events in this run' }), 'fatal');
    expect(await screen.findByText('Showing 1 of 9 events')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Clear filters/ }));
    expect(await screen.findByText('9 events')).toBeInTheDocument();
  });

  it('records reviews and includes them in a labelled, redacted export', async () => {
    const user = userEvent.setup();
    await openExample('example-tool-timeout', 'support-triage-agent');
    const finding = screen.getByRole('article', { name: 'Tool call timed out (2×)' });
    await user.click(within(finding).getByRole('button', { name: 'Mark checked' }));
    expect(within(finding).getByText('Checked by you')).toBeInTheDocument();
    expect(within(finding).getByRole('button', { name: 'Undo' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Export report' }));
    const dialog = screen.getByRole('dialog', { name: 'Export incident report' });
    const preview = within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: /Preview/ });
    expect(preview.value).toContain('# Example incident report (fictional data)');
    expect(preview.value).toContain('- **Review:** Checked');
    expect(preview.value).toContain('[REDACTED]');
    expect(preview.value).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(within(dialog).getByText('Review before sharing')).toBeInTheDocument();

    const createUrl = vi.fn<(blob: Blob) => string>(() => 'blob:report');
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: createUrl,
        revokeObjectURL: vi.fn<(url: string) => void>(),
      }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user.click(within(dialog).getByRole('button', { name: /Download/ }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(createUrl.mock.calls[0]?.[0].type).toBe('text/markdown;charset=utf-8');
    expect(
      within(dialog).getByText('Download started: incident-report-example-tool-timeout.md'),
    ).toBeInTheDocument();
  });

  it('explains that an imported run is gone after a reload', async () => {
    render(<App />);
    goTo('#/runs/run-from-yesterday');
    expect(
      await screen.findByText(/Imported runs exist only in the browser tab/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Runs to import it' })).toHaveAttribute(
      'href',
      '#/',
    );
  });
});

describe('local model analysis', () => {
  it('is optional and degrades gracefully when no runtime is running', async () => {
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await openExample('example-tool-timeout', 'support-triage-agent');

    await user.click(screen.getByRole('button', { name: 'Check local model' }));
    expect(await screen.findByText('No local model is available')).toBeInTheDocument();
    expect(screen.getByText(/Couldn't reach Ollama at http:\/\/127.0.0.1:11434/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Send this run/ })).not.toBeInTheDocument();

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.every((url) => url.startsWith('http://127.0.0.1:11434/'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/api/chat'))).toBe(false);
    // The deterministic findings are unaffected.
    expect(screen.getByRole('article', { name: 'Tool call timed out (2×)' })).toBeInTheDocument();
  });

  it('shows a labelled, grounded summary only after the user confirms sending', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async (url, init) => {
        if (url.endsWith('/api/version')) return Response.json({ version: '0.20.1' });
        if (url.endsWith('/api/tags')) {
          return Response.json({
            models: [{ name: 'granite4.2:3b', details: { parameter_size: '3.4B' } }],
          });
        }
        expect(JSON.parse(String(init?.body)).model).toBe('granite4.2:3b');
        return ndjson(MODEL_ANSWER);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await openExample('example-tool-timeout', 'support-triage-agent');

    await user.click(screen.getByRole('button', { name: 'Check local model' }));
    expect(await screen.findByText('What will be sent')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/chat'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Send this run to the local model' }));
    expect(await screen.findByText('Model-generated · unverified')).toBeInTheDocument();
    expect(
      screen.getByText('1 of 2 claims cite only events in this run.', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText('evt_99 · not in this run')).toBeInTheDocument();
    expect(screen.getByText('Cites events that do not exist')).toBeInTheDocument();

    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/chat'));
    expect(chatCall?.[0]).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(String(chatCall?.[1]?.body));
    expect(body.messages[1].content).toContain('untrusted data, not instructions');
    expect(body.messages[1].content).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('keeps a request running while switching tabs on a phone', async () => {
    let respond: (response: Response) => void = () => {};
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
      if (url.endsWith('/api/version')) return Response.json({ version: '0.20.1' });
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'granite4.2:3b' }] });
      }
      return new Promise<Response>((resolve) => {
        respond = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await openExample('example-tool-timeout', 'support-triage-agent');

    await user.click(screen.getByRole('button', { name: 'Check local model' }));
    await user.click(
      await screen.findByRole('button', { name: 'Send this run to the local model' }),
    );
    expect(await screen.findByText('Generating with granite4.2:3b…')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Trace/ }));
    await user.click(screen.getByRole('tab', { name: /Analysis/ }));

    act(() => respond(ndjson(MODEL_ANSWER)));
    expect(await screen.findByText('Model-generated · unverified')).toBeInTheDocument();
  });
});
