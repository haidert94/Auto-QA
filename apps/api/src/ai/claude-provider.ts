// Cliente directo de Anthropic sin SDK: fetch nativo con timeout.
// La documentación de la API vive en https://docs.anthropic.com/en/api/messages.

import type { AiModel, AiProvider, AiRequest, AiResponse } from './ai-provider';
import { estimateCost } from './ai-provider';

const ANTHROPIC_VERSION = '2023-06-01';

export class ClaudeProvider implements AiProvider {
  readonly model: AiModel;
  readonly isConfigured: boolean;

  constructor(model: AiModel = 'claude-sonnet-4-5', private readonly apiKey: string = process.env.AUTOQA_ANTHROPIC_API_KEY ?? '') {
    this.model = model;
    this.isConfigured = this.apiKey.length > 0;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    if (!this.isConfigured) {
      throw new Error('AUTOQA_ANTHROPIC_API_KEY no está configurada.');
    }
    const body = {
      model: this.resolveModelId(),
      max_tokens: Math.min(Math.max(request.maxOutputTokens ?? 2048, 128), 8192),
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.prompt }],
    };
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(request.timeoutMs ?? 60000),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error('Claude API ' + response.status + ': ' + errorText.slice(0, 200));
    }
    const payload = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (payload.content ?? [])
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n');
    const inputTokens = payload.usage?.input_tokens ?? 0;
    const outputTokens = payload.usage?.output_tokens ?? 0;
    return {
      text, model: this.model, inputTokens, outputTokens,
      estimatedCostCop: estimateCost(this.model, inputTokens, outputTokens),
    };
  }

  private resolveModelId(): string {
    // Mapeo de los nombres cortos al identificador oficial de Anthropic.
    switch (this.model) {
      case 'claude-haiku-4-5': return 'claude-haiku-4-5-20250929';
      case 'claude-sonnet-4-5': return 'claude-sonnet-4-5-20250929';
      default: throw new Error('Modelo no soportado por ClaudeProvider: ' + this.model);
    }
  }
}
