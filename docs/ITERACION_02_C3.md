# Iteración 02-C3 — integración controlada real en Neon

Fecha: **11 de noviembre de 2026**. Base funcional: Maestro v1.2, Plano
base v1.1/adenda 1.2 y autorización expresa de Trainmex para 02-C3.
Base técnica: [02-C1](ITERACION_02_C1.md) y [02-C2](ITERACION_02_C2.md).

**Resultado: integración controlada PASS, limpieza PASS, ocho regresiones PASS.
Pendiente de revisión y aceptación de ChatGPT/Trainmex.**

Se ejecutó SQL real de los adaptadores sin modificarlos. Hubo COMMIT temporal
de fixtures ficticios y recuperación desde procesos/conexiones nuevos.
**No se inició 02-C4:** el webhook conserva los repositorios simulados,
`SIMULATION_ONLY`, sin WhatsApp saliente ni publicación. No se declara
operativa la recepción de tickets/citas por WhatsApp ni completo el Paquete 01.

## 1. Precondiciones y límites de seguridad

Antes de cualquier escritura se revisaron las 12 tablas, columnas/tipos/
nullable/identity, FKs entrantes y salientes, constraints validados, índices
valid/ready, triggers de usuario, RLS y privilegios. No hay FKs externas al
conjunto revisado, triggers de usuario ni RLS. Las tablas operativas estaban
vacías; esta suite **se detiene si dejan de estarlo**, antes de crear fixtures.

Se comprobaron las defensas de 02-C1: UNIQUE de confirmación, PK de recibos,
CHECK de duración finita de 20 minutos/estados/modalidades, UNIQUE parcial
PROGRAMADA por ticket y EXCLUDE GiST global. Ninguna migración fue necesaria.

- **15 servicios activos 8/5/2**, sin INSERT/UPDATE/DELETE en servicios.
- **5 horarios ISO 1–5**, 14:00–17:30, 20 minutos, activos, sin modificaciones.
- La prueba referencia el servicio existente «Pago semanal» mediante SELECT,
  no lo utiliza como fixture mutable ni lo asocia a un trabajador real.
- Un colaborador por ejecución, ID aleatorio con marcador `SYNTHETIC-C3-`,
  nombre inequívocamente ficticio, `whatsapp=NULL`, activo. No existe teléfono.
- Tickets con descripción/resumen constantes «PRUEBA SINTETICA 02-C3».
- Claves técnicas con prefijo exclusivo del ensayo para tickets y recibos;
  **son IDs ficticios, no eventos auténticos de Meta**. No se enviaron a Meta.
- Un bloqueo parcial ficticio, solo dentro de una transacción ROLLBACK.
- Citas en un día laborable futuro elegido desde reloj PostgreSQL y zona
  `America/Mexico_City`, sin cambiar fecha/hora del servidor.

El script crea un diario técnico **antes** de escribir, conserva las claves
de limpieza, esquema, conteos/huellas y resultados. Está en
`generated-artifacts/neon-c3-<uuid>.json`, fuera de Git y de publicación,
sin Secrets ni datos personales. No se incluye como archivo público.

## 2. Transacciones y SQL real ejecutado a nivel funcional

### Adaptadores, sin alteraciones

Cada operación utiliza su conexión real: BEGIN, límites locales, advisory lock
institucional común, SELECT de recibo/identidad/servicio/ticket/cita/calendario,
reloj PostgreSQL y SQL parametrizado, seguido de COMMIT o ROLLBACK.

1. **Ticket:** INSERT con `ON CONFLICT (id_mensaje_confirmacion) DO NOTHING`
   y RETURNING; recuperación mediante SELECT; folio estable `NOM-<id_ticket>`.
2. **Reserva:** INSERT de PROGRAMADA con guardia final de
   `clock_timestamp()+interval '120 minutes'`; INSERT del recibo versión 1;
   ambos confirmados en la misma transacción.
3. **Reprogramación:** UPDATE de la misma fila `id_cita`, mismo ticket,
   guardias de margen; INSERT de recibo y COMMIT conjunto.
4. **Cancelación:** UPDATE PROGRAMADA→CANCELADA más recibo; no UPDATE de ticket.
5. **Negativa expresa simulada:** llamada separada al cierre de ticket,
   UPDATE a «cerrado sin cita», `cerrado_en` establecido, `resuelto_en=NULL`.
6. **Recuperación:** SELECT por confirmación/evento/cita desde pools nuevos
   y procesos Node independientes, sin estado conversacional.

Un primer escenario ejecutó el SQL real bajo SAVEPOINT y ROLLBACK exterior
antes de pasar a los escenarios de COMMIT. El bloqueo parcial también se
insertó y revirtió dentro de ROLLBACK; nunca quedó confirmado.

