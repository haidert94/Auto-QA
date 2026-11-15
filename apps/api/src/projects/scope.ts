import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export type ScopePath = { host: string; path: string };

export function normalizeHost(value: string): string {
  const input = value.trim();
  const host = /^[\p{L}\p{N}.-]+$/u.test(input) ? domainToASCII(input).toLowerCase() : '';
  const labels = host.split('.');
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (
    host.length > 253 || labels.length < 2 || labels.some(label => !validLabel.test(label)) ||
    isIP(host) || /(^|\.)(localhost|local|internal|home\.arpa)$/.test(host)
  ) {
    throw new BadRequestException('Usa dominios válidos sin comodines, IP ni nombres de red local');
  }
  return host;
}

function normalizePath(value: string): string {
  const path = value.trim();
  if (
    !/^\/[A-Za-z0-9._~!$&'()+,=:@/-]*$/.test(path) ||
    path.includes('//') || path.split('/').some(segment => segment === '.' || segment === '..')
  ) {
    throw new BadRequestException('Usa rutas absolutas sin comodines, codificación porcentual ni segmentos ambiguos');
  }
  return path === '/' ? path : path.replace(/\/$/, '');
}

export function parseBaseUrl(value: string): { url: string; host: string; path: string } {
  const match = /^https:\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(value.trim());
  if (!match) {
    throw new BadRequestException('Se requiere una URL HTTPS sin credenciales, parámetros, fragmentos ni puerto personalizado');
  }
  const host = normalizeHost(match[1].replace(/:443$/, ''));
  const rawPath = match[2] ?? '/';
  const path = normalizePath(rawPath);
  return { url: `https://${host}${rawPath}`, host, path };
}

export function normalizeScopePaths(entries: ScopePath[], hosts: string[]): ScopePath[] {
  const unique = new Map<string, ScopePath>();
  for (const entry of entries) {
    const host = normalizeHost(entry.host);
    const path = normalizePath(entry.path);
    if (!hosts.includes(host)) {
      throw new BadRequestException('Cada ruta debe pertenecer a un dominio permitido del mismo entorno');
    }
    unique.set(host + path, { host, path });
  }
  return [...unique.values()];
}

export function matchesScope(target: ScopePath, scope: ScopePath[]): boolean {
  return scope.some(({ host, path }) =>
    host === target.host && (path === '/' || path === target.path || target.path.startsWith(path + '/')),
  );
}
