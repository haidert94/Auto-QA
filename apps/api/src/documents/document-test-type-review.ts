import type { DocumentFormat } from '@prisma/client';
import { sourceBlocksToMarkdown } from '../automation/document-converter';
import { ALL_TEST_TYPES, type AutomationTestType } from '../automation/test-types';
import { parseDocument } from './document-files';

// Revisa el Markdown en el servidor. Cada marca requiere una señal concreta
// y puede corregirse desde «Aplica a» sin alterar la validación documental.
const evidence: Record<AutomationTestType, RegExp> = {
  functional_web: /\b(?:rf|fr|hu|us)[ -]\d+\b|\b(?:historias? de usuario|user stories|user story|requisitos? funcional(?:es)?|functional requirements?|flujos? (?:de usuario|funcional(?:es)?)|inici[oa]r? sesion|inicio de sesion|autenticacion|checkout|shopping cart)\b/,
  mobile_emulated: /\b(?:responsive|responsiv[oa]|diseno adaptativo|mobile emulado|emulacion movil|navegadores? movil(?:es)?|mobile browsers?|mobile emulation|vista movil|pantallas? (?:movil(?:es)?|pequenas?))\b/,
  compatibility: /\b(?:cross browser|crossbrowser|compatibilidad (?:entre|con|de) navegadores|compatibilidad (?:web|cross browser)|(?:otros|varios|distintos|multiples) navegadores|browser compatibility|(?:chromium|chrome|firefox|webkit|safari)\s*(?:,|\/|y|and)\s*(?:chromium|chrome|firefox|webkit|safari))\b/,
  availability: /\b(?:uptime|availability sla|monitoreo http|monitorizacion http|health ?check|disponibilidad (?:del servicio|del sitio|de la aplicacion|mensual)|(?:sla|slo) de disponibilidad)\b/,
  performance: /\b(?:rendimiento|performance|latencia|tiempos? de (?:carga|respuesta)|pruebas? de (?:carga|estres)|core web vitals|lighthouse|lcp|ttfb|p95|p99|load testing|response times?)\b|\b(?:carg[ae]r?|respond[ae]r?) en menos de \d+(?:[.,]\d+)?\s*(?:ms|segundos?|seconds?)\b/,
  ux: /\b(?:usabilidad|usability|accesibilidad|accessibility|wcag|experiencia (?:de usuario|del usuario)|user experience|heuristicas de nielsen|lectores? de pantalla|screen readers?|navegacion por teclado|contraste de colores|ux)\b/,
  manual: /\b(?:(?:casos?|pruebas?|validacion|verificacion|ejecucion|comprobacion) manual(?:es)?|manual (?:tests?|testing|verification|review)|revision humana|requiere (?:intervencion humana|criterio humano))\b/,
};

export function suggestDocumentTestTypes(markdown: string): AutomationTestType[] {
  const text = markdown.normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase().replace(/[-_\s]+/g, ' ');
  return ALL_TEST_TYPES.filter(type => evidence[type].test(text));
}

export async function reviewDocumentTestTypes(format: DocumentFormat, content: Buffer): Promise<AutomationTestType[]> {
  const blocks = await parseDocument(format, content);
  return suggestDocumentTestTypes(sourceBlocksToMarkdown(blocks));
}