Se provocó un error PostgreSQL **22012** mediante SELECT de división por cero
justo antes de insertar el recibo de una reprogramación. El UPDATE previo se
revirtió, la reserva anterior permaneció intacta y no apareció recibo nuevo.
Es inyección técnica del script, no un cambio del adaptador ni un fallo espontáneo.

### Concurrencia real observada

Dos conexiones tenían **backends PostgreSQL distintos**, comprobados durante
transacciones simultáneas. `pg_blocking_pids` confirmó la espera real, no solo
dos promesas en JavaScript:

- Dos adaptadores disputaron el mismo horario con modalidades diferentes.
  El segundo esperó el advisory lock; tras COMMIT del primero revalidó y
  rechazó `SLOT_UNAVAILABLE`. Un solo ganador.
- Una reserva adyacente de la otra modalidad fue válida: un único recurso
  institucional, sin separación extra.
- Para probar **GiST con solapamiento parcial**, el ganador fue el adaptador
  real; el contendiente envió INSERT directo de defensa, deliberadamente sin
  advisory lock y fuera de grilla. Esperó la transacción ganadora y fue
  rechazado por **23P01**. El perdedor hizo ROLLBACK, sin recibo ni COMMIT.
  Esta ruta directa solo pertenece al test; no es una API operativa.
- Un intento parcialmente solapado por el adaptador fue rechazado por su
  propia validación de grilla/disponibilidad.

No se afirma que los cambios futuros de horarios/bloqueos puedan omitir el
protocolo común. No se implementaron sus escritores ni se añadieron locks/índices
productivos nuevos.

### Reloj y frontera de 120 minutos: evidencia y alcance

Se observó espera real del adaptador y su lectura `clock_timestamp()` posterior
a liberar el bloqueo. Una prueba focalizada adicional, **solo SELECT y ROLLBACK**,
usó CTE materializados: adquirir el mismo advisory lock, después evaluar un
único `clock_timestamp()`, comparar destino a +120:00 y +119:59.

Resultado PostgreSQL después de espera observada: **120:00 TRUE; 119:59 FALSE**.
El helper reutilizado por la suite es `postLockBoundary`.

Esto demuestra la inclusividad exacta del predicado con reloj del servidor.
Las suites deterministas prueban también el margen al ofrecer, confirmar,
esperar bloqueos y la guardia final SQL. **No se afirma una reserva end-to-end
en el microinstante exacto +120:00 entre llamadas de red:** el reloj avanza
entre validaciones; si el margen cae por debajo antes del INSERT/UPDATE, debe
rechazarse. No se congeló ni sustituyó el reloj de Neon.

### Pérdida de respuesta y proceso nuevo

El cliente del test deja que PostgreSQL confirme COMMIT y después provoca
un error de acuse. El adaptador devuelve `COMMIT_OUTCOME_UNKNOWN` y descarta
la conexión. Otro pool/proceso recupera el recibo y la cita; repetir el evento
devuelve el resultado original sin duplicar.

**COMMIT y lectura posterior fueron reales; la pérdida del acuse fue inyectada
en el cliente**, no una interrupción física de la red. Los procesos hijos
arrancaron sin contexto/borradores y verificaron ticket, recibo y cita.
No se reinició el servidor del webhook ni se interrumpió Neon.

## 3. Resultados y primer fallo registrado

Primera ejecución: **15:08:18–15:08:24 UTC**.
Dos grupos PASS; el tercero **FAIL ERR_ASSERTION** al comparar el recibo
recuperado desde un proceso nuevo. Limpieza PASS: retiró 1 recibo, 1 cita,
1 ticket y 1 colaborador; las 12 tablas volvieron al estado inicial.

Diagnóstico de solo lectura: un objeto ficticio enviado como JSONB regresó
con valores idénticos pero distinto orden de claves. `deepEqual` pasó y el
hash no canónico del helper de pruebas difirió. Se corrigió **solo el digest
de la prueba**, ordenando claves recursivamente. **No se cambió**
`commandFingerprint`, contrato del recibo, adaptadores ni motor conversacional.

Segunda ejecución completa: **15:10:06–15:10:23 UTC**.

