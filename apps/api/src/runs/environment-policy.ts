export function supportsScenarioWrites(type?: string | null) {
  return type === 'DEVELOPMENT' || type === 'QA' || type === 'STAGING';
}

export function scenarioRunEnvironmentError(environment: {
  type?: string | null;
  readOnly?: boolean;
  authorizationConfirmed?: boolean;
  authorizedAt?: Date | string | null;
}): string | null {
  if (!environment.authorizationConfirmed) return 'Confirma la autorización del entorno antes de ejecutar.';
  if (environment.readOnly !== false) return null;
  if (!supportsScenarioWrites(environment.type)) return 'Los cambios con datos de prueba solo se permiten en Desarrollo, QA o Preproducción.';
  if (!environment.authorizedAt) return 'Vuelve a confirmar la autorización del entorno con el modo de cambios habilitado.';
  return null;
}
