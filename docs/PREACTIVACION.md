# Catarina RH — informe final de preactivación

**Corte: 11 de noviembre de 2026. Base: `839442b2a4cef69b735af93924bc00084b8fa0c9`.**

**PREPARACIÓN IMPLEMENTADA Y VERIFICADA; NO ES ACTIVACIÓN PRODUCTIVA.**
Sin WhatsApp saliente, contactos con colaboradores, publicación, cambios de
Secrets, Meta, cuentas externas o documento rector de Google Drive. No se ejecutó
DDL: permanecen 14 tablas, 15 servicios activos y cinco horarios institucionales.
La aceptación corresponde a Trainmex/ChatGPT. El SHA final se informa en el
cierre de esta entrega y puede consultarse mediante `git log -1`.

## 1. Resultado por módulo

| Módulo | Estado entregado | Evidencia / límite |
|---|---|---|
| Login/logout RH | Endurecido, sin cuenta universal | Cinco grupos HTTPS reales sobre build SSR, cuentas ficticias solo en proceso privado; ninguna cuenta RH del proyecto configurada |
| Permisos | Dos perfiles, mínimo privilegio | Generalista no escribe catálogo/fuentes ni exporta; Tu Voz solo lectura Gerente; ninguna edición administrativa de denuncias |
| Directorio/tickets | UX y límites conservados | CRUD demo en navegador; SQL real con fixtures y limpieza. Identificador de colaborador existente no editable en formulario |
| Agenda/bloqueos | Crear, editar mismo ID, eliminar; agenda compartida | Navegador y SQL reales; confirmación de intención para borrar; fechas/horas normalizadas al editar |
| Contexto/eventos | Persistencia existente conservada | COMMIT, proceso nuevo, lease/fencing, TTL 120 min, reintentos y lote parcial 503 en Neon |
| Fuentes Drive | Lectura verificable y edición restringida | Documento rector leído realmente con lector de la aplicación; cero fuentes RH registradas al terminar. No se aprobó ese documento como política |
| Políticas/Tu Voz | Flujos existentes conservados | Tres conversaciones en demo y SQL; política sin fuente deriva sin inventar; Tu Voz separado y no exportado |
| Sheets | Exportador real reforzado; destino pendiente | SQL/locks/archivado reales + proveedor ficticio; ningún archivo real creado o escrito |
| Encuestas | Preparación durable y respuestas verificadas | Dos conexiones preparan una sola encuesta; atención No ≠ No resuelto; atención Sí/4/Parcialmente entre procesos |
| Dispatcher | Motor técnico probado con transporte `FAKE_ONLY` | Idempotencia/reintentos/lease/resultado incierto simulados; adaptador de entrega durable bloqueado por esquema |
| Cron/salud | Rutas autenticadas y CLI preparadas | Sin scheduler externo activado; público: health 200, readiness anónima 401, cron sin configurar 503 |
| WhatsApp | GET y HMAC RAW conservados; salida OFF | GET HTTPS sintético 200; POST firmado 200, firma incorrecta/ausente 401/401. No es prueba de envío o recepción Meta real |
| Runtime | Adaptador Node explícito y TLS verificado | check 0 errores/0 avisos, build PASS; socket cliente Neon cifrado/certificado verificado |

## 2. Acceso y panel

- Cuentas específicas mediante `RH_ADMIN_ACCOUNTS`; solo roles `generalista` y
  `gerente`. Configuración inválida, duplicada o incompleta falla cerrado.
- Contraseñas scrypt con sal por cuenta; comparación segura. No se almacenan
  contraseñas en cookie, cliente o repositorio.
- Cookie `Secure`, `HttpOnly`, `SameSite=Strict`; sesión opaca firmada y
  revocable durante ocho horas. Logout invalida también una copia de la cookie.
  Un cambio de credencial/rol o retiro de la cuenta invalida su sesión al validar.
- **Las sesiones administrativas están en memoria por proceso**: reinicio
  exige login; otra instancia no acepta un token que no conoce. No se promete
  sesión RH compartida. Instancia única o afinidad de sesión para el panel;
  fallar cerrado es preferible a una cookie firmada sin revocación efectiva.
