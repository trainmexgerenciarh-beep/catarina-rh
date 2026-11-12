# Biblioteca documental de Catarina RH

## Estado vigente — biblioteca con aprobación delimitada

La carpeta institucional indicada por Trainmex se comprobó con lectura de Drive:
contiene las políticas de vacaciones y de permisos/licencias. El procedimiento
interno de vacaciones está fuera de esa carpeta. Esos documentos reales no se
aprobaron ni se escribieron en Neon durante esta ejecución; no hay raíz ni
documentos registrados en la tabla `fuentes` porque la cuenta administrativa
todavía no está configurada.

El panel precarga la carpeta autorizada **solo para la sesión del administrador**
cuando se registra la primera raíz. Al registrar, el servidor valida que sea una
carpeta accesible y, al sincronizar, comprueba listado completo, permisos y hash
de Docs/PDF. Los nuevos documentos comienzan como BORRADOR; un cambio requiere
nueva revisión y nunca publica automáticamente. La ficha permite revisar versión,
tipo, fechas sustentadas y texto leído temporalmente. El administrador decide si
es política apta para colaboradores y aprueba solamente fragmentos exactos y un
alcance explícito. Los procedimientos internos no se aprueban completos ni se
convierten automáticamente en reglas para trabajadores.

**Consulta en producción:** Catarina usa solo los fragmentos exactos con
aprobación vigente y estado activo que ya están almacenados en Neon. No lee Drive
ni conserva el documento completo por cada mensaje. Al usar **Sincronizar /
Revisar cambios**, la app detecta modificación de contenido/título, archivo
retirado o pérdida de permiso; pone la revisión pendiente/inactiva, bloquea la
respuesta y conserva la aprobación anterior únicamente como historial no
publicado. La carpeta no tiene Drive watch ni sincronización automática; un cambio
externo no puede conocerse hasta la siguiente sincronización manual. No se asignó
una frecuencia no aprobada ni se afirma invalidación instantánea antes de ella.

**Activación pendiente:** `RH_ADMIN_ACCOUNTS` no está configurado; el administrador
no puede iniciar sesión y registrar/sincronizar la carpeta. No hay cuentas reales,
raíces, políticas aprobadas ni datos nuevos en Neon. Consulte
[Activación de administración y biblioteca](ACTIVACION_ADMIN_BIBLIOTECA.md).

## Cambio mínimo autorizado y control de datos

El esquema de `fuentes` solo tiene enlace, título, categoría, versión, fecha y
activo; no representa carpetas, revisión/hash, aprobación de fragmentos o cambios
pendientes. Se conserva la tabla y se agrega **una columna nullable JSONB**:

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
ALTER TABLE public.fuentes ADD COLUMN biblioteca JSONB;
COMMIT;
```

Sin tablas, índices, triggers ni modificación de las columnas anteriores.
Sin rellenar o publicar filas preexistentes. El script explícito
`scripts/migrate-document-library.mjs --authorized-library-column` verifica
compatibilidad, preserva huellas de las 16 tablas (excluyendo la nueva columna
NULL) y deja evidencia agregada. No se ejecuta al iniciar la aplicación.

Reversión segura inicial: deshabilitar uso de biblioteca sin borrar datos.
No ejecutar DROP ni eliminar aprobaciones/configuración; cualquier reversión
destructiva posterior necesita autorización. Las filas antiguas sin contrato de
aprobación delimitada no se usan automáticamente para responder a trabajadores.

El documento real de vacaciones es ejemplo de **procedimiento interno borrador**.
Su emisión no demuestra vigencia ni autorización para colaboradores. No se
aprueba durante el desarrollo ni se guarda su contenido completo en el repositorio.

El detalle de implementación, pruebas y límites de este corte se documenta en
[Activación de administración y biblioteca](ACTIVACION_ADMIN_BIBLIOTECA.md).
