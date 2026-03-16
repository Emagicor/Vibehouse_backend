/**
 * Defines which roles each actor role is allowed to create.
 * OWNER → can create all roles
 * MANAGER → can create RECEPTION, HOUSEKEEPING_LEAD, MAINTENANCE_LEAD
 * RECEPTION / HOUSEKEEPING_LEAD / MAINTENANCE_LEAD → cannot create anyone
 */
export const ROLE_HIERARCHY: Record<string, string[]> = {
  OWNER: ['MANAGER', 'RECEPTION', 'HOUSEKEEPING_LEAD', 'MAINTENANCE_LEAD'],
  MANAGER: ['RECEPTION', 'HOUSEKEEPING_LEAD', 'MAINTENANCE_LEAD'],
  RECEPTION: [],
  HOUSEKEEPING_LEAD: [],
  MAINTENANCE_LEAD: [],
};
