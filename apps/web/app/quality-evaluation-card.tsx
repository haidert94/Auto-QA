import type { CSSProperties, ReactNode } from 'react';

export function Score({ value, label }: { value: number | null; label: string }) {
  return <div className={`quality-score-ring${value === null ? ' quality-score-ring--empty' : ''}`} role="img" aria-label={`${label}: ${value === null ? 'sin evaluación' : `${value} de 100`}`}
    style={{ '--quality-progress': `${Math.max(0, Math.min(100, value ?? 0)) * 3.6}deg` } as CSSProperties}>
    <strong>{value ?? '—'}</strong><small>/ 100</small>
  </div>;
}
export function EvaluationCard({ index, title, badge, children }: { index: string; title: string; badge: string; children: ReactNode }) {
  return <section className="quality-evaluation" aria-label={title}><header><h2><span>{index} //</span> {title}</h2><span className="quality-badge">{badge}</span></header>{children}</section>;
}
