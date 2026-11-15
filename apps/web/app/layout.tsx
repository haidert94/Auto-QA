import './commercial.css';
import './style.css';
export const metadata = { title: 'AutoQA', description: 'Plataforma de pruebas automatizadas' };
export default function Layout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="es"><body><main>{children}</main></body></html>; }
