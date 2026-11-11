# Catarina RH — entrega integral autorizada

## Autorización y precondiciones

La orden integral de Trainmex posterior a 02-D1A autoriza terminar el producto
en este repositorio, crear las dos tablas propuestas y añadir atención recibida
a encuestas, manteniendo salida y publicación bloqueadas. Sustituye las
exclusiones de alcance históricas de 02-A–D1A; no sustituye las reglas de RH.
Los tres apartados oficiales y el estándar universal 1.0 se consultaron mediante
Google Drive (HTTP 200). Google Drive no se modifica desde esta entrega.

Inspección previa SELECT: 12 tablas; colaboradores, tickets, citas, recibos,
fuentes, consultas, denuncias y encuestas vacíos. Servicios 15 y horarios 5.
Tipos/FKs compatibles; no se recrean tablas existentes ni se cambia catálogo.

## Migración explícita, no automática

`migrations/001_contexto_eventos_encuestas.sql`: transacción con lock_timeout 5s,
statement_timeout 60s; dos tablas, dos índices adicionales y una columna BOOLEAN
nullable `encuestas.recibio_atencion`. No inventa atención para registros antiguos.
Se conserva SQL histórico. El script exige los nombres ausentes, 12 tablas,
15 servicios y cinco horarios; compara conteos/huellas de columnas anteriores.

El diseño provisional se adapta a la autorización de resumen mínimo:
`estado` permite únicamente cuatro módulos estructurados (menu, nomina, agenda,
recepcion), máximo 16 KiB, sin transcripción. Nómina conserva una explicación
breve de trabajo; Tu Voz un relato suficiente limitado; después del registro
se eliminan del borrador. TTL lógico exacto 120 min y limpieza física por lote.
Los resultados de eventos son exclusivamente códigos y folios técnicos, no
mensajes preparados ni narraciones. Recibos sin purga automática provisional.

Reversión no ejecutada: primero detener procesamiento, comprobar tablas nuevas
vacías/sin dependencias de negocio y exportar evidencia autorizada si procede;
retirar código dependiente; DROP explícito separado de las dos tablas y columna
solo con autorización. No borrar ni restaurar las doce tablas existentes.
Una reversión destructiva después de uso perdería deduplicación: no es segura
por iniciativa automática.

## Activación

No publicar ni activar salida. Autenticación RH falla cerrada sin allowlist:
`RH_ADMIN_ACCOUNTS` contiene cuentas específicas con email y uno de los dos roles:
generalista/gerente, salt aleatorio y hash scrypt (64 bytes, hexadecimal).
Firma de sesión mediante SESSION_SECRET existente, cookie Secure/HttpOnly/
SameSite Strict, ocho horas y revocación al retirar la cuenta de allowlist.
No existe usuario o contraseña universal. Ningún Secret se cambia en esta entrega.
La demostración usa datos enteramente ficticios aislados, nunca datos Neon.

## Matriz de aceptación técnica

