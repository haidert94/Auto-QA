import localFont from 'next/font/local';
import './commercial.css';
import './style.css';
import './project-detail.css';
import './scenario-workspace.css';
import './automation-workspace.css';

const geist = localFont({
  src: './fonts/geist.woff2',
  variable: '--landing-geist',
  weight: '400 800',
  display: 'swap',
});
const jetBrainsMono = localFont({
  src: './fonts/jetbrains-mono.woff2',
  variable: '--landing-mono',
  weight: '400 600',
  display: 'swap',
});

export const metadata = { title: 'AutoQA', description: 'Plataforma de pruebas automatizadas' };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es" className={geist.variable + ' ' + jetBrainsMono.variable}>
    <body><main>{children}</main></body>
  </html>;
}
