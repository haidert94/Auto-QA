export type MonitorHttpCheck = { method: string; minStatus: number; maxStatus: number };

export const defaultMonitorHttpCheck: MonitorHttpCheck = { method: 'GET', minStatus: 200, maxStatus: 399 };

export const monitorHttpCheckFields = { method: true, minStatus: true, maxStatus: true } as const;
