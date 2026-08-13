# Seguridad y privacidad

## Controles implementados

- Autenticación obligatoria; participantes anónimos y administradores no anónimos.
- Autorización multi-organización con roles `owner` y `facilitator`; los roles `analyst` históricos quedan denegados hasta su resolución explícita.
- Sesiones temporales por partida y equipo.
- Callables privilegiadas con validación, idempotencia, rate limiting de join, auditoría y correlación.
- Firestore y Storage con denegación por defecto.
- Informes privados, sanitizados y con checksum SHA-256.
- CSP, HSTS, protección contra framing, política de permisos y caché de assets.
- CSV protegido contra inyección de fórmulas.
- Retención de 24 meses, archivo, periodo de gracia y borrado recursivo programado.

## Datos tratados

Metadatos de empresa contratante, facilitador, reto, aportaciones de equipos, identificadores técnicos de Firebase e informes. No se requiere correo, nombre ni cuenta del participante. Evitar introducir datos personales en retos o respuestas y comunicarlo al inicio del taller.

## Responsabilidades externas

- Activar MFA para `owner` y cuentas con acceso a Firebase/Vercel.
- Aplicar mínimo privilegio IAM y revisar miembros trimestralmente.
- Mantener proyectos separados, rotar credenciales y no guardar secretos en Git.
- Configurar App Check por fases y alertas operativas.
- Formalizar base legal, aviso de privacidad, encargados, retención y ejercicio de derechos.
- Revisar backups y restauración al menos semestralmente.

Las claves web de Firebase identifican el proyecto pero no sustituyen reglas, App Check ni cuotas. Las credenciales de servicio, tokens y secretos solo viven en gestores de secretos/CI.

## Gestión de vulnerabilidades

CI ejecuta lint, TypeScript, pruebas, builds y `npm audit --audit-level=high`. Las vulnerabilidades moderadas transitivas de herramientas Firebase deben registrarse y revisarse en cada actualización; no aplicar `audit fix --force` sin prueba de compatibilidad.

## Notificación

Los errores mostrados al usuario son genéricos e incluyen correlación cuando existe. Logs de servidor solo deben contener operación, categoría de error e identificadores hash; nunca contenido de talleres, códigos de sala, correos o UID.