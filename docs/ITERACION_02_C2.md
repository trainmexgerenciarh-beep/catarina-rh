# Iteración 02-C2 — adaptadores persistentes aislados

Fecha: 11 de noviembre de 2026.
**IMPLEMENTADA / PRUEBAS SIMULADAS Y REGRESIONES PASS / PENDIENTE DE ACEPTACIÓN.**
No es una integración operativa. No se conectaron los adaptadores al webhook,
no hubo escrituras Neon, migraciones, fixtures reales ni ejecución de 02-C3.
ChatGPT/Trainmex validan y autorizan; Replit programa y prueba.

## Fuentes y alcance preservado

Se leyeron los rectores locales, el estado actual de Maestro/Plano/Gestión
mediante exportación GET de Google Drive y [la evidencia de 02-C1](ITERACION_02_C1.md).
El contrato detallado y la conservación de recibos en esta etapa proceden de
la autorización expresa de 02-C2. No se modificaron Drive ni los rectores.

Inspección de Neon exclusivamente SELECT: doce tablas, restricciones de
02-C1 validadas, cinco horarios activos ISO 1–5 de 14:00 a 17:30, 20 minutos;
15 servicios activos; cero tickets, citas y operaciones_citas. La consulta
final tras las suites confirmó los mismos conteos y cinco horarios aprobados.
No se ejecutó DDL ni INSERT/UPDATE/DELETE, ni siquiera dentro de ROLLBACK.
Los INSERT/UPDATE/COMMIT del adaptador se probaron solo con un cliente ficticio.

El motor de 02-A, el motor de agenda 02-B, la clasificación, HMAC y el endpoint
no se reescribieron ni se conectaron a repositorios nuevos. Tampoco se añadió
transporte WhatsApp, lógica documental, encuestas, panel o conversación remota.

## Interfaces y responsabilidades

- `persistence-unit.ts`: `inAgendaTransaction(pool, work)` es la unidad
  transaccional compartida. Una conexión por llamada, BEGIN, límites locales
  5s/60s, bloqueo institucional, trabajo, COMMIT y liberación. No crea pool,
  no consulta Secrets y no llama a Gemini.
- `payroll-tickets.ts`: conserva `TicketRepository` asíncrono y el modelo
  de folio `NOM-id_ticket`, con BIGINT como string. El adaptador Neon utiliza
  la unidad común; protege eventos compartidos y comprueba identidad/servicio.
  El repositorio en memoria utilizado por el webhook sigue seleccionado.
- `agenda-persistence-contract.ts`: tipos de comandos, interfaz asíncrona
  `PersistentAgenda`, huella y validación estricta del recibo versión 1.
- `neon-agenda.ts`: adaptador SQL preparado con `execute`, `findApplied`,
  `findAppointment` y `listAvailable`. Exige opción y modo `SIMULATION_ONLY`.
  Recibe un pool inyectado; no tiene inicialización que lo conecte al webhook.

`SIMULATION_ONLY` identifica el alcance y exige selección explícita, **no**
convierte un pool real en una base de pruebas ni sustituye autorización para
escribir. En esta etapa solo se le inyectó el cliente ficticio. Una futura
ejecución con pool real requiere el paquete y permisos correspondientes.

Los métodos de ticket y agenda son operaciones transaccionales independientes.
No hay transacción anidada ni creación de ticket y cita por un mismo evento.
La primitiva común permite una sola conexión en cada operación; el recibo y
su mutación de cita pertenecen siempre a esa misma transacción.

## Contrato de comandos y recibos

### Identificador y huella

`eventId` debe ser el ID completo original del mensaje Meta, opaco, obligatorio,
no vacío, sin recortar ni sustituir. No se genera fallback por teléfono, lote,
sesión o reloj. Su procedencia auténtica corresponde al llamador autenticado
de la futura integración; no se intenta demostrar con un prefijo supuesto.
Los IDs que aparecen en los tests son inequívocamente ficticios.

