# Administración de Plataforma GFS

`platformAdmin` es un privilegio excepcional. No debe asignarse por dominio, membresía empresarial ni desde el frontend. Firestore y Storage deniegan el acceso global directo incluso con el claim; las operaciones globales pasan por callables que revalidan el usuario en Firebase Auth y registran auditoría.

## Mínimo privilegio

- Usar una identidad operadora individual, con MFA y sin roles Owner/Editor del proyecto.
- Conceder temporalmente un rol IAM personalizado limitado a `firebaseauth.users.get` y `firebaseauth.users.update` en staging.
- Usar Application Default Credentials; no descargar claves JSON de cuentas de servicio.
- Retirar el rol IAM temporal al finalizar y conservar el ticket de aprobación.
- No usar cuentas anónimas ni compartir UIDs, tokens o correos en logs.

La API de Identity Platform exige `firebaseauth.users.update` para modificar una cuenta y `firebaseauth.users.get` para leerla. `setCustomUserClaims` reemplaza el mapa completo, por lo que el procedimiento debe preservar claims ajenos.

Referencias oficiales: [claims personalizados de Firebase](https://firebase.google.com/docs/auth/admin/custom-claims) y [permisos IAM de Identity Platform](https://cloud.google.com/identity-platform/docs/access-control).

## Asignar o revocar el claim

Ejecutar desde `functions/` únicamente contra staging. El argumento es el UID, no el correo.

```powershell
gcloud auth application-default login
$env:GOOGLE_CLOUD_PROJECT = "kreatum-dinamic-staging"
node --input-type=module -e "import {applicationDefault,initializeApp} from 'firebase-admin/app'; import {getAuth} from 'firebase-admin/auth'; initializeApp({credential:applicationDefault(),projectId:process.env.GOOGLE_CLOUD_PROJECT}); const [uid,mode]=process.argv.slice(1); if(!/^[A-Za-z0-9_-]{3,128}$/.test(uid)||!['grant','revoke'].includes(mode)) throw new Error('Argumentos invalidos'); const auth=getAuth(); const user=await auth.getUser(uid); if(user.disabled) throw new Error('Usuario deshabilitado'); const claims={...(user.customClaims??{})}; if(mode==='grant') claims.platformAdmin=true; else delete claims.platformAdmin; await auth.setCustomUserClaims(uid,claims); await auth.revokeRefreshTokens(uid); const verified=await auth.getUser(uid); if((verified.customClaims?.platformAdmin===true)!==(mode==='grant')) throw new Error('Verificacion fallida'); console.log('Claim actualizado, verificado y tokens de refresco revocados.');" -- <uid> grant
```

Para revocar, repetir el mismo comando sustituyendo `grant` por `revoke`. El script conserva el resto de claims, rechaza usuarios deshabilitados, verifica el resultado y revoca tokens de refresco.

Después de asignar o revocar:

1. Cerrar sesión en todos los dispositivos y volver a autenticarse, o forzar `getIdToken(true)`.
2. Confirmar que `grant` permite abrir `/platform` y ejecutar una callable de solo lectura.
3. Confirmar que `revoke` devuelve `permission-denied` en esa misma callable.
4. Confirmar en pruebas que el claim no permite lecturas directas de `organizations`, `workshops`, informes o Storage.
5. Retirar el rol IAM temporal de la identidad operadora.

Revocar tokens impide obtener nuevos tokens con el claim anterior; los callables vuelven a consultar el usuario actual, por lo que una revocación queda bloqueada server-side aunque un cliente conserve temporalmente un ID token antiguo.

## Orden de activación seguro

1. Completar dry-run, apply y verify de `migrate-platform-access.mjs` en staging.
2. Desplegar Functions con autorización tenant y auditoría.
3. Ejecutar pruebas A/B y de descarga/generación auditada.
4. Desplegar índices, Firestore Rules y Storage Rules.
5. Asignar `platformAdmin` solo al operador aprobado y ejecutar smoke.

No usar este procedimiento en producción dentro de esta entrega.