- Esto **no cambia** el contexto de colaboradores en Neon, su TTL de 120 min,
  ni la recuperación de tickets/citas/eventos entre procesos.
- CSRF por origen y rechazo cross-site, JSON de objeto obligatorio y lectura
  acotada a 16 KiB para login/RH/cron. Se conservó el límite de intentos de login.
- Las comprobaciones de rol ocurren antes de acceder a datos protegidos.
  Generalista puede operar directorio, tickets, agenda/bloqueos y encuestas;
  leer/verificar fuentes no equivale a aprobarlas o editarlas.
- Respuestas privadas y salud sin caché; errores seguros, sin SQL, credenciales
  o narraciones. La redacción incluye tokens/challenges y claves sensibles de URL.
- Se corrigieron edición de fechas ISO/horas PostgreSQL, acceso visual a edición
  de bloqueos, permisos de botones y avisos de operación/lectura confirmada.

### Prueba de cuentas

`test:auth:browser` genera dos identidades `.invalid`, contraseñas aleatorias y
TLS autofirmado temporal, inicia el **build SSR real** únicamente en
`127.0.0.1`, sin `DATABASE_URL`, credenciales WhatsApp o Gemini del proyecto.
Prueba login/logout, roles, CSRF, replay de cookie revocada, aislamiento entre
perfiles y reinicio efectivo del proceso. Los datos RH de esa prueba son mock.
Se eliminaron certificado/clave y se detuvieron los procesos al finalizar.
**No se verificó login de personal RH real ni se debilitó la autenticación pública.**

## 3. Drive y exportación Sheets

### Fuentes

La identidad conectada pudo leer el documento rector usando `readSource`;
texto no vacío, sin registrar contenido. Esa evidencia solo demuestra acceso a
esa referencia. No acredita acceso a todos los documentos RH ni su aprobación.
El lector actual usa Google Docs exportable a texto; formatos no compatibles,
permiso ausente o contenido insuficiente degradan con seguridad, sin inventar.
La verificación devuelve lectura confirmada, **no aprobación institucional**.

### Exportador

- Requiere destino explícito `RH_EXPORT_SPREADSHEET_ID` y rol Gerente.
  La interfaz ofrece verificar lectura, sin confundirla con permiso de escritura.
- Solo tickets ordinarios cerrados, no archivados, del mes en
  `America/Mexico_City`; categorías Nómina y Políticas. Nunca consulta/exporta
  denuncias o seguimientos de Tu Voz. No elimina tickets.
- Pestaña `Tickets_YYYY_MM`, identificador de ticket como texto, ocho columnas
  funcionales más huella canónica SHA-256 y versión. Celdas como strings,
  protegidas frente a interpretación de fórmulas.
- `AppendCells` y `CreateDeveloperMetadata` ocurren en **un batch atómico**.
  Cada ticket tiene ID positivo determinista de metadata y recibo técnico v1
  (ticket, mes, huella), sin secretos ni narración en el recibo.
- La unicidad nativa de metadata impide un segundo append incluso si un
  primer batch se aplica tarde después de perder su acuse. Una colisión de ID
  técnico se rechaza; no se inventa otro ID ni se sobrescribe metadata ajena.
- Relee filas, huellas y recibos antes de marcar `archivado_en`. Datos alterados,
  duplicados, verificación incompleta, permisos o cuotas fallan sin archivar.
  La recuperación de acuse perdido/tardío está probada con proveedor ficticio.
- **Defecto detectado y corregido con Neon real:** los locks de sesión no sirven
  como exclusión fiable sobre un pool transaccional. Ahora usa
  `pg_try_advisory_xact_lock`, misma conexión y transacción, más locks de los
  tickets cerrados seleccionados. Contención devuelve conflicto controlado.
- Excepción técnica delimitada: esta exportación administrativa mantiene la
  transacción durante I/O Sheets, con presupuesto externo de 25 s, límite por
  llamada 10 s, statement timeout 10 s e idle-in-transaction 30 s. No mantiene
  el lock de agenda ni llama Gemini/Drive dentro de esa transacción.
