const DEFAULT_ALLOWED_PROJECTS = ['kreatum-dinamic-staging'];

export const migrationProjectAllowed = (projectId) => {
  if (typeof projectId !== 'string' || projectId.length === 0) return false;
  if (projectId.startsWith('demo-')) return true;
  const configured = (process.env.KREATUM_MIGRATION_ALLOWED_PROJECTS || DEFAULT_ALLOWED_PROJECTS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(projectId);
};

export const assertMigrationProjectAllowed = (projectId) => {
  if (!migrationProjectAllowed(projectId)) {
    throw new Error('Proyecto rechazado: la migración solo permite emuladores o staging en allowlist.');
  }
};
