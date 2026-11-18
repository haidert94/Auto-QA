'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type NavAccount = {
  name: string; email: string;
  organization: { id: string; name: string };
  subscription: { status: string; plan?: { name: string } };
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
  const accountMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (accountMenu.current && !accountMenu.current.contains(event.target as Node)) accountMenu.current.open = false;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      if (accountMenu.current?.open) {
        accountMenu.current.open = false;
        accountMenu.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

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
      <Link href="/dashboard" className="app-nav-logo" aria-label="AutoQA, inicio">Auto<span>QA</span></Link>
      <button type="button" className="app-nav-toggle" aria-label="Menú"
              aria-expanded={menuOpen} aria-controls="app-main-navigation"
              onClick={() => setMenuOpen(o => !o)}>{menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}</button>
      <nav id="app-main-navigation" className={menuOpen ? 'app-nav-links open' : 'app-nav-links'} aria-label="Navegación principal">
        {links.map(link => <Link key={link.href} href={link.href}
          className={isActive(link.href) ? 'active' : ''}
          aria-current={isActive(link.href) ? 'page' : undefined}
          onClick={() => setMenuOpen(false)}>{link.label}</Link>)}
      </nav>
      <div className="app-nav-account">
        <span className="app-nav-org" title={account.organization.name}>
          <span className="app-nav-org-name">{account.organization.name}</span>
          {account.subscription.plan?.name && <span className="app-nav-plan">{account.subscription.plan.name}</span>}
        </span>
        <details className="app-nav-menu" ref={accountMenu}>
          <summary aria-label="Menú de la cuenta">
            <span className="app-nav-avatar"><UserRound size={16} aria-hidden="true" /></span>
            <ChevronDown size={12} className="app-nav-chevron" aria-hidden="true" />
          </summary>
          <div className="app-nav-menu-content">
            <strong>{account.name || account.email}</strong>
            <p>{account.email}</p>
            <p>Plan: {account.subscription.plan?.name ?? 'Sin plan asignado'}</p>
            <p>Suscripción: {account.subscription.status}</p>
            <button type="button" className="outline" onClick={logout} disabled={busy}>
              {busy ? 'Cerrando…' : 'Cerrar sesión'}
            </button>
          </div>
        </details>
      </div>
    </div>
  </header>;
}