El comando incluye propietario para comprobar acceso, ticket decimal string,
tipo de operación, cita origen cuando corresponde, destino explícito con zona,
modalidad y declaración `confirmed: true`. El adaptador no interpreta textos
de consentimiento; el llamador debe obtener confirmación expresa.
No se admite una cancelación con un destino ni una reserva con cita origen.

`huella_parametros` = SHA-256 hexadecimal UTF-8 de JSON compacto del arreglo:

```text
[1, tipo_operacion, id_ticket, id_cita_origen_o_null,
 destino_UTC_ISO_o_null, modalidad]
```

Orden fijo; IDs como strings, sin conversiones Number que pierdan precisión.
Instantes equivalentes se normalizan a ISO UTC con milisegundos.
En CANCELAR el destino es null; los tiempos originales se guardan en resultado.
La huella excluye ID del evento, propietario, teléfono, mensaje, nombre y Secrets.

### Resultado JSONB versión 1

Objeto con **exactamente ocho campos**:

| Campo | Contrato |
|---|---|
| `version` | Número 1 |
| `operation` | RESERVAR / CANCELAR / REPROGRAMAR |
| `ticketId` | ID técnico decimal string |
| `appointmentId` | ID técnico decimal string |
| `modality` | PRESENCIAL / REMOTA |
| `status` | CANCELADA para CANCELAR; PROGRAMADA para las otras |
| `start` | Inicio del resultado de esa operación, ISO UTC |
| `end` | Fin, exactamente 20 minutos después, ISO UTC |

`creado_en` lo asigna PostgreSQL en la columna existente. No se introduce otro
reloj, columna o historial. Se valida versión, claves exactas, enums,
correspondencia de operación/IDs con la fila técnica, fechas y duración al
recuperar un recibo. El CHECK JSONB de la base no sustituye ese validador.
La relación real cita–ticket se verifica bajo transacción y locks; las dos
FK por sí solas no demuestran esa correspondencia.

### Repetición, rechazo y retención

- Mismo evento y huella: devuelve el **resultado original** sin nueva mutación,
  incluso después de reprogramar, cancelar, cerrar ticket o reiniciar el
  objeto adaptador. Se revalida acceso activo antes de devolverlo.
- Misma clave y huella distinta: `EVENT_CONFLICT`. No se reutiliza un evento
  para una intención nueva.
- `findApplied(eventId, propietario)` permite recuperar el recibo sin borrador
  conversacional. Es la entrada que deberá usar 02-C4 antes de depender de
  memoria. Recuperar un recibo antiguo no afirma que su horario siga vigente:
  `findAppointment` consulta la cita actual por separado.
- Rechazos, falta de confirmación y operaciones pendientes no generan recibo.
  Un reintento rechazado se vuelve a autorizar y validar íntegramente contra
  el horario/ocupación/reloj actuales. Puede aplicar si cambió la disponibilidad
  y el llamador conserva la misma intención confirmada; nunca debe reconstruir
  una intención usando otro borrador ni prometer un resultado anterior.
- En esta etapa los recibos persistentes **no tienen expiración ni borrado
  automático** y no caducan con el contexto de 120 minutos. El adaptador no
  contiene DELETE. La retención/depuración futura es deuda de privacidad
  obligatoria antes de producción; no se establece conservación indefinida
  como política institucional definitiva.

## Unidad transaccional y diagramas

Todas las operaciones usan `pg_advisory_xact_lock` con la misma clave técnica
institucional `2026111001`, sin separar recurso por modalidad o por ticket.
Los futuros escritores de horarios/bloqueos deberán adquirir ese mismo lock
antes de modificar configuración. No se implementaron esos escritores aquí.

