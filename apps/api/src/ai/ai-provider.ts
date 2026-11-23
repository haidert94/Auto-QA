// Interfaz común para proveedores de IA. Cada proveedor recibe un prompt,
// devuelve el texto generado y el consumo real de tokens para que el
// router pueda facturar. Los providers no deciden presupuesto ni modelo
// por defecto — eso vive en ai-router.

export type AiOperation =
  | 'document-analysis'
  | 'scenario-generation'
  | 'failure-explanation'
  | 'document-classification'
  | 'ux-analysis';

export type AiModel =
  | 'claude-haiku-5-5'
  | 'claude-sonnet-5-5'
  | 'gpt-4o-mini'
  | 'gpt-4o'
  | 'rule-based';

export type AiRequest = {
  operation: AiOperation;
  prompt: string;
  systemPrompt?: string;
  maxOutputTokens?: number;
  // Timeout en milisegundos; default 60s.
  timeoutMs?: number;
};

export type AiResponse = {
  text: string;
  model: AiModel;
  inputTokens: number;
  outputTokens: number;
  // Costo estimado en COP; el router lo recalcula al final contra la
  // tarifa vigente, pero el provider sugiere un valor.
  estimatedCostCop: number;
  // Si el provider no está configurado o devuelve un fallback mecánico,
  // este flag deja que el caller sepa que "la IA no habló aquí".
  usedFallback?: boolean;
  fallbackReason?: 'ai-budget-exhausted';
};

export interface AiProvider {
  readonly model: AiModel;
  readonly isConfigured: boolean;
  complete(request: AiRequest): Promise<AiResponse>;
}

// Precios de referencia (USD por millón de tokens) convertidos a COP con
// TRM ~4100. Son aproximados; el proveedor emite factura real. Usamos esto
// solo para enforcement de cuota y mostrar al usuario lo que lleva gastado.
export const PRICING_COP_PER_MTOK: Record<AiModel, { input: number; output: number }> = {
  'claude-haiku-5-5':  { input: 3_280,  output: 16_400 },   // ~USD 0.80/4.00
  'claude-sonnet-5-5': { input: 12_300, output: 61_500 },   // ~USD 3.00/15.00
  'gpt-4o-mini':       { input: 615,    output: 2_460 },    // ~USD 0.15/0.60
  'gpt-4o':            { input: 10_250, output: 41_000 },   // ~USD 2.50/10.00
  'rule-based':        { input: 0,      output: 0 },
};

export function estimateCost(model: AiModel, inputTokens: number, outputTokens: number): number {
  const rates = PRICING_COP_PER_MTOK[model];
  return Math.ceil((inputTokens * rates.input + outputTokens * rates.output) / 1_000_000);
}
