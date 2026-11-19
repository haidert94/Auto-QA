import type { ReactNode } from 'react';

export function GenerationCard({ title, variant = 'scenarios', disabled, children, action }: {
  title: string;
  variant?: 'scenarios' | 'playwright';
  disabled: boolean;
  children: ReactNode;
  action: ReactNode;
}) {
  const state = disabled ? 'disabled' : 'ready';
  return <section className={`generate-cta generate-cta--${state} generate-cta--${variant}`} aria-label={title}>
    <div className="generate-cta__info">
      <span className="generate-cta__eyebrow">Automatización con IA</span>
      <h2>{title}</h2>
      {children}
    </div>
    <div className="generate-cta__action">{action}</div>
  </section>;
}
