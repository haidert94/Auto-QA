import { createHash } from 'node:crypto';
import type { Environment } from '@prisma/client';

type ValidationEnvironment = Pick<Environment, 'type' | 'baseUrl' | 'readOnly' | 'authorizationConfirmed'
  | 'authorizedAt' | 'allowedHosts' | 'allowedPaths' | 'excludedPaths' | 'prohibitedActions'>;

export function validationScopeSignature(env: ValidationEnvironment) {
  return createHash('sha256').update(JSON.stringify([env.type, env.baseUrl, env.readOnly,
    env.authorizationConfirmed, env.authorizedAt, env.allowedHosts, env.allowedPaths, env.excludedPaths,
    env.prohibitedActions])).digest('hex');
}
