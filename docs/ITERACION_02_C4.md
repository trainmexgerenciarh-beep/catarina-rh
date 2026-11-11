# Iteración 02-C4 — webhook persistente, SIN SALIDA

Fecha: **11 de noviembre de 2026**.
**IMPLEMENTADA / E2E simulada y Neon real PASS / limpieza PASS /
ocho regresiones PASS / pendiente aceptación de ChatGPT–Trainmex.**

Se integró el endpoint existente con los motores 02-A/02-B y los adaptadores
02-C2, validados en [02-C3](ITERACION_02_C3.md). No es un piloto ni publicación.
El canal no envía WhatsApp: **ninguna solicitud de envío a Graph API**.

## Fuentes, alcance y compatibilidad

Se consultó mediante GET la exportación oficial de Google Drive: Documento
Maestro v1.2 con actualización 02-C3, Plano/adenda 1.2 y Gestión y Control
del Proyecto. Los tres registran 02-C3 aceptada solo como integración
controlada. La autorización específica de esta solicitud habilitó 02-C4.
También se contrastaron [02-C1](ITERACION_02_C1.md),
[02-C2](ITERACION_02_C2.md), [02-C3](ITERACION_02_C3.md) y el
[control técnico](CONTROL_PROYECTO.md).

**No se editaron Google Drive ni los dos Markdown rectores** ni sus versiones.
Se conserva su SQL/histórico. Este informe aporta evidencia para su actualización
posterior por ChatGPT/Trainmex.

Preinspección SELECT antes de escribir, repetida bajo locks antes del fixture:
12 tablas, FKs entrantes/salientes, columnas/tipos/nullable, constraints e índices
validados, sin triggers de usuario ni RLS/dependencias externas. Tablas operativas
vacías, **15 servicios activos 8/5/2 y cinco horarios ISO 1–5 intactos**.
No hizo falta migración ni cambiar permisos.

## Arquitectura: mismos motores, repositorios asíncronos

```text
GET de verificación: código conservado literalmente

POST bytes RAW
  -> HMAC-SHA256 + timingSafeEqual (misma validación)
  -> JSON y VALIDACIÓN COMPLETA del lote, antes de seleccionar repositorios
  -> creación perezosa del motor persistente
  -> teléfono registrado, colaborador activo y no ambiguo
  -> recuperar recibo/ticket por ID ORIGINAL antes de depender del borrador
  -> motor de menú/nómina existente + motor de agenda existente, ahora await
      Gemini contra catálogo activo, FUERA de transacciones
      explicación mínima + viernes + resumen + confirmación explícita
  -> adaptadores SQL y unidad de trabajo existentes
      lock institucional + identidad/servicio/titularidad + reloj BD
      mutación y recibo aplicado en UNA transacción -> COMMIT confirmado
  -> preparar resultado interno
  -> DESCARTAR la respuesta conversacional; HTTP solo acusa recepción
```

- `persistent-reception.ts` únicamente compone los motores y repositorios.
- `agenda-port.ts` traduce interfaces/DTO del simulador al adaptador SQL;
  no duplica reglas de disponibilidad, autorización, reloj, estados o persistencia.
- `agenda-reception.ts` espera interfaces asíncronas; continúa funcionando con
  el simulador anterior, cuyas 24 pruebas permanecen PASS.
- Dos lecturas nuevas, sin migración: citas PROGRAMADA del propietario activo,
  y tickets pendientes sin cita PROGRAMADA. La selección de varios tickets
  pide el folio, nunca elige arbitrariamente uno.
- La consulta «agendar cita» puede retomar un ticket pendiente recuperado;
  no reconstruye explicación/semana desde una confirmación incierta.
- El motor 02-A expone limpieza de borrador sin actividad nueva, usada para
  no convertir el prefijo reentregado de un lote en otro ticket tras reinicio.

No se añadió un segundo motor, nuevos estados de base, campos o flujos de RH.
Políticas, Tu Voz, remoto conversacional, encuestas, panel y salida permanecen
fuera. Se conserva su navegación previa sin incorporar registros funcionales.

