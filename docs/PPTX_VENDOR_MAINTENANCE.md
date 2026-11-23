# Distribución local revisada de PptxGenJS

## Alcance

KREATUM conserva PptxGenJS 4.0.1, su API, código ejecutable, tipos, documentación y licencia MIT originales. La dependencia Functions apunta a `file:vendor/pptxgenjs-4.0.1.tgz`, empaquetada desde `functions/vendor/pptxgenjs`. El único cambio al manifiesto upstream es retirar `dependencies.image-size`, que no se utiliza en el runtime 4.0.1. No se cambia el número de versión ni se ocultan avisos de auditoría.

El tarball oficial se verificó en memoria contra SHA512 del lock anterior y se compararon sus diez archivos byte a byte con el paquete instalado antes de copiarlo. `functions/vendor/pptxgenjs/PROVENANCE.json` conserva origen, integridad upstream, integridad de la distribución revisada y SHA256; `upstream.package.json` conserva el manifiesto original. Los archivos de runtime no se editan. `.gitattributes` conserva sus bytes al pasar entre Windows y Linux.

Se distribuye un tarball en lugar de un enlace a directorio: npm instala los enlaces locales con las herramientas de desarrollo upstream, que no forman parte del runtime y amplían innecesariamente la superficie. El archivo local se crea desde la raíz con `npm pack ./functions/vendor/pptxgenjs --pack-destination ./functions/vendor --ignore-scripts`. Su integridad queda fijada en procedencia y lock, y los tests comparan cada archivo empaquetado e instalado contra las fuentes revisadas.

## Motivo y límites

Los avisos GHSA-w3rx-r6r6-pgpr y GHSA-5p2g-fcmc-qvqq afectan a image-size hasta 2.0.2 sin parche publicado al verificarlo. No son un fallo independiente del motor de diapositivas. El código upstream `src/gen-media.ts` (tag v4.0.1, líneas 188–222) deja la antigua función de medición comentada. KREATUM proporciona PNG internos codificados y dimensiones explícitas.

La mitigación elimina realmente el paquete image-size del árbol instalado y del lock. No acepta el riesgo mediante una excepción del scanner. PDF sigue usando PDFKit; PPTX conserva el mismo motor. Esta decisión no certifica que el resto del paquete o de la plataforma carezca de vulnerabilidades.

Fuentes: https://github.com/gitbrent/PptxGenJS/tree/v4.0.1 ; https://registry.npmjs.org/pptxgenjs/-/pptxgenjs-4.0.1.tgz ; https://github.com/advisories/GHSA-w3rx-r6r6-pgpr ; https://github.com/advisories/GHSA-5p2g-fcmc-qvqq .

## Verificación obligatoria

- `npm --prefix functions test`: incluye integridad de todos los archivos, diferencia exacta de manifiesto, ausencia del parser instalado/lock y PPTX con carga del parser expresamente bloqueada; mantiene la prueba existente de PDF/PPTX completos, orden y contenido.
- `npm --prefix functions run typecheck` y `npm run audit:security`.
- Puerta completa de publicación, prueba de informes en staging e inspección visual PDF/PPTX antes de producción. Ninguna comprobación operativa pendiente queda dispensada.

## Mantenimiento y actualización

Responsable: mantenedores de KREATUM. Revisar avisos upstream y el registro npm antes de cada publicación. No ejecutar actualizaciones automáticas sobre esta copia. Para adoptar otro release, verificar integridad del tarball, comparar código/dependencias/licencia, regenerar procedencia, revisar cualquier nueva ruta de imágenes y repetir todas las pruebas. Mantener las bibliotecas transitivas en el lock y bajo npm audit; los tests de hash impiden cambios inadvertidos al runtime vendorizado.

Volver al paquete oficial cuando publique un manifiesto sin esta dependencia o una dependencia corregida, después de validar regresiones. El rollback del cambio consiste en restaurar el manifiesto y lock anteriores mediante una revisión controlada; reintroduciría image-size vulnerable y, por tanto, debe volver a bloquear producción. No modificar el gate para permitirlo.
