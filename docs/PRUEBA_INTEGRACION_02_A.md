# Prueba controlada de integración Neon — Iteración 02-A

Fecha: 10 de noviembre de 2026. Autorización: prueba aislada con datos
sintéticos, sin avance a 02-B. Replit ejecuta y documenta; ChatGPT/Trainmex
validan y actualizan el control oficial de Google Drive. No se editó Drive.

## Método y precondiciones comprobadas

Se revisaron primero, en solo lectura, las columnas de las 11 tablas, claves
primarias/foráneas, nulabilidad, identidad, restricciones, disparadores y
políticas. Se confirmó `tickets.id_mensaje_confirmacion TEXT UNIQUE` opcional,
catálogo activo 15 = 8/5/2, sin disparadores de usuario ni RLS en las tres tablas
de escritura. Dependencias relevantes:

- `tickets` referencia `colaboradores` y `servicios`.
- `citas` referencia `tickets`; `consultas` referencia los tres.
- `denuncias` referencia `colaboradores`; `encuestas` referencia `citas` y
  `seguimientos_denuncia` referencia `denuncias`.

No se usaron personas, teléfonos ni servicios operativos como fixtures.
Se eligió **una transacción exterior con ROLLBACK**, no inserciones persistidas:
un colaborador marcado inequívocamente como sintético con teléfono NULL, un
servicio sintético de categoría Nómina con ID negativo aleatorio comprobado
ausente, y una clave de confirmación sintética única. No se imprimieron sus
identificadores, textos ni folio.

Antes de escribir se capturaron conteos y huellas internas del contenido de las
11 tablas. Se tomó un bloqueo transaccional `SHARE ROW EXCLUSIVE NOWAIT` sobre
las tablas revisadas: permite lecturas y evita carreras con escritores durante
la breve prueba; si no se puede adquirir, se aborta antes de insertar. Se
revalidaron esquema/conteos bajo bloqueo. Las consultas tienen límites de
espera/ejecución y la transacción un límite de inactividad.

Limpieza definida de antemano: ROLLBACK exterior, nunca DELETE por prefijo,
TRUNCATE, reinicio de secuencias ni borrado de datos ajenos. Antes de cada
operación del adaptador se comprobaron la identidad exacta de los fixtures,
ausencia de citas y número esperado de tickets. También se comprobó ausencia
del ID de servicio antes de insertarlo. Cualquier excepción dispara ROLLBACK;
si no se pudiera confirmar la limpieza se informa como fallo, no como PASS.

## Adaptador probado y alcance de la transacción

Se importó **el adaptador existente sin modificarlo**. Un envoltorio exclusivo
del test traduce sus límites BEGIN/COMMIT a SAVEPOINT/RELEASE y su ROLLBACK a
ROLLBACK TO SAVEPOINT. El resto del SQL real, parámetros, restricciones, lecturas,
INSERT ON CONFLICT y UPDATE se ejecuta en Neon. No hay COMMIT exterior.

Esto verifica el SQL real y la unicidad ante reintentos **secuenciales dentro
de una conexión**, pero no el comportamiento del COMMIT real, la durabilidad,
la recuperación después de reiniciar procesos ni la concurrencia entre
conexiones. No se presentan como PASS esas pruebas no ejecutadas. Para
comprobarlas hacen falta fixtures confirmados temporalmente y un ensayo
separado; esta ejecución prefirió el aislamiento sin persistir datos.

## Resultados reales

