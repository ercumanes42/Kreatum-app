# Informes

## Flujo v2

1. El Alquimista genera un snapshot canónico desde la partida.
2. El servidor elimina campos privados, ordena documentos y calcula SHA-256.
3. El JSON se guarda en Storage privado y se registra como `draft`.
4. El Alquimista puede editar resumen ejecutivo, observaciones y próximos pasos.
5. `publish` congela la edición y permite lectura a analistas de la organización.

Todas las operaciones son autenticadas, autorizadas e idempotentes. El cliente obtiene el archivo con un enlace temporal autorizado; no existen URLs públicas permanentes.

## IAM mínimo de la cola

La identidad runtime de la callable que encola informes necesita:

- `roles/cloudtasks.enqueuer` en el proyecto para crear la tarea.
- `roles/iam.serviceAccountUser` exclusivamente sobre esa misma cuenta de servicio para poder usarla como identidad OIDC (`iam.serviceAccounts.actAs`).

No otorgar `Editor` ni `Service Account User` a nivel de proyecto. Tras cambiar IAM, verificar una generación real y confirmar que el job termina en `completed` con PDF, PPTX y JSON.

## Integridad

El registro conserva versión de esquema, versión de exportación, versión de plantilla y `sourceSnapshotHash`. Para auditar un informe, descargar el snapshot autorizado, canonicalizarlo con la misma versión y comparar el hash.

## Alcance actual

El backend v2 produce un snapshot JSON verificable y un job persistente genera PDF y PPTX en servidor. Antes de publicar, valida cabeceras binarias, tamaño, hash y versión de plantilla. Los artefactos se guardan en Storage privado y solo se descargan mediante una URL temporal autorizada y auditada.

El archivo legado `kreatum_report_builder.html` se conserva únicamente como referencia; no participa en el flujo canónico de informes.