| Módulo | Entregado | Evidencia / límite |
|---|---|---|
| Contexto, borradores y dedupe | Neon compartido, versión/revisión, lease 90 s y fencing, TTL 120 min | COMMIT real, procesos nuevos, dos conexiones, expiración, eventos sin negocio y medios; PASS |
| Webhook | GET verificación, POST HMAC RAW, validación completa antes de negocio, 503 parcial | HTTPS real 200/401/401; GET PASS; arnés firmado SQL real; no evento Meta real en esta entrega |
| Nómina | Catálogo activo, viernes, resumen/confirmación, ticket/folio, cita presencial o negativa expresa | Conversación completa SQL real y demo UI; sin diagnóstico de nómina ni resolución inferida |
| Políticas | Extracto literal con fuente/versión/vigencia o consulta/faltante/ticket/cita REMOTA | Fallback SQL real; respuesta sustentada con fuente ficticia; Drive real leído, sin fuentes institucionales cargadas |
| Tu Voz | Dos opciones, relato/resumen confirmado, consentimiento Sí/No, folio propio | SQL real separado en denuncias; No no crea seguimiento/cita/ticket; Gerencia únicamente |
| Agenda | Repositorio original compartido, dos modalidades, cancelar/reprogramar mismo ID | GiST, una PROGRAMADA/ticket, concurrencia idéntica/parcial/adyacente, rollback; PASS |
| Panel y directorio | Directorio CRUD, filtros, servicios, tickets, agenda, fuentes, consultas, Tu Voz, encuestas, estadísticas | Navegador real demo escritorio/móvil; operaciones SQL de directorio/fuente/bloqueo y permisos; acceso administrativo real aún sin configurar |
| Atención y resolución | REALIZADA/NO_ASISTIO solo después de fin, horas reales opcionales explícitas | SQL real; horario programado nunca suplanta horas reales; cita no resuelve ticket |
| Encuestas | Preparación durable idempotente desde día posterior de fecha programada; atención, 1–5 si atendido, resolución y comentario | SQL real y conversación ficticia; no atención deja calificación/resolución NULL; no salida real |
| Reportes / Sheets | Indicadores SQL y exportación ordinaria mensual deduplicada/archivada sin borrar | Mock de acuse perdido y relectura PASS; destino/permisos pendientes, ningún archivo Sheets real escrito |
| WhatsApp saliente | Transporte Graph v27 con texto/plantilla y restricciones de ventana/aprobación/destino | Gate bloqueado antes de fetch; cero solicitudes de envío; dispatcher saliente no habilitado |

### Rutas y uso

`/` entrada; `/demo` panel ficticio; `/demo?resource=simulacion` conversación;
`/login` acceso específico; `/panel` datos Neon tras autenticación.
Secciones: `dashboard`, `agenda`, `tickets`, `colaboradores`, `servicios`,
`fuentes`, `consultas`, `voz`, `encuestas`, `indicadores`, `configuracion`.
API privada `/api/rh/{recurso}`; demo `/api/demo/{recurso}` y
`POST /api/demo/conversation`; autenticación `/api/admin/login`, `/session`,
`/logout`; webhook `/api/whatsapp/webhook`.
Navegador público sin sesión obtiene 401 de datos RH, no una copia de Neon.
La demo nunca escribe Neon ni usa Gemini/Drive reales: clasificación ficticia
declarada y almacenamiento por cookie aislada temporal.

## Contrato durable, privacidad y concurrencia

```text
HMAC + validación completa de lote
  -> identidad activa/unívoca por teléfono
  -> TX1: lock institucional, identidad revalidada, recibo anterior,
          hash/clave, contexto/revisión, lease/token/generación; COMMIT
  -> catálogo + Gemini + Drive FUERA de transacciones
  -> TX2 UNA conexión: lock institucional, fencing/identidad/catálogo,
          motor existente -> ticket/cita/consulta/Tu Voz,
          contexto mínimo + evento PROCESADO + recibo aplicado; COMMIT
  -> resultado preparado (NO envío)
```

- Un duplicado PROCESADO recupera códigos/folio, no reejecuta ni renueva TTL.
  Misma clave con otra huella/titular produce conflicto controlado. El evento
  usa el ID completo original; los tests usan IDs ficticios completos y únicos.
- Hash v1 determinista de tipo/propietario/texto; medios usan JSON canónico
  hasheado, sin descargar ni transcribir. No se almacena el payload en el diario.
  Notificaciones de entrega/status se acusan sin operaciones de negocio.
- El contexto expira exactamente 120 min después de la última actividad nueva
  comprometida. Lease 90 s permite recuperar un trabajador detenido: token,
  generación y revisión impiden que el trabajador viejo confirme después.
  Un pendiente recibido antes de una actividad posterior ya confirmada se
  descarta técnicamente sin aplicar aquel texto al nuevo borrador.
- Una modificación administrativa del teléfono o estado invalida la identidad
  revalidada dentro de la transacción; no basta el lookup anterior a Gemini.
- Un fallo entre efectos y diario final revierte ambos. Si el COMMIT ocurrió y
  se perdió el acuse, el reintento recupera el registro desde otro proceso.
  No es una promesa de entrega exactamente una vez a Graph/WhatsApp.
