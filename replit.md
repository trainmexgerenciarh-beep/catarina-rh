# Catarina RH — notas de desarrollo

## Estado vigente — preactivación, NO OUTBOUND

- Referencia de aceptación/activación: `docs/PREACTIVACION.md`. Ningún envío,
  cron externo, publicación o cambio de cuentas/Secrets/Meta autorizado por
  inferencia. No se modificó esquema: siguen 14 tablas y 15 servicios/cinco
  horarios. Columna `encuestas.entrega` únicamente propuesta, NO aplicada.
- Sesiones RH opacas/revocables en memoria por proceso, ocho horas; reiniciar
  exige login y otra instancia falla cerrado. **Por qué:** revocar copias de
  cookie al salir sin inventar una tabla de sesiones. No confundir con contexto
  del colaborador compartido en Neon y TTL 120 min.
- Generalista no edita fuentes/catálogo ni exporta; Tu Voz solo lectura Gerente.
  Bootstrap privado no configura cuentas reales. No debilitar auth si falta Secret.
- `/api/cron` autenticado prepara, no envía. Dispatcher solo `FAKE_ONLY`;
  entrega durable requiere autorización explícita de esquema y trabajo pendiente.
  Salud pública mínima; readiness privada no declara listo un canal bloqueado.
- Adaptador Node explícito en Vite; `npm start` sirve build. No cambiar
  workflow/hosting productivo por iniciativa.

- Informe vigente: `docs/ENTREGA_INTEGRAL.md`; control:
  `docs/CONTROL_PROYECTO.md`. Las secciones 02-C4/D1A siguientes son históricas.
- Se conservan SvelteKit/TypeScript/Neon/Gemini y los motores originales.
  `createDurableConversation` compone recepción completa y unidad transaccional;
  no sustituirla por el repositorio demo o por otro motor.
- Esquema vigente **14 tablas**: se autorizaron/aplicaron dos tablas aditivas
  de contexto/eventos y `encuestas.recibio_atencion` nullable. No alterar otras
  estructuras por iniciativa. Los 15 servicios y cinco horarios se conservaron.
- Contexto mínimo compartido, TTL exacto 120 min, lease/fencing/revisión,
  deduplicación durable y un cliente PostgreSQL para contexto/negocio/recibo final.
  Gemini/Drive siempre fuera de transacciones. No purgar recibos provisionalmente.
- `/demo` es ficticio/aislado; `/panel` y `/api/rh/*` requieren allowlist de
  cuentas específicas, sin admin universal. Solo roles generalista/gerente;
  Tu Voz restringido a gerente y nunca exportado al archivo común.
- HMAC RAW/GET intactos. Transporte saliente bloqueado por defecto; ningún
  camino actual habilita envíos. Mantenimiento solo limpia contexto vencido y
  prepara encuestas, sin enviar. No publicar ni activar por iniciativa.
- Pruebas vigentes: 24 grupos SQL real con limpieza de 14 tablas, nueve grupos
  integrales, 13 preactivación, cinco auth HTTPS y ocho UI; regresiones/check/build
  PASS. La variante de
  prueba con COMMIT necesita autorización vigente y flag explícito; no ejecutar
  automáticamente fixtures reales ni scripts históricos de esquema doce.
- Activación pendiente del responsable: cuentas RH, fuentes institucionales,
  destino/permisos Sheets, revisión de salida/plantillas Meta y hosting.
  Drive leído realmente; exportación Sheets real y entregas WhatsApp NO certificadas.
- ChatGPT/Trainmex validan, aceptan y actualizan los tres apartados de Drive.
  Replit no debe declararlos aceptados ni editar Google Drive en esta entrega.

## Estado histórico — 02-C4 persistente y SIN SALIDA

- Webhook enlazado a Neon mediante `createPersistentReception`, mismos motores
  02-A/02-B y port asíncrono, sin segundo motor. GET intacto y POST RAW HMAC.
  Validar lote completo antes de negocio; identificación activa antes de repositorios.
- `SIMULATION_ONLY` ahora indica **NO OUTBOUND**, no «tickets solo en memoria».
  No existe envío Graph API, piloto ni publicación. No habilitar por iniciativa.
- Recibos/tickets por ID completo antes de usar contexto; respuesta 200 es acuse
  de recepción, no éxito funcional. Error parcial devuelve 503, prefijo COMMIT
  se recupera y borradores inciertos se preguntan otra vez. No Gemini bajo lock.
- Contexto local caduca >=120 min; replay no renueva actividad. IDs/hashes
  volátiles no equivalen a un historial durable de todos los mensajes.
  No prometer consistencia multiproceso.
- Pruebas 6 grupos E2E locales + 6 Neon PASS, ocho regresiones PASS; limpieza
  exacta, 12 huellas/metadata iguales, 15 servicios y cinco horarios intactos.
  Sin nuevas migraciones. Secuencias tickets18→20/citas10→13 no restablecidas.
- Pruebas reales de fallos fueron arnés firmado, SQL real, COMMIT y proceso
  nuevo; no Meta real ni corte físico de Neon. Reproducción real requiere
  autorización vigente; por defecto `test:webhook:neon` solo inspecciona.
- [Informe 02-C4](docs/ITERACION_02_C4.md) incluye material para los TRES
  apartados de Drive; solo ChatGPT/Trainmex los actualizan y aceptan.

## Antecedente — 02-C3 probada antes de conectar el webhook

- El 11 de noviembre de 2026 se ejecutó integración real controlada autorizada:
  COMMIT temporal, procesos nuevos, concurrencia observada entre backends,
  idempotencia, GiST, cancelación y reprogramación con rollback. 12/12 grupos PASS.
- Limpieza exacta de fixtures y huellas/conteos iguales en las 12 tablas.
  15 servicios y cinco horarios intactos; sin nuevos cambios de esquema.
  Secuencias consumidas NO restablecidas. Ocho regresiones PASS.
- `test:integration:neon` por defecto es SELECT-only; `--clock-only` usa
  SELECT/ROLLBACK. No volver a ejecutar `--commit-authorized` sin autorización
  vigente: se crean fixtures temporales y se requiere baseline operativo vacío.
- Informe y material para los TRES apartados de Google Drive:
  [Integración 02-C3](docs/ITERACION_02_C3.md). Drive solo lo actualiza
  ChatGPT/Trainmex después de revisar; Replit no lo editó.
- En esa etapa el webhook seguía en memoria. La autorización posterior de
  02-C4 se documenta arriba. No declarar recepción productiva por WhatsApp.
- Igualdad de frontera exacta: predicado SQL con un reloj post-lock; no prometer
  microinstante exacto entre llamadas de red. Acuse perdido fue inyección de
  cliente después de COMMIT real, no corte físico de red.

## Contrato vigente — adaptadores aislados 02-C2

- Adaptadores preparados en `neon-agenda.ts` y `payroll-tickets.ts`, unidad
  `inAgendaTransaction`: una conexión, mismo advisory lock institucional para
  agenda y tickets, recibo/cita en una transacción. Nunca Gemini bajo el lock.
- La selección en memoria fue el límite de 02-C2; 02-C4 fue autorizada y probada
  posteriormente. `SIMULATION_ONLY` por sí solo no es autorización de fixtures.
- Recibos versión 1 originales e inmutables por evento, huella determinista,
  sin transcripciones/propietario en el resultado. Sin caducidad/borrado
  automático en esta etapa; política definitiva de retención pendiente.
- Colisiones entre confirmaciones de tickets y recibos de citas se controlan
  en ambos sentidos bajo el mismo lock, sin nueva migración.
- No reejecutar escrituras por COMMIT incierto: recuperar por evento.
  CANCELADA permite cierre explícito sin cita; cancelación no cierra ni resuelve.
- `test:persistence`: 21 grupos SQL simulados PASS; agenda/payroll/conversation/
  processing/webhook/check/build PASS. En 02-C2 hubo solo SELECT; la prueba
  autorizada posterior 02-C3 está documentada arriba.
- Evidencia y deudas: [Iteración 02-C2](docs/ITERACION_02_C2.md).
  Rectores/Drive intactos. No declarar operación por WhatsApp. Los límites de
  evidencia de 02-C2 son históricos; 02-C3 comprobó COMMIT controlado posterior.

## Antecedente — 02-C1 aplicada

- El 11 de noviembre de 2026 se aplicó exclusivamente el DDL principal
  corregido de Drive autorizado por Trainmex: Neon pasa de 11 a 12 tablas
  con `operaciones_citas` vacía, cinco NOT NULL de citas, CHECK de estados,
  duración global finita de 20 minutos y modalidades, UNIQUE parcial y
  exclusión GiST para PROGRAMADA. No volver a ejecutar automáticamente.
- Cinco horarios ISO 1–5, 14:00–17:30, 20 minutos, activos, IDs 1–5.
  Dos transacciones con COMMIT confirmado y verificación desde conexión nueva.
  No se modificó contenido de tickets/colaboradores/servicios.
- No se autorizaron CHECK opcionales de horarios/bloqueos. Contrato/retención
  de recibos pendientes de 02-C2; no producir ni borrar recibos por iniciativa.
- Webhook y código intactos, repositorios aún simulados. No se demostraron
  reservas concurrentes ni COMMIT durable de los adaptadores. Contexto en
  memoria aceptado temporalmente; no prometer continuidad entre procesos.
- Evidencia, SQL exacto y reversión no ejecutada:
  [Migración controlada 02-C1](docs/ITERACION_02_C1.md).
- Las restricciones de iteraciones anteriores son historial de su alcance;
  esta autorización no habilita nuevas migraciones ni 02-C2.

## Estado actual — Iteración 02-B simulada

- Agenda única en memoria: `createSimulatedAgenda` y composición `createAgendaReception`.
  Solo presencial de Nómina; no conectar por iniciativa propia al webhook ni a Neon.
- Horario inicial ficticio lunes-viernes 14:00–17:30, bloques de 20 minutos
  sin buffer, zona America/Mexico_City. Margen exacto >=120 minutos,
  revalidado al registrar y para cancelar/reprogramar.
- `npm run test:agenda`: 24 grupos ficticios; evidencia, esquema y límites en
  [Iteración 02-B](docs/ITERACION_02_B.md). Sin cambios en documentos rectores.
- Caducidad de contexto no cancela reservas; proceso nuevo pierde toda la
  agenda ficticia. Deduplicación/atomicidad solo en instancia compartida.
- 02-A durable sigue pendiente: ROLLBACK integrado no demostró COMMIT,
  recuperación durable ni concurrencia entre conexiones. Webhook aún simulado.
- Esta iteración no autoriza escrituras Neon: `test:payroll:neon` se ejecutó
  exclusivamente en modo de lectura, sin `--rollback-authorized`.
- Google Drive lo actualiza ChatGPT/Trainmex tras revisar, no Replit.

## Estado actual — Iteración 02-A

- Recepción de nómina y tickets con repositorio de simulación; no habilitar escrituras Neon desde el webhook por iniciativa propia. El adaptador pasó una prueba autorizada en Neon dentro de ROLLBACK; COMMIT durable, reinicio y concurrencia entre conexiones siguen sin verificar.
- Contexto con caducidad exacta de 120 minutos sin actividad aceptada, aplicada por el motor compuesto. Reinicios pierden memoria; no eliminan ni modifican tickets persistidos.
- Cambio de esquema autorizado en 02-A: `public.tickets.id_mensaje_confirmacion TEXT UNIQUE`, opcional. Su permiso no autorizaba otras modificaciones. La autorización posterior de 02-C1 y su ejecución se documentan arriba. No ejecutar de nuevo automáticamente.
- `npm run test:payroll`: simulación de confirmación, folio estable, reintentos/reinicio de dos procesos, negativa expresa y caducidad. No hace llamadas externas.
- Evidencia y límites: [Iteración 02-A](docs/ITERACION_02_A.md); [registro técnico de gestión](docs/CONTROL_PROYECTO.md).
- Prueba integrada y limpieza: [ensayo controlado](docs/PRUEBA_INTEGRACION_02_A.md). `test:payroll:neon` inspecciona sin escribir por defecto; `--rollback-authorized` ejecuta fixtures aislados solo con autorización expresa. No usar personas/servicios operativos como fixtures ni restablecer secuencias. El ensayo no dejó filas persistidas.
- Las notas de iteraciones anteriores se conservan abajo como historial. No representan el estado funcional completo actual.

## Ejecutar y validar

- El workflow `Start application` ejecuta `npm run dev` en el puerto 5000.
- `npm run check` valida Svelte y TypeScript.
- `npm run build` genera la compilación de producción; no publica la aplicación.
- `npm run check:integrations` consulta de forma read-only las 11 tablas documentadas en `information_schema.tables` y envía una solicitud breve al API de Gemini.

## Secrets

Configura valores únicamente mediante Replit Secrets. La aplicación utiliza `DATABASE_URL`, `GEMINI_API_KEY`, `WHATSAPP_VERIFY_TOKEN` y `WHATSAPP_APP_SECRET`. No copiar valores secretos a archivos, consola, registros ni commits.

## Webhook de WhatsApp

- Ruta: `/api/whatsapp/webhook`.
- GET implementa el desafío `hub.mode=subscribe`, compara `hub.verify_token` con `WHATSAPP_VERIFY_TOKEN` y responde con `hub.challenge`.
- POST valida `X-Hub-Signature-256` como HMAC-SHA256 del cuerpo original antes de interpretar JSON. Rechaza firmas ausentes o incorrectas; requiere `WHATSAPP_APP_SECRET`.
- Tras una firma válida, confirma la recepción y registra solo el conteo de mensajes; no guarda ni imprime el contenido, teléfonos, firma ni otros datos del payload.
- El logger de desarrollo redacta los parámetros del token y el desafío en los registros de solicitudes.
- Esta iteración no responde mensajes ni procesa conversaciones.

Para probar firmas contra el servidor de desarrollo, ejecuta `npm run test:webhook`. Usa `WHATSAPP_APP_SECRET` desde Secrets y prueba firmas válidas, incorrectas y ausentes sin mostrar el valor ni la firma.

## Estado de configuración de WhatsApp — 5 de noviembre de 2026

- `WHATSAPP_APP_SECRET` se corrigió en Replit Secrets con el App Secret de Meta; no registrar ni copiar su valor.
- Private preview se desactivó temporalmente para permitir el callback externo. Meta verificó y guardó la URL HTTPS de desarrollo de `/api/whatsapp/webhook`; la URL completa se omite.
- El campo `messages` de la versión v27.0 quedó suscrito.
- Un evento de prueba iniciado desde el panel de Meta llegó por POST, pasó la validación de firma y recibió HTTP 200.
- El endpoint no guardó datos en Neon ni envió una respuesta por WhatsApp.
- La aplicación permanece sin publicar. Meta advierte que, mientras siga así, solo entrega eventos de prueba enviados desde su panel; una prueba con un mensaje real está bloqueada por esa restricción.

## Neon y alcance de datos

`npm run check:integrations` solo lee `information_schema.tables` para comprobar las 11 tablas indicadas en los documentos funcionales. No ejecuta DDL ni modifica filas. No agregar migraciones, crear tablas o cambiar el esquema sin autorización explícita.

No están implementados los módulos posteriores ni la operación productiva. Los tickets 02-A se prueban en simulación; su adaptador Neon no está habilitado en el webhook.