| Comprobación | Resultado |
|---|---|
| Inspección y compatibilidad | **PASS**, 11 tablas y UNIQUE vigente; sin DDL. |
| INSERT del ticket ficticio | **PASS**, exactamente un ticket pendiente de cita; cierre y resolución nulos. |
| Folio estable | **PASS**, `NOM-<id_ticket>` devuelto, sin imprimir valor. |
| Dos confirmaciones repetidas | **PASS**, misma clave, mismo ticket/folio y conteo 1. |
| Recuperación de respuesta perdida | **PASS limitado**, se descartó la referencia del adaptador y otro adaptador recuperó el mismo registro por clave/propietario en la misma transacción. No fue un fallo real de red ni reinicio. |
| Negativa expresa a agendar | **PASS**, `estado = cerrado sin cita`, `cerrado_en` no nulo, `resuelto_en` NULL y resultado de negativa/no resuelto. |
| Repetición del cierre | **PASS**, conserva el mismo cierre y fecha, sin marcar resuelto. |
| Ausencia de citas/otros efectos | **PASS**, cero citas; ocho tablas no escritas conservaron huellas/conteos incluso antes del rollback. |
| Limpieza | **PASS**, ROLLBACK confirmado; cero residuos identificados por claves exactas, esquema y huellas/conteos de las 11 tablas iguales al inicio. |
| Concurrencia real / COMMIT durable / reinicio con Neon | **NO EJECUTADOS**, por elección de transacción única sin persistencia. |

### Conteos capturados

| Tabla | Inicial | Dentro de la transacción | Final |
|---|---:|---:|---:|
| colaboradores | 0 | 1 | 0 |
| servicios | 15 | 16 | 15 |
| tickets | 0 | 1 | 0 |
| citas | 0 | 0 | 0 |
| consultas | 0 | 0 | 0 |
| denuncias | 0 | 0 | 0 |
| encuestas | 0 | 0 | 0 |
| fuentes | 0 | 0 | 0 |
| horarios_atencion | 0 | 0 | 0 |
| bloqueos_agenda | 0 | 0 | 0 |
| seguimientos_denuncia | 0 | 0 | 0 |

Se crearon únicamente tres filas sintéticas dentro de la transacción y se
retiraron las tres mediante ROLLBACK; no hubo filas confirmadas ni DELETE.
El servicio sintético no fue visible para otras transacciones. El catálogo
operativo termina con los mismos 15 servicios y contenido íntegro.

**Efecto no transaccional:** hubo tres intentos INSERT del adaptador (inicial y
dos conflictos). PostgreSQL puede consumir valores de la secuencia IDENTITY
incluso si hay conflicto o ROLLBACK. No se midió su avance exacto ni se
restableció; los huecos no son tickets residuales y no cambian folios existentes.
No se promete reversión de secuencias.

## Comandos ejecutados

- `npm run test:payroll:neon -- --rollback-authorized`: **PASS**, ensayo anterior.
  Sin esa opción, el comando nuevo solo realiza inspección de lectura.
  La opción técnica no constituye autorización para futuras ejecuciones:
  cada ensayo con escrituras debe respetar el permiso y condiciones del proyecto.
- `npm run test:payroll`: **PASS**, 15 grupos simulados.
- `npm run test:conversation`: **PASS**.
- `npm run test:processing`: **PASS completo**, 32 comprobaciones locales y
  catálogo real/Gemini, incluidos pago y requisitos del premio y sin clasificar.
- `npm run test:webhook`: **PASS**, firma válida 200, incorrecta/ausente 401.
- `npm run check`: **PASS**, 0 errores y 0 advertencias.
- `npm run build`: **PASS**, sin publicación.

Persisten los avisos anteriores de semántica futura SSL de pg y selección de
destino productivo de adapter-auto; no impidieron las pruebas y no se cambiaron
Secrets ni configuración para ocultarlos.

## Límites y siguiente decisión

El webhook **sigue usando repositorio simulado en memoria**; no se activó el
adaptador Neon en la aplicación. Esta evidencia no declara operativa la
recepción real con WhatsApp. No hubo envíos, reservas, citas, cambios de esquema,
Meta, Secrets, despliegue o visibilidad de GitHub. 02-B y demás módulos no se
iniciaron. La recuperación/concurrencia durables entre conexiones siguen
pendientes; aceptación y siguiente autorización corresponden a ChatGPT/Trainmex.
