import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

// Encabezado estándar para las páginas del shell de cuenta (Resumen,
// Proyectos, Miembros, Facturación). Replica el patrón visual del heading
// de proyecto: breadcrumb mono uppercase arriba, título grande, badge
// opcional y descripción, con acciones alineadas a la derecha.
//
// Reusa las clases .project-breadcrumb* y .project-heading* existentes
// para mantener una sola fuente de verdad del tratamiento tipográfico.

export type Crumb = { href?: string; label: string };
export type HeadingBadge = { label: string; tone?: 'ready' | 'draft' | 'archived' | 'muted' };

export function AppPageHeading({
  crumbs = [], title, badge, summary, actions, aside, back,
}: {
  crumbs?: Crumb[];
  title: string;
  badge?: HeadingBadge;
  summary?: string;
  actions?: ReactNode;
  aside?: ReactNode;
  // Opcional: muestra un enlace "← Volver" sobre el breadcrumb apuntando
  // al href dado. Útil en páginas standalone que se abren desde una
  // pestaña del detalle de proyecto (Calidad, Reporte, etc.).
  back?: { href: string; label?: string };
}) {
  return <>
    {back && <p className="app-page-heading__back">
      <Link href={back.href}><ArrowLeft size={14} aria-hidden="true" />{back.label ?? 'Volver'}</Link>
    </p>}
    {(crumbs.length > 0 || aside) && <div className="project-breadcrumb-row">
      <nav className="project-breadcrumb" aria-label="Ruta de la página">
        {crumbs.map((crumb, i) => <span key={i} className="app-page-heading__crumb">
          {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
          {i < crumbs.length - 1 && <ChevronRight size={11} aria-hidden="true" />}
        </span>)}
      </nav>
      {aside && <span className="project-revision">{aside}</span>}
    </div>}
    <header className="project-heading">
      <div className="project-heading__identity">
        <div className="project-heading__title">
          <h1>{title}</h1>
          {badge && <span className={`project-status project-status--${badge.tone ?? 'ready'}`}>
            <i aria-hidden="true" />{badge.label}
          </span>}
        </div>
        {summary && <p>{summary}</p>}
      </div>
      {actions && <div className="project-heading__actions">{actions}</div>}
    </header>
  </>;
}
