import { notFound, redirect } from 'next/navigation';
import { requireAccount } from '../../../autoqa-server';

export default async function PreviousCodeHealthPage() {
  const account = await requireAccount();
  if (account.canViewCodeHealth !== true) notFound();
  redirect('/admin/salud-del-codigo');
}
