import type { JsonValue } from '../../domain/types';

/** The smallest useful run, shown on the import format page. Kept valid by a test. */
export const MINIMAL_RUN: JsonValue = {
  id: 'run-2026-10-24-001',
  agentName: 'my-agent',
  task: 'Look up the order status for order 1042',
  status: 'failed',
  startedAt: '2026-10-24T14:02:11Z',
  endedAt: '2026-10-24T14:02:45Z',
  events: [
    {
      id: 'e1',
      sequence: 1,
      timestamp: '2026-10-24T14:02:12Z',
      kind: 'tool_call',
      status: 'ok',
      toolName: 'orders.lookup',
      callId: 'c1',
      input: { orderId: 1042 },
    },
    {
      id: 'e2',
      sequence: 2,
      timestamp: '2026-10-24T14:02:42Z',
      kind: 'tool_result',
      status: 'error',
      toolName: 'orders.lookup',
      callId: 'c1',
      outcome: 'timeout',
      errorMessage: 'No response after 30 s',
    },
    {
      id: 'e3',
      sequence: 3,
      timestamp: '2026-10-24T14:02:45Z',
      kind: 'error',
      status: 'error',
      errorType: 'ToolTimeoutError',
      message: 'orders.lookup timed out',
      fatal: true,
      callId: 'c1',
    },
  ],
};
