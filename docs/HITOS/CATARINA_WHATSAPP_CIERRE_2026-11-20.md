# Catarina RH — cierre de respuestas WhatsApp y activación controlada

Fecha: 20 de noviembre de 2026
Estado: **código integrado y pruebas previas completadas; salida real apagada**.

## Resultado

El webhook existente ahora puede contestar por WhatsApp con texto, botones y
listas interactivas, reutilizando las respuestas y reglas actuales de Catarina.
Los botones/listas entrantes se traducen a la selección esperada por el mismo
motor de conversación. No se creó un segundo motor ni se alteraron flujos RH.

El envío real permanece apagado por tres barreras que deben coincidir:

1. `WHATSAPP_WEBHOOK_REPLY_ENABLED=true`.
2. `WHATSAPP_OUTBOUND_APPROVED=true`.
3. El destino exacto está en `WHATSAPP_OUTBOUND_ALLOWLIST`.

Las tres configuraciones se observaron ausentes en este entorno. Los cinco
Secrets Meta de acceso/firma/número/cuenta se observaron presentes por estado,
sin leer sus valores. No se editaron Secrets ni se hizo ninguna solicitud a
Graph API.

## Seguridad y comportamiento de envío

- Se conserva la verificación GET y la firma HMAC-SHA256 del POST sobre los
  bytes RAW antes de interpretar el cuerpo o acceder a repositorios de negocio.
- El lote se valida completo antes de procesarlo. Se admiten texto y respuestas
  de botones/listas; los eventos con formato inválido se rechazan.
- Se conserva el requisito de colaborador activo y la persistencia/idempotencia
  de tickets/citas. Un evento reentregado que ya fue procesado no vuelve a
  generar una respuesta saliente.
- Los mensajes interactivos solo se envían dentro de las 24 horas del evento
  entrante según su hora Meta. Una marca temporal ausente/inválida o fuera de
  ventana hace fallar el envío; no se sustituye por un texto no permitido.
  Para contestar fuera de esa ventana hará falta una plantilla aprobada y
  configurada por Trainmex/Meta.
- Un resultado exitoso significa que Meta aceptó la solicitud, no que el
  destinatario recibió o leyó el mensaje.
- Ante error o acuse incierto, el endpoint devuelve HTTP 503 con `outbound:
  not_confirmed`; no registra una entrega exitosa. El reintento del mismo evento
  no repite el envío. No hay outbox durable de respuestas: después de un timeout
  no se puede prometer entrega, y no se hace un reenvío ciego que pudiera duplicar
  el mensaje.
- El modo actual no está habilitado para colaboradores; el primer envío real
  sigue detenido hasta autorización expresa del titular. No se habilitó canal
  general, piloto, publicación ni cron externo.

## Pruebas

| Comprobación | Resultado y alcance |
|---|---|
| `npm run test:outbound` | PASS, 6 grupos; HTTP de Graph sustituido por un mock: payload de texto/lista/botón, allowlist, dos interruptores, ventana, duplicado, fallo y acuse incierto. Sin Meta ni red externa. |
| `npm run test:webhook:e2e` | PASS, 6 grupos; HMAC y procesamiento con adaptadores/repositorio SQL ficticios. Sin Neon ni envío. |
| `npm run test:integral` | PASS, 12 grupos; simulación local de nómina, políticas, Tu Voz, agenda, persistencia simulada y transporte apagado. |
| `npm run test:conversation` | PASS; conversaciones sintéticas. |
| `npm run test:payroll` | PASS, 16 grupos; flujos, fechas, ticket idempotente y regresiones. Solo repositorios simulados. |
| `npm run test:agenda` | PASS, 25 grupos; agenda, cancelación y reprogramación. Solo memoria ficticia. |
| `npm run test:persistence` | PASS, 21 grupos; SQL simulado, concurrencia, rollback e idempotencia. Sin Neon. |
| `npm run test:webhook` | PASS, endpoint HTTPS de desarrollo: firma válida 200, inválida 401 y ausente 401. Usa remitente sintético no registrado, no hace efecto de negocio ni envío. |
| `npm run check` | PASS, 0 errores y 0 avisos. |
| `npm run build` | PASS. |

El POST firmado de desarrollo puede consultar en Neon si existe el número
sintético, pero no ejecuta INSERT/UPDATE/DELETE. No se corrieron tests con COMMIT
en Neon en esta entrega. Tampoco se reejecutó `test:processing` con Gemini real;
el motor de clasificación existente no se modificó.

## Git, Neon y Meta

- Neon: sin DDL ni escrituras; se conservan las 16 tablas, servicios y horarios.
- Meta: sin llamadas de lectura o escritura; número, tipo de cuenta y vigencia
  del token no se verificaron. No hubo envío de WhatsApp.
- GitHub: el trabajo local recibido tenía 25 commits por delante de `origin/main`;
  se revisó el conjunto de cambios y se sincronizó `main` mediante push
  fast-forward. El SHA final y la igualdad local/remoto se informan en el mensaje
  de entrega, porque un archivo no puede contener establemente el hash del commit
  que lo modifica.
- Árbol de trabajo: limpio al verificar después del push.

## Qué necesita Trainmex para la primera conversación real

1. Confirmar en Meta cuál es el número de prueba que se usará; no se consultó ni
   se mostró ningún número configurado.
2. Indicar un destinatario de prueba que Trainmex controle y autorice, no un
   número de colaborador. Ese destino debe coincidir con los permitidos por Meta.
3. Tras aprobar expresamente ese primer envío, configurar de forma privada los
   dos interruptores de salida y añadir únicamente ese destino a la allowlist.
   No compartir tokens, App Secret ni otros Secrets por chat.
4. Enviar un mensaje iniciado por ese destinatario dentro de la ventana de
   servicio; entonces comprobar recepción, respuesta interactiva y los efectos
   de negocio que el mensaje realmente confirme. No probar creando un ticket o
   cita real sin revisar antes su impacto en Neon.

## RESUMEN PARA CHATGPT — ACTUALIZACIÓN DE DOCUMENTOS MAESTROS

### Documento Maestro de Control

Anexar que la respuesta bidireccional quedó conectada al webhook existente, pero
la salida real sigue bloqueada por dos interruptores y una allowlist. Mantener
el estado como preparación técnica, no como piloto ni canal operativo. No afirmar
que se envió un mensaje o que Meta entregó una respuesta. La primera ida y vuelta
requiere aprobación expresa de Trainmex.

### Plano Funcional y Modelo de Datos

Registrar el mapeo de botones/listas a las opciones del motor existente; conservar
HMAC RAW, directorio activo, persistencia e idempotencia. No hubo migración ni
cambios de esquema. La ventana de conversación usa el timestamp Meta; fuera de
24 horas requiere plantilla aprobada. La aceptación de Meta no es entrega al
teléfono. El reintento duplicado no vuelve a enviar. No existe outbox durable y
se mantiene la limitación ante acuse incierto.

### Gestión del Proyecto

Marcar este cierre como código y verificaciones simuladas PASS, sin envío Meta,
sin prueba con colaborador y sin publicación. Añadir evidencias:
`test:outbound` 6 grupos; `test:webhook:e2e` 6; `test:integral` 12;
`test:conversation`; `test:webhook` HTTPS 200/401/401; `check` 0/0; `build`.
Indicar que no se escribió Neon, no se alteró Meta/Secrets y los cinco Secrets
Meta solo se comprobaron por presencia. SHA remoto, fast-forward y árbol limpio
quedan en el reporte de entrega de esta ejecución.
