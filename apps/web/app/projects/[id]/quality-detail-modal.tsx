'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { dateText } from './run-report-data';

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
      {([['requirementsWithoutScenario', 'Requisitos sin escenario'], ['scenariosNotExecuted', 'Escenarios sin ejecución'], ['unstableScenarios', 'Escenarios inestables']] as const).map(([key, title]) => <details key={key} className="quality-detail-gap">
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
