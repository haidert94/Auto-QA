'use client';

import type { Report } from '../document-client';

const kindLabels: Record<string, string> = {
  USER_STORY: 'Historia de usuario', FUNCTIONAL: 'Requisito funcional',
  NON_FUNCTIONAL: 'Requisito no funcional', REQUIREMENT: 'Requisito',
  ACCEPTANCE_CRITERION: 'Criterio de aceptación', BUSINESS_RULE: 'Regla de negocio',
  ROLE: 'Rol', PERMISSION: 'Permiso', SCENARIO: 'Escenario de prueba',
  AMBIGUITY: 'Ambigüedad', CONTRADICTION: 'Posible contradicción',
};

// Reemplaza al card terminal "Diagnóstico del proyecto". Toma la salida del
// endpoint /documents/analysis y la presenta con el chrome de las tarjetas
// de la pestaña Datos (cabecera cream, labels mono en mayúsculas, bloques
// colapsables para el detalle largo).
export function AnalysisCard({ report, number = '04', pending }: {
  report: Report | null;
  number?: string;
  pending?: string;
}) {
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
  const stats = [
    { label: 'Declarados', value: ipa.documents.declared },
    { label: 'Cargados', value: ipa.documents.uploaded },
    { label: 'Procesados', value: ipa.documents.processed },
    { label: 'Validados', value: ipa.documents.validated },
  ];
  const requisites = [
    { label: 'Verificables', value: ipa.verifiable },
    { label: 'Ambiguos o pendientes', value: ipa.ambiguous },
  ];

  return <section className="detail-card detail-analysis">
    <header className="detail-card__head">
      <h2><span>{number} //</span> Análisis documental</h2>
      <span className="detail-count">{ipa.score}/100 · {statusLabel}</span>
    </header>
    <div className="detail-card__body">
      <dl className="detail-analysis__metrics">
        {stats.map(stat => <div key={stat.label}>
          <dt>{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>)}
      </dl>
      <dl className="detail-analysis__metrics detail-analysis__metrics--split">
        {requisites.map(stat => <div key={stat.label}>
          <dt>{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>)}
      </dl>

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
