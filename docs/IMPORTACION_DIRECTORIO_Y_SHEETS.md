# Directorio y Google Sheets — entrega integrada

**Corte: 11 de noviembre de 2026.** Base: `940fac7a508e78adff6db9f1042d026c5b0ad5ff`.
Replit implementa y prueba; ChatGPT/Trainmex revisan y actualizan los tres
apartados rectores en Google Docs. No se editaron esos documentos.

## Resultado

- Importador privado navegable en **Administración > Importar directorio**,
  `/panel?resource=importar`, también enlazado desde Directorio. Solo el
  administrador principal puede abrirlo y llamar a su API.
- Lee desde Replit la hoja de directorio ya entregada. Alternativa de pegado
  CSV/TSV o archivo local privado si la conexión carece de permiso.
- Previsualización sin escrituras; clasificación por fila:
  **ALTA / SIN_CAMBIOS / CAMBIO_BLOQUEADO / RECHAZO**, con recuentos,
  normalización de teléfono/estatus y campos diferentes.
- Confirmación separada, expresa, con casilla y botón. **Nunca se sobrescriben
  colaboradores existentes**: las diferencias se muestran pero no se aplican.
  No se desactiva a quien no aparezca en el archivo. El resultado informa altas,
  cero actualizaciones y rechazos/cambios bloqueados.
- Exportador mensual existente restringido a la hoja de destino de prueba
  proporcionada; no acepta otro destino por UI. Un override privado diferente
  falla cerrado; no se modificaron variables ni Secrets.

## Lecturas reales y permiso de las hojas

Se utilizó el SDK de conectores **del proceso de Replit**, no las credenciales
del chat ni una suposición basada en compartir enlaces.

| Comprobación | Resultado real |
|---|---|
| Metadatos y lectura de «Directorio de colaboradores (prueba)», «Hoja 1» | PASS |
| Filas del directorio validadas, solo en RAM | 2 válidas, 0 rechazos |
| Filas incorporadas a Neon desde ese directorio | **0 — no se confirmó la importación** |
| Metadatos y lectura de «Cuenta integradora (prueba)», «Hoja 1» | PASS |
| Identidad de Drive por `about.user.emailAddress` | Cuenta titular confirmada |
| Capacidad `canEdit` de Drive en ambos archivos | true |
| Credencial del conector Sheets | OAuth de usuario; su correo no se expone en los metadatos del SDK |
| Escritura efectiva a través del conector **Sheets** | PASS, canaria autorizada |

Las dos conexiones son independientes. El correo comprobado en Drive **no se
atribuye a Sheets**. La escritura de Sheets quedó demostrada por su propia
respuesta y relectura, no por `canEdit` de Drive. No se identificó ni inventó una
cuenta de servicio que el titular deba invitar; no se cambió ningún permiso.

**Cambio respecto del antecedente recibido:** la hoja leída en esta ejecución
ya tiene siete encabezados, incluido «Centro de trabajo», además de los seis
informados inicialmente. Las dos filas tienen centro informado. No se copiaron
sus valores personales a logs, documentación, fixtures o Git.

El parser admite `centro` y `Centro de trabajo`; si no existe o está vacío,
lo muestra como **A DEFINIR (opcional)** y almacena NULL, sin inventar una sede.
Una primera lectura detectó el encabezado adicional y bloqueó la operación;
se incorporó ese alias y la relectura pasó. No hubo escritura durante ese bloqueo.

### Prueba canaria real autorizada

Se ejecutó **una sola canaria real**, sin tickets ni trabajadores:

1. Verificación de pestaña esperada y ausencia de valores usados.
2. Segunda lectura inmediata de vacío antes de escribir.
3. Escritura de **una fila / tres celdas A1:C1**, con marcador único
   «PRUEBA CATARINA», descripción ficticia y versión técnica.
4. Relectura exacta de esa fila: PASS.
5. Nueva comprobación de pertenencia antes de limpiar.
6. Limpieza únicamente de los tres `userEnteredValue` escritos: PASS.
7. Relectura final: **hoja vacía, cero valores usados**, como al inicio.

No se crearon pestañas, no se borraron filas/rangos amplios ni se exportó
información laboral. El marcador dinámico no se conserva en este informe.
El comando no se ejecuta automáticamente ni desde una acción normal del panel:

```sh
npm run check:sheets                       # solo lectura
# Requiere autorización vigente; ESCRIBE una canaria, no ejecutar por rutina:
npm run check:sheets -- --authorized-canary
```

