# Catarina RH

Base técnica inicial del sistema de servicios de Recursos Humanos de Trainmex.

## Documentos rectores vigentes

- [Documento Maestro de Control — versión interna 1.2](CATARINA_RH_DOCUMENTO_MAESTRO_CONTROL_v1.1.md)
- [Plano Funcional y Modelo de Datos — base 1.1 y adenda funcional 1.2](CATARINA_RH_PLANO_FUNCIONAL_Y_MODELO_DATOS_v1.0.md)

El Paquete Funcional 01 no está implementado íntegramente. Los archivos conservan el historial y SQL original de las 11 tablas; la evolución puntual de esquema autorizada para 02-A está documentada por separado.

## Iteración 02-A — estado actual de simulación

- [Especificación técnica, esquema autorizado y pruebas](docs/ITERACION_02_A.md).
- [Registro técnico para Gestión del Proyecto](docs/CONTROL_PROYECTO.md).
- Nómina recibe el concepto entre ocho servicios activos, identifica el viernes de pago, recopila explicación breve, presenta resumen y exige confirmación explícita. Los IDs se validan de nuevo antes de registrar.
- Solo después de confirmar crea un ticket **simulado** con folio `SIM-NOM-…`. El adaptador PostgreSQL preparado utiliza `id_ticket` como folio `NOM-…` y la columna opcional `id_mensaje_confirmacion TEXT UNIQUE`, única modificación de Neon expresamente autorizada y aplicada.
- Una negativa expresa a agendar cierra sin cita y sin resolución. Afirmar interés no reserva; silencio, cancelación del menú y caducidad no cierran tickets.
- La recepción del webhook usa el repositorio **en memoria de simulación**, no el adaptador de escritura Neon. No envía respuestas por WhatsApp. Falta autorización para datos sintéticos y validación de escritura integrada; no se declara operación real.
- El contexto del motor compuesto caduca lógicamente al cumplirse exactamente 120 minutos sin actividad aceptada. Se limpia al siguiente tráfico; no hay temporizador ni contexto compartido entre procesos. Reiniciar pierde borradores y tickets ficticios del webhook, no tickets persistidos.
- La idempotencia de confirmaciones con repositorio persistente se probó usando dos procesos Node independientes y una base ficticia temporal; esto no sustituye una prueba de concurrencia real en Neon.
- `npm run test:payroll` ejecuta la suite aislada nueva sin Secrets, Neon ni Gemini. Se conservan `test:conversation`, `test:processing`, `test:webhook`, `check` y `build`.
- No se implementan agenda 02-B, políticas documentales, Tu Voz operativo, panel ni encuestas. No hay despliegue ni cambios en Meta.

Las secciones siguientes describen iteraciones anteriores; las reglas vigentes de caducidad y tickets simulados son las de 02-A.

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

## Iteración técnica 01: recepción, menú y contexto

- El motor reconoce colaboradores activos antes de continuar; los no encontrados, inactivos o ambiguos no reciben una sesión.
- Presenta las tres categorías aprobadas, permite números o intención natural y el submenú de Tu Voz. Admite regresar, menú principal, cancelar, correcciones y aclaraciones breves.
- El clasificador existente usa solo servicios activos de Neon para enrutar internamente; no presenta subcategorías ni respuestas documentales al colaborador.
- El diálogo produce una respuesta solo para simulación. El webhook no la envía ni la devuelve a WhatsApp. Esta iteración no crea tickets, citas, consultas, denuncias, encuestas ni folios.
- El contexto es una estructura mínima en memoria del proceso (pantalla, categoría y banderas de flujo); no conserva mensajes ni transcripciones. Se elimina al cancelar o al reiniciar el proceso. No se fija un tiempo de inactividad porque está pendiente de definición. No es compartido entre procesos ni persistente; un reinicio o una instancia distinta pierde el contexto.
- Ejecuta `npm run test:conversation` para la simulación aislada; `npm run test:processing` mantiene las pruebas del catálogo real y Gemini; `npm run test:webhook` conserva la prueba HMAC.
- El Paquete Funcional 01 sigue definido pero no implementado íntegramente; los módulos de tickets, agenda, respuestas documentales, Tu Voz operativo y encuestas permanecen fuera de esta iteración.

## Clasificación de mensajes — 5 de noviembre de 2026

- El procesamiento consulta solo lectura los campos `id_servicio`, `categoria` y `subcategoria` de los servicios activos en Neon.
- Gemini selecciona un `id_servicio` del catálogo vigente. El servidor valida que exista en esa lista. Solo un `id_servicio: null` válido representa «sin clasificar»; un ID desconocido/inactivo, catálogo vacío o respuesta inválida es un fallo técnico, nunca una clasificación exitosa.
- El clasificador diferencia el pago de premios de puntualidad y asistencia de las consultas sobre sus reglas para obtenerlos.
- `npm run test:processing` usa el catálogo real de Neon para probar mensajes ficticios de pago semanal, despensa, gasolina, vacaciones, permisos, horas extra, quejas, ideas de mejora, ambas consultas de premios y un caso sin clasificación. No inserta registros ni modifica el esquema.

## Iteración correctiva 01-A — INC-001

- [Registro técnico y evidencia de INC-001](docs/INC-001.md). El estado de aceptación corresponde a ChatGPT/Trainmex, no al ejecutor de las pruebas.
- Se reprodujo una generación truncada por `MAX_TOKENS`: el alias actual usa un modelo con pensamiento y el límite anterior de 128 incluía esos tokens. El parser no comprobaba el motivo de terminación.
- Se conserva Gemini y el catálogo consultado en Neon. El contrato exige JSON estructurado con una sola propiedad obligatoria, un ID activo o `null`; no se reparan ni se extraen fragmentos de respuestas inválidas.
- Se comprueba terminación `STOP` y se distinguen fallos de formato/truncamiento, catálogo, integración y configuración mediante códigos seguros, sin respuestas del proveedor, mensajes, IDs o secretos en los diagnósticos.
- `npm run test:classifier` ejecuta pruebas locales sin API/Neon/Secrets. `npm run test:awards` comprueba con Gemini y Neon, solo lectura, pago del premio frente a requisitos para obtenerlo. La suite `test:processing` incluye las pruebas locales del contrato.
- El motor conversacional, su contexto temporal sin caducidad, el acceso a colaboradores y la validación HMAC permanecen sin cambios. Esta corrección no habilita operación real ni fases posteriores.

## Estado de configuración de WhatsApp — 5 de noviembre de 2026

- Se corrigió `WHATSAPP_APP_SECRET` en Replit Secrets con el App Secret de Meta; no se documenta su valor.
- Private preview se desactivó temporalmente para permitir el callback externo. Meta verificó y guardó la URL HTTPS de desarrollo del endpoint; no se incluye la URL completa.
- El campo `messages` de la versión v27.0 quedó suscrito en Meta.
- Un evento de prueba enviado desde el panel de Meta llegó por POST; la firma fue aceptada y el endpoint respondió HTTP 200.
- La prueba no guardó datos en Neon ni envió una respuesta por WhatsApp.
- La aplicación sigue sin publicarse. Mientras permanezca así, Meta solo entrega eventos de prueba enviados desde su panel; una prueba con un mensaje real está bloqueada por esa restricción.
