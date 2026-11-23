/// <reference lib="dom" />

export const UX_VIEWPORT = { width: 1280, height: 720 };
export const UX_NAVIGATION_TIMEOUT_MS = 30_000;

const HEURISTICS = [
  'H1 visibilidad del estado del sistema',
  'H2 lenguaje natural y del usuario',
  'H3 control y libertad',
  'H4 consistencia y estándares',
  'H5 prevención de errores',
  'H6 reconocimiento mejor que recuerdo',
  'H7 flexibilidad y eficiencia',
  'H8 diseño estético y minimalista',
  'H9 ayuda a reconocer errores',
  'H10 ayuda y documentación',
  'WCAG contraste, foco visible, textos alternativos, jerarquía semántica',
];

export const UX_SYSTEM_PROMPT = 'Experto en usabilidad y accesibilidad web. SOLO JSON válido.';

export function summarizeUxDom() {
  const trim = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const pick = (sel: string, max: number) => Array.from(document.querySelectorAll(sel)).slice(0, max);
  return {
    title: document.title,
    lang: document.documentElement.lang,
    headings: pick('h1,h2,h3', 30).map(h => ({ tag: h.tagName.toLowerCase(), text: trim(h.textContent) })),
    buttons: pick('button,[role=button]', 30).map(b => ({ text: trim(b.textContent), aria: (b as HTMLElement).getAttribute('aria-label') })),
    links: pick('a[href]', 30).map(a => ({ text: trim(a.textContent), href: (a as HTMLAnchorElement).href.slice(0, 200) })),
    inputs: pick('input,select,textarea', 30).map(i => ({
      type: (i as HTMLInputElement).type ?? i.tagName.toLowerCase(),
      name: (i as HTMLInputElement).name,
      aria: i.getAttribute('aria-label'),
      placeholder: (i as HTMLInputElement).placeholder,
      hasLabel: !!(i.id && document.querySelector('label[for="' + i.id + '"]')),
    })),
    imagesMissingAlt: pick('img:not([alt])', 10).length,
  };
}

export const UX_PROMPT_START = [
  'Audita la siguiente página web aplicando heurísticas de Nielsen y pautas WCAG básicas.',
  'Heurísticas a considerar:',
  HEURISTICS.map(h => '- ' + h).join('\n'),
  '',
  'URL: ',
].join('\n');

export const UX_PROMPT_DOM = [
  '',
  'Resumen del DOM (encabezados, botones, enlaces, inputs):',
  '',
].join('\n');

export const UX_PROMPT_END = [
  '',
  '',
  'Responde SOLO JSON con el formato:',
  '{ "overallSummary": "...", "findings": [ { "heuristic": "H4", "severity": "critical|major|minor", "summary": "...", "recommendation": "...", "selector": "css opcional" } ] }',
  'Máximo 15 findings. Clasifica severity por impacto real en el usuario.',
].join('\n');

export function buildUxPrompt(url: string, domSummary: unknown) {
  return UX_PROMPT_START + url + '\n' + UX_PROMPT_DOM + JSON.stringify(domSummary).slice(0, 20000) + '\n' + UX_PROMPT_END;
}
