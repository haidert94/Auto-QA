import { requireWorkspace } from '../autoqa-server';

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireWorkspace();
  return children;
}
