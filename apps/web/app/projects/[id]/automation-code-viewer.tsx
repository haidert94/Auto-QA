'use client';

import { Check, Code2, Copy, FileCode2, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { playwrightConfig, type GeneratedSpec } from './automation-export';

function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\/\/.*$|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b(?:import|from|const|let|async|await|test|expect|export|default|return)\b)/g);
  return <>{parts.map((part, i) => <span key={i} className={part.startsWith('//') ? 'code-comment' : /^["'`]/.test(part) ? 'code-string'
    : /^(import|from|const|let|async|await|test|expect|export|default|return)$/.test(part) ? 'code-keyword' : undefined}>{part}</span>)}</>;
}

export function AutomationCodeViewer({ specs, activeId, onSelect, generating }: {
  specs: GeneratedSpec[]; activeId: string | null; onSelect: (id: string) => void; generating: boolean;
}) {
  const editor = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const group = useId();
  const files = [...specs.filter(spec => !spec.error).map(spec => ({ id: spec.scenarioId, filename: spec.filename, code: spec.code })),
    ...(specs.some(spec => !spec.error) ? [{ id: 'configuration', filename: 'playwright.config.ts', code: playwrightConfig }] : [])];
  const active = activeId ? files.find(file => file.id === activeId) : files[0];

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === editor.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => { setCopied(false); setNotice(''); }, [active?.id, active?.code]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    if (!active) return;
    try { await navigator.clipboard.writeText(active.code); setCopied(true); setNotice('Código copiado.'); }
    catch { setNotice('No se pudo copiar. Selecciona el código y cópialo manualmente.'); }
  }
  async function expand() {
    try { if (fullscreen) await document.exitFullscreen(); else await editor.current?.requestFullscreen(); }
    catch { setNotice('El navegador no permitió ampliar el visor.'); }
  }

  return <section className="automation-editor" ref={editor} aria-label="Visor de código Playwright">
    <header className="automation-editor__head">
      <div className="automation-file-tabs" role="tablist" aria-label="Archivos de automatización">
        {files.map((file, index) => <button type="button" key={file.id} role="tab" id={`${group}-${index}`} aria-selected={active?.id === file.id}
          tabIndex={active?.id === file.id ? 0 : -1} aria-controls={`${group}-code`} title={file.filename}
          onClick={() => onSelect(file.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % files.length : event.key === 'ArrowLeft' ? (index - 1 + files.length) % files.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? files.length - 1 : null;
            if (next === null) return;
            event.preventDefault(); onSelect(files[next].id); document.getElementById(`${group}-${next}`)?.focus();
          }}><Code2 size={12} />{file.filename}</button>)}
        {!files.length && <span className="automation-editor__empty-tab"><Code2 size={13} />Código Playwright</span>}
      </div>
      <span className="automation-language">TypeScript</span>
      <div className="automation-editor__tools"><button type="button" aria-label="Copiar código" disabled={!active} onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
        <button type="button" aria-label={fullscreen ? 'Restaurar visor de código' : 'Ampliar visor de código'} onClick={() => void expand()}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div>
    </header>
    {active ? <div className="automation-code-scroll" id={`${group}-code`} role="tabpanel" aria-labelledby={`${group}-${files.findIndex(file => file.id === active.id)}`} tabIndex={0}>
      <pre className="automation-source"><code>{active.code.split('\n').map((line, i) => <span className="automation-code-line" key={i}>
        <span className="automation-line-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><span><Highlight text={line || ' '} /></span>
      </span>)}</code></pre>
    </div> : <div className="automation-code-empty"><FileCode2 size={32} /><h3>{generating ? 'Generando código…' : 'Prepara tus escenarios para Playwright'}</h3>
      <p>Selecciona un escenario para consultar su código, o genera los seleccionados.</p></div>}
    <footer className="automation-editor__footer"><span>{active ? `${active.code.split('\n').length} líneas · ${active.filename}` : 'Sin archivo generado'}</span>
      <span role="status">{notice || 'Código generado · compilación y ejecución no verificadas'}</span></footer>
  </section>;
}
