'use client';

import { useState } from 'react';
import type { Report, SavedDocument } from '../document-client';

const kindLabels: Record<string, string> = {
  USER_STORY: 'Historia de usuario', FUNCTIONAL: 'Requisito funcional',
  NON_FUNCTIONAL: 'Requisito no funcional', REQUIREMENT: 'Requisito',
  ACCEPTANCE_CRITERION: 'Criterio de aceptación', BUSINESS_RULE: 'Regla de negocio',
  ROLE: 'Rol', PERMISSION: 'Permiso', SCENARIO: 'Escenario de prueba',
  AMBIGUITY: 'Ambigüedad', CONTRADICTION: 'Posible contradicción',
};

const requirementKinds = new Set(['USER_STORY', 'REQUIREMENT', 'FUNCTIONAL', 'NON_FUNCTIONAL']);

type MetricKey =
  | 'declared' | 'uploaded' | 'processed' | 'validated'
  | 'verifiable' | 'ambiguous';

const documentStates: Record<string, string> = {
  DECLARED: 'Declarado', UPLOADED: 'Cargado',
  PROCESSED: 'Procesado', VALIDATED: 'Validado',
};

// Reemplaza al card terminal "Diagnóstico del proyecto". Toma la salida del
// endpoint /documents/analysis y la presenta con el chrome de las tarjetas
// de la pestaña Datos (cabecera cream, labels mono en mayúsculas, bloques
// colapsables para el detalle largo).
export function AnalysisCard({ report, documents = [], number = '04', pending }: {
  report: Report | null;
  documents?: SavedDocument[];
  number?: string;
  pending?: string;
}) {
  const [active, setActive] = useState<MetricKey | null>(null);
  if (!report) {
    return <section className="detail-card detail-analysis">
      <header className="detail-card__head">
        <h2><span>{number} //</span> Análisis documental</h2>
      </header>
      <div className="detail-card__body">
        <p className="muted">{pending ?? 'Aún no hay un análisis guardado. Sube un módulo desde el card de documentos para que el agente lo procese.'}</p>
      </div>
    </section>;
  }

  const { ipa, analysis } = report;
  const statusLabel = ipa.status === 'BLOCKED'
    ? 'Bloqueado por autorización, alcance o estado del proyecto'
    : 'Evaluado';
  const stats: Array<{ label: string; value: number; key: MetricKey }> = [
    { label: 'Declarados', value: ipa.documents.declared, key: 'declared' },
    { label: 'Cargados', value: ipa.documents.uploaded, key: 'uploaded' },
    { label: 'Procesados', value: ipa.documents.processed, key: 'processed' },
    { label: 'Validados', value: ipa.documents.validated, key: 'validated' },
  ];
  const requisites: Array<{ label: string; value: number; key: MetricKey }> = [
    { label: 'Verificables', value: ipa.verifiable, key: 'verifiable' },
    { label: 'Ambiguos o pendientes', value: ipa.ambiguous, key: 'ambiguous' },
  ];

  function toggle(key: MetricKey) { setActive(current => current === key ? null : key); }

  return <section className="detail-card detail-analysis">
    <header className="detail-card__head">
      <h2><span>{number} //</span> Análisis documental</h2>
      <span className="detail-count">{ipa.score}/100 · {statusLabel}</span>
    </header>
    <div className="detail-card__body">
      <div className="detail-analysis__metrics" role="group" aria-label="Resumen de documentos">
        {stats.map(stat => <button key={stat.key} type="button"
          className={active === stat.key ? 'detail-analysis__metric detail-analysis__metric--active' : 'detail-analysis__metric'}
          onClick={() => toggle(stat.key)}
          aria-pressed={active === stat.key}
          aria-expanded={active === stat.key}
          disabled={stat.value === 0}>
          <span className="detail-analysis__metric-label">{stat.label}</span>
          <span className="detail-analysis__metric-value">{stat.value}</span>
        </button>)}
      </div>
      <div className="detail-analysis__metrics detail-analysis__metrics--split" role="group" aria-label="Resumen de requisitos">
        {requisites.map(stat => <button key={stat.key} type="button"
          className={active === stat.key ? 'detail-analysis__metric detail-analysis__metric--active' : 'detail-analysis__metric'}
          onClick={() => toggle(stat.key)}
          aria-pressed={active === stat.key}
          aria-expanded={active === stat.key}
          disabled={stat.value === 0}>
          <span className="detail-analysis__metric-label">{stat.label}</span>
          <span className="detail-analysis__metric-value">{stat.value}</span>
        </button>)}
      </div>
      {active && <MetricDrawer metric={active} documents={documents} analysis={analysis} />}

      <details className="detail-analysis__section">
        <summary>Información disponible y faltante</summary>
        <ul className="detail-analysis__signals">
          {ipa.signals.map(signal => (
            <li key={signal.criterion}>
              <header>
                <strong>{signal.criterion}</strong>
                <span>{signal.weight ? `${signal.points}/${signal.weight}` : 'No aplica'}</span>
              </header>
              {(signal.available.length > 0 || signal.missing.length > 0) && <ul>
                {signal.available.map(item => <li key={item} className="success">{item}</li>)}
                {signal.missing.map(item => <li key={item} className="muted">Pendiente · {item}</li>)}
              </ul>}
            </li>
          ))}
        </ul>
      </details>

      {ipa.recommendations.length > 0 && <details className="detail-analysis__section">
        <summary>Recomendaciones ({ipa.recommendations.length})</summary>
        <ul className="detail-analysis__recommendations">
          {ipa.recommendations.map(item => <li key={item}>{item}</li>)}
        </ul>
      </details>}

      {analysis && <details className="detail-analysis__section">
        <summary>Hallazgos y fuentes ({analysis.findings.length})</summary>
        {analysis.warnings.length > 0 && <ul className="detail-analysis__warnings">
          {analysis.warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>}
        <ol className="detail-analysis__findings">
          {analysis.findings.map(finding => (
            <li key={finding.id}>
              <header>
                <span className="detail-analysis__kind">{kindLabels[finding.kind] ?? finding.kind}</span>
                {finding.pendingConfirmation && <span className="detail-analysis__pending">Pendiente de confirmación</span>}
              </header>
              <p>{finding.text}</p>
              <p className="muted">
                {finding.source.filename} · versión {finding.source.version} · {finding.source.locator}
              </p>
            </li>
          ))}
        </ol>
      </details>}
    </div>
  </section>;
}

// Panel que se abre bajo las métricas al clickear un contador. Muestra los
// ítems que esa métrica cuenta (documentos en ese estado, findings por
// verificabilidad). Se cierra haciendo click de nuevo en el mismo
// contador o seleccionando otro.
function MetricDrawer({ metric, documents, analysis }: {
  metric: MetricKey;
  documents: SavedDocument[];
  analysis: Report['analysis'];
}) {
  if (metric === 'declared' || metric === 'uploaded' || metric === 'processed' || metric === 'validated') {
    // El backend cuenta cumulativo: un doc PROCESADO también está
    // "cargado" porque pasó por ese estado. Replicamos esa semántica
    // acá o el drawer mostraría "No hay documentos" aún con contador > 0.
    const matches: Record<typeof metric, (state: string) => boolean> = {
      declared: state => state === 'DECLARED',
      uploaded: state => state === 'UPLOADED' || state === 'PROCESSED' || state === 'VALIDATED',
      processed: state => state === 'PROCESSED' || state === 'VALIDATED',
      validated: state => state === 'VALIDATED',
    };
    const filtered = documents.filter(doc => matches[metric](doc.state));
    const titles: Record<typeof metric, string> = {
      declared: 'Declarados', uploaded: 'Cargados', processed: 'Procesados', validated: 'Validados',
    };
    const title = titles[metric];
    if (!filtered.length) return <EmptyDrawer title={title} message={`No hay documentos en este grupo.`} />;
    return <div className="detail-analysis__drawer" aria-label={`Documentos ${title.toLowerCase()}`}>
      <p className="detail-analysis__drawer-title">Documentos · {title}</p>
      <ul className="detail-analysis__doc-list">
        {filtered.map(doc => <li key={doc.id}>
          <strong>{doc.filename}</strong>
          <span className="muted">
            {documentStates[doc.state]}{doc.currentVersion?.format ? ` · ${doc.currentVersion.format}` : ''}
            {doc.currentVersion?.number ? ` · v${doc.currentVersion.number}` : ''}
          </span>
        </li>)}
      </ul>
    </div>;
  }

  if (!analysis) return <EmptyDrawer title={metric === 'verifiable' ? 'Verificables' : 'Ambiguos o pendientes'}
    message="Aún no hay un análisis guardado." />;
  const matched = analysis.findings.filter(f => metric === 'verifiable'
    ? requirementKinds.has(f.kind) && !f.pendingConfirmation
    : f.pendingConfirmation);
  const title = metric === 'verifiable' ? 'Requisitos verificables' : 'Ambiguos o pendientes';
  if (!matched.length) return <EmptyDrawer title={title} message="Sin hallazgos en esta categoría." />;
  return <div className="detail-analysis__drawer" aria-label={title}>
    <p className="detail-analysis__drawer-title">{title} · {matched.length}</p>
    <ol className="detail-analysis__findings">
      {matched.slice(0, 50).map(finding => (
        <li key={finding.id}>
          <header>
            <span className="detail-analysis__kind">{kindLabels[finding.kind] ?? finding.kind}</span>
            {finding.pendingConfirmation && <span className="detail-analysis__pending">Pendiente</span>}
          </header>
          <p>{finding.text}</p>
          <p className="muted">
            {finding.source.filename} · versión {finding.source.version} · {finding.source.locator}
          </p>
        </li>
      ))}
      {matched.length > 50 && <li className="muted detail-analysis__more">
        … y {matched.length - 50} más. Expandí "Hallazgos y fuentes" abajo para verlos todos.
      </li>}
    </ol>
  </div>;
}

function EmptyDrawer({ title, message }: { title: string; message: string }) {
  return <div className="detail-analysis__drawer detail-analysis__drawer--empty">
    <p className="detail-analysis__drawer-title">{title}</p>
    <p className="muted">{message}</p>
  </div>;
}