| Grupo real | Resultado |
|---|---|
| SQL real inicial con SAVEPOINT/ROLLBACK | PASS |
| Ticket COMMIT, folio y confirmación concurrente | PASS |
| Cita/recibo COMMIT y lectura desde proceso nuevo | PASS |
| Repetición, huella distinta y colisión ticket/cita | PASS |
| Reprogramación misma cita y fallo/rollback real del recibo | PASS |
| Cancelación, no resolución y cierre explícito tras CANCELADA | PASS |
| Dos conexiones, mismo intervalo y modalidades; adyacencia | PASS |
| Contendiente parcial rechazado por GiST, espera observada | PASS |
| Zona/ventana/fin de semana y bloqueo parcial ROLLBACK | PASS |
| Reloj posterior a espera y frontera SQL inclusiva | PASS |
| COMMIT real, acuse perdido simulado y proceso nuevo | PASS |
| Propiedad, ningún `resuelto_en` y límites de fixtures | PASS |
| Limpieza exacta, huellas y esquema de 12 tablas | PASS |

Después se reforzó la frontera con espera real en el helper SELECT-only,
ejecutado focalizadamente con `--clock-only`: **PASS**, sin nueva ronda de
fixtures/COMMIT. No se repitieron escrituras innecesariamente.

## 4. Limpieza y auditoría

La limpieza adquiere el lock común y locks breves de las 12 tablas (NOWAIT,
timeout). Antes de borrar comprueba:

1. Colaborador exacto, marcador ficticio y WhatsApp nulo.
2. Cada ticket pertenece al colaborador del ensayo y tiene clave y textos técnicos.
3. Citas ligadas a esos tickets; cada recibo tiene su clave exclusiva y vínculo.
4. Ausencia de consultas/denuncias/encuestas ajenas que dependan de esos fixtures.
5. Esquema sin cambios. Ante duda se detiene; no hay DELETE global/CASCADE.

DELETE parametrizados por **listas exactas**: recibos → citas → tickets →
bloqueo propio si persistiera → colaborador. Ningún servicio se crea/elimina.
Antes de COMMIT se exige snapshot igual al inicial; después se vuelve a leer.

Segunda ejecución, filas confirmadas y eliminadas:
**7 recibos, 5 citas, 9 tickets, 1 colaborador.**
El bloqueo fue ROLLBACK (0 filas que borrar). Hubo además intentos revertidos/
rechazados; no se confunden con filas confirmadas.

| Tabla | Inicial | Antes de limpiar segunda ejecución | Final |
|---|---:|---:|---:|
| colaboradores | 0 | 1 | 0 |
| tickets | 0 | 9 | 0 |
| citas | 0 | 5 | 0 |
| operaciones_citas | 0 | 7 | 0 |
| bloqueos_agenda | 0 | 0 | 0 |
| servicios | 15 | 15 | 15 |
| horarios_atencion | 5 | 5 | 5 |
| consultas | 0 | 0 | 0 |
| denuncias | 0 | 0 | 0 |
| encuestas | 0 | 0 | 0 |
| fuentes | 0 | 0 | 0 |
| seguimientos_denuncia | 0 | 0 | 0 |

Las huellas de contenido de **cada una de las 12 tablas** coincidieron:
MD5 agregado de hashes de filas ordenados, sin exportar filas personales.
Auditoría compacta:

- SHA-256 canónico del snapshot inicial/final:
  `1a08df172d4ef4c44c89e871d5f5c70a0b234ac649ae837308002d08ea00736e`.
- Huella de servicios inicial/final: `293a8a853d198fc0b1497e910b8e8fe2`.
- Huella de horarios inicial/final: `09a002e41f4b2856002d9ba74f809bea`.
- Huella de metadata segunda ejecución inicial/final:
  `9f5dc340915ee71293a37dd56619c89e4cf2f3fa30c6c4a8e5139b4236081408`.

La primera versión del helper usaba otro orden de serialización para la huella
de metadata; solo se compara cada ejecución consigo misma. No fue cambio de esquema.
Los hashes son evidencia de comparación, no una copia de seguridad.

### Secuencias: efecto no reversible conservado

No se utilizó setval, RESTART ni restablecimiento de IDENTITY.

| Secuencia | Antes de primera ejecución | Después de primera | Después de segunda |
|---|---:|---:|---:|
| tickets | 4 | 7 | 18 |
| citas | 1 | 3 | 10 |
| bloqueos_agenda | sin usar | sin usar | 1 |

Son 14 asignaciones adicionales de tickets y 9 de citas en conjunto; también
un valor del bloqueo revertido. Incluyen conflictos y ROLLBACK: son huecos
normales, no residuos. Las otras secuencias, incluidas servicios y horarios,
no cambiaron. Las 12 tablas recuperaron su contenido; **las secuencias no**.

## 5. Regresiones ejecutadas

