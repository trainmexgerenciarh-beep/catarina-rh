# Biblioteca documental de Catarina RH

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

El resultado de implementación, pruebas y límites se completa al cerrar la entrega.