## SIMULATION_ONLY significa SIN ENVÍO, no ausencia de persistencia

El webhook **ahora selecciona los adaptadores Neon** después de validar
firma/payload. No selecciona el repositorio en memoria de tickets.
Se mantiene `SIMULATION_ONLY`: los textos internos nunca se envían ni se
devuelven en HTTP, y no existe transporte saliente que pueda activarlos.

Esto permite COMMIT controlado con eventos autenticados de prueba. No autoriza
cargar usuarios reales, habilitar piloto, cambiar Meta/Secrets/hosting ni publicar.
No se añadió un flag de prueba remoto, bypass de firma ni endpoint de depuración.

### Reglas de negocio conservadas

- Solo Nómina, ocho servicios activos; Gemini selecciona ID del catálogo ACTIVO
  consultado y el servidor lo valida. Pago de premios ≠ requisitos de premios.
- Ticket únicamente después de resumen confirmado; folio `NOM-<id_ticket>`,
  clave original obligatoria, unicidad y conflicto ticket/cita bajo lock común.
- Agenda PRESENCIAL, única persona RH, compartida con ocupación de cualquier
  modalidad técnica; no se implementa conversación REMOTA.
- ISO lunes–viernes 14:00–17:30, bloques completos consecutivos de 20 minutos,
  último 17:00–17:20. Sin fallback de horarios ni modificación de sus filas.
- Ofrecer consulta BD; confirmar revalida disponibilidad y >=120 minutos con
  `clock_timestamp()` después de locks y guardia SQL final.
- Reprogramar actualiza el mismo `id_cita` y `id_ticket` atómicamente.
- Cancelar no cierra ticket. «Sin cita» exige negativa expresa separada;
  CANCELADA no impide ese cierre. `resuelto_en` no se modifica.
- No se implementan transiciones automáticas REALIZADA/NO_ASISTIO.

## Seguridad, reintentos y lotes

### Barreras de entrada

Firma ausente/incorrecta → **401**, sin seleccionar motor ni consultas.
JSON/envelope/texto/ID inválido → **400** antes de procesar cualquier mensaje
del lote. Dos mensajes del mismo lote con ID idéntico y contenido distinto
también se rechazan antes de cualquier efecto.

Notificaciones de estado/no texto no ejecutan lógica de negocio. Número
ausente/inactivo/ambiguo solo permite la consulta de identificación:
no clasificación ni transacción de ticket/cita.

La factoría `createWebhookPost` es la misma que utiliza la ruta SvelteKit;
inyectar dependencias en tests no crea una ruta de acceso sin firma.
GET quedó literalmente igual; una verificación HTTPS con token privado y
challenge ficticio confirmó 200 sin imprimir ninguno.

### Entrega frente a éxito funcional

HTTP **200 `{received:true}`** es acuse de recepción, **no** confirmación de
ticket/reserva ni promesa de que cada mensaje produce operación.
Acceso denegado, pregunta de aclaración, navegación y duplicado también pueden
ser recibidos correctamente sin escritura.

Los mensajes válidos se procesan secuencialmente en orden. Cada operación
persistente tiene su transacción; **el lote no es una transacción global**.
Si un mensaje falla técnicamente, se detiene el sufijo y devuelve **503**.
Operaciones ya confirmadas permanecen; su reentrega recupera resultados
durables. No se presenta un borrador o intento fallido como COMMIT exitoso.
No hay cola duradera ni confirmación de mensajes salientes.

### Idempotencia y recuperación

- Se conserva el ID original completo, sin truncarlo a 512 caracteres ni
  generar IDs alternativos por teléfono/sesión/lote. El origen auténtico lo
  valida HMAC; en tests los IDs son **explícitamente sintéticos**.
- Recibos v1 y huella canónica técnica de 02-C2 sin cambios. Igual clave/
  parámetros recupera snapshot; parámetros diferentes → conflicto controlado.
- Los conflictos entre la clave de ticket y de cita se conservan bajo el
  mismo bloqueo institucional, sin migración.
- En proceso se recuerdan IDs y hashes de texto, no transcripciones ni respuestas.
  Un mismo ID con texto diferente produce fallo controlado sin mutación.