| Comando | Resultado |
|---|---|
| `npm run test:persistence` | PASS, 21 grupos simulados |
| `npm run test:agenda` | PASS, 24 grupos |
| `npm run test:payroll` | PASS, 15 grupos |
| `npm run test:conversation` | PASS |
| `npm run test:processing` | PASS completo: 32 comprobaciones locales, catálogo Neon 15 y Gemini real; pago/requisitos de premios y sin clasificar |
| `npm run test:webhook` | PASS, firma válida 200, incorrecta/ausente 401 |
| `npm run check` | PASS, 0 errores y 0 advertencias |
| `npm run build` | PASS |

Avisos preexistentes no bloqueantes: semántica SSL futura de pg y ausencia de
destino productivo en adapter-auto. No se alteró configuración para ocultarlos.
No se ejecutó el antiguo `test:payroll:neon`: corresponde a la etapa de
11 tablas; no se presenta como validación del esquema actual.

## 6. Reproducción, riesgos y límites

```sh
# Solo preinspección SELECT, sin fixtures ni escrituras:
npm run test:integration:neon
# SELECT y transacciones ROLLBACK para reloj después de espera real:
npm run test:integration:neon -- --clock-only
# SOLO bajo autorización expresa vigente y tablas operativas vacías:
npm run test:integration:neon -- --commit-authorized
```

Si un proceso es terminado abruptamente o falla la conexión durante limpieza,
el diario permanece. Hay recuperación selectiva explícita, que vuelve a validar
esquema/dependencias y exige igualdad completa del baseline antes de confirmar:

```sh
node scripts/test-neon-c3.mjs --cleanup-authorized generated-artifacts/neon-c3-<uuid>.json
```

No repetir toda la integración para limpiar. No borrar por patrón amplio.
Una modificación externa concurrente puede hacer que la auditoría se detenga;
habrá que revisar el diario y dependencias, no eludir sus guardias.

- Prueba pequeña y controlada, no ensayo de carga, caída física de Neon,
  failover, indisponibilidad sostenida ni futura edición concurrente del calendario.
- El recibo conserva el snapshot aplicado original; consultar estado actual
  de cita es una lectura distinta. Los reintentos antiguos no reprogramaron de nuevo.
- No se insertaron estados REALIZADA/NO_ASISTIO ni se inventaron criterios de
  resolución. Sus regresiones simuladas siguen PASS.
- Contexto por proceso, caducidad de 120 minutos y pérdida de borradores al
  reiniciar permanecen sin cambios. La recuperación de registros confirmados
  ahora tiene evidencia real; **no convierte el contexto en persistente**.
- La retención de recibos sin borrado automático sigue vigente para esta etapa.
  La eliminación aquí fue exclusivamente limpieza autorizada de fixtures, no
  política productiva de retención. Privacidad/retención definitiva sigue pendiente.
- No hubo cambios funcionales en adaptadores, webhook, motores, esquema,
  servicios, horarios, Secrets, Meta, hosting, visibilidad GitHub ni publicación.

## 7. Información para actualizar LOS TRES apartados maestros

**Propuesta informativa para ChatGPT/Trainmex; NO se editó Google Drive ni se
elevaron versiones rectoras locales. Conservar históricos al actualizar.**

### Documento Maestro de Control

Registrar que 02-C3 demostró en entorno controlado COMMIT temporal y recuperación
durable de tickets/folios/citas/recibos, idempotencia, concurrencia institucional,
cancelación y reprogramación sin resolución. Mantener explícitamente pendiente
02-C4, integración operativa WhatsApp-Neon y aceptación funcional. Catarina sigue
siendo recepcionista/secretaria; sin nuevas funciones ni publicación.

### Plano Funcional y Modelo de Datos

No cambió el modelo de **12 tablas** de 02-C1 ni el contrato de recibos versión 1
de 02-C2. Incorporar evidencia de FKs, UNIQUE/GiST, misma cita al reprogramar,
rollback, cierre tras CANCELADA solo por negativa expresa, bloqueo compartido
y reloj post-lock. Servicios 15 y horarios 5 intactos; fixtures eliminados.
Anotar consumo de secuencias, límites de la prueba de frontera/pérdida de acuse,
contexto en memoria y deuda de privacidad. No ejecutar ni reemplazar SQL histórico.

### Gestión del Proyecto

Proponer **02-C3: pruebas técnicas PASS / limpieza PASS / pendiente aceptación**.
Registrar primer FAIL del helper JSONB, corrección exclusiva de test, ejecución
completa 12/12 PASS, prueba focalizada SELECT-only PASS y ocho regresiones PASS.
Adjuntar este informe y el commit final del reporte. Siguiente hito **02-C4
separado y aún no autorizado/ejecutado en esta solicitud**; no dar por terminado
el Paquete Funcional 01 ni habilitar operación con colaboradores.
