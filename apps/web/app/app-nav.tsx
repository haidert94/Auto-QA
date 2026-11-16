'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

type NavAccount = {
  name: string; email: string;
  organization: { id: string; name: string };
  subscription: { status: string };
};

const links = [
  { href: '/dashboard', label: 'Resumen' },
  { href: '/projects', label: 'Proyectos' },
  { href: '/account/members', label: 'Miembros' },
  { href: '/billing', label: 'Facturación' },
];

export function AppNav({ account }: { account: NavAccount }) {
  const pathname = usePathname() ?? '';
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/commerce/logout', { method: 'POST' });
      window.location.assign('/');
    } catch {
      setBusy(false);
    }
  }

  function isActive(href: string): boolean {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname === href || pathname.startsWith(href + '/');
  }

  return <header className="app-nav">
    <div className="app-nav-inner">
      <Link href="/dashboard" className="app-nav-logo">AutoQA</Link>
      <button type="button" className="app-nav-toggle" aria-label="Menú"
              onClick={() => setMenuOpen(o => !o)}>☰</button>
      <nav className={menuOpen ? 'app-nav-links open' : 'app-nav-links'}>
        {links.map(link => <Link key={link.href} href={link.href}
          className={isActive(link.href) ? 'active' : ''}
          onClick={() => setMenuOpen(false)}>{link.label}</Link>)}
      </nav>
      <div className="app-nav-account">
        <span className="app-nav-org muted">{account.organization.name}</span>
        <details className="app-nav-menu">
          <summary>{account.name || account.email}</summary>
          <div className="app-nav-menu-content">
            <p className="muted">{account.email}</p>
            <p className="muted">Suscripción: {account.subscription.status}</p>
            <button type="button" onClick={logout} disabled={busy}>
              {busy ? 'Cerrando…' : 'Cerrar sesión'}
            </button>
          </div>
        </details>
      </div>
    </div>
  </header>;
}
