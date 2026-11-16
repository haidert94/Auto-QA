import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accountFetch } from '../../../autoqa-server';
import { PerformancePanel } from './performance-panel';

type Environment = { id: string; type: string | null; baseUrl: string | null; authorizationConfirmed?: boolean; readOnly?: boolean };

export const dynamic = 'force-dynamic';

export default async function PerformancePage({ params }: { params: Promise<{ id: string }> }) {
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
  const envs: Environment[] = (data.environments ?? [])
    .filter((e: Environment) => e.authorizationConfirmed && e.readOnly !== false);

  return <section className="panel">
    <p><Link href={`/projects/${id}`}>← Volver al proyecto</Link></p>
    <h1>Performance · Lighthouse</h1>
    <PerformancePanel projectId={id} environments={envs.map(e => ({ id: e.id, type: e.type, baseUrl: e.baseUrl }))} />
  </section>;
}
