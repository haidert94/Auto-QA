'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useRef } from 'react';

export default function MobileNavigation({ links, loginHref }: {
  links: readonly (readonly [string, string])[];
  loginHref: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);

  function close() {
    if (menu.current) menu.current.open = false;
  }

  return (
    <details className="mobile-nav" ref={menu}>
      <summary aria-label="Abrir menú"><Menu size={22} aria-hidden="true"/></summary>
      <nav aria-label="Navegación móvil">
        {links.map(([label, href]) => <Link key={href} href={href} onClick={close}>{label}</Link>)}
        <Link href={loginHref} onClick={close}>Iniciar sesión</Link>
      </nav>
    </details>
  );
}
