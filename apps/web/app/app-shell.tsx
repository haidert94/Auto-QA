import { requireAccount } from './autoqa-server';
import { AppNav } from './app-nav';

// Envuelve cualquier página firmada: fuerza sesión y añade la navegación
// superior. Si no hay sesión, requireAccount() redirige a /login.
export async function AppShell({ children }: { children: React.ReactNode }) {
  const account = await requireAccount();
  return <>
    <AppNav account={{
      name: account.name, email: account.email,
      organization: { id: account.organization.id, name: account.organization.name },
      subscription: { status: account.subscription.status },
    }}/>
    <div className="app-shell-body">{children}</div>
  </>;
}