- Ante COMMIT incierto no se afirma éxito: relectura de Sheets y tickets permite
  recuperar sin otro append. El cliente se descarta si el COMMIT quedó incierto.

Contrato de API contrastado contra el
[discovery oficial Sheets v4](https://sheets.googleapis.com/$discovery/rest?version=v4):
metadata ID único por spreadsheet y batch sin aplicación parcial si una petición
es inválida. **No se ha verificado ese contrato escribiendo un archivo real del
titular**: falta destino autorizado. No hay permiso inferido de una lectura.

## 4. Encuestas, despacho y cron

Preparación SQL idempotente, hasta 100 pendientes por invocación. Son elegibles
desde el día posterior a la **fecha programada de cita en México**; recupera
atrasadas si hubo interrupción. Solo colaboradores activos con teléfono válido,
categorías ordinarias y cita no cancelada. Sin encuesta para Tu Voz, consultas
sin cita o cierre sin cita. Preparar no establece `enviada_en`.

El motor de pruebas:

- Solo acepta transporte `FAKE_ONLY` y destinatarios inequívocamente ficticios.
- Claim con token/lease; veinte despachos concurrentes aceptan una sola vez.
- Texto solo con ventana comprobable menor a 24 h; exactamente 24 h, fecha
  futura o sin ventana requieren plantilla configurada.
- Rechazo temporal conocido: backoff y máximo tres intentos. Fallo permanente:
  descarte técnico. Timeout, acuse sin ID o lease incierto: revisión, **sin
  reenvío automático que pudiera duplicar un mensaje**.
- Fencing y acuse tardío controlado; jamás confunde aceptación por proveedor
  con atención recibida, lectura o resolución del ticket.

`POST /api/cron` requiere `Authorization: Bearer` con `CRON_SECRET` propio de
al menos 32 caracteres, sin token en URL; tarea permitida `prepare`.
`npm run cron:prepare` invoca esa ruta usando `CATARINA_BASE_URL` y el Secret
internamente. No imprime el token ni instala un scheduler.
`dispatch` devuelve **409 DURABLE_DELIVERY_SCHEMA_APPROVAL_REQUIRED**.
Sin Secret configurado, la ruta permanece **503**, no abierta.
El temporizador residente anterior queda como best-effort; no constituye
garantía de ejecución en un alojamiento que suspende procesos.

### Bloqueo de esquema, NO aplicado

`encuestas` tiene `enviada_en`, pero no puede guardar durablemente un claim,
intento rechazado, acuse incierto o revisión entre reinicios. No se reutilizaron
contextos/eventos entrantes, comentarios ni `enviada_en` como un outbox ficticio.
**Falta el adaptador de entrega durable; no basta con encender un Secret.**

Propuesta mínima para autorización separada, **NO EJECUTADA**:

```sql
ALTER TABLE public.encuestas
  ADD COLUMN entrega JSONB,
  ADD CONSTRAINT encuestas_entrega_objeto
    CHECK (entrega IS NULL OR jsonb_typeof(entrega) = 'object');
```

Una columna nullable, sin tabla adicional ni backfill destructivo. Contrato
propuesto: versión 1, estado técnico, número de intentos, próximo intento,
token/lease/fencing, fechas, código seguro e ID de acuse del proveedor.
Sin transcripción, teléfono ni credenciales. Mantener `enviada_en` para acuse
aceptado, no para marcar envíos que quizá nunca ocurrieron.
Tras autorización, implementar/verificar el adaptador transaccional y pruebas
de recuperación antes de considerar una activación. Resultado incierto requiere
revisión; ninguna implementación puede prometer exactamente-una-entrega externa
si el proveedor no ofrece esa garantía.

## 5. Ejecuciones y evidencia

| Comando / comprobación | Resultado final | Tipo |
|---|---|---|
| `npm run check` | PASS, 0 errores/0 avisos | Svelte/TypeScript |
| `npm run build` | PASS, adapter-node | Compilación SSR y cliente |
| `test:persistence` | PASS, 21 grupos | SQL mock |
| `test:agenda` | PASS, 24 grupos | Reloj/repositorio ficticio |
| `test:payroll` | PASS, 15 grupos | Simulado |
| `test:conversation` | PASS, 5 comprobaciones | Simulado |
| `test:processing` | PASS, 32 contrato local y 11 casos Gemini | Neon lectura + Gemini real |
| `test:webhook` | PASS, 200/401/401 | POST HTTPS público sintético |
| `test:webhook:e2e` | PASS, 6 grupos | SQL mock |
| `test:memory` | PASS, 9 grupos | Reloj/timers/SQL ficticios |
| `test:integral` | PASS, 9 grupos | Flujos completos y proveedor Sheets ficticio |
| `test:preactivation` | PASS, 13 grupos | Auth/dispatcher/cron/errores/Sheets ficticios |
| `test:auth:browser` | PASS, 5 grupos | HTTPS/SSR/login/logout reales privados; datos mock |
| `test:ui` | PASS, 8 grupos | Chromium 402/1440 px, backend demo real |
| `test:integral:neon -- --authorized-synthetic-commit` | PASS, 24 grupos | SQL/COMMIT reales, procesos/conexiones distintos |
| GET webhook HTTPS | PASS, 200 y comparación interna | Challenge ficticio y Secret no impreso |
| Drive lector de aplicación | PASS, referencia no vacía | Lectura real, sin registrar/activar fuentes |
| Salud y protección pública | 200 `/healthz`, 401 `/readyz`, 503 `/api/cron` | Estados esperados sin configuración titular |

Gemini distinguió pago de premios de sus requisitos, además de pago semanal,
despensa, gasolina, vacaciones, permisos, horas extra, quejas, ideas y «sin
clasificar», siempre contra 15 servicios activos. No se modificó el catálogo.
La agenda conserva ISO lun-vie 14:00–17:30, bloques completos de 20 min,
último 17:00–17:20, presencial/remota compartidas. Fronteras exactas en unidades
con reloj controlado; PostgreSQL además comprobó el predicado inclusivo
120:00/119:59 tras esperar un lock real. No es una prueba Meta en ese instante.

### Fallos encontrados, no ocultados

1. Un preflight inicial usó `pg_stat_ssl` como indicador del TLS del cliente y
   se detuvo **sin crear fixtures**. El socket cliente sí estaba cifrado y
   autorizado; el backend reportó otro tramo. Ahora readiness y prueba observan
   el socket real. No se desactivó validación de certificados.
2. Una ronda real pasó 21 grupos y falló en el nuevo caso de exclusión del
   exportador. Se corrigió el lock de sesión por lock transaccional compatible
   con pooler. Se liberó solo el lock técnico conocido de esa prueba, sin
   terminar procesos, desbloqueos amplios o escrituras de filas ajenas.
3. Dos rondas posteriores completaron 24 grupos PASS; la última incluye edición
   efectiva de bloqueos. Todas las rondas con fixtures terminaron con limpieza
   y comparación de las 14 tablas. No se presentan las primeras como PASS.
4. Se ajustaron selectores y cierre/aceptación de diálogos en las nuevas
   automatizaciones de navegador. La última ejecución completa es PASS.

### Neon: aislamiento, limpieza y secuencias

Preflight exigió tablas operativas vacías; ninguna identidad real disponible.
Cada ronda usó un colaborador con marcador sintético/WhatsApp no enrutable,
los servicios existentes solo como FK, una fuente inactiva no real y un bloqueo
ficticio. Se inspeccionaron dependencias antes de borrar por IDs/FKs exclusivos.
No se insertaron servicios ni horarios.

Última ronda: eliminados **55 eventos, 1 contexto, 2 encuestas, 1 consulta,
6 recibos, 4 citas, 5 tickets, 1 Tu Voz, 1 fuente y 1 colaborador**.
Un bloqueo se creó, editó y eliminó durante su escenario; limpieza final cero.
Las otras rondas con escritura retiraron 49 y 55 eventos respectivamente y
sus dependencias. No quedaron fixtures ni locks de exportación.

Conteos inicial/final: **servicios 15, horarios_atencion 5; las otras 12 tablas
cero**. Las 14 huellas por tabla coinciden. SHA-256 agregado del vector ordenado
de conteos/huellas, antes y después de la última ronda:

`43d6ea85bcb53fd0245bb2ae0d5154e9408cb81bdf69bf8ea01a36aa41519211`

Consumo de secuencias de **toda esta fase**, incluidas rondas reparadas:

| Secuencia de tabla | Antes | Después |
|---|---:|---:|
| bloqueos_agenda | 3 | 6 |
| citas | 29 | 41 |
| consultas | 4 | 7 |
| denuncias | 5 | 8 |
| encuestas | 5 | 11 |
| fuentes | 2 | 5 |
| tickets | 40 | 58 |
| horarios_atencion | 5 | 5 |
| servicios | 16 | 16 |
| seguimientos_denuncia | 1 | 1 |

Los saltos por rollback/conflicto son normales; **no se reiniciaron secuencias**.
No hubo cambio de esquema, datos institucionales, cuentas, Secrets o Meta.

## 6. Lista única de dependencias indispensables del titular

1. **Cuentas y directorio autorizados.** Elegir correos y asignar Generalista/
   Gerente. Ejecutar `npm run admin:bootstrap` en terminal privada: entrada oculta,
   contraseña propia mínima de 12 caracteres, archivo de hashes con permiso
   0600 bajo `generated-artifacts/`, ignorado por Git/despliegue. Combinar las
   cuentas autorizadas en un array de objetos `email, role, salt, hash` y
   cargarlo personalmente en `RH_ADMIN_ACCOUNTS` mediante Secrets, nunca chat.
   Eliminar el archivo privado después. `SESSION_SECRET` ya existe; no se cambió.
   Autorizar posteriormente el directorio mínimo del piloto; hoy no hay personas
   reales registradas. No se creó ni ejecutó bootstrap con cuentas reales.
2. **Fuentes RH aprobadas.** Entregar Google Docs autorizados, versión/vigencia y
   servicio/categoría; compartir lectura con la identidad Drive conectada.
   Gerencia registra/verifica y decide activar cada fuente. Cero fuentes
   institucionales activas no se sustituye por contenido inventado.
3. **Destino Sheets de prueba.** Proporcionar spreadsheet explícito, compartir
   edición con la identidad Sheets ya conectada y autorizar escritura ficticia
   solo allí. Configurar `RH_EXPORT_SPREADSHEET_ID` personalmente. Probar ida/
   vuelta, metadata, acuse perdido y permisos antes de usar un archivo común.
   No crear un destino arbitrario ni exportar Tu Voz.
4. **Estado durable de entrega.** Autorizar o rechazar la única columna/check
   propuesta en §4. Sin esa autorización no se ejecuta la migración ni se
   completa/conecta el adaptador de entrega real; se conserva despacho bloqueado.
5. **Canal Meta y permiso de prueba.** Revisar cuenta/número, restricciones del
   modo de prueba, plantillas aprobadas e idioma, ventana y destinatarios de
   prueba expresamente permitidos. Cualquier prueba saliente necesita permiso
   específico posterior. Los Secrets existentes no prueban plantillas/permisos.
   `WHATSAPP_OUTBOUND_APPROVED` y `WHATSAPP_OUTBOUND_ALLOWLIST` no están
   configurados, y no se activaron ni se solicitó contacto con trabajadores.
6. **Alojamiento e invocación.** Autorizar destino Node, origen HTTPS canónico
   (`ORIGIN`), puerto/host y operación del panel en una instancia o con afinidad.
   Entrada preparada: `npm run build` y `npm start`; workflow de desarrollo
   sigue en `npm run dev`, sin deployment publicado. Crear `CRON_SECRET` propio
   y una invocación autenticada de preparación con frecuencia aprobada, usando
   `CATARINA_BASE_URL` del destino autorizado. No se instaló cron externo ni se
   seleccionó otro proveedor. El despacho real seguirá bloqueado tras preparar.

## 7. Riesgos residuales y condiciones de piloto

- No se declara operativo un envío porque un webhook o endpoint responda 200.
  Se distinguen recepción, COMMIT, aceptación del proveedor y atención/resolución.
- Login de cuentas RH reales, escritura Sheets real, plantillas/canal Meta y
  cron/hosting productivos **no fueron verificados**. El piloto/contacto aún
  requiere autorización; ningún interruptor se habilita automáticamente.
- Sesión administrativa en memoria exige re-login tras reinicio/rebalanceo.
  Conversación durable tiene garantías diferentes, probadas entre procesos.
- El exportador mantiene transacción acotada sobre tickets cerrados durante
  llamadas Sheets; fallos/locks dan error controlado. Cuotas, edición manual
  de filas/metadata o colisión de ID requieren revisión, no archivo falso.
- La verificación TLS acredita cliente→endpoint Neon; `pg_stat_ssl` no prueba
  cifrado de todos los tramos internos del proveedor.
- Retención de recibos técnicos continúa provisional, **sin purga automática**.
  Definir política de privacidad con Trainmex antes de operación definitiva;
  no se inventó plazo legal ni se promete retención indefinida.

## 8. Rutas, cambios y material para los tres apartados rectores

Rutas existentes: `/demo`, `/demo?resource=simulacion`, `/panel`, `/login`,
recursos protegidos `/api/rh/*`, `/api/whatsapp/webhook`.
Nuevas: `/healthz`, `/readyz`, `POST /api/cron`.
Demo incluye directorio, tickets, agenda, bloqueos, fuentes, consultas, Tu Voz,
encuestas, indicadores y configuración; solo datos aislados ficticios.

Cambios centrales: autenticación/cierre/JSON, roles/UX RH, TLS/configuración
PostgreSQL, adaptador Node, exportador, motor de despacho ficticio y cron
protegido. Herramientas nuevas: bootstrap privado, invocación cron, pruebas de
preactivación/auth-browser y fixture Sheets atómico. OpenSSL es dependencia
local de la prueba TLS, no un certificado o cambio del alojamiento.

Archivos nuevos:

- `docs/PREACTIVACION.md`
- `scripts/admin-bootstrap.mjs`
- `scripts/run-cron.mjs`
- `scripts/test-auth-browser.mjs`
- `scripts/test-preactivation.mjs`
- `scripts/helpers/sheets-fixture.mjs`
- `src/lib/server/cron-auth.ts`
- `src/lib/server/cron-handler.ts`
- `src/lib/server/postgres-config.ts`
- `src/lib/server/request-json.ts`
- `src/lib/server/survey-dispatcher.ts`
- `src/routes/api/cron/+server.ts`
- `src/routes/healthz/+server.ts`
- `src/routes/readyz/+server.ts`
- `.agents/memory/neon-pooler.md` — precauciones técnicas para continuidad del trabajo.

También se actualizaron README, CONTROL_PROYECTO, replit.md, índices de notas,
paquetes/configuración Vite y las implementaciones/pruebas existentes afectadas.
El diff del commit conserva el inventario completo; los dos Markdown rectores
y sus versiones no se modificaron.

Para actualización posterior por ChatGPT/Trainmex:

- **Maestro:** preparación reforzada; producto demostrable, sin piloto,
  publicación o mensajes reales; dependencias exactas en §6.
- **Plano:** 14 tablas y catálogo/horarios intactos; ninguna migración en esta
  fase. Columna de entrega solo propuesta. Aclarar sesión RH local frente a
  conversación compartida, cron preparado y contrato de exportación.
- **Gestión:** registrar último PASS 24 Neon / 13 preactivación / 5 auth /
  8 UI y regresiones, evidencia de limpieza/secuencias, defecto de locks corregido,
  SHA del cierre y aceptación/activación todavía pendientes.

**Replit no editó Google Drive.** Mantener SQL/históricos y no reemplazar
validación del titular por este informe.
