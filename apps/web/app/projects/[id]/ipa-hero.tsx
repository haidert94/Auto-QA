// Componente visual reutilizado tanto por /projects/[id]/ipa (vista
// dedicada con bloqueos, histórico y anclas) como por el tab "Datos"
// del detalle del proyecto (resumen al completar el registro).
// Sin "use client": se renderiza en server components.

export type IpaSignal = {
  criterion: string;
  weight: number;
  points: number;
  missing: string[];
  blocking: boolean;
};

export type IpaSummary = {
  score: number;
  status: 'ASSESSED' | 'BLOCKED';
  signals: IpaSignal[];
};

export function levelFor(score: number, status: IpaSummary['status']):
  { label: string; css: string; headline: string } {
  if (status === 'BLOCKED') return { label: 'Bloqueado', css: 'insuficiente', headline: 'Resuelve los bloqueos antes de automatizar.' };
  if (score >= 85) return { label: 'Óptimo', css: 'óptimo', headline: 'Preparación óptima para automatizar.' };
  if (score >= 70) return { label: 'Aceptable', css: 'aceptable', headline: 'Preparación aceptable. Hay recomendaciones por atender.' };
  if (score >= 50) return { label: 'Mejorable', css: 'mejorable', headline: 'Preparación mejorable. Varias señales pendientes.' };
  return { label: 'Insuficiente', css: 'insuficiente', headline: 'Preparación insuficiente. Completa la documentación y el alcance.' };
}

export function IpaHero({ ipa, generatedAt, subtitle }: {
  ipa: IpaSummary;
  generatedAt?: string;
  subtitle?: string;
}) {
  const level = levelFor(ipa.score, ipa.status);
  return (
    <>
      <header className="ipa-diagnostic-head">
        <div>
          <p className="ipa-eyebrow">Diagnóstico de preparación</p>
          <h2>Índice de Preparación para Automatización (IPA)</h2>
        </div>
        <span className={`ipa-level-badge ipa-level-${level.css}`}>Nivel {level.label}</span>
      </header>

      <div className="ipa-score-card">
        <div className="ipa-score-circle">
          <span className="ipa-score-value">{ipa.score}</span>
          <span className="ipa-score-max">/ 100</span>
        </div>
        <div>
          <p className="ipa-score-headline">{ipa.score} / 100 — Nivel {level.label} para Automatización</p>
          <p className="muted">{level.headline}</p>
          {subtitle && <p className="muted"><small>{subtitle}</small></p>}
          {generatedAt && <p className="muted"><small>
            Calculado {new Date(generatedAt).toLocaleString('es-CO')}.
          </small></p>}
        </div>
      </div>

      <ul className="ipa-category-list">
        {ipa.signals.filter(s => s.weight > 0).map((signal, i) => {
          const pct = Math.round(100 * signal.points / signal.weight);
          return (
            <li key={i}>
              <div className="ipa-category-head">
                <span>{signal.criterion}{signal.blocking && signal.points < signal.weight ? ' · bloqueante' : ''}</span>
                <strong>{pct}%</strong>
              </div>
              <div className="ipa-category-bar"><div className="ipa-category-fill" style={{ width: pct + '%' }}/></div>
              {signal.missing.length > 0 && <p className="muted"><small>Pendiente: {signal.missing.join(' · ')}</small></p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
