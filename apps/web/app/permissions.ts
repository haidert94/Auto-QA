import type { OrgRole } from './autoqa-server';

// Matriz de permisos espejo de @RequiresRole en el backend. El servidor sigue
// siendo la fuente de verdad; estas banderas ocultan botones para evitar que el
// usuario haga clic en algo que la API rechazaría con 403. Nunca al revés:
// no mostrar una acción aquí no hace falta explicar en la UI por qué está
// deshabilitada — simplemente no aparece.
const ROLE_RANK: Record<OrgRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };

function atLeast(role: OrgRole | undefined, min: OrgRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export type Permission =
  // Proyectos
  | 'project.create' | 'project.update' | 'project.delete'
  // Escenarios
  | 'scenario.create' | 'scenario.update' | 'scenario.delete' | 'scenario.suggest'
  // Runs
  | 'run.execute' | 'run.explain'
  // Automatización
  | 'automation.generate' | 'automation.select'
  // Documentos
  | 'document.upload' | 'document.analyze' | 'document.validate' | 'document.delete'
  // Monitores
  | 'monitor.create' | 'monitor.update' | 'monitor.delete'
  // Exploración
  | 'exploration.create'
  // Pruebas de carga
  | 'load.create'
  // Performance
  | 'performance.create'
  // ICSP
  | 'icsp.snapshot'
  // Miembros
  | 'members.manage' | 'members.changeRole'
  // Facturación
  | 'billing.checkout' | 'billing.cancel';

const RULES: Record<Permission, OrgRole> = {
  'project.create': 'ADMIN',
  'project.update': 'EDITOR',
  'project.delete': 'ADMIN',

  'scenario.create': 'EDITOR',
  'scenario.update': 'EDITOR',
  'scenario.delete': 'EDITOR',
  'scenario.suggest': 'EDITOR',

  'run.execute': 'EDITOR',
  'run.explain': 'EDITOR',

  'automation.generate': 'EDITOR',
  'automation.select': 'EDITOR',

  'document.upload': 'EDITOR',
  'document.analyze': 'EDITOR',
  'document.validate': 'ADMIN',
  'document.delete': 'ADMIN',

  'monitor.create': 'EDITOR',
  'monitor.update': 'EDITOR',
  'monitor.delete': 'ADMIN',

  'exploration.create': 'EDITOR',
  'load.create': 'ADMIN',
  'performance.create': 'EDITOR',
  'icsp.snapshot': 'ADMIN',

  'members.manage': 'ADMIN',
  'members.changeRole': 'OWNER',

  'billing.checkout': 'OWNER',
  'billing.cancel': 'OWNER',
};

export function can(role: OrgRole | undefined, permission: Permission): boolean {
  return atLeast(role, RULES[permission]);
}

export function roleLabel(role: OrgRole): string {
  return role;
}
