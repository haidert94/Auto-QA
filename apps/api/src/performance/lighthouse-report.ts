// Parseo puro del reporte JSON de Lighthouse. Separado del runner para
// poder cubrirlo con tests sin instalar Chromium.

export const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

export type LighthouseMetrics = {
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  fcpMs: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  siMs: number | null;
};

function scoreToInt(value: unknown): number | null {
  // Lighthouse devuelve scores 0..1 o null.
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;
}

function numericValue(audits: Record<string, unknown>, key: string): number | null {
  const audit = audits[key] as { numericValue?: unknown } | undefined;
  if (!audit || typeof audit.numericValue !== 'number' || !Number.isFinite(audit.numericValue)) return null;
  return audit.numericValue;
}

function intValue(audits: Record<string, unknown>, key: string): number | null {
  const value = numericValue(audits, key);
  return value === null ? null : Math.round(value);
}

// Lighthouse 10+ guarda los scores en report.categories.<cat>.score (0..1).
// Las métricas (FCP, LCP, TBT, CLS, SI) viven en report.audits.<id>.numericValue.
// CLS es adimensional (float), el resto son milisegundos.
export function parseLighthouseReport(raw: unknown): LighthouseMetrics {
  const report = (raw ?? {}) as { categories?: Record<string, { score?: unknown }>; audits?: Record<string, unknown> };
  const categories = report.categories ?? {};
  const audits = report.audits ?? {};
  return {
    performanceScore: scoreToInt(categories['performance']?.score),
    accessibilityScore: scoreToInt(categories['accessibility']?.score),
    bestPracticesScore: scoreToInt(categories['best-practices']?.score),
    seoScore: scoreToInt(categories['seo']?.score),
    fcpMs: intValue(audits, 'first-contentful-paint'),
    lcpMs: intValue(audits, 'largest-contentful-paint'),
    tbtMs: intValue(audits, 'total-blocking-time'),
    cls: numericValue(audits, 'cumulative-layout-shift'),
    siMs: intValue(audits, 'speed-index'),
  };
}
