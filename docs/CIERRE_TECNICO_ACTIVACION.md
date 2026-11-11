# Catarina RH — cierre técnico de activación

**11 de noviembre de 2026. Base: `005a0d50b9518b951b937f5a3e726ba4dc6d6376`.**

**Implementado y probado; NO se activó operación productiva.**
Replit desarrolla/prueba; Trainmex y ChatGPT revisan y aceptan.
Este informe complementa, sin borrar, `PREACTIVACION.md`. El bloqueo de esquema
de ese informe quedó resuelto en esta ejecución. No se editaron los tres
apartados rectores de Google Drive.

## 1. Entrega comprobable

| Área | Resultado | Qué se probó / qué no |
|---|---|---|
| Estado de entrega de encuestas | Adaptador PostgreSQL implementado | COMMIT temporal, lectura desde proceso nuevo, dos procesos concurrentes, errores y limpieza real |
| Despachador | `FAKE_ONLY` conectado al adaptador durable | Transporte ficticio sin HTTP ni Graph; no es una entrega real |
| Cron | `prepare` y `dispatch_test` autenticados | Concurrencia real de DB; falta configurar credencial e invocación externa por el titular |
| Login/logout | Flujo seguro existente + pruebas ampliadas | HTTPS/SSR real privado, dos cuentas sintéticas, roles, cambio de permisos, revocación, CSRF, configuración ausente |
| Fuentes | Borrador por defecto y aprobación del Gerente | Verificación de lectura antes de activar, fuera de transacciones; lectura técnica real del rector; ninguna política aprobada |
| Sheets | Exportador anterior conservado y regresado | Dedupe, efecto tardío, rehidratación y archivado con proveedor ficticio; ninguna escritura externa |
| Panel | Estado y modo de entrega visibles | No se exponen token/lease del worker; pruebas de navegador escritorio/móvil con datos demo |
| Runtime/webhook | Conservados | Node build, TLS, HMAC RAW, GET público sintético, salud y autenticación; ningún nuevo evento real de Meta |

No se crearon cuentas RH reales, documentos, archivos Google ni cron externo.
No se publicaron deployments. No se cambiaron Secrets, Meta, visibilidad GitHub,
catálogo, horarios o proveedor de alojamiento.

## 2. Migración efectivamente aplicada

Inspección previa de catálogos: **14 tablas**, `encuestas` tenía ocho columnas,
PK `id_encuesta`, FK `id_cita`; `recibio_atencion` boolean opcional y ninguna
columna equivalente a entrega. Cero encuestas y otras tablas operativas vacías;
15 servicios activos y cinco horarios existentes.

