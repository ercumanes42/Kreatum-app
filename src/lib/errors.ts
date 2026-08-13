type ErrorLike = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
};

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email o contraseña incorrectos.',
  'auth/invalid-email': 'El email no tiene un formato válido.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  'auth/network-request-failed': 'No se pudo conectar con el servicio de acceso.',
  'functions/already-exists': 'Ese código de sala ya está en uso. Elige otro.',
  'functions/failed-precondition': 'La operación ya no es válida para el estado actual de la partida.',
  'functions/invalid-argument': 'Revisa los datos introducidos.',
  'functions/not-found': 'La partida no está disponible. Comprueba el código con el facilitador.',
  'functions/permission-denied': 'No tienes permisos para realizar esta operación.',
  'functions/resource-exhausted': 'Se alcanzó temporalmente el límite de intentos. Espera un minuto.',
  'functions/unauthenticated': 'La sesión ha caducado. Vuelve a identificarte.',
  'functions/unavailable': 'El servicio no está disponible en este momento. Reintenta en unos segundos.',
  'permission-denied': 'No tienes permisos para acceder a estos datos.',
  'unavailable': 'No hay conexión con el servicio. Comprueba la red.',
};

const ERROR_REASON_MESSAGES: Record<string, string> = {
  'invitation-token-signing': 'La activación está temporalmente indisponible. Contacta con el Administrador.',
};

export const getErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object') return '';
  const code = (error as ErrorLike).code;
  return typeof code === 'string' ? code : '';
};

export const getUserFacingError = (
  error: unknown,
  fallback = 'No se pudo completar la operación.',
): string => {
  const details = error && typeof error === 'object'
    ? (error as ErrorLike).details
    : null;
  const reason = details && typeof details === 'object'
    ? (details as { reason?: unknown }).reason
    : null;
  if (typeof reason === 'string' && ERROR_REASON_MESSAGES[reason]) {
    return ERROR_REASON_MESSAGES[reason];
  }
  const code = getErrorCode(error);
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];

  if (error instanceof Error) {
    const safeMessages = [
      'Falta configurar VITE_DEFAULT_ORGANIZATION_ID',
      'Solo el Alquimista autenticado',
      'La sesi\u00f3n de administrador no se pudo validar',
      'Ya estás registrado en el Equipo',
      'La partida ya no está activa',
    ];
    if (safeMessages.some((message) => error.message.includes(message))) {
      return error.message;
    }
  }
  return fallback;
};
