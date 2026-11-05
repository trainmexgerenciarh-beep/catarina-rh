# Catarina RH — notas de desarrollo

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

La aplicación no queda conectada ni publicada en Meta en esta iteración.

## Neon y alcance de datos

`npm run check:integrations` solo lee `information_schema.tables` para comprobar las 11 tablas indicadas en los documentos funcionales. No ejecuta DDL ni modifica filas. No agregar migraciones, crear tablas o cambiar el esquema sin autorización explícita.

No están implementados todavía los flujos completos de conversación, agenda, tickets, respuestas documentales ni funciones de atención.