Único DDL ejecutado, en una transacción explícita:

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
ALTER TABLE public.encuestas ADD COLUMN entrega JSONB;
COMMIT;
```

**COMMIT PASS.** Columna nullable, sin default ni backfill. No se agregó CHECK,
índice, tabla, extensión o trigger: la autorización de esta ejecución se limitó
a **una columna**. El CHECK sugerido en el informe anterior NO se ejecutó.
El contrato se valida en el adaptador; escritura manual de JSON arbitrario en
DB no queda impedida por un CHECK. Contrato incompatible falla cerrado.

El script `scripts/migrate-survey-delivery.mjs` inspecciona primero, compara las
14 huellas y la proyección anterior de encuestas, y exige el flag
`--authorized-add-column`. No se ejecuta al arrancar, compilar ni publicar.
Si la columna compatible ya existe, no repite DDL. La inspección final confirmó
`jsonb`, `is_nullable=YES`, `column_default=NULL`.

El DDL requiere ACCESS EXCLUSIVE brevemente; el tiempo de espera está acotado.
No hubo timeout ni fallo de migración. No se conservan locks tras COMMIT.

**Reversión propuesta, NO ejecutada:** detener invocaciones y volver al código
anterior compatible; dejar la columna sin usar es la reversión menos riesgosa.
Eliminarla perdería recibos: requiere nueva autorización y revisión de datos,
no se hace automáticamente ni durante limpieza de fixtures.

## 3. Contrato durable de entrega v1

Archivo: `src/lib/server/neon-survey-delivery.ts`.

`NULL` significa sin reclamación. JSON objeto mínimo:

| Campo | Contrato |
|---|---|
| `v` | `1`; versión desconocida se rechaza |
| `mode` | Exactamente `FAKE_ONLY` |
| `state` | `PENDIENTE`, `EN_CURSO`, `REINTENTAR`, `ACEPTADA`, `REVISION`, `DESCARTADA` |
| `attempts`, `fence` | Enteros no negativos; aumentan al reclamar |
| `nextAt`, `updatedAt` | Milisegundos epoch calculados con reloj PostgreSQL |
| `token`, `leaseUntil` | Token técnico aleatorio y lease de 60 segundos al reclamar |
| `code` | Código técnico acotado, no error libre del proveedor |
| `providerId` | Acuse técnico, ficticio en esta etapa |

No guarda contraseña, token Meta, teléfono, resumen, transcripción ni respuesta
a la encuesta. No acepta claves JSON ajenas al contrato. El token de reclamación
es técnico, no una credencial externa; tampoco se expone en respuestas del panel.

Correspondencia operativa: pendiente=`NULL`/`PENDIENTE`; reclamado=`EN_CURSO`;
aceptado ficticio=`ACEPTADA`; errores recuperables=`REINTENTAR`;
incertidumbre=`REVISION`; rechazo definitivo/no elegible=`DESCARTADA`.
**ACEPTADA en modo FAKE_ONLY nunca significa enviado por WhatsApp.**
Por ello NO actualiza `enviada_en`, `recibio_atencion`, respuesta, estado de cita
ni resolución del ticket. No se reinterpretarán recibos ficticios como reales.

### Transacciones y recuperación

```text
cron autenticado
  → selección de encuestas de destinatario inequívocamente ficticio
  → BEGIN / FOR UPDATE OF encuestas SKIP LOCKED
  → reloj PostgreSQL después de tomar el lock
  → reclamar + nuevo token/fence + COMMIT
  → transporte FICTICIO sin transacción o lock de DB abierto
  → BEGIN / bloquear fila / comprobar token y estado
  → registrar resultado + COMMIT
