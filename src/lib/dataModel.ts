export type DataModelVersion = 'legacy' | 'v2';

const configuredDataModel = import.meta.env.VITE_KREATUM_DATA_MODEL?.trim().toLowerCase();

export const dataModelVersion: DataModelVersion =
  configuredDataModel === 'legacy' ? 'legacy' : 'v2';

export const isV2DataModel = dataModelVersion === 'v2';

export const workshopCollectionName = isV2DataModel ? 'workshops' : 'games';

export const configuredDefaultOrganizationId =
  import.meta.env.VITE_DEFAULT_ORGANIZATION_ID?.trim() || '';
const SELECTED_ORGANIZATION_STORAGE_KEY = 'kreatum_selected_organization_id';

const readStoredOrganizationId = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(SELECTED_ORGANIZATION_STORAGE_KEY)?.trim() || '';
};

// Mutable export keeps existing consumers compatible; ESM imports are live bindings.
export let defaultOrganizationId = readStoredOrganizationId() || configuredDefaultOrganizationId;

export const setSelectedOrganizationId = (organizationId: string) => {
  const normalized = organizationId.trim();
  defaultOrganizationId = normalized || configuredDefaultOrganizationId;
  if (typeof window === 'undefined') return;
  if (normalized) window.localStorage.setItem(SELECTED_ORGANIZATION_STORAGE_KEY, normalized);
  else window.localStorage.removeItem(SELECTED_ORGANIZATION_STORAGE_KEY);
};

export const getSelectedOrganizationId = () => defaultOrganizationId;

export const requireDefaultOrganizationId = () => {
  if (!defaultOrganizationId) {
    throw new Error(
      'No hay una organización administrativa seleccionada.',
    );
  }
  return defaultOrganizationId;
};
