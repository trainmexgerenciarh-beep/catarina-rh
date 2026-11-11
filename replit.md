# Catarina RH — notas de desarrollo

## Estado actual — 02-C1 aplicada, 02-C2 no autorizada

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