- Al reiniciar no existe hash durable del texto de cada mensaje: un recibo
  encontrado devuelve su resultado original, **no reinterpreta un borrador
  nuevo como si fuese la operación antigua**. La huella durable cubre parámetros
  técnicos de la operación, no constituye un archivo de todos los payloads.
- Un lote reentregado tras reinicio puede perder intenciones no confirmadas.
  Se descarta el borrador incierto al recuperar el ticket y se vuelve a preguntar;
  no se usa su antiguo «sí» para crear otro ticket.
- El cierre sin cita es idempotente por ticket/estado. No se guardan recibos
  de cierre en `operaciones_citas`, reservada a las tres operaciones de cita;
  no se inventa un registro durable de cada mensaje de navegación/negativa.
- Ante COMMIT incierto se devuelve 503; el reintento consulta primero el
  registro durable y no repite cambios. No se afirma rollback si COMMIT ocurrió.

### Contexto temporal y límites aceptados

Caduca a **>=120 minutos** sin nueva actividad, evaluado al procesar entradas.
Duplicados/recuperaciones no renuevan actividad ni reactivan borradores.
Los registros Neon no caducan con esa memoria. Los marcadores de deduplicación
en memoria conservan IDs/hashes durante el proceso, no relatos; su crecimiento
y la consistencia entre instancias requieren evaluación antes de producción.

Colas por teléfono son locales. Locks/constraints protegen registros persistentes
entre conexiones, pero no ordenan ni comparten borradores de varias instancias.
Si se desea continuidad del diálogo o auditoría durable de TODOS los mensajes,
se requiere diseño y autorización nuevos; no está implementado.

Los mensajes sin efecto persistente no tienen deduplicación durable después
de morir el proceso: pueden volver como entradas de un contexto nuevo. No
reviven el borrador anterior perdido ni se promete exactly-once para cada
pregunta. La recuperación durable protege ticket/cita; la confirmación explícita
y descarte de borradores inciertos siguen siendo obligatorios.

Recibos conservan la política de esta fase sin borrado automático. La limpieza
de fixtures autorizados NO es una política de retención productiva.

## Pruebas ejecutadas: separar evidencias

### E2E local — SQL simulado

`npm run test:webhook:e2e`: **6 grupos PASS** con el mismo handler HMAC y los
mismos motores/adaptadores, cliente SQL ficticio:

1. HMAC RAW 401/401, payload/lote malformado 400, cero consultas de identidad
   y SQL antes de pasar barreras; acceso no registrado/inactivo sin negocio.
2. Resumen antes de registrar; duplicado dentro/entre lotes; colisión de cuerpo.
3. Reserva, reprogramación misma cita, antiguo reintento, cancelación y cierre.
4. Lote parcialmente fallido, prefijo confirmado y sufijo pendiente; reentrega
   también tras recrear el motor sin duplicar.
5. COMMIT incierto simulado, reinicio del motor, ticket/cita recuperables.
6. Duplicado a 119 minutos no renueva actividad; borrador caduca a 120.

Se comprueba que la llamada de clasificación no tenga transacciones abiertas
y que logs no incluyan texto, teléfono ni credencial ficticia.

### Neon real — fixtures con COMMIT temporal

`npm run test:webhook:neon -- --commit-authorized`: **6/6 grupos PASS**,
**15:45:28–15:46:33 UTC**:

| Grupo | Evidencia real |
|---|---|
| 1 | HTTPS al workflow SvelteKit: firma incorrecta/ausente 401; lote malformado 400; no registrado/inactivo 200 sin efectos. Huellas comparadas. |
| 2 | HTTPS: resumen y confirmación explícita; duplicado dentro/entre lotes → un ticket, mismo origen/folio. |
| 3 | HTTPS: reserva, reprogramación mismo ID, replay antiguo, cancelación y cierre separado sin resolución. |
| 4 | Mismo handler firmado en Node con SQL real: falla 22012 inyectada antes del recibo, ticket COMMIT conservado, cita revertida; reentrega completa termina una sola reserva. |
| 5 | Mismo handler firmado y SQL real: reprogramación COMMIT, acuse perdido inyectado después, 503; proceso Node nuevo recupera recibo, replay antiguo no cambia cita; conflicto de huella comprobado directamente en adaptador. |
| 6 | Dos tickets sin `resuelto_en`, IDs vinculados, cinco recibos, servicios/horarios/resto de tablas intactos. |