**Límite:** Google Sheets no ofrece aquí un compare-and-swap de celdas frente
a ediciones humanas concurrentes. Se hicieron comprobaciones antes de cada
escritura/limpieza y se rechaza limpiar contenido cambiado o ajeno. Ejecutar
futuras canarias solo en una ventana controlada sin otros editores. La prueba
demuestra permiso efectivo en este momento, no que nunca pueda revocarse.

## Contrato y seguridad del importador

- Seis encabezados obligatorios, espacios periféricos/case/acentos normalizados:
  número de empleado, nombre completo, departamento, WhatsApp, puesto, estatus.
  Centro opcional, columnas desconocidas o encabezados repetidos rechazados.
- IDs de empleado conservados como texto; no inventa identificadores ni ceros.
  Rechaza caracteres fuera del formato documentado alfanumérico con `._-`.
- Teléfonos: diez dígitos locales se muestran con país México `52`; acepta
  doce dígitos que empiezan por `52` y números internacionales explícitos con
  `+` y forma de 8–15 dígitos. Elimina solo separadores admitidos.
  Rechaza letras, notación científica, cero inicial y el formato legado `521`
  ambiguo, que debe corregirse tras verificarlo. Validar formato **no demuestra**
  titularidad, asignación ni que WhatsApp sea alcanzable; no se contacta el número.
- Estatus reconocidos: activo/inactivo, active/inactive, true/false, 1/0, sí/no.
  Otros valores se rechazan; no se asume activo.
- Rechaza duplicados de ID/teléfono en el lote y teléfonos pertenecientes a
  otro registro. Los registros existentes se comparan y nunca se actualizan.
- Máximo técnico de 200 filas y 200 KiB por entrada/respuesta de origen:
  limita trabajo y memoria de un lote administrativo, no la plantilla laboral.
  Se leen todas las celdas usadas y luego se valida; no se trunca silenciosamente
  el directorio a un rango fijo. CSV con comillas, comas internas y TSV admitidos.
- No guarda archivos ni borradores del importador. La UI mantiene el texto en
  memoria y lo envía solo al endpoint autenticado por HTTPS; no se envía a Gemini
  ni se escribe en Sheets.
- Token HMAC de vista previa sin datos laborales: digest de entrada y proyección
  actual de directorio, actor, origen, versión y vencimiento técnico de diez
  minutos. No cambia el TTL conversacional de 120 minutos.
- Cambiar entrada/directorio, manipular token o vencerlo obliga a previsualizar
  nuevamente. La UI invalida el token tras error de confirmación, sin falso éxito.
- API verifica sesión actual, principal y CSRF; respuestas `no-store`.
  Dentro de la transacción vuelve a comprobar principal activo, usa el bloqueo
  asesor de los escritores existentes y un bloqueo de tabla acotado para el
  directorio, revalida digest y realiza solo INSERT de altas aprobadas.
  No mantiene transacción abierta durante llamadas Google.
- Auditoría mínima agregada: actor, acción, fecha y cantidad de altas; sin
  nombres, teléfonos o contenido del CSV.
- Fallo intermedio implica ROLLBACK. Si se pierde el acuse de COMMIT, informa
  resultado incierto y exige nueva lectura: las altas ya presentes quedan
  idénticas/bloqueadas, no se vuelve a insertar ni se reintenta a ciegas.
- El importador no agrega un índice único de teléfono; coordina los escritores
  actuales mediante su protocolo compartido. Un escritor externo a la app que
  ignore ese protocolo sigue siendo un límite del esquema existente.

## Pruebas ejecutadas

| Prueba | Resultado / naturaleza |
|---|---|
| `test:directory` | **8 grupos PASS**: parser, normalización, duplicados, permisos, token, fallos/acuse perdido, canaria simulada y SQL real ROLLBACK |
| `test:admin` | **8 grupos PASS**: SQL real ROLLBACK, administrador único, revocación, auditoría y fuentes simuladas |
| `test:auth:browser` | **8 grupos PASS**: HTTPS privado real, login/logout, CSRF, aislamiento/reinicio, UI usuarios/importador; datos y API de altas simulados |
| `test:ui` | **8 grupos PASS**: navegador real con datos demo, escritorio 1440 y móvil 402, sin desbordamiento ni errores JS |
| `test:preactivation` | **13 grupos PASS**, scheduler/transportes/Sheets simulados; incluye deduplicación y acuse perdido |
| `test:integral` | **9 grupos PASS**, incluye políticas sin fuente, faltante y derivación RH, sin inventar respuesta |
| `test:persistence` | **21 grupos PASS**, SQL simulado |
| `test:agenda` | **24 grupos PASS**, simulación |
| `test:payroll` | **15 grupos PASS**, simulación |
| `test:conversation` | PASS, conversaciones ficticias |
| `test:webhook:e2e` | **6 grupos PASS**, HMAC y fallos de lote simulados |
| `test:webhook` | HTTPS de desarrollo real con evento ficticio no autorizado: **200 / 401 / 401** |
| `check` | **PASS, cero errores y cero advertencias** |
| `build` | **PASS**, adapter-node |
| Lectura actualizada de hojas / canaria real | **PASS**, detalles anteriores |

