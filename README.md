# Catarina RH

Base técnica inicial del sistema de servicios de Recursos Humanos de Trainmex.

## Documentos rectores vigentes

- [Documento Maestro de Control — versión interna 1.2](CATARINA_RH_DOCUMENTO_MAESTRO_CONTROL_v1.1.md)
- [Plano Funcional y Modelo de Datos — base 1.1 y adenda funcional 1.2](CATARINA_RH_PLANO_FUNCIONAL_Y_MODELO_DATOS_v1.0.md)

El Paquete Funcional 01 no está implementado íntegramente. Los archivos conservan el historial y SQL original de las 11 tablas; la evolución autorizada de esquema de 02-A y 02-C1 está documentada por separado.

## Iteración 02-C4 — webhook persistente, SIN SALIDA

- [Arquitectura, pruebas, limpieza y actualización de los tres apartados rectores](docs/ITERACION_02_C4.md).
- POST firmado enlazado a motores 02-A/02-B y adaptadores Neon asíncronos.
  GET intacto; validación RAW HMAC y lote completo antes de negocio.
- Recuperación por evento antes del borrador, ticket tras resumen confirmado,
  agenda presencial, cancelación/reprogramación, negativa expresa sin resolver.
- `SIMULATION_ONLY` significa **sin envío**; ahora sí hay persistencia en Neon.
  HTTP 200 solo acusa recepción; no es confirmación funcional de reserva.
- E2E local 6 grupos y E2E Neon 6 grupos PASS; ocho regresiones PASS.
  Fixtures exactos retirados: 5 recibos, 2 citas, 2 tickets y un colaborador
  ficticio no enrutable. Doce huellas iguales; catálogo/horarios intactos.
- No se ejecutó Meta real ni WhatsApp saliente. Sin piloto, publicación,
  migración, cambios de Secrets, Meta o privacidad GitHub.
- Contexto local por proceso con caducidad 120 minutos; borradores inciertos
  se vuelven a preguntar. Ver límites de reintentos/retención en el informe.
- `test:webhook:e2e` es local. `test:webhook:neon` inspecciona por defecto;
  `--commit-authorized` requiere autorización expresa de fixtures temporales.
- Google Drive no fue editado; ChatGPT/Trainmex actualizarán LOS TRES apartados
  rectores después de revisar el reporte.

## Antecedente 02-C3 — integración real controlada, webhook aún simulado entonces

- [Informe, evidencia, limpieza y material para los tres apartados maestros](docs/ITERACION_02_C3.md).
- SQL real de adaptadores sin cambios: COMMIT temporal, procesos nuevos,
  idempotencia, concurrencia entre conexiones, GiST, cancelación y rollback.
- **12/12 grupos PASS**, limpieza exacta PASS y ocho regresiones PASS.
  Primera ejecución falló por comparación de orden de claves JSONB del test;
  corrección exclusiva del helper, sin cambios funcionales.
- Se retiraron todos los fixtures; conteos/huellas de las 12 tablas iguales,
  15 servicios y cinco horarios intactos. Se consumieron valores de secuencias,
  sin restablecerlos.
- `npm run test:integration:neon` solo inspecciona; `--clock-only` verifica el
  reloj/predicado con SELECT y ROLLBACK. `--commit-authorized` exige autorización
  expresa para fixtures temporales y se detiene si hay datos operativos.
- 02-C4 **no ejecutada**: webhook en memoria, sin salientes ni publicación.
  Contexto volátil y retención definitiva de recibos siguen pendientes.
- Google Drive y versiones rectoras locales no se editaron; ChatGPT/Trainmex
  revisarán y actualizarán los tres apartados maestros.

## Antecedente 02-C2 — alcance y resultados de esa etapa

- [Contrato de recibos, interfaces, diagramas, pruebas y límites](docs/ITERACION_02_C2.md).
- Unidad transaccional común: una conexión y un bloqueo institucional para
  agenda/tickets. Agenda SQL con recibo aplicado en la misma transacción,
  recuperación por evento, huella canónica y conflicto entre ticket y cita.
- Mantiene estados, titularidad activa, horarios ISO, 20 minutos y margen
  inclusivo de 120 minutos con reloj PostgreSQL tras bloqueos.
- Recibos sin caducidad automática durante esta etapa; retención definitiva
  pendiente antes de producción. No contienen transcripciones ni datos personales.
- `npm run test:persistence`: 21 grupos con SQL ficticio; las siete regresiones
  solicitadas también PASS. **No hubo escrituras Neon ni COMMIT de fixtures.**
- Modo `SIMULATION_ONLY`; webhook permanece con repositorios en memoria.
  **02-C3 real y 02-C4 no ejecutadas**, no hay reservas operativas por WhatsApp.

## Antecedente 02-C1 — alcance y resultados de esa etapa

- [SQL exacto, objetos, horarios, COMMIT y límites](docs/ITERACION_02_C1.md).
- Neon tiene ahora **12 tablas**: se añadió únicamente `operaciones_citas`,
  vacía, y las restricciones autorizadas de citas (20 minutos finitos,
  cuatro estados, modalidades, UNIQUE parcial y exclusión GiST).
- Cargados cinco horarios ISO lunes-viernes 14:00–17:30, duración 20,
  activos; ambos COMMIT confirmados y verificados desde conexión nueva.
- Sin cambios a tickets, colaboradores ni los 15 servicios. No se ejecutaron
  fixtures, reservas, pruebas de concurrencia ni validaciones opcionales.
- **02-C2 no iniciada**. Webhook, motores y adaptadores sin cambios: continúan
  los límites de simulación y los pendientes de integración durable.

## Iteración 02-B — agenda institucional en simulación

- [Reglas, compatibilidad de esquema, pruebas y límites de 02-B](docs/ITERACION_02_B.md).
- Motor componible `createAgendaReception` con oferta, selección, confirmación,
  consulta, cancelación y reprogramación de citas **solo ficticias**. Reutiliza
  02-A sin modificarla; no está conectado al webhook.
- Una agenda compartida para una persona de RH; en esta fase solo presencial
  para Nómina. Lunes-viernes 14:00–17:30, bloques consecutivos de 20 minutos
  completos, sin buffer, zona `America/Mexico_City`.
- Margen >=120 minutos al ofrecer/confirmar; revalidación de horario, bloqueos
  y ocupación. Reprogramar es todo-o-nada en una instancia de memoria.
- `npm run test:agenda`: 24 grupos ficticios PASS. Regresiones, check y build
  también PASS; detalles y fallos de desarrollo corregidos en la documentación.
- Contexto caduca a las dos horas sin borrar reservas; reiniciar el proceso
  pierde la agenda ficticia. No existe garantía entre procesos/instancias.
- El pendiente de 02-A permanece separado: no se han probado COMMIT durable ni
  concurrencia Neon. La prueba anterior con ROLLBACK no los sustituye.
- En 02-B Neon solo se inspeccionó: **sin escrituras ni DDL**. No se activaron
  tickets/reservas reales por WhatsApp, transporte saliente ni despliegue.

## Iteración 02-A — antecedente y límites conservados

- [Especificación técnica, esquema autorizado y pruebas](docs/ITERACION_02_A.md).
- [Registro técnico para Gestión del Proyecto](docs/CONTROL_PROYECTO.md).
- Nómina recibe el concepto entre ocho servicios activos, identifica el viernes de pago, recopila explicación breve, presenta resumen y exige confirmación explícita. Los IDs se validan de nuevo antes de registrar.
- Solo después de confirmar crea un ticket **simulado** con folio `SIM-NOM-…`. El adaptador PostgreSQL preparado utiliza `id_ticket` como folio `NOM-…` y la columna opcional `id_mensaje_confirmacion TEXT UNIQUE`, cambio aplicado en 02-A. La evolución posterior autorizada de 02-C1 está registrada arriba.
- Una negativa expresa a agendar cierra sin cita y sin resolución. Afirmar interés no reserva; silencio, cancelación del menú y caducidad no cierran tickets.
- La recepción del webhook usa el repositorio **en memoria de simulación**, no el adaptador de escritura Neon. No envía respuestas por WhatsApp. La [prueba autorizada con ROLLBACK](docs/PRUEBA_INTEGRACION_02_A.md) validó SQL sin persistencia; no validó COMMIT durable/concurrencia real ni operación por WhatsApp.
- El contexto del motor compuesto caduca lógicamente al cumplirse exactamente 120 minutos sin actividad aceptada. Se limpia al siguiente tráfico; no hay temporizador ni contexto compartido entre procesos. Reiniciar pierde borradores y tickets ficticios del webhook, no tickets persistidos.
- La idempotencia de confirmaciones con repositorio persistente se probó usando dos procesos Node independientes y una base ficticia temporal; esto no sustituye una prueba de concurrencia real en Neon.
- `npm run test:payroll` ejecuta la suite aislada nueva sin Secrets, Neon ni Gemini. Se conservan `test:conversation`, `test:processing`, `test:webhook`, `check` y `build`.
- Esta entrega inicial no incluía agenda; 02-B se documenta arriba como motor separado de simulación. Políticas documentales, Tu Voz operativo, panel y encuestas no se implementan. No hay despliegue ni cambios en Meta.

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