Los grupos 1–3 atravesaron **HTTPS y el endpoint en ejecución**. Los 4–5 usan
la misma factoría y motores dentro del arnés para inyectar fallos sin introducir
flags ni fallos en el servidor. El proceso hijo crea otra instancia del handler
y conexiones nuevas; no se reinició el workflow en medio de la prueba.

**No se originaron eventos en Meta ni teléfonos reales. No hubo WhatsApp
entrante real de una persona ni envíos salientes.** La firma fue calculada
internamente con el Secret real, nunca registrada.

La pérdida de acuse fue simulada por cliente después de COMMIT real, no corte
físico de red. No se repitió en C4 la disputa real GiST entre backends:
permanece acreditada por C3, con mutadores/lock/constraints conservados y sus
regresiones simuladas PASS. No se afirma una nueva prueba de carga/concurrencia.
Tampoco se esperaron dos horas reales: la caducidad se prueba con reloj de
contexto simulado; el reloj PostgreSQL de reservas no se sustituye.

Lectura adicional del SELECT de tickets pendientes: SQL real PASS con vista
vacía autorizada; la recuperación con filas pendientes está cubierta en E2E
simulado, no se presenta esa lectura vacía como otra prueba COMMIT.

### Regresiones

| Comando | Resultado |
|---|---|
| `npm run test:persistence` | PASS, 21 grupos |
| `npm run test:agenda` | PASS, 24 grupos |
| `npm run test:payroll` | PASS, 15 grupos |
| `npm run test:conversation` | PASS |
| `npm run test:processing` | PASS completo, 32 locales + catálogo Neon y Gemini real, incluidos pago/requisitos de premios y sin clasificar |
| `npm run test:webhook` | PASS, HTTPS HMAC 200/401/401 |
| `npm run check` | PASS, 0 errores/advertencias |
| `npm run build` | PASS |

Desarrollo: primera comprobación encontró un tipo demasiado amplio del
resultado del handler; se reutilizó el tipo del motor existente. La primera
prueba local de acuse perdido activaba el fallo en un COMMIT de lectura;
se corrigió el arnés para fallar solo tras una mutación. Ejecución final local
PASS. La primera y única ronda con fixtures Neon de C4 pasó completa.
Avisos preexistentes SSL/adapter-auto no bloqueantes, sin cambios para ocultarlos.

## Fixtures, COMMIT y limpieza exacta

Un colaborador ficticio, nombre técnico, WhatsApp de solo ceros y terminación
de prueba: **no E.164, no enrutable y ajeno a persona real**. No se reproduce
el número en este informe. ID y eventos con marcador exclusivo `SYNTHETIC-C4-`.
Descripción/resumen expresamente ficticios, sin datos personales.

El fixture se activó/desactivó solo para probar acceso; se restituyó antes
de limpiar. No se creó ni editó servicio. Se referenció «Pago semanal» por
consulta del catálogo. Horarios institucionales no se tocaron.

Diario técnico previo a escribir en `generated-artifacts/neon-c4-<uuid>.json`,
ignorado por Git/publicación; contiene claves técnicas y auditoría, no Secret,
firma ni transcripciones. Setup/limpieza usan lock institucional y locks
NOWAIT acotados, validan metadata y dependencias. Antes de cada conjunto de
DELETE se identifican filas exactas y se comprueba ausencia de dependencias
ajenas. Orden: recibos → citas → tickets → bloqueo propio si existiera → colaborador.
Sin DELETE global, DROP, TRUNCATE, CASCADE ni reinicio de secuencias.

