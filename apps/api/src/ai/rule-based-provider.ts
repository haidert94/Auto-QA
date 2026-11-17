// Fallback sin IA. Devuelve un mensaje genérico para que el flujo no se
// rompa cuando la organización no tiene plan con IA o no hay API key
// configurada. El flag `usedFallback` deja que la UI sepa que no se
// consultó un modelo real.

import type { AiProvider, AiRequest, AiResponse } from './ai-provider';

const RESPONSES: Record<string, string> = {
  'document-analysis': 'Análisis por reglas aplicado. Para análisis semántico asistido con IA, actualiza al plan Professional o superior.',
  'scenario-generation': 'No se generaron escenarios automáticamente. La generación con IA requiere plan Professional o superior.',
  'failure-explanation': 'El trace está disponible para descargar. La explicación automática requiere plan Professional o superior.',
  'document-classification': 'Clasificación por reglas aplicada. La clasificación asistida con IA requiere plan Professional o superior.',
  'ux-analysis': 'El análisis UX asistido requiere plan Professional o superior. Revisa manualmente la usabilidad y accesibilidad.',
};

export class RuleBasedProvider implements AiProvider {
  readonly model = 'rule-based' as const;
  readonly isConfigured = true;

  async complete(request: AiRequest): Promise<AiResponse> {
    return {
      text: RESPONSES[request.operation] ?? 'Operación no cubierta por el fallback sin IA.',
      model: 'rule-based',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostCop: 0,
      usedFallback: true,
    };
  }
}