- Rechazo de disponibilidad usa SAVEPOINT: no confirma la nueva reserva y
  conserva una previa. Se vuelven a ofrecer opciones; no promete citas fallidas.
- La agenda conserva lock común, GiST y UNIQUE parcial; toda modalidad usa la
  misma persona RH. El panel modifica bloqueos bajo el mismo protocolo.
- El bloqueo global es deliberadamente conservador y limita throughput;
  no se certificó carga de producción ni caída física del proveedor.
- Resultados de eventos: objeto v1 mínimo `version/codigo/aplicado/folio`;
  columnas técnicas enlazan ticket/cita cuando existen. No se almacenan
  respuestas preparadas, texto íntegro del evento ni transcripciones.
- `operaciones_citas` conserva contrato v1 de operaciones APLICADAS, huella y
  resultado original; `tickets.id_mensaje_confirmacion` conserva su UNIQUE.
  No se reutiliza la clave de ticket para producir un efecto contradictorio
  de agenda. Recibos antiguos se consultan antes del borrador.
- **Retención provisional:** no purga automática de eventos/recibos/IDs de
  confirmación ni de tickets/citas. Definir finalidad/plazo definitivo y
  tratamiento de idempotencia antes de una futura purga; no inventar plazo legal.

### Mantenimiento y programación

Hook del servidor inicia un temporizador de 60 s por proceso vivo, sin envío:
limpia hasta 100 contextos vencidos sin lease vigente y prepara encuestas
pendientes bajo el lock común. No hay transacción abierta durante llamadas
externas. El acceso también descarta lógicamente contexto vencido.

La preparación evalúa la fecha PROGRAMADA en America/Mexico_City, no la fecha
de creación, y encuentra fechas anteriores a hoy, sin citas CANCELADA.
La ausencia de encuesta se comprueba bajo el mismo lock en todos los procesos:
un reinicio hace catch-up, no crea una segunda encuesta. No aplica a consultas
autoatendidas, tickets sin cita ni Tu Voz. También existe acción manual de
preparar desde el panel. No inferir atención ni respuesta de satisfacción.

Un proceso suspendido no ejecuta timers: se conserva estado durable y se
recupera al volver, pero no se promete puntualidad sin alojamiento/scheduler
revisados. La entrega NO instala cron externo ni cambia hosting. La cola
saliente y la entrega/reintentos de plantillas deberán validarse al autorizar
salida; no están activados ni certificados con Meta real.

## Pruebas ejecutadas (11 de noviembre de 2026)

| Comando / comprobación | Resultado real |
|---|---|
| `npm run test:persistence` | PASS, 21 grupos, SQL mock |
| `npm run test:agenda` | PASS, 24 grupos, reloj/repositorio ficticio |
| `npm run test:payroll` | PASS, 15 grupos, repositorio/SQL simulado |
| `npm run test:conversation` | PASS, conversaciones ficticias |
| `npm run test:memory` | PASS, nueve grupos, reloj/timers/SQL ficticios |
| `npm run test:webhook:e2e` | PASS, seis grupos, SQL simulado |
| `npm run test:processing` | PASS, contrato local 32 comprobaciones, Neon READ ONLY y Gemini real: 10 temas y un caso sin clasificar, incluidos pago/requisitos de premios |
| `npm run test:integral` | PASS, nueve grupos: autenticación, gate salida, fuentes, tres flujos, demo aislada, temporizador y Sheets simulado |
| `npm run test:integral:neon -- --authorized-synthetic-commit` | PASS, 20 grupos SQL/COMMIT real, nuevas conexiones y procesos; limpieza exacta |
| `npm run test:ui` | PASS, siete grupos, Chromium real, CRUD/demo/tres conversaciones/privacidad/responsive 402 y 1440 px |
| `npm run test:webhook` | PASS, HTTPS público HMAC 200/401/401, número ficticio no autorizado |
| GET HTTPS con token interno/challenge sintético | PASS, sin imprimir query/challenge/secret |
| Lectura Drive desde SDK de la aplicación | PASS, documento técnico autorizado; no respuesta documental institucional real |
| `npm run check` | PASS, cero errores/cero advertencias |
| `npm run build` | PASS; adapter-auto informa que falta elegir entorno productivo, no se publicó |

