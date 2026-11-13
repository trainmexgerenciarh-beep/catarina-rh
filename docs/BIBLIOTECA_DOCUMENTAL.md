# Biblioteca documental de Catarina RH

## Estado vigente — administración simplificada

La carpeta institucional está conectada. El administrador activó
**Política de Vacaciones**; **Política para la gestión de permisos y licencias**
permanece como borrador privado. La corrección técnica descrita abajo no aprobó
ni modificó contenido real.

El administrador principal abre una ficha, lee el documento en privado, elige
**Política / preguntas de trabajador** o **Procedimiento interno** y pulsa una
sola vez **Validar y activar**. Una política aprobada queda disponible completa
para consultas, guardada en Neon en fragmentos exactos y acotados. Un
procedimiento interno se puede validar para consulta administrativa, pero nunca
se incluye en respuestas a colaboradores. Generalistas pueden consultar la
biblioteca, no agregar, retirar ni activar documentos.

La categoría es solo una etiqueta de orden/búsqueda y se asigna automáticamente;
no controla la respuesta. La versión se lee del documento si está indicada.
Fechas de emisión, vencimiento y vigencia no se solicitan ni bloquean la
aprobación. El contenido se cita con el título y, cuando existe, la versión.

**Reemplazar o retirar:** al editar un archivo, sincroniza la carpeta; el cambio
lo devuelve a revisión y deja de usarse hasta que el administrador lo valide de
nuevo. **Retirar** conserva el registro pero impide usarlo; no borra ni modifica
el archivo de Drive. Si el documento desaparece o se pierde permiso, la siguiente
sincronización lo bloquea. No existe vigilancia automática de Drive.

La sincronización y lectura del contenido suceden con la identidad conectada a
Drive. No se lee Drive en cada mensaje. No se necesita migración: el flujo usa
la columna `fuentes.biblioteca` existente y deja `vigente_desde` vacío en nuevas
aprobaciones.

### Nota de corrección: texto extraído por Drive

Al activar la segunda política, la primera versión del divisor de texto combinó
párrafos y reconstruyó algunos saltos en blanco. Eso podía hacer fallar la
comprobación literal, aunque el documento fuera accesible. El divisor ahora
conserva segmentos del texto original, incluidos los espacios entre párrafos.
Después de la corrección, vuelve a sincronizar la carpeta y repite **Leer en
privado → Validar y activar** para esa política. No se ha activado en automático.

## Antecedente: migración mínima de la biblioteca

En la iteración inicial el esquema de `fuentes` solo tenía enlace, título,
categoría, versión, fecha y activo; no representaba carpetas, revisión/hash,
aprobación o cambios pendientes. Se conservó la tabla y se agregó **una columna
nullable JSONB**:

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
ALTER TABLE public.fuentes ADD COLUMN biblioteca JSONB;
COMMIT;
```

Esta migración histórica ya está aplicada. No se añaden tablas, índices, triggers
ni modificaciones de otras columnas en la simplificación actual.
Sin rellenar o publicar filas preexistentes. El script explícito
`scripts/migrate-document-library.mjs --authorized-library-column` verifica
compatibilidad, preserva huellas de las 16 tablas (excluyendo la nueva columna
NULL) y deja evidencia agregada. No se ejecuta al iniciar la aplicación.

Reversión segura inicial: deshabilitar uso de biblioteca sin borrar datos.
No ejecutar DROP ni eliminar aprobaciones/configuración; cualquier reversión
destructiva posterior necesita autorización. Las filas antiguas sin contrato de
aprobación delimitada no se usan automáticamente para responder a trabajadores.

El procedimiento de vacaciones sigue clasificado como **procedimiento interno**;
su nombre/versionado no lo convierte en política para colaboradores.

El detalle de implementación, pruebas y límites de este corte se documenta en
[Activación de administración y biblioteca](ACTIVACION_ADMIN_BIBLIOTECA.md).
