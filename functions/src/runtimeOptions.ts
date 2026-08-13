const configuredRuntimeServiceAccount = process.env.KREATUM_RUNTIME_SERVICE_ACCOUNT?.trim();

export const RUNTIME_SERVICE_ACCOUNT = configuredRuntimeServiceAccount || undefined;
