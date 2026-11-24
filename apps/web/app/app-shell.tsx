import { requireAccount, type Account } from './autoqa-server';
import { AppNav } from './app-nav';

// Envuelve cualquier página firmada: fuerza sesión y añade la navegación
// superior. Si no hay sesión, requireAccount() redirige a /login.
export async function AppShell({ children, account: authenticated }: { children: React.ReactNode; account?: Account }) {
  const account = authenticated ?? await requireAccount();
  return <div className="app-shell">
    <AppNav account={{
      name: account.name, email: account.email, canViewCodeHealth: account.canViewCodeHealth,
      organization: { id: account.organization.id, name: account.organization.name },
      subscription: {
        status: account.subscription.status,
        plan: account.subscription.plan ? { name: account.subscription.plan.name } : undefined,
      },
    }}/>
    <div className="app-shell-body">{children}</div>
  </div>;
}