```text
Firma / identificación / intención / Gemini / confirmación
                 FUERA de transacción y de bloqueo
                               |
BEGIN -> SET LOCAL -> bloqueo institucional común
  -> leer recibo por ID Meta
       existente -> autorizar propietario/servicio y vínculo
                 -> validar huella/recibo -> COMMIT -> resultado ORIGINAL
       ausente   -> comprobar colisión con confirmación de ticket
                 -> bloquear ticket, colaborador activo y servicio activo
                 -> verificar cita propia y estado si corresponde
                 -> leer horarios / bloqueos / ocupación
                 -> reloj PostgreSQL DESPUÉS de esperar bloqueos
                 -> validar margen, ventana y disponibilidad
                 -> INSERT o UPDATE de cita con guardia final de reloj SQL
                 -> INSERT recibo técnico
                 -> COMMIT confirmado -> resultado
```

```text
Reprogramación: misma cita + mismo ticket
  UPDATE intervalo -> INSERT recibo -> COMMIT
  fallo antes de COMMIT -> ROLLBACK -> reserva anterior intacta

COMMIT enviado, respuesta incierta:
  COMMIT_OUTCOME_UNKNOWN -> descartar conexión
  -> llamador recupera por ID desde conexión nueva
  -> NO reintento automático a ciegas
```

Todo error PostgreSQL se convierte en código seguro sin SQL/params:
`PERSISTENCE_CONFLICT` para unicidad/exclusión, `PERSISTENCE_BUSY` para timeout,
`DATABASE_UNAVAILABLE` para integración restante. Los errores funcionales
conservan códigos propios. No se emite éxito antes de confirmar COMMIT.

### Un mismo evento en ticket y cita

Sin nuevas tablas ni migración: el alta de ticket comprueba que el ID no tenga
recibo en operaciones_citas; el alta/cambio de cita comprueba que no esté en
tickets.id_mensaje_confirmacion. Ambas rutas usan el mismo lock global.
Se probaron ambos sentidos y una carrera simulada: un efecto, el otro conflicto.
No hay una UNIQUE global entre las dos tablas: SQL externo que omita el
protocolo podría violar esta regla; no se promete protección frente a ese caso.

## Agenda, estados y cierre

- Lee la configuración real existente, no un horario fallback. ISO laborable
  1–5; zona IANA America/Mexico_City; bloques completos de 20 minutos alineados
  a la apertura, consecutivos. Ventana inicial 14:00–17:30: diez bloques,
  último 17:00–17:20.
- Calendario inexistente, ventanas superpuestas, filas inválidas o horas con
  segundos no nulos fallan explícitamente; no se redondean silenciosamente
  horas/bloqueos. El contrato actual opera con precisión de minuto en configuración.
- Ocupación PROGRAMADA de ambas modalidades comparte el recurso. REMOTA solo
  se representa técnicamente para comprobar ocupación; no hay conversación
  remota ni ampliación a políticas. Acceso restringido al servicio activo
  de Nómina del ticket durante esta etapa.
- Ofrecer y confirmar consultan reloj PostgreSQL. El mínimo es inclusivo
  >=120 minutos; cancelar valida el inicio anterior y reprogramar ambos.
  INSERT/UPDATE repiten el mínimo usando `clock_timestamp()` en la sentencia
  final para cubrir también el viaje de red posterior a la validación.
- GiST y UNIQUE parcial ya existentes siguen siendo defensas adicionales,
  no sustituyen el protocolo para cambios de configuración.
- Solo crea PROGRAMADA, cancela PROGRAMADA→CANCELADA y reprograma la misma fila.
  No transforma REALIZADA/NO_ASISTIO ni reactiva estados finales.
- Agendar/cancelar/reprogramar no actualiza ticket ni `resuelto_en`.
- Cierre sin cita requiere llamada explícita del flujo de negativa:
  CANCELADA ya no bloquea el cierre, pero PROGRAMADA o un histórico no se
  reinterpretan como «sin cita». Cancelar por sí mismo no cierra el ticket.
  La lectura repetida de ticket/cierre también revalida acceso y servicio.

