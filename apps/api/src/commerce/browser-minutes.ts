import type { PlanCapability } from '@prisma/client';

export function browserMinutesLimit(
  planCode: string,
  capability?: Pick<PlanCapability, 'availability' | 'monthlyLimit'>,
): number | null {
  if (!capability || capability.availability === 'NOT_INCLUDED') return 0;
  if (planCode === 'enterprise' && capability.monthlyLimit === null) return null;
  return capability.monthlyLimit ?? 0;
}
