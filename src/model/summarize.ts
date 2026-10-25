import type { AgentRun } from '../domain/types';
import type { ModelConfig } from './config';
import { chat, ModelError, probeRuntime } from './ollama';
import type { ChatOptions, InstalledModel } from './ollama';
import { parseModelOutput } from './output';
import type { ModelSummary } from './output';
import { buildSummaryPrompt } from './prompt';
import type { PromptDisclosure } from './prompt';

export interface SummaryResult {
  summary: ModelSummary;
  model: InstalledModel;
  runtimeVersion?: string;
  endpoint: string;
  generatedAt: string;
  durationMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  disclosure: PromptDisclosure;
}

/**
 * Summarizes one run with a local model. The runtime is re-checked right
 * before sending so a model that became remote or was removed is never used.
 * The model's answer is validated before it is returned; it is never acted on.
 */
export async function summarizeRun(
  run: AgentRun,
  config: ModelConfig,
  options: ChatOptions = {},
): Promise<SummaryResult> {
  const status = await probeRuntime(config, options);
  if (status.state !== 'ready') {
    throw new ModelError(
      status.state === 'model-missing' || status.state === 'blocked' ? status.state : 'unreachable',
      status.message,
    );
  }

  const prompt = buildSummaryPrompt(run);
  const started = Date.now();
  const reply = await chat(config, prompt, options);
  const parsed = parseModelOutput(reply.content, new Set(run.events.map((event) => event.id)));
  if (!parsed.ok) throw new ModelError('malformed', parsed.reason, reply.content);

  return {
    summary: parsed.value,
    model: status.model,
    ...(status.version && { runtimeVersion: status.version }),
    endpoint: config.endpoint,
    generatedAt: new Date().toISOString(),
    durationMs: reply.totalDurationMs ?? Date.now() - started,
    ...(reply.promptTokens !== undefined && { promptTokens: reply.promptTokens }),
    ...(reply.outputTokens !== undefined && { outputTokens: reply.outputTokens }),
    disclosure: prompt.disclosure,
  };
}
