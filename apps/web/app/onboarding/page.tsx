import { redirect } from 'next/navigation';
import { requireAccount } from '../autoqa-server';
import { can } from '../permissions';
import { OnboardingWizard } from './wizard';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const account = await requireAccount();
  if (!can(account.role, 'project.create')) redirect('/projects');
  return <OnboardingWizard />;
}
