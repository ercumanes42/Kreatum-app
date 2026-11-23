# KREATUM — Confirmación de entrega de alertas

Entorno: `kreatum-dinamic-staging`. Comprobación del 11/09/2026 mediante consulta autorizada del buzón destinatario y capturas aportadas por el usuario. No se modificaron mensajes ni se mostraron credenciales.

| Alerta | Recepción UTC | Evidencia de incidente sintético |
|---|---|---|
| Access | 16:04:11 | `0.ocibaf0xksz8` |
| Reports | 18:43:20 | `0.ociexa8z9tds` |
| Backups | 18:43:20 | `0.ociexa8z9tdz` |
| Completion | 18:43:21 | `0.ociexa8z9te6` |

Los tres avisos restantes corresponden al probe `security-validation-20260911-184242`, enviado a las 18:42:42.425 UTC. Entrega observada en aproximadamente 38–39 segundos. Las tres capturas del usuario confirman además su recepción. Los eventos se identificaron como pruebas controladas: no se provocaron fallos de clientes ni se ejecutó una operación de backup fallida.

Se verificó que las cuatro políticas están habilitadas y utilizan el canal verificado de staging. La primera emisión de los tres probes a las 17:15 no acredita entrega; la evidencia válida es la emisión y recepción de las 18:42–18:43. No se atribuye sin prueba una causa definitiva a la primera ausencia.

## Alcance y límites

- Confirmada la llegada al buzón de las cuatro categorías; el punto solicitado de recepción queda comprobado.
- Las condiciones observadas cubren errores registrados, no todas las latencias, rechazos 4xx o ausencia de backups.
- `autoClose=1800s` es configuración, no evidencia por sí sola de cierre del incidente. Los probes son eventos puntuales; no representan una recuperación real del servicio.
- No se crearon ni activaron políticas en producción. Esa publicación requiere el nuevo GO solicitado por el usuario.
- La recepción de la alerta de backups no demuestra recuperación de archivos. La lectura `storage.objects.get` sigue denegada a la identidad conectada; ese control permanece pendiente.
