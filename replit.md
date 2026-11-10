# Catarina RH — notas de desarrollo

## Estado actual — Iteración 02-A

- Recepción de nómina y tickets con repositorio de simulación; no habilitar escrituras Neon desde el webhook por iniciativa propia. El adaptador SQL existe, pero su validación integrada requiere autorización de datos sintéticos.
- Contexto con caducidad exacta de 120 minutos sin actividad aceptada, aplicada por el motor compuesto. Reinicios pierden memoria; no eliminan ni modifican tickets persistidos.
- Único cambio de esquema autorizado y aplicado: `public.tickets.id_mensaje_confirmacion TEXT UNIQUE`, opcional. No autoriza otras columnas, tablas, índices adicionales ni datos de prueba. No ejecutar de nuevo automáticamente.
- `npm run test:payroll`: simulación de confirmación, folio estable, reintentos/reinicio de dos procesos, negativa expresa y caducidad. No hace llamadas externas.
- Evidencia y límites: [Iteración 02-A](docs/ITERACION_02_A.md); [registro técnico de gestión](docs/CONTROL_PROYECTO.md).
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
