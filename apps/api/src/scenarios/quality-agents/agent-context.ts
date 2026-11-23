import type { AiRouter } from '../../ai/ai-router';

export type UxAgentContext = {
  ai: Pick<AiRouter, 'dispatch'>;
  organizationId: string | null;
  projectId: string;
};

export class QualityReviewRequired extends Error {}

export function nodeTarget(url: URL) {
  const lines = ['const target = new URL(' + JSON.stringify(url.origin + url.pathname) + ');'];
  if (url.search) lines.push(
    'const query = process.env.AUTOQA_TARGET_QUERY;',
    "if (!query?.startsWith('?')) throw new Error('Define AUTOQA_TARGET_QUERY con los parámetros del entorno autorizado.');",
    'target.search = query;',
  );
  if (url.hash) lines.push(
    'const fragment = process.env.AUTOQA_TARGET_FRAGMENT;',
    "if (!fragment?.startsWith('#')) throw new Error('Define AUTOQA_TARGET_FRAGMENT con el fragmento del entorno autorizado.');",
    'target.hash = fragment;',
  );
  return lines;
}