```

- Misma encuesta reclamada por dos conexiones/procesos: solo uno obtiene el
  trabajo. PK de encuesta, estado durable y lock de fila son la barrera.
- La consulta excluye los reintentos aún no vencidos. Lote de selección acotado
  a 100 filas y ejecución de hasta 50 trabajos por invocación del runner.
  No se promete throughput productivo con esta configuración de prueba.
- Se usa reloj DB para reclamación, vencimiento observado y backoff; un reloj
  aportado por el caller no cambia esos plazos.
- Rechazo externo inequívocamente temporal: espera 60 s y después 120 s;
  máximo tres intentos. Al agotarse, revisión.
- Timeout, acuse ausente o lease vencido: **REVISION, sin reenvío automático**.
  La muerte del proceso antes de iniciar el transporte también puede quedar
  en revisión conservadora: es preferible perder un intento a duplicar.
- El acuse tardío del mismo intento puede asentarse si conserva el token
  vigente, incluso después de revisión por lease vencido. Un intento anterior,
  token ajeno o fila ya finalizada no pueden sobrescribir el resultado.
- Fallo antes de COMMIT revierte la actualización; fallo de conexión durante
  COMMIT se propaga, descarta el cliente y se resuelve consultando el estado
  durable, no afirmando éxito ni enviando de nuevo a ciegas.
- No se borra entrega por vencimiento del contexto del colaborador.
  No hay purga automática; retención definitiva sigue siendo decisión de
  privacidad antes de producción, no un plazo legal inventado.

**Límite inevitable:** Meta y PostgreSQL no comparten transacción distribuida.
No se promete exactly-once externo. La prueba de acuse perdido es una
simulación de interrupción del worker/resultado sobre estado real PostgreSQL,
no una caída provocada de Meta ni prueba de entrega a empleados.

### Barreras de no salida

El adaptador solo reclama teléfonos sintéticos con cero inicial; el dispatcher
los vuelve a validar. El runner importa únicamente el transporte ficticio:
**no importa Graph, no hace fetch y no tiene interruptor de transporte real**.
Números reales no se reclaman ni modifican. Credenciales presentes no habilitan
salida. El contrato de prueba no se puede convertir en entrega real únicamente
poniendo un Secret: una activación posterior requiere revisión y autorización
expresa del canal, destinatarios y transporte.

## 4. Cron preparado, no activado externamente

Ruta `POST /api/cron`; JSON objeto de hasta 16 KiB, autenticación por
`Authorization: Bearer <CRON_SECRET>`, secreto de al menos 32 caracteres.
No se acepta credencial en query string. No se imprime el header.

| Solicitud | Resultado |
|---|---|
| Sin configuración propia de cron | 503, cerrado |
| Credencial incorrecta / query | 401 |
| `{"task":"prepare"}` | Prepara encuestas elegibles sin enviar |
| `{"task":"dispatch_test"}` | Reclama/ejecuta solo transporte ficticio y persiste resultados |
| `{"task":"dispatch"}` | 409 `REAL_WHATSAPP_DISPATCH_DISABLED` |
| Excepción o resultado no confirmado | 503; no se afirma COMMIT funcional |

Preparación: desde el día posterior a la **fecha programada** de la cita en
`America/Mexico_City`, incluye pendientes atrasados, no canceladas, colaborador
activo, categorías ordinarias; sin Tu Voz, autoatendidas sin cita ni cierre sin
cita. No deduce que recibió atención por el estado de la cita.
La clasificación de ventana conservada usa texto solo con último inbound
conocido dentro de 24 h; si no se conoce, plantilla. El runner durable de prueba
no inventa un inbound reciente y usa una plantilla ficticia.

Comandos para un futuro entorno autorizado:

```bash
npm run cron:prepare
npm run cron:test
```

Ambos leen `CATARINA_BASE_URL` HTTPS y `CRON_SECRET` del entorno, sin mostrarlo.
El segundo solo permite `dispatch_test`. No se ejecutó el comando contra una
configuración real de cron: todavía no hay `CRON_SECRET` configurado.

Para preparar alojamiento, Trainmex debe aprobar Node con `npm run build` /
`npm start`, `HOST`/`PORT`, `ORIGIN` HTTPS canónico y zona de presentación
`America/Mexico_City`. Panel RH: instancia única o afinidad, porque sus sesiones
revocables siguen siendo locales; conversaciones/entregas son durables en Neon.
El titular debe instalar por separado una invocación autenticada revisada
(p.ej. cada cinco minutos para preparación; es frecuencia técnica propuesta,
no nuevo plazo funcional). El cron externo debe guardar la credencial
privadamente, tener timeout y alertar 503 sin registrar headers.
El temporizador residente no sustituye al planificador externo.

`/healthz` sigue público; `/readyz` requiere sesión RH o credencial cron.
Readiness ahora reconoce la columna y diferencia preparación técnica de
activación externa: no sigue declarando una migración pendiente inexistente.
Mientras salida/hosting no estén autorizados, no declara piloto listo.

## 5. Alta administrativa y documentos, sin identidades inventadas

### RH_ADMIN_ACCOUNTS

1. Trainmex aporta los correos concretos y asigna `generalista`/`gerente`.
   No existe cuenta universal ni registro público.
2. Cada responsable define su contraseña única de 12–256 caracteres en terminal
   privada con `npm run admin:bootstrap`. Entradas ocultas; no poner contraseña
   en shell, chat, Git o argumentos.
3. El script crea un archivo ignorado `generated-artifacts/private-admin-*.json`
   con permisos 0600: email, rol, sal y hash scrypt; no contraseña.
4. Para varias cuentas, reunir los objetos en **un solo array JSON** mediante
   editor privado, conservando email único. El responsable copia ese array a
   **Secrets → RH_ADMIN_ACCOUNTS**, sin imprimirlo ni comprometerlo en Git.
   `SESSION_SECRET` debe existir; no se cambió en esta ejecución.
5. El responsable elimina los archivos locales privados después de configurar.
   Iniciar por HTTPS `/login`; cerrar sesión revoca la cookie incluso copiada.
   Un cambio/retiro de rol, credencial o cuenta invalida su sesión.

**Verificación actual de existencia, sin valores:** `RH_ADMIN_ACCOUNTS`,
`CRON_SECRET`, `RH_EXPORT_SPREADSHEET_ID`, `WHATSAPP_OUTBOUND_APPROVED` y
`WHATSAPP_OUTBOUND_ALLOWLIST` ausentes. No se crearon ni editaron Secrets.
Las cuentas `.invalid` de tests solo viven en el proceso HTTPS privado y se
eliminan al terminar; ese proceso no recibe Secrets reales ni DATABASE_URL.

### Drive

Panel `/panel?resource=fuentes`: Gerente registra nombre, categoría, enlace
Drive, versión y vigencia. **Nueva fuente empieza sin aprobar**. Se reutiliza
`activo` como aprobación operativa; no se agregó tabla ni historial de aprobaciones.
«Verificar» solo comprueba lectura. El Gerente revisa contenido y vigencia antes
de marcar «Aprobada por Gerente para consultas».
Antes de guardar activa, el servidor vuelve a comprobar lectura fuera de toda
transacción. Lectura fallida impide activar; Generalista no edita/aprueba.
La lectura no certifica que el documento sea política oficial.

Se leyó realmente contenido no vacío del documento rector por la identidad
Drive conectada. No se registró como fuente RH, no se imprimió su contenido y no
se editó. Cero fuentes quedaron al terminar. El titular debe compartir los
documentos institucionales aprobados con la identidad conectada; no se
fabricaron políticas.

### Sheets

El titular debe aportar una **hoja de prueba explícitamente autorizada**,
compartida con permiso de edición a la identidad Sheets conectada. Aportar el
`spreadsheetId` (tramo `/d/.../edit`) mediante `RH_EXPORT_SPREADSHEET_ID`.
No confundirlo con `gid`. No se incluyó ningún ID de destino inventado.

El Gerente verifica acceso en Configuración. Lectura accesible **no demuestra
permiso de escritura**. Antes de utilizar datos ordinarios, autorizar una prueba
ficticia aislada de ida/vuelta y limpiar solo esos fixtures.
El exportador conserva recibo atómico de metadata, huella y relectura; solo
tickets ordinarios cerrados, nunca Tu Voz, sin borrar Neon. Se probaron
duplicados, errores, efecto tardío y recuperación mediante Sheets ficticio.
**Cero escrituras/creaciones en Sheets externos en esta ejecución.**

## 6. Pruebas ejecutadas

| Comando / comprobación | Resultado real |
|---|---|
| `test:delivery:neon -- --authorized-synthetic-commit` | **11 grupos PASS** finales, COMMIT real + procesos independientes + transporte ficticio |
| `test:integral:neon -- --authorized-synthetic-commit` | **24 grupos PASS**, SQL/COMMIT real, recuperación multiproceso y concurrencia; proveedor Sheets ficticio |
| `test:auth:browser` | **6 grupos PASS**, HTTPS/SSR real privado; datos RH mock, configuración sintética |
| `test:ui` | **8 grupos PASS**, Chromium 1440/402 px, demo aislada; fuente nueva no aprobada |
| `test:preactivation` | **13 grupos PASS**, dispatcher/reintentos/ventanas/Sheets/roles simulados |
| `test:persistence` | **21 grupos PASS**, SQL mock |
| `test:agenda` | **24 grupos PASS**, repositorios simulados |
| `test:payroll` | **15 grupos PASS**, repositorios simulados |
| `test:conversation` | PASS, cinco comprobaciones ficticias |
| `test:processing` | PASS: 32 comprobaciones locales + 11 casos Gemini real y catálogo Neon leído |
| `test:webhook:e2e` | **6 grupos PASS**, SQL simulado, lote parcial/503/reentrega |
| `test:memory` | **9 grupos PASS**, reloj/temporizadores simulados |
| `test:integral` | **9 grupos PASS**, sin Neon |
| `test:webhook` | HTTPS público sintético: **200/401/401** |
| GET de verificación público | **200 PASS**, token y challenge usados internamente, nunca mostrados |
| Salud / readiness anónima / cron sin configurar | **200 / 401 / 503** |
| Drive, solo lectura técnica | **PASS**, contenido no vacío, no aprobación |
| `npm run check` | **0 errores, 0 warnings** |
| `npm run build` | **PASS**, adapter-node |

Las 11 pruebas durables cubren: ganador único entre procesos; acuse recuperado
y fencing; caída/lease y acuse tardío; backoff/máximo de intentos/token anterior;
resultado incierto sin replay; rollback de resultado inválido; cron dual;
reinicio sin reenviar; segunda conexión NOWAIT durante transporte (sin lock);
proyección administrativa sin token; versión/modo/claves ajenas y no resolución.

No hubo FAIL de estas suites en esta ejecución. Hubo rondas incrementales de
entrega (9, 10 y 11 grupos PASS) al incorporar cobertura; se documentan abajo
porque cada una consumió secuencias. No se repitieron pruebas de Meta real,
hoja real, cuentas RH verdaderas, cron externo ni publicación: **NO EJECUTADAS
por límites de autorización/configuración**, no se presentan como PASS.

## 7. Fixtures y limpieza

Antes de escribir: catálogos/constraints/FKs reales inspeccionados, baseline
operativo vacío, IDs técnicos devueltos y propietario sintético único definidos.
Colaboradores de nombre inequívoco de prueba y teléfono no enrutable con cero
inicial; ningún empleado real. Servicios institucionales se usaron únicamente
como referencia FK, nunca se modificaron ni crearon servicios de prueba.

- Primera ronda durable: 7 encuestas/citas/tickets y un colaborador, limpiados.
- Regresión integral: 55 eventos, un contexto, dos encuestas, una consulta,
  seis recibos, cuatro citas, cinco tickets, un registro Tu Voz, una fuente
  inactiva y un colaborador, limpiados. Un bloqueo creado/editado/eliminado
  dentro del propio escenario, sin residuo.
- Segunda y tercera rondas durables: ocho encuestas/citas/tickets y un
  colaborador **por ronda**, limpiados.

Fixtures de ticket/cita/encuesta se crean juntos en transacción para que el
preparador no observe una cita sintética a medio construir. Limpieza por los
IDs capturados y FK del propietario exclusivo: encuestas → citas → tickets →
colaborador; en integral primero eventos/contexto/recibos/dependencias.
Sin DELETE global, DROP, TRUNCATE, reinicio de secuencias ni borrado de recibos
ajenos. No había registros reales operativos que alterar.

**Las 14 huellas y conteos antes/después de cada ronda coincidieron.**
Final: servicios=15, horarios=5, las otras doce tablas=0. Cero fixtures y cero
locks de exportación residuales. La huella SHA256 agregada del formato de
snapshot del test durable fue:
`9a441a26d2aa51620888b19afa1bf7fb37d1f27ac22827e7e9a24fd17e2559e6`.
El test integral usa otra estructura de claves de snapshot:
`43d6ea85bcb53fd0245bb2ae0d5154e9408cb81bdf69bf8ea01a36aa41519211`.
No se comparan hashes de formatos distintos entre sí.

Secuencias al comienzo/final de **toda esta ejecución**, sin restablecer:

| Secuencia | Inicio | Final |
|---|---:|---:|
| bloqueos_agenda | 6 | 7 |
| citas | 41 | 68 |
| consultas | 7 | 8 |
| denuncias | 8 | 9 |
| encuestas | 11 | 36 |
| fuentes | 5 | 6 |
| tickets | 58 | 87 |
| horarios_atencion | 5 | 5 |
| servicios | 16 | 16 |
| seguimientos_denuncia | 1 | 1 |

Los huecos son consumo no reversible normal de pruebas/idempotencia, no filas
residuales. El ticket ID sigue dando folio estable, no necesariamente consecutivo.

## 8. Lista FINAL de dependencias externas para piloto

1. **Cuentas RH verdaderas**: Trainmex aporta emails y roles; cada responsable
   genera hash privado y configura `RH_ADMIN_ACCOUNTS`. Verificar HTTPS real
   del entorno aprobado, no reutilizar cuentas sintéticas.
2. **Directorio y documentos oficiales**: RH valida colaboradores/WhatsApp y
   documentos/versiones/vigencias, permisos de lectura Drive y aprobación en
   panel. No cargar datos reales por suposición.
3. **Hoja Sheets de prueba autorizada**: titular aporta ID y edición a la
   conexión; autoriza prueba ficticia real de ida/vuelta. Hasta entonces,
   exportación externa no verificada.
4. **Meta, plantillas y destinatarios**: titular verifica cuenta/canal/modo,
   plantillas aprobadas/idioma, ventana y destinatarios de prueba autorizados;
   permiso separado y revisión técnica antes de cualquier envío real. El modo
   FAKE_ONLY no se activa con credenciales ni instala cron saliente.
5. **Hosting y cron**: Trainmex decide URL/hosting Node, instancia/afinidad del
   panel y credencial cron independiente, y autoriza instalación/frecuencia del
   invocador seguro. No se publicó ni instaló automáticamente.

La **aprobación de columna** ya no es dependencia pendiente. Siguen siendo
límites: sesiones administrativas locales (re-login tras reinicio), ausencia de
ensayo de entrega externa real, no exactly-once en Meta y retención definitiva
por definir. No se declara «operando» ni piloto iniciado.

## 9. Archivos y traspaso rector

Nuevos: adaptador `neon-survey-delivery.ts`, runner `survey-test-runner.ts`,
script manual `migrate-survey-delivery.mjs`, suite
`test-survey-delivery-neon.mjs` y este informe.
Modificados: cron handler/ruta/CLI, dispatcher (aclaración de contrato),
servicio RH, workspace, readiness, pruebas de auth y navegador, scripts npm,
README, PREACTIVACION y CONTROL_PROYECTO. Memoria registra únicamente la
decisión no obvia de no confundir acuse ficticio con envío real.

Para ChatGPT/Trainmex, **sin editar Google Docs desde Replit**:

- **Documento Maestro:** se cerró preparación técnica durable, sin habilitar
  salida/piloto; cinco dependencias externas, responsabilidad de RH/titular.
- **Plano Funcional:** una sola columna nullable JSONB en encuestas,
  contrato v1 FAKE_ONLY, estados/fencing/revisión, sin alterar atención
  recibida ni agenda/estados/14 tablas/15 servicios/cinco horarios.
- **Gestión:** registrar suites reales vs ficticias, limpieza, secuencias,
  límite de idempotencia externa, SHA final y aceptación pendiente.

El SHA de commit/push se entrega en el cierre; este informe no contiene su
propio hash recursivo. `git log -1` y `git status` permiten comprobarlo.