La primera prueba de navegador falló por un selector nuevo incorrecto. Se corrigió
el test y se reforzó la invalidación del token de confirmación ante un error;
la suite completa de navegador posterior pasó. No se presenta ese primer intento
como PASS. La captura del preview real muestra el acceso administrativo pendiente
sin datos privados; el importador autenticado se verificó en HTTPS aislado con
credenciales/fixtures sintéticos, no con cuentas reales.

Gemini real no se volvió a invocar en este cambio de directorio/Sheets; no se
modificó su clasificador. Tampoco se volvieron a ejecutar suites históricas de
COMMIT real de tickets/citas/encuestas. El ajuste de destino en la prueba histórica
integral Neon solo actualiza la constante utilizada por su transporte simulado;
no representa una nueva ejecución de esa suite.

### Limpieza y Neon

- Inspección previa: 16 tablas, 15 servicios activos, 5 horarios, 0 colaboradores.
  Esquema del directorio compatible; `centro` es nullable.
- **Ningún DDL**, sin migraciones ni alteración del catálogo/horarios.
- Fixtures del importador completamente ficticios, prefijo técnico de empleado
  y teléfonos de prueba no enrutables. Metadatos de principal solo dentro del
  ROLLBACK; no credenciales en PostgreSQL.
- Cada prueba SQL verificó conteos y huellas de **las 16 tablas iguales** antes
  y después del ROLLBACK. Sin cuentas, colaboradores o auditoría persistidos.
- Secuencia de auditoría: **10→18** durante esta ejecución, incluyendo ejecuciones
  incrementales y regresión de accesos. PostgreSQL no revierte `nextval`;
  no se restableció la secuencia. Ninguna otra secuencia consumida por estas pruebas.
- No se insertaron los dos trabajadores proporcionados. Confirmación específica
  pendiente exclusivamente en la UI del administrador tras revisar sus datos.
- No hubo exportación real de tickets, solo canaria; la idempotencia completa
  del exportador mensual y rehidratación se probaron con transporte simulado.

## Pendientes exactos para el titular

1. **Configurar acceso privado RH**: `RH_ADMIN_ACCOUNTS` sigue ausente;
   `SESSION_SECRET` está presente. Seguir el bootstrap ya documentado en
   [Usuarios y configuración](ADMIN_USUARIOS_Y_CONFIGURACION.md). Los dos correos
   autorizados no cambian y no se vuelven a solicitar. No entregar contraseñas,
   hashes o Secrets en el chat. No se crearon cuentas por conocer sus correos.
2. Entrar como principal, abrir Importar directorio, revisar normalización y
   centro efectivamente proporcionado y confirmar las altas **si las autoriza**.
   Replit no ejecutó esa confirmación en nombre del administrador.
3. **No falta volver a entregar enlaces ni compartir con un servicio inventado**:
   lectura de ambas hojas y escritura canaria desde Replit ya comprobadas.
   El destino queda fijo en código a la hoja entregada, sin Secret nuevo necesario.
4. Fuentes oficiales aprobadas pueden añadirse después: **no bloquean esta
   operación de prueba**. Sin una fuente suficiente, Catarina no inventa políticas;
   registra consulta/faltante y ofrece atención RH conforme al flujo existente.
5. Envíos WhatsApp reales, publicación, cron externo y piloto siguen desactivados
   y requieren su autorización/configuración específica previa, no concedida aquí.

## Archivos principales

- `src/lib/server/directory-import.ts`, `sheets-config.ts`, `sheets-access.ts`.
- `src/routes/api/admin/directory-import/+server.ts`; guard SSR de `/panel`.
- `src/lib/components/DirectoryImport.svelte` e integración en `RhWorkspace.svelte`.
- Exportador `monthly-export.ts`, estado en `rh-service.ts`, mensaje API RH.
- `scripts/test-directory-import.mjs`, `check-authorized-sheets.mjs`,
  ampliación de navegador y ajuste de destino de fixtures de exportación.
- README, control del proyecto y este informe; memoria de la restricción del
  importador sin datos personales. Sin cambios al Documento Maestro/Plano.

La entrega es código y documentación en un único commit descriptivo en main;
el SHA exacto y verificación del push se reportan al finalizar. No es activación
productiva ni autorización de envío.
