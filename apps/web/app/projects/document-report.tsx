import type { Report } from './document-client';

const kindLabels: Record<string, string> = {
  USER_STORY: 'Historia de usuario', FUNCTIONAL: 'Requisito funcional',
  NON_FUNCTIONAL: 'Requisito no funcional', REQUIREMENT: 'Requisito',
  ACCEPTANCE_CRITERION: 'Criterio de aceptación', BUSINESS_RULE: 'Regla de negocio',
  ROLE: 'Rol', PERMISSION: 'Permiso', SCENARIO: 'Escenario de prueba',
  AMBIGUITY: 'Ambigüedad', CONTRADICTION: 'Posible contradicción',
};

export function DocumentReport({ report: { ipa, analysis } }: { report: Report }) {
  return (
    <section aria-labelledby="ipa-heading">
      <h3 id="ipa-heading">Índice de Preparación para Automatización (IPA)</h3>
      <p><strong>{ipa.score}/100</strong> · {ipa.status === 'BLOCKED' ? 'Bloqueado. Consulta los motivos del IPA.' : 'Evaluado'}</p>
      <p>Declarados · {ipa.documents.declared} | Cargados · {ipa.documents.uploaded} | Procesados · {ipa.documents.processed} | Validados · {ipa.documents.validated}</p>
      <p>Requisitos verificables · {ipa.verifiable} | Requisitos ambiguos o pendientes · {ipa.ambiguous}</p>
      <details>
        <summary>Información disponible y faltante</summary>
        {ipa.signals.map(signal => (
          <div key={signal.criterion}>
            <h4>{signal.criterion} · {signal.weight ? signal.points + '/' + signal.weight : 'No aplica'}</h4>
            <ul>
              {signal.available.map(item => <li key={item}>{item}</li>)}
              {signal.missing.map(item => <li key={item}>Pendiente · {item}</li>)}
            </ul>
          </div>
        ))}
      </details>
      {ipa.recommendations.length > 0 && (
        <details>
          <summary>Recomendaciones ({ipa.recommendations.length})</summary>
          <ul>{ipa.recommendations.map(item => <li key={item}>{item}</li>)}</ul>
        </details>
      )}
      {!analysis && ipa.documents.uploaded > 0 && <p className="muted">Solicita un análisis para las versiones actuales.</p>}
      {analysis?.warnings.length ? <ul>{analysis.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
      {analysis && (
        <details>
          <summary>Hallazgos y fuentes ({analysis.findings.length})</summary>
          <ol className="document-list">
            {analysis.findings.map(finding => (
              <li key={finding.id}>
                <strong>{kindLabels[finding.kind] ?? finding.kind}</strong>
                {finding.pendingConfirmation && ' · Pendiente de confirmación'}
                <p>{finding.text}</p>
                <p className="muted">{finding.source.filename} · versión {finding.source.version} · {finding.source.locator}</p>
                {finding.relatedSource && <p className="muted">
                  Fuente relacionada · {finding.relatedSource.filename} · versión {finding.relatedSource.version} · {finding.relatedSource.locator}
                </p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
