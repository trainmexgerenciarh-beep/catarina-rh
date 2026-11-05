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