| Tabla | Inicial | Antes de limpieza | Final |
|---|---:|---:|---:|
| colaboradores | 0 | 1 | 0 |
| tickets | 0 | 2 | 0 |
| citas | 0 | 2 | 0 |
| operaciones_citas | 0 | 5 | 0 |
| servicios | 15 | 15 | 15 |
| horarios_atencion | 5 | 5 | 5 |
| bloqueos_agenda | 0 | 0 | 0 |
| consultas | 0 | 0 | 0 |
| denuncias | 0 | 0 | 0 |
| encuestas | 0 | 0 | 0 |
| fuentes | 0 | 0 | 0 |
| seguimientos_denuncia | 0 | 0 | 0 |

**Eliminados: 5 recibos, 2 citas, 2 tickets y 1 colaborador.**
Las huellas individuales de las 12 tablas coinciden antes/después y luego de
COMMIT de limpieza. Evidencia compacta:

- Snapshot canónico SHA-256 inicial/final:
  `1a08df172d4ef4c44c89e871d5f5c70a0b234ac649ae837308002d08ea00736e`.
- Metadata inicial/final:
  `9f5dc340915ee71293a37dd56619c89e4cf2f3fa30c6c4a8e5139b4236081408`.
- Tickets IDENTITY **18→20**; citas **10→13**, incluido INSERT revertido.
  Otras secuencias sin cambios. No se restablecieron.

Sin residuos; los saltos IDENTITY no se confunden con registros persistidos.

## Reproducción y condiciones de parada

```sh
npm run test:webhook:e2e
# Solo inspección, NO fixtures ni escrituras:
npm run test:webhook:neon
# Únicamente bajo autorización expresa; exige tablas operativas vacías:
npm run test:webhook:neon -- --commit-authorized
# Si una ejecución autorizada se interrumpe, usar SU diario exacto:
node scripts/test-webhook-neon.mjs --cleanup-authorized generated-artifacts/neon-c4-<uuid>.json
```

No ejecutar la ronda real para «limpiar». Si hay datos operativos, esquema
distinto, dependencias ajenas o imposibilidad de limpiar, se detiene sin eludir
guardias. Una muerte abrupta del proceso puede dejar fixtures: conservar diario,
revisar y ejecutar recuperación selectiva autorizada. No confundir esa limpieza
con retención automática de recibos productivos.

## Material para LOS TRES APARTADOS RECTORES — revisión ChatGPT/Trainmex

**No actualizado directamente en Drive. Conservar históricos y versiones
rectoras; anexar el SHA final del reporte antes de aceptar.**

### Documento Maestro de Control

Proponer registrar 02-C4 implementada y probada en recepción persistente
controlada: webhook HMAC enlazado a mismos motores/adaptadores, tickets y citas
con COMMIT por eventos sintéticos, sin salida. Sustituir solo la referencia
vigente a «webhook exclusivamente en memoria». NO declarar piloto, mensaje
auténtico Meta de esta entrega, operación con colaboradores ni Paquete 01 completo.

### Plano Funcional y Modelo de Datos

Modelo y contrato v1 intactos: 12 tablas, 15 servicios, cinco horarios; sin DDL.
Añadir diagrama RAW/firma/lote/identidad/recuperación/contexto/transacción,
interfaces asíncronas y lecturas de propietario/pendientes. Distinguir acuse
HTTP de COMMIT, transacciones por operación de lote global, y hash técnico
durable de marcadores de texto volátiles. Cancelar no cierra ni resuelve;
reprogramación conserva IDs. Contexto compartido y retención siguen pendientes.

### Gestión del Proyecto

Proponer **02-C4 IMPLEMENTADA / PRUEBAS Y LIMPIEZA PASS / PENDIENTE ACEPTACIÓN**.
Evidencia: seis grupos locales, seis grupos Neon (tres HTTPS al workflow y
arnés firmado para fallos/recuperación), ocho regresiones, GET intacto,
limpieza 5/2/2/1 y huellas iguales. Anotar consumo de secuencias y límites de
simulación, contexto por proceso y ausencia de Meta/WhatsApp real.
No autorizar por este registro publicación, piloto, salida, escalado, migración
o siguiente iteración. ChatGPT/Trainmex revisan/aceptan; Replit programa/prueba.