Contexto conversacional sigue en memoria por proceso: caduca tras 120 minutos
sin actividad aceptada, pierde borradores al reiniciar y no es compartido
entre procesos. No se conectó aún esa conversación a estos adaptadores.
Los registros realmente confirmados mediante un adaptador persistente se
recuperarían de Neon; **su COMMIT real no se probó en esta iteración**.

## Pruebas ejecutadas

`scripts/fixtures/persistent-agenda.mjs` modela SQL con snapshots por transacción,
mutex global y estados falsos. No importa pg ni usa Secrets, red o Neon.
Modela rollback, COMMIT antes/después de pérdida de respuesta y diferentes
clientes/repositorios sobre el mismo estado ficticio. No es PostgreSQL real.

| Comando | Resultado real |
|---|---|
| `npm run test:persistence` | **PASS, 21 grupos** |
| `npm run test:agenda` | **PASS, 24 grupos**, 02-B sin cambios |
| `npm run test:payroll` | **PASS, 15 grupos** |
| `npm run test:conversation` | **PASS** |
| `npm run test:processing` | **PASS completo**, 32 validaciones locales, Neon lectura y Gemini real; pago/requisitos de premios y sin clasificar incluidos |
| `npm run test:webhook` | **PASS**, firma válida 200; incorrecta/ausente 401 |
| `npm run check` | **PASS**, 0 errores y 0 advertencias |
| `npm run build` | **PASS**, advertencia existente de adapter-auto sobre destino productivo no configurado |

La suite nueva incluye claves obligatorias/canonización, BIGINT, propiedad,
servicio/identidad activos, contexto no requerido para recuperar, duplicados
simultáneos, huella incompatible, reintento antiguo tras dos reprogramaciones
y cancelación, carreras entre modalidades y entre ticket/cita, adyacencia,
solapamiento parcial, bloqueo parcial, cambio de configuración, 120:00/119:59,
espera del lock y demora final de escritura, rollback de reprogramación,
cierre explícito tras cancelación, estados históricos, recibo corrupto,
errores SQL seguros y recuperación ante acuse de COMMIT perdido.

Primer ensayo de la suite nueva: falló en el grupo de cierre tras cancelación
porque el cliente ficticio clasificaba el UPDATE como su subconsulta de acceso;
se corrigió únicamente el enrutamiento del mock. No fue un fallo Neon ni se
ocultó el resultado inicial. La ejecución final completa de 21 grupos pasó.
Se adaptó el mock de una prueba antigua a la comprobación de acceso añadida.
Advertencia SSL preexistente de pg durante lectura externa: sin cambio de Secrets.

Se reinició una vez Start application después del conjunto de cambios de
servidor; workflow RUNNING, registros agregados sin mensajes ni firmas sensibles,
portada técnica cargada y consola de captura sin errores.

## Límites y aceptación posterior

- No hubo SQL de escritura real, ni rollback real con fixtures. No se comprobó
  el análisis/ejecución de las nuevas sentencias de escritura por PostgreSQL.
- Concurrencia, fallos de conexión y recuperación se probaron en un modelo
  local; no acreditan COMMIT durable ni aislamiento de dos procesos Neon.
- 02-C3 requiere autorización y plan específico de fixtures, dependencias,
  limpieza selectiva y pruebas desde conexiones/procesos distintos. No se
  ejecutó ni se añadió un comando de prueba que haga COMMIT real.
- Leer toda la ocupación PROGRAMADA es suficiente para esta escala controlada;
  medir volumen/rendimiento antes de operación. No se agregaron índices.
- Las transiciones administrativas históricas y cambios de horarios están
  fuera de esta implementación. Las herramientas futuras deben usar el protocolo.
- 02-C4 deberá integrar explícitamente recuperación por evento, confirmaciones
  y repositorios asíncronos; el webhook actual sigue en memoria, sin salientes.
- Ningún cambio en esquema, datos, horarios, Secrets, Meta, hosting,
  visibilidad de GitHub o publicación. No se declara operativo el Paquete 01.
