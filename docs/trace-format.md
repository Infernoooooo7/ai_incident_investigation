# Trace import format

Agent Incident Investigator reads runs in its own JSON format. This page is the reference
for anyone producing that JSON, for example with a script over an agent framework's logs.
The same reference, in shorter form, is in the app under **Format**.

Everything is validated in the browser when it is imported (`src/data/validate.ts`).
Nothing is uploaded.

## Files

A file (or pasted text) can contain:

- one run object,
- a JSON array of run objects, or
- an object with a `runs` array.

Limits: 5 MB per file and 20,000 events per run. Each run is validated on its own, so one
invalid run does not block the others in the same file.

## Run

| Field                  | Type                                  | Required | Notes                                         |
| ---------------------- | ------------------------------------- | -------- | --------------------------------------------- |
| `id`                   | text                                  | yes      | Unique among imported runs                    |
| `agentName`            | text                                  | yes      |                                               |
| `agentVersion`         | text                                  | no       |                                               |
| `task`                 | text                                  | yes      | What the agent was asked to do                |
| `summary`              | text                                  | no       | One-line outcome, shown on the run card       |
| `status`               | `succeeded`, `failed`, or `cancelled` | yes      | As reported by the agent                      |
| `startedAt`, `endedAt` | date and time with a timezone         | yes      | ISO 8601, for example `2026-10-24T14:02:11Z`  |
| `metadata`             | object                                | no       | Any JSON. `"example": "…"` marks example data |
| `events`               | list of events                        | yes      | Sorted by `sequence` on import                |

## Event (all kinds)

| Field             | Type                          | Required | Notes                                              |
| ----------------- | ----------------------------- | -------- | -------------------------------------------------- |
| `id`              | text                          | yes      | Unique within the run; findings cite it            |
| `sequence`        | whole number                  | yes      | Position in the run                                |
| `timestamp`       | date and time with a timezone | yes      | When the event was recorded                        |
| `kind`            | see below                     | yes      | Decides which other fields are expected            |
| `status`          | `ok`, `warning`, or `error`   | yes      | Severity as reported by the producer               |
| `name`            | text                          | no       | Label such as "Plan"; replaces the generated title |
| `durationMs`      | number                        | no       | How long the step took, if measured                |
| `input`, `output` | any JSON                      | no       | Recorded payloads                                  |
| `metadata`        | object                        | no       | Any JSON                                           |

## Extra fields by kind

| Kind                  | Required                                                                               | Optional                                                 |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `agent_message`       | `role` (`user`, `assistant`, `system`), `text`                                         |                                                          |
| `tool_call`           | `toolName`, `callId`                                                                   |                                                          |
| `tool_result`         | `toolName`, `callId`, `outcome` (`success`, `error`, `timeout`)                        | `errorCode`, `errorMessage`                              |
| `retry`               | `attempt` (2 for the first retry), `reason`                                            | `maxAttempts`, `toolName`, `previousCallId`, `backoffMs` |
| `error`               | `errorType`, `message`, `fatal` (true or false)                                        | `callId`                                                 |
| `permission_decision` | `toolName`, `action`, `decision` (`allowed`, `denied`), `decidedBy` (`policy`, `user`) | `policy`, `reason`, `callId`                             |

`callId` is what ties a tool call to its result, permission decisions, and errors. A
`retry` points at the failed call with `previousCallId`; the next call to the same tool is
treated as the next attempt.

## Smallest useful run

```json
{
  "id": "run-2026-10-24-001",
  "agentName": "my-agent",
  "task": "Look up the order status for order 1042",
  "status": "failed",
  "startedAt": "2026-10-24T14:02:11Z",
  "endedAt": "2026-10-24T14:02:45Z",
  "events": [
    {
      "id": "e1",
      "sequence": 1,
      "timestamp": "2026-10-24T14:02:12Z",
      "kind": "tool_call",
      "status": "ok",
      "toolName": "orders.lookup",
      "callId": "c1",
      "input": { "orderId": 1042 }
    },
    {
      "id": "e2",
      "sequence": 2,
      "timestamp": "2026-10-24T14:02:42Z",
      "kind": "tool_result",
      "status": "error",
      "toolName": "orders.lookup",
      "callId": "c1",
      "outcome": "timeout",
      "errorMessage": "No response after 30 s"
    },
    {
      "id": "e3",
      "sequence": 3,
      "timestamp": "2026-10-24T14:02:45Z",
      "kind": "error",
      "status": "error",
      "errorType": "ToolTimeoutError",
      "message": "orders.lookup timed out",
      "fatal": true,
      "callId": "c1"
    }
  ]
}
```

This run is kept valid by a unit test (`src/features/format/minimalRun.test.ts`). A larger,
complete example is available from **Download sample JSON** in the app; it is one of the
bundled fictional examples and carries `"metadata": { "example": "…" }`, so it is tagged
"Marked as example data" if you import it.

## Validation behaviour

- **Run-level problems reject the run** and name the field: `agentName is missing`,
  `status should be one of: succeeded, failed, cancelled, but it is text ("exploded")`.
- **Event-level problems skip only that event.** The rest of the run loads, the skipped
  record is listed on the run page with its original JSON, and findings that depend on a
  missing event get lower confidence.
- **Timestamps need a date, a time, and a timezone.** `22:19:44` on its own is rejected.
- **Duplicate event IDs** within a run: the later event is skipped.
- **Duplicate run IDs**: a run whose ID is already imported is reported, not replaced.
- **Warnings** (the run still loads): events outside the run's start and end times,
  repeated sequence numbers, and an end time before the start time.
- **Display:** every value is rendered as text. Nothing in a trace is interpreted as HTML,
  executed, or followed as a link.