La frontera 120:00/119:59 se verificó con reloj PostgreSQL después de esperar
lock; las suites de agenda cubren 20 min sin buffer, cierre 17:30, último bloque
17:00–17:20, días hábiles, bloques parciales y zona horaria.
Concurrencia: dos pools reales disputan intervalo igual/parcial; adyacentes
válidos. Lease y fencing se forzaron con fixtures; un proceso hijo recuperó
estado/recibo confirmado. No se interrumpió físicamente Neon.

Defectos encontrados y corregidos durante la verificación: origen HTTPS del
proxy distinto al interno (solo se confía en el host dev configurado, no
headers arbitrarios), selector reactivo de fuentes con variable fuera de
scope, tipo de opciones del SDK y guard del arnés de pruebas. La ejecución
rechazada por sintaxis no abrió conexiones ni escribió datos. Todos los
resultados PASS anteriores corresponden a ejecuciones completadas, no inferidas.

### SQL real y limpieza

Preflight: doce tablas originales vacías salvo servicios=15/horarios=5, columnas,
FKs/índices/constraints inspeccionados. Migración autorizada COMMIT, 459 ms
registrados; verificación posterior: 14 tablas, 18 constraints de contexto y
22 de eventos, cuatro índices (dos PK y dos explícitos), BOOLEAN nullable.
Todas las huellas de datos anteriores a DDL se conservaron.

Cuatro rondas progresivas de integración alcanzaron 13/15/18/20 grupos,
cada una con comparación final de catorce conteos/huellas. Última ronda:

| Tabla | Antes | Eliminados al limpiar | Después |
|---|---:|---:|---:|
| colaboradores | 0 | 1 ficticio | 0 |
| tickets | 0 | 5 ficticios | 0 |
| citas | 0 | 4 ficticias | 0 |
| operaciones_citas | 0 | 6 recibos ficticios | 0 |
| contextos_conversacion | 0 | 1 contexto ficticio | 0 |
| eventos_entrantes | 0 | 50 eventos ficticios | 0 |
| consultas | 0 | 1 ficticia | 0 |
| denuncias | 0 | 1 ficticia | 0 |
| encuestas | 0 | 1 ficticia | 0 |
| fuentes | 0 | 1 inactiva ficticia | 0 |
| bloqueos_agenda | 0 | 1 ficticio, vía propia acción eliminar | 0 |
| seguimientos_denuncia | 0 | 0 | 0 |
| servicios | 15 | 0 | 15 |
| horarios_atencion | 5 | 0 | 5 |

Un colaborador sin WhatsApp enrutable y marcadores técnicos exclusivos; ningún
servicio/horario de prueba. La fuente ficticia quedó inactiva, nunca se leyó como
política institucional. SQL parametrizado: altas necesarias, consultas,
actualizaciones de estado/horario y fallos inyectados dentro de la unidad
transaccional; limpieza por IDs/propietario/marcadores exactos, en orden FK,
sin DROP/TRUNCATE/DELETE global ni reinicio de secuencias.

Última ronda consumió secuencias tickets 34→40 (incluye rollback), citas 25→29,
consultas 3→4, denuncias 4→5, encuestas 4→5, fuentes 1→2, bloqueos 2→3.
Acumulado desde antes de estas rondas: tickets 20→40/citas 13→29.
**Los huecos de secuencia son irreversibles normalmente y no se ocultaron.**
Servicios/horarios conservaron también sus secuencias. Catorce huellas finales
idénticas: sin residuos de fixtures ni cambios a registros preexistentes.

### Configuración pendiente, no simulada como éxito

1. Responsable configura cuentas específicas en `RH_ADMIN_ACCOUNTS` con scrypt
   y roles generalista/gerente; SESSION_SECRET existente se usa internamente.
   Ninguna cuenta real de RH se creó ni probó en navegador. El módulo/roles,
   firma, contraseña incorrecta/revocación y rechazo sin sesión sí se probaron.
