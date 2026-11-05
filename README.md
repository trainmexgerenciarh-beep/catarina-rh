# Catarina RH

Base técnica inicial del sistema de servicios de Recursos Humanos de Trainmex.

## Desarrollo

```bash
npm run dev
```

## Comprobaciones

```bash
npm run check
npm run build
npm run check:integrations
```

`check:integrations` ejecuta una consulta de solo lectura a `information_schema.tables` para comprobar las 11 tablas existentes en Neon y realiza una llamada breve a Gemini con el SDK oficial `@google/genai`. Requiere los Secrets `DATABASE_URL` y `GEMINI_API_KEY`.

El webhook de WhatsApp está disponible en `/api/whatsapp/webhook`. La verificación GET requiere `WHATSAPP_VERIFY_TOKEN`; el POST requiere la firma `X-Hub-Signature-256` comprobada con `WHATSAPP_APP_SECRET` y no guarda mensajes.

## Estado de configuración de WhatsApp — 5 de noviembre de 2026

- Se corrigió `WHATSAPP_APP_SECRET` en Replit Secrets con el App Secret de Meta; no se documenta su valor.
- Private preview se desactivó temporalmente para permitir el callback externo. Meta verificó y guardó la URL HTTPS de desarrollo del endpoint; no se incluye la URL completa.
- El campo `messages` de la versión v27.0 quedó suscrito en Meta.
- Un evento de prueba enviado desde el panel de Meta llegó por POST; la firma fue aceptada y el endpoint respondió HTTP 200.
- La prueba no guardó datos en Neon ni envió una respuesta por WhatsApp.
- La aplicación sigue sin publicarse. Mientras permanezca así, Meta solo entrega eventos de prueba enviados desde su panel; una prueba con un mensaje real está bloqueada por esa restricción.
