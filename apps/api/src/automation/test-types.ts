// Mapa canónico de tipos de prueba seleccionables en el pipeline de
// automatización. Cada tipo requiere una capability específica del plan
// — el servicio lo valida al aceptar la selección.

import type { CapabilityCode } from '@prisma/client';

export type AutomationTestType =
  | 'functional_web'
  | 'mobile_emulated'
  | 'compatibility'
  | 'availability'
  | 'performance'
  | 'ux'
  | 'manual';

export const TEST_TYPE_META: Record<AutomationTestType, {
  label: string;
  description: string;
  capability: CapabilityCode;
}> = {
  functional_web: {
    label: 'Funcional web',
    description: 'Casos funcionales ejecutables por Playwright y comprobaciones que requieren revisión manual.',
    capability: 'BROWSER_TESTS',
  },
  mobile_emulated: {
    label: 'Mobile emulado',
    description: 'Casos para navegadores móviles emulados y comprobaciones que requieren revisión manual.',
    capability: 'RESPONSIVE_TESTS',
  },
  compatibility: {
    label: 'Compatibilidad cross-browser',
    description: 'Mismos casos ejecutados en Chromium + Firefox + WebKit.',
    capability: 'CROSS_BROWSER',
  },
  availability: {
    label: 'Disponibilidad / uptime',
    description: 'Monitores HTTP continuos con alertas por correo.',
    capability: 'UPTIME_MONITORS',
  },
  performance: {
    label: 'Performance',
    description: 'Auditorías Lighthouse + pruebas de carga k6 sobre URLs clave.',
    capability: 'LIGHTHOUSE_AUDITS',
  },
  ux: {
    label: 'Análisis UX (IA)',
    description: 'Revisión asistida de usabilidad y accesibilidad con heurísticas Nielsen + WCAG básico.',
    capability: 'UX_ANALYSIS',
  },
  manual: {
    // Casos ejecutados por una persona. No pasan por el agente ni por
    // Playwright: la evidencia (imágenes y estado final) se carga desde
    // Reporte. Reusa BROWSER_TESTS porque todos los planes incluyen la
    // posibilidad de registrar ejecuciones manuales.
    label: 'Casos manuales',
    description: 'Escenarios que ejecuta una persona y registran evidencia (imágenes y estado) desde la pestaña Reporte.',
    capability: 'BROWSER_TESTS',
  },
};

export const ALL_TEST_TYPES: AutomationTestType[] = Object.keys(TEST_TYPE_META) as AutomationTestType[];

export function isTestType(value: string): value is AutomationTestType {
  return (ALL_TEST_TYPES as string[]).includes(value);
}