2. RH registra fuentes institucionales aprobadas con categoría, URL, versión y
   vigencia, y concede lectura al conector. Hay cero fuentes reales; no afirmar
   que ya se contestan políticas reales. Drive técnico sí pudo leerse por SDK.
3. Responsable elige `RH_EXPORT_SPREADSHEET_ID` y permisos de edición. Exportador
   implementado y mockeado, sin exportación real ni creación de archivo externo.
4. Revisión Meta: permisos, publicación/autorización cuando corresponda,
   plantillas y ventana de servicio, destinatarios autorizados y aprobación
   explícita antes de habilitar envíos. Gate requiere revisión explícita y
   configuración; actualmente ninguna ruta lo habilita. Cero mensajes reales.
5. Validar alojamiento y programación/monitoreo operativo antes de producción.
   No certificar disponibilidad 24/7, cron externo o envío exactamente-una-vez.

No se editaron Secrets, cuenta/número Meta, visibilidad GitHub, hosting ni
documentos Google Drive. No se contactó a colaboradores ni publicó deployment.

## Material para actualizar los tres apartados rectores

**Documento Maestro:** registrar entrega de tres categorías y panel integral,
contexto/deduplicación compartidos, agenda única dos modalidades, encuesta
separando atención/resolución; mantener papel de recepcionista/secretaria.
No declarar piloto, envíos ni fuentes institucionales operativas sin activación.

**Plano Funcional/Modelo:** conservar histórico SQL; anexar migración aplicada
de dos tablas (12→14), campo nullable de atención, contratos lease/fencing/
evento/recibos, TTL 120 min y retención provisional sin purgas. Mantener quince
servicios/cinco horarios, esquema de citas, estados e invariantes originales.

**Gestión del Proyecto:** pruebas anteriores PASS diferenciadas real/mock,
COMMIT y limpieza exacta, secuencias consumidas, commit remoto de esta entrega,
pendiente aceptación Trainmex/ChatGPT y cinco activaciones anteriores.
Replit programa/prueba; ChatGPT y Trainmex revisan/aceptan/actualizan Drive.

## Archivos y dependencias de la entrega

- `src/lib/server/durable-conversation.ts`, `complete-reception.ts`,
  `maintenance.ts`: coordinación durable, recepción ampliada y mantenimiento.
- `persistence-unit.ts`, `payroll-reception.ts`, `agenda-reception.ts`,
  `neon-agenda.ts`, `whatsapp-webhook-post.ts` y ruta webhook: adaptación mínima
  de motores/unidad transaccional existentes, preservando verificación HMAC.
- `admin-auth.ts`, `rh-service.ts`, `institutional-sources.ts`,
  `monthly-export.ts`, `whatsapp-outbound.ts`: acceso RH, administración,
  evidencia documental, exportación y transporte bloqueado.
- `demo-store.ts`, `src/lib/components/RhWorkspace.svelte`, rutas `/`, `/demo`,
  `/panel`, `/login`, `/api/admin/*`, `/api/demo/*`, `/api/rh/*` y
  `src/hooks.server.ts`: interfaz, aislamiento demo, endpoints y mantenimiento.
- `migrations/001_contexto_eventos_encuestas.sql`,
  `scripts/migrate-integral.mjs`: DDL autorizado explícito y verificación.
- `scripts/test-integral.mjs`, `test-integral-neon.mjs`,
  `test-panel-browser.mjs`: regresión integral local, SQL real controlado y UI.
- `package.json`/lock: SDK oficial Replit para conectores Google ya autorizados
  y Playwright para prueba de navegador; stack y plataforma no reemplazados.
- `README.md`, `replit.md`, `docs/CONTROL_PROYECTO.md`, este informe y nota
  técnica de memoria: estado/evidencia vigente. Rectores históricos intactos.
- `.gitignore`/`.replitignore`: caché de navegador excluida. Capturas/resultados
  generados se mantienen fuera de Git y despliegue.

El SHA definitivo y confirmación de `origin/main` se entregan en el informe
de cierre; `git show --stat HEAD` contiene el manifiesto exacto sin autorreferencia
de hash dentro del propio commit.
