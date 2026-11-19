'use client';

import { useEffect, useRef, useState } from 'react';
import type { Report, SavedDocument } from '../document-client';

export type AnalysisDialogTarget = 'environments' | 'documents' | 'roles';

// Guía contextual por tipo de pendiente que emite readiness.ts. El match
// contra el texto exacto del backend evita duplicar reglas acá — si se
// agrega un mensaje nuevo al backend, el popup cae al comportamiento
// genérico y queda explícito que falta documentar.
type HelpGuide = {
  title: string;
  description: string;
  steps: string[];
  action?: { label: string; target: AnalysisDialogTarget };
};

const HELP_GUIDES: Record<string, HelpGuide> = {
  'Adjunta documentación funcional.': {
    title: 'Falta documentación funcional',
    description: 'El agente no encontró documentos funcionales cargados para el proyecto. Sin requisitos ni historias, el IPA no puede evaluar la cobertura.',
    steps: [
      'Reunite con el equipo funcional y pedí las historias de usuario, requisitos o criterios de aceptación en PDF, DOCX, XLSX o Markdown.',
      'Abrí "Documentos asociados y contratos técnicos" en esta misma pestaña.',
      'Subí los archivos usando el stepper de módulos. El análisis se dispara automáticamente al terminar.',
    ],
    action: { label: 'Abrir documentos', target: 'documents' },
  },
  'Revisa las fuentes y valida al menos un documento procesado.': {
    title: 'Valida un documento procesado',
    description: 'La IA ya extrajo findings pero nadie confirmó que el documento sea la fuente oficial. La validación es un sello de "esto es lo que vamos a probar contra".',
    steps: [
      'Abrí "Documentos asociados y contratos técnicos" en esta misma pestaña.',
      'Ubicá en la lista el documento procesado que querés aprobar.',
      'Click en "Marcar como validado". Esta acción requiere rol ADMIN u OWNER.',
      'Si encontrás un error en el contenido, eliminá el documento y re-cargá la versión corregida.',
    ],
    action: { label: 'Abrir documentos', target: 'documents' },
  },
  'Aclara los requisitos marcados como pendientes.': {
    title: 'Hay requisitos ambiguos',
    description: 'La IA marcó algunas historias/requisitos como "Pendiente de confirmación" porque admiten más de una interpretación o les falta información. Abrí el tile "Ambiguos o pendientes" arriba para ver cuáles.',
    steps: [
      'Click en el tile "Ambiguos o pendientes" para ver la lista exacta.',
      'Por cada requisito ambiguo, volvé a la fuente (el documento origen) y aclará: actor específico, acción puntual, resultado esperado, criterios de aceptación medibles.',
      'Actualizá el documento en origen y volvé a subir la versión corregida desde el modal de documentos.',
      'El análisis se recorre de nuevo al subir una versión nueva.',
    ],
    action: { label: 'Abrir documentos', target: 'documents' },
  },
  'Vincula criterios de aceptación explícitos con sus requisitos.': {
    title: 'Criterios sin requisito padre',
    description: 'Hay criterios de aceptación detectados pero el agente no pudo vincularlos a su historia o requisito superior. Sin ese vínculo, los escenarios generados no sabrán qué probar.',
    steps: [
      'En el documento fuente, usá una referencia explícita al requisito: "[HU-1]", "Criterio de HU-1", "RF-01 · Criterio 1", etc.',
      'Re-subí el documento desde el modal de documentos para que la IA pueda reconstruir la trazabilidad.',
    ],
    action: { label: 'Abrir documentos', target: 'documents' },
  },
  'Identifica las cuentas de prueba mediante referencias externas.': {
    title: 'Cuentas de prueba sin identificar',
    description: 'La matriz de roles declara cuentas de prueba pero no apuntan a una bóveda externa (ej. vault:qa/admin). Guardar contraseñas en el proyecto es un riesgo de seguridad.',
    steps: [
      'Abrí el card "Roles y matriz de autorización" y editá el rol correspondiente.',
      'En "Referencia externa a cuenta de prueba" pegá la referencia a tu bóveda, con formato tipo "vault:qa/lector".',
      'Nunca pongas la contraseña en texto plano acá; la bóveda es la que la resuelve en runtime.',
    ],
    action: { label: 'Abrir roles', target: 'roles' },
  },
};

