'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { dateText, durationText } from './run-report-data';

export type LighthouseCategory = 'performance' | 'accessibility' | 'bestPractices' | 'seo';

export type LighthouseAudit = {
  performanceScore: number | null; accessibilityScore: number | null;
  bestPracticesScore: number | null; seoScore: number | null;
  lcpMs: number | null; fcpMs: number | null; tbtMs: number | null; cls: number | null;
  completedAt: string | null;
};

type Signal = { criterion: string; weight: number; points: number; missing: string[] };
type IpaDetail = {
  score: number; status: 'ASSESSED' | 'BLOCKED';
  verifiable?: number; ambiguous?: number;
  signals: Signal[];
  documents?: { declared: number; uploaded: number; processed: number; validated: number };
  blockers?: string[]; hints?: string[]; recommendations?: string[];
};

type IcspDimension = { code: string; label: string; value: number; weight: number; numerator: number; denominator: number; description?: string };
type IcspGap = { id: string; label: string; detail?: string };
type IcspDetail = {
  score: number;
  dimensions: IcspDimension[];
  counts: { requirements: number; scenarios: number; runs: number; results: number; passed: number; failed: number };
  window: { days: number; from: string; to: string };
  gaps: { requirementsWithoutScenario: IcspGap[]; scenariosNotExecuted: IcspGap[]; unstableScenarios: IcspGap[] };
};

type Assessment = { id: string; score: number | null; createdAt: string; delta: number | null };

