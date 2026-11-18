import { redirect } from 'next/navigation';
import { requireAccount } from '../../autoqa-server';
import { can } from '../../permissions';
import { ProjectForm } from '../project-form';

export const dynamic = 'force-dynamic';

export default async function NewProject() {
  const account = await requireAccount().catch(() => null);
  if (!can(account?.role, 'project.create')) redirect('/projects');
  return <ProjectForm />;
}