function helpFor(missing: string): HelpGuide {
  return HELP_GUIDES[missing] ?? {
    title: 'Pendiente del proyecto',
    description: missing,
    steps: ['Revisá el criterio y actualiza la información correspondiente en el proyecto.'],
  };
}

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
export function AnalysisCard({ report, documents = [], number = '04', pending, onOpenDialog }: {
  report: Report | null;
  documents?: SavedDocument[];
  number?: string;
  pending?: string;
  onOpenDialog?: (target: AnalysisDialogTarget) => void;
}) {
  const [active, setActive] = useState<MetricKey | null>(null);
  const [helpItem, setHelpItem] = useState<string | null>(null);
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
      {helpItem && <PendingHelpDialog item={helpItem} onClose={() => setHelpItem(null)}
        onOpenDialog={target => { setHelpItem(null); onOpenDialog?.(target); }} />}

      <details className="detail-analysis__section">
        <summary>
          <span>Información disponible y faltante</span>
          <span className="detail-analysis__section-count">{ipa.signals.length}</span>
        </summary>
        <ul className="detail-analysis__signals">
          {ipa.signals.map(signal => (
            <li key={signal.criterion}>
              <header>
                <strong>{signal.criterion}</strong>
                <span>{signal.weight ? `${signal.points}/${signal.weight}` : 'No aplica'}</span>
              </header>
              {(signal.available.length > 0 || signal.missing.length > 0) && <ul>
                {signal.available.map(item => <li key={item} className="success">{item}</li>)}
                {signal.missing.map(item => <li key={item} className="muted">
                  <button type="button" className="detail-analysis__pending-link"
                    onClick={() => setHelpItem(item)}>
                    Pendiente · {item}
                  </button>
                </li>)}
              </ul>}
            </li>
          ))}
        </ul>
      </details>

      {ipa.recommendations.length > 0 && <details className="detail-analysis__section">
        <summary>
          <span>Recomendaciones</span>
          <span className="detail-analysis__section-count">{ipa.recommendations.length}</span>
        </summary>
        <ul className="detail-analysis__recommendations">
          {ipa.recommendations.map(item => <li key={item}>
            <button type="button" className="detail-analysis__pending-link detail-analysis__pending-link--full"
              onClick={() => setHelpItem(item)}>{item}</button>
          </li>)}
        </ul>
      </details>}

      {analysis && <details className="detail-analysis__section">
        <summary>
          <span>Hallazgos y fuentes</span>
          <span className="detail-analysis__section-count">{analysis.findings.length}</span>
        </summary>
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
  // Ambos contadores del backend (readiness.ts:89-90) solo cuentan findings
  // cuyo kind es un requisito (user story / requirement / functional /
  // non-functional). Criterios de aceptación, reglas de negocio, roles,
  // permisos, etc. tienen su propio ciclo y no entran acá aunque estén
  // pendientes.
  const matched = analysis.findings.filter(f => requirementKinds.has(f.kind) && (
    metric === 'verifiable' ? !f.pendingConfirmation : f.pendingConfirmation
  ));
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

function PendingHelpDialog({ item, onClose, onOpenDialog }: {
  item: string;
  onClose: () => void;
  onOpenDialog: (target: AnalysisDialogTarget) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const guide = helpFor(item);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="pending-help-dialog" aria-labelledby="pending-help-title"
    onCancel={onClose}>
    <header className="pending-help-dialog__head">
      <h2 id="pending-help-title">{guide.title}</h2>
      <button type="button" className="secondary" onClick={onClose} aria-label="Cerrar">×</button>
    </header>
    <div className="pending-help-dialog__body">
      <p className="pending-help-dialog__lead">{guide.description}</p>
      <p className="pending-help-dialog__eyebrow">Pasos sugeridos</p>
      <ol className="pending-help-dialog__steps">
        {guide.steps.map((step, i) => <li key={i}>{step}</li>)}
      </ol>
    </div>
    <div className="pending-help-dialog__actions">
      {guide.action && <button type="button" onClick={() => onOpenDialog(guide.action!.target)}>
        {guide.action.label}
      </button>}
      <button type="button" className="secondary" onClick={onClose}>Cerrar</button>
    </div>
  </dialog>;
}