function Shell({ title, onClose, children, extraLink }: { title: string; onClose: () => void; children: React.ReactNode; extraLink?: { href: string; label: string } }) {
  useEffect(() => {
    function esc(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return <div className="quality-detail-overlay" role="dialog" aria-modal="true" aria-label={title}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="quality-detail-panel">
      <header><h3>{title}</h3><button type="button" aria-label="Cerrar" onClick={onClose}><X size={14} /></button></header>
      <div className="quality-detail-body">{children}</div>
      <footer>
        {extraLink && <Link href={extraLink.href} className="quality-detail-link">{extraLink.label}</Link>}
        <button type="button" onClick={onClose}>Cerrar</button>
      </footer>
    </div>
  </div>;
}

export function IpaDetailModal({ projectId, ipa, history, generatedAt, onClose }: {
  projectId: string; ipa: IpaDetail; generatedAt?: string | null; history: Assessment[]; onClose: () => void;
}) {
  return <Shell title="Evaluación IPA y sus fuentes" onClose={onClose}
    extraLink={{ href: `/projects/${projectId}/ipa`, label: 'Abrir página completa →' }}>
    <section>
      <h4>Resumen</h4>
      <dl className="quality-detail-dl">
        <div><dt>Puntaje</dt><dd>{ipa.score} / 100</dd></div>
        <div><dt>Estado</dt><dd>{ipa.status === 'ASSESSED' ? 'Evaluado' : 'Bloqueado'}</dd></div>
        {typeof ipa.verifiable === 'number' && <div><dt>Requisitos verificables</dt><dd>{ipa.verifiable}</dd></div>}
        {typeof ipa.ambiguous === 'number' && <div><dt>Ambiguos / pendientes</dt><dd>{ipa.ambiguous}</dd></div>}
        {generatedAt && <div><dt>Evaluado</dt><dd>{dateText(generatedAt)}</dd></div>}
      </dl>
    </section>
    <section>
      <h4>Dimensiones ({ipa.signals.length})</h4>
      <ol className="quality-detail-list">{ipa.signals.map((signal, i) => <li key={i}>
        <div><strong>{i + 1}. {signal.criterion}</strong>
          <span>{signal.weight > 0 ? `${Math.round(100 * signal.points / signal.weight)}%` : 'No aplica'} ({signal.points}/{signal.weight})</span></div>
        {signal.missing.length > 0 && <p>Pendiente: {signal.missing.join(' · ')}</p>}
      </li>)}</ol>
    </section>
    {ipa.documents && <section>
      <h4>Documentos</h4>
      <dl className="quality-detail-dl">
        <div><dt>Declarados</dt><dd>{ipa.documents.declared}</dd></div>
        <div><dt>Cargados</dt><dd>{ipa.documents.uploaded}</dd></div>
        <div><dt>Procesados</dt><dd>{ipa.documents.processed}</dd></div>
        <div><dt>Validados</dt><dd>{ipa.documents.validated}</dd></div>
      </dl>
    </section>}
    {ipa.blockers && ipa.blockers.length > 0 && <section>
      <h4>Bloqueos</h4>
      <ul className="quality-detail-bullets">{ipa.blockers.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </section>}
    {ipa.recommendations && ipa.recommendations.length > 0 && <section>
      <h4>Recomendaciones</h4>
      <ul className="quality-detail-bullets">{ipa.recommendations.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </section>}
    {history.length > 0 && <section>
      <h4>Histórico</h4>
      <ol className="quality-detail-history">{history.slice(0, 10).map(item => <li key={item.id}>
        <strong>{item.score ?? '—'}</strong><span>{dateText(item.createdAt)}</span>
        <small>{item.delta === null ? 'Sin comparación' : item.delta > 0 ? `+${item.delta}` : item.delta}</small>
      </li>)}</ol>
    </section>}
  </Shell>;
}

const LIGHTHOUSE_META: Record<LighthouseCategory, {
  label: string; scoreKey: 'performanceScore' | 'accessibilityScore' | 'bestPracticesScore' | 'seoScore';
  description: string;
  thresholds: Array<{ label: string; range: string; tone: 'good' | 'warn' | 'poor' }>;
  tips: string[];
}> = {
  performance: {
    label: 'Performance',
    scoreKey: 'performanceScore',
    description: 'Velocidad de carga e interactividad percibida por el usuario. Mide cuánto tarda el sitio en ser visible y responder.',
    thresholds: [
      { label: 'Excelente', range: '90–100', tone: 'good' },
      { label: 'A mejorar', range: '50–89', tone: 'warn' },
      { label: 'Bajo', range: '0–49', tone: 'poor' },
    ],
    tips: [
      'LCP (Largest Contentful Paint) ideal < 2.5 s.',
      'TBT (Total Blocking Time) ideal < 200 ms.',
      'CLS (Cumulative Layout Shift) ideal < 0.1.',
      'Optimiza imágenes (formato moderno, lazy loading, tamaños correctos) y reduce el JS que bloquea el render.',
    ],
  },
  accessibility: {
    label: 'Accesibilidad',
    scoreKey: 'accessibilityScore',
    description: 'Qué tan usable es el sitio para personas con discapacidades: contraste, lectores de pantalla, navegación por teclado y etiquetas ARIA.',
    thresholds: [
      { label: 'Excelente', range: '90–100', tone: 'good' },
      { label: 'A mejorar', range: '50–89', tone: 'warn' },
      { label: 'Bajo', range: '0–49', tone: 'poor' },
    ],
    tips: [
      'Asegura contraste suficiente entre texto y fondo (WCAG AA ≥ 4.5:1).',
      'Añade atributos alt descriptivos a las imágenes.',
      'Usa roles y labels ARIA para elementos interactivos.',
      'El orden de tabulación con el teclado debe seguir el flujo visual.',
    ],
  },
  bestPractices: {
    label: 'Buenas prácticas',
    scoreKey: 'bestPracticesScore',
    description: 'Cumplimiento de estándares web modernos: seguridad, consola sin errores, uso correcto de APIs del navegador.',
    thresholds: [
      { label: 'Excelente', range: '90–100', tone: 'good' },
      { label: 'A mejorar', range: '50–89', tone: 'warn' },
      { label: 'Bajo', range: '0–49', tone: 'poor' },
    ],
    tips: [
      'HTTPS obligatorio en toda la navegación.',
      'Elimina errores y warnings en la consola del navegador.',
      'Declara el ancho correcto en imágenes para evitar reflow.',
      'Evita librerías con vulnerabilidades conocidas (npm audit).',
    ],
  },
  seo: {
    label: 'SEO',
    scoreKey: 'seoScore',
    description: 'Qué tan bien pueden los motores de búsqueda entender e indexar el sitio.',
    thresholds: [
      { label: 'Excelente', range: '90–100', tone: 'good' },
      { label: 'A mejorar', range: '50–89', tone: 'warn' },
      { label: 'Bajo', range: '0–49', tone: 'poor' },
    ],
    tips: [
      'Cada página con título único, meta descripción y <h1>.',
      'Declara un robots.txt y un sitemap.xml accesibles.',
      'URLs legibles, canonicals correctos.',
      'Añade open-graph y Twitter cards para compartir en redes.',
      'Datos estructurados (schema.org) donde aplique.',
    ],
  },
};

function scoreTone(score: number | null): 'good' | 'warn' | 'poor' | 'empty' {
  if (score === null) return 'empty';
  if (score >= 90) return 'good';
  if (score >= 50) return 'warn';
  return 'poor';
}

export function LighthouseDetailModal({ projectId, category, audit, onClose }: {
  projectId: string; category: LighthouseCategory; audit: LighthouseAudit; onClose: () => void;
}) {
  const meta = LIGHTHOUSE_META[category];
  const score = audit[meta.scoreKey];
  const tone = scoreTone(score);
  const toneLabel = tone === 'good' ? 'Excelente' : tone === 'warn' ? 'A mejorar' : tone === 'poor' ? 'Bajo' : 'Sin dato';
  return <Shell title={`Lighthouse · ${meta.label}`} onClose={onClose}
    extraLink={{ href: `/projects/${projectId}/performance`, label: 'Ver auditorías y configuración →' }}>
    <section>
      <h4>Puntaje</h4>
      <div className={`quality-detail-score is-${tone}`}>
        <strong>{score ?? '—'}</strong><span>/ 100</span>
        <em>{toneLabel}</em>
      </div>
      <p>{meta.description}</p>
      {audit.completedAt && <small className="muted">Evaluado: {dateText(audit.completedAt)}</small>}
    </section>
    <section>
      <h4>Rangos de referencia</h4>
      <ol className="quality-detail-list">{meta.thresholds.map(t => <li key={t.label} className={`is-${t.tone}`}>
        <div><strong>{t.label}</strong><span>{t.range}</span></div>
      </li>)}</ol>
    </section>
    {category === 'performance' && <section>
      <h4>Métricas de esta auditoría</h4>
      <dl className="quality-detail-dl">
        <div><dt>LCP · Carga principal</dt><dd>{durationText(audit.lcpMs)}</dd></div>
        <div><dt>FCP · Primer contenido</dt><dd>{durationText(audit.fcpMs)}</dd></div>
        <div><dt>TBT · Bloqueo total</dt><dd>{durationText(audit.tbtMs)}</dd></div>
        <div><dt>CLS · Desplazamiento</dt><dd>{audit.cls !== null ? audit.cls.toFixed(3) : 'No disponible'}</dd></div>
      </dl>
    </section>}
    <section>
      <h4>Qué revisar</h4>
      <ul className="quality-detail-bullets">{meta.tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>
    </section>
  </Shell>;
}

export function IcspDetailModal({ projectId, icsp, history, generatedAt, onClose }: {
  projectId: string; icsp: IcspDetail; generatedAt?: string | null; history: Assessment[]; onClose: () => void;
}) {
  return <Shell title="Dimensiones e histórico de ICSP" onClose={onClose}
    extraLink={{ href: `/projects/${projectId}/icsp`, label: 'Abrir página completa →' }}>
    <section>
      <h4>Resumen</h4>
      <dl className="quality-detail-dl">
        <div><dt>Puntaje</dt><dd>{icsp.score} / 100</dd></div>
        <div><dt>Ventana</dt><dd>{icsp.window.days} días</dd></div>
        <div><dt>Requisitos</dt><dd>{icsp.counts.requirements}</dd></div>
        <div><dt>Escenarios</dt><dd>{icsp.counts.scenarios}</dd></div>
        <div><dt>Ejecuciones / resultados</dt><dd>{icsp.counts.runs} / {icsp.counts.results}</dd></div>
        <div><dt>Aprobados / fallidos</dt><dd>{icsp.counts.passed} / {icsp.counts.failed}</dd></div>
        {generatedAt && <div><dt>Calculado</dt><dd>{dateText(generatedAt)}</dd></div>}
      </dl>
    </section>
    <section>
      <h4>Dimensiones ({icsp.dimensions.length})</h4>
      <ol className="quality-detail-list">{icsp.dimensions.map((d, i) => <li key={d.code}>
        <div><strong>{i + 1}. {d.label}</strong>
          <span>{d.denominator > 0 ? `${Math.round(100 * d.value)}%` : 'Sin datos'} ({d.numerator}/{d.denominator})</span></div>
        {d.description && <p>{d.description}</p>}
      </li>)}</ol>
    </section>
    <section>
      <h4>Brechas</h4>
      {([['requirementsWithoutScenario', 'Requisitos por cubrir'], ['scenariosNotExecuted', 'Escenarios sin ejecución'], ['unstableScenarios', 'Escenarios inestables']] as const).map(([key, title]) => <details key={key} className="quality-detail-gap">
        <summary>{title} ({icsp.gaps[key].length})</summary>
        {icsp.gaps[key].length > 0 ? <ul>{icsp.gaps[key].slice(0, 30).map(item => <li key={item.id}>
          {item.label}{item.detail && <small> — {item.detail}</small>}
        </li>)}{icsp.gaps[key].length > 30 && <li className="muted">y {icsp.gaps[key].length - 30} más…</li>}</ul>
          : <p>Sin brechas reportadas.</p>}
      </details>)}
    </section>
    {history.length > 0 && <section>
      <h4>Histórico</h4>
      <ol className="quality-detail-history">{history.slice(0, 10).map(item => <li key={item.id}>
        <strong>{item.score ?? '—'}</strong><span>{dateText(item.createdAt)}</span>
        <small>{item.delta === null ? 'Sin comparación' : item.delta > 0 ? `+${item.delta}` : item.delta}</small>
      </li>)}</ol>
    </section>}
  </Shell>;
}
