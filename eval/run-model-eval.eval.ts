/**
 * Live evaluation of the optional local-model summary.
 *
 *   npm run eval:model
 *
 * Requires a running Ollama with the model installed. Configure with
 * EVAL_OLLAMA_URL (default http://127.0.0.1:11434) and EVAL_MODEL (default
 * granite4.2:3b). Only loopback endpoints are accepted. Results are printed and
 * saved to eval/results/ only when the model actually answered; otherwise the
 * run reports that no measurements were produced.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRun } from '../src/data/validate';
import { DEFAULT_MODEL_CONFIG, validateConfig } from '../src/model/config';
import { EVAL_FIXTURES } from '../src/model/eval/fixtures';
import { formatEvalReport, scoreFixture } from '../src/model/eval/score';
import type { FixtureScore } from '../src/model/eval/score';
import { ModelError, probeRuntime } from '../src/model/ollama';
import { summarizeRun } from '../src/model/summarize';

describe('local model evaluation', () => {
  it('summarizes every fixture with the configured local model', async () => {
    const checked = validateConfig({
      ...DEFAULT_MODEL_CONFIG,
      endpoint: process.env.EVAL_OLLAMA_URL ?? DEFAULT_MODEL_CONFIG.endpoint,
      model: process.env.EVAL_MODEL ?? DEFAULT_MODEL_CONFIG.model,
      timeoutMs: 600_000,
    });
    if (!checked.ok) throw new Error(checked.reason);
    const config = checked.value;

    const status = await probeRuntime(config);
    if (status.state !== 'ready') {
      console.log(
        `\nLocal model evaluation skipped: ${status.message}\nNo measurements were produced.\n`,
      );
      return;
    }

    const scores: FixtureScore[] = [];
    for (const fixture of EVAL_FIXTURES) {
      const parsed = parseRun(await fixture.load());
      if (!parsed.ok) throw new Error(`Fixture ${fixture.id} is not a valid run.`);
      try {
        const result = await summarizeRun(parsed.run, config);
        scores.push(scoreFixture(fixture, { ok: true, summary: result.summary }));
      } catch (error) {
        const message =
          error instanceof ModelError ? `${error.kind}: ${error.message}` : String(error);
        scores.push(scoreFixture(fixture, { ok: false, error: message }));
      }
    }

    const date = new Date().toISOString();
    const report = formatEvalReport(scores, {
      model: config.model,
      ...(status.version && { runtimeVersion: status.version }),
      date,
    });
    console.log(`\n${report}`);
    mkdirSync('eval/results', { recursive: true });
    const file = `eval/results/${date.slice(0, 10)}-${config.model.replace(/[^A-Za-z0-9._-]+/g, '_')}.md`;
    writeFileSync(file, report);
    console.log(`Saved ${file}`);
    expect(scores).toHaveLength(EVAL_FIXTURES.length);
  });
});
