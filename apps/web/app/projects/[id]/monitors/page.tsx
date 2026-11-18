import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch, requireAccount, type OrgRole } from '../../../autoqa-server';
import { MonitorsPanel } from './monitors-panel';

type Environment = { id: string; type: string | null; baseUrl: string | null; authorizationConfirmed?: boolean };

export const dynamic = 'force-dynamic';

export default async function MonitorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let project: Response | undefined;
  try { project = await accountFetch(`/projects/${id}`); } catch {}
  if (project?.status === 404) notFound();
  if (!project?.ok) {
    return <section className="panel">
      <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
      <p className="error" role="alert">No se pudo cargar el proyecto.</p>
    </section>;
  }
  const data = await project.json();
  const envs: Environment[] = (data.environments ?? []).filter((e: Environment) => e.authorizationConfirmed);

  let role: OrgRole = 'VIEWER';
  try { role = (await requireAccount()).role; } catch {}

  return <section className="panel">
    <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
    <h1>Monitores de disponibilidad</h1>
    <MonitorsPanel projectId={id} environments={envs.map(e => ({ id: e.id, type: e.type, baseUrl: e.baseUrl }))} role={role} />
  </section>;
}
