// Cliente directo de OpenAI Chat Completions sin SDK. Docs:
// https://platform.openai.com/docs/api-reference/chat.

import type { AiModel, AiProvider, AiRequest, AiResponse } from './ai-provider';
import { estimateCost } from './ai-provider';

export class OpenAiProvider implements AiProvider {
  readonly model: AiModel;
  readonly isConfigured: boolean;

  constructor(model: AiModel = 'gpt-4o-mini', private readonly apiKey: string = process.env.AUTOQA_OPENAI_API_KEY ?? '') {
    this.model = model;
    this.isConfigured = this.apiKey.length > 0;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    if (!this.isConfigured) {
      throw new Error('AUTOQA_OPENAI_API_KEY no está configurada.');
    }
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.prompt });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.resolveModelId(),
        messages,
        max_tokens: Math.min(Math.max(request.maxOutputTokens ?? 2048, 128), 8192),
      }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 60000),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error('OpenAI API ' + response.status + ': ' + errorText.slice(0, 200));
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = payload.choices?.[0]?.message?.content ?? '';
    const inputTokens = payload.usage?.prompt_tokens ?? 0;
    const outputTokens = payload.usage?.completion_tokens ?? 0;
    return {
      text, model: this.model, inputTokens, outputTokens,
      estimatedCostCop: estimateCost(this.model, inputTokens, outputTokens),
    };
  }

  private resolveModelId(): string {
    switch (this.model) {
      case 'gpt-4o': return 'gpt-4o';
      case 'gpt-4o-mini': return 'gpt-4o-mini';
      default: throw new Error('Modelo no soportado por OpenAiProvider: ' + this.model);
    }
  }
}
