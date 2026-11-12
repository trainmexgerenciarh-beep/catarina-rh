# Activación del administrador y biblioteca documental

**Corte verificado: 12 de noviembre de 2026.** Este informe describe el proyecto
existente; no sustituye la aceptación de Trainmex ni modifica los documentos
rectores de Google Drive.

## Resultado breve

- La carpeta oficial de Drive se encontró y se enumeró con el conector Google
  Drive de este Repl. La consulta lista completa devolvió las dos políticas de
  vacaciones y permisos/licencias proporcionadas por Trainmex. El procedimiento
  interno de vacaciones se leyó por separado y no pertenece a esa carpeta.
- Las dos políticas se pudieron leer y se calculó su hash en memoria. El lector
  de aplicación confirma permisos, tipo y que el contenido no cambió durante
  la lectura. Se verificaron los metadatos de versión indicados por Trainmex,
  sin guardar ni incluir texto de las políticas en este informe.
- No se sincronizaron ni registraron documentos en Neon: **`fuentes` tiene cero
  filas y no hay carpeta configurada en la aplicación**. Ninguna política real
  fue aprobada. El procedimiento interno continúa sin publicarse.
- Neon conserva sus 16 tablas, 15 servicios activos en 3 categorías y 5 horarios
  activos. En `usuarios_rh` hay cero filas. No se ejecutó DDL, no se alteraron
  fuentes, colaboradores, servicios, horarios ni otros datos.
- `RH_ADMIN_ACCOUNTS` está ausente y `SESSION_SECRET` está presente. Los valores
  nunca se leyeron ni cambiaron. No se verificó el login de una cuenta real.
- La aplicación precarga la carpeta entregada solo para el principal. Después
  de iniciar sesión, podrá registrarla y sincronizarla desde **Panel RH →
  Biblioteca documental**. La lista real aparecerá como BORRADOR para revisión.

## Único paso privado que falta al titular

1. En la Shell privada del proyecto, ejecutar
   `npm run admin:bootstrap-initial`. La terminal solicita dos contraseñas
   distintas de forma oculta y crea un archivo local con los dos hashes scrypt
   de las cuentas iniciales y sus roles ya fijados: un administrador principal
   y un gestor. No elija ni envíe las contraseñas al agente; no comparta el
   archivo. El archivo queda ignorado por Git y debe borrarse al terminar.
2. Copiar personalmente el contenido de ese archivo en **Replit → Tools →
   Secrets → `RH_ADMIN_ACCOUNTS`**. No pegarlo en chat, logs ni repositorio.
   `SESSION_SECRET` ya existe; no hace falta cambiarlo.
3. Reiniciar **Start application** para cargar el Secret y acceder por HTTPS a
   `/login` con la contraseña del principal. Solo ese primer login, después de
   verificarla contra el hash privado, activa en una sola transacción las dos
   cuentas iniciales **si y solo si** `usuarios_rh` está vacío. La UI de
   **Administración → Usuarios y accesos** queda entonces disponible para el
   principal. El gestor no puede disparar el bootstrap ni elevar su rol.

Si la tabla ya contiene alguna cuenta, una fila inactiva o datos incompatibles,
el bootstrap automático no modifica nada y el login falla cerrado; requiere que
Trainmex revise el estado antes de usar el procedimiento explícito preexistente.
La app no infiere identidad por el correo, no crea contraseñas y no incorpora
una vía de acceso temporal. La configuración debe representar exactamente las
dos cuentas aprobadas y sus roles.

Después del login:

1. Abrir **Panel RH → Biblioteca documental → Registrar carpeta**. El enlace
   que Trainmex ya proporcionó aparece precargado para el principal.
2. Registrar la carpeta y pulsar **Sincronizar / Revisar cambios**. La app
   confirma permisos, enumera Docs/PDF de la carpeta y subdirectorios y crea
   cada documento como BORRADOR. No crea ni comparte carpetas y no cambia Drive.
3. Abrir cada ficha, leer el contenido temporalmente y verificar versión,
   alcance y vigencia con respaldo documental. Solo entonces puede proponerse
   y aprobar explícitamente un tipo `POLITICA/PREGUNTAS_TRABAJADOR` y fragmentos
   exactos. El procedimiento interno debe permanecer `PROCEDIMIENTO_INTERNO`;
   no se convierte en respuesta al trabajador por el hecho de estar en Drive.

## Contrato de biblioteca y límites

- Drive es el origen para registro, lectura y sincronización. Los archivos
  originales no se modifican.
- Neon conserva metadatos de fuente, estado, hash/revisión, la aprobación, alcance
  y solo los fragmentos exactos que el principal publicó. No guarda transcripciones
  del chatbot ni el documento completo. La lectura de contenido para revisión es
  temporal y está bajo sesión RH.
- Las respuestas a políticas consultan exclusivamente esos fragmentos aprobados
  y activos en Neon. No se llama a Drive en cada mensaje. Las respuestas citan
  título, versión y fecha registrada; si no hay fragmento suficiente o hay varias
  respuestas diferentes, se deriva a RH en lugar de improvisar.
- La sincronización manual verifica acceso, inventario completo, modificación,
  retiro y hash. Si cambia un documento, queda pendiente e inactivo hasta revisión;
  si se retira o se pierde acceso, se desactiva el material afectado o se bloquea
  la raíz con error. Una fila INACTIVA nunca se reactiva automáticamente.
- **Limitación:** Drive no notifica al proyecto en tiempo real y no se configuró
  cron ni vigilancia automática. Un cambio o revocación externa se detecta al
  pulsar sincronizar; hasta ese momento puede permanecer visible el último
  fragmento que RH había aprobado. La aplicación informa esta limitación y no
  promete invalidación instantánea sin una sincronización.
- Los enlaces de directorio y exportación configurados para este proyecto se
  conservan y se precargan en el diálogo privado de recursos; no se cambió su
  destino ni se repitió la canaria. No se importaron colaboradores ni se
  exportaron tickets.

## Implementación y verificación

- Se añadió un bootstrap inicial de dos cuentas con roles fijos. La activación
  exige el hash privado correcto del principal, exactamente ambas cuentas
  autorizadas, una tabla `usuarios_rh` vacía y un bloqueo transaccional compartido
  con la administración existente. Idempotente ante la pérdida de respuesta;
  no crea un segundo administrador ni repara filas parciales a ciegas.
- Se mantiene login local con contraseña, CSRF/origen, cookies seguras, revocación
  y autorización de servidor. La interfaz sola no concede acceso.
- No hubo migración nueva; la columna `fuentes.biblioteca JSONB` ya estaba
  presente. El conteo de esquema no cambió.
- La prueba real de Drive es de solo lectura. La prueba de SQL para la biblioteca
  y el bootstrap usa datos sintéticos dentro de una transacción revertida; no
  demuestra COMMIT durable ni crea cuentas reales. La prueba de navegador usa
  HTTPS local privado, cuentas ficticias y API documental simulada.
- No hubo envíos WhatsApp, solicitudes de Graph para envío, cambios de Secrets,
  actualizaciones de archivos Drive, imports personales, escrituras Sheets ni
  publicación.

### Pruebas ejecutadas en esta entrega

| Comprobación | Resultado | Alcance |
|---|---|---|
| `npm run check` | PASS, 0 errores/0 avisos | Svelte/TypeScript |
| `npm run build` | PASS | SvelteKit, adapter-node |
| `npm run test:admin` | PASS, 9 grupos | SQL Neon real solo en ROLLBACK; sin cuentas reales |
| `npm run test:library` | PASS, 6 grupos | SQL Neon real solo en ROLLBACK; Docs/fragmentos de prueba simulados |
| `npm run test:auth:browser` | PASS, 9 grupos | HTTPS privado real, usuarios ficticios; APIs RH simuladas, sin Neon/Secrets |
| `npm run test:integral` | PASS, 9 grupos | Datos ficticios y transportes simulados |
| `npm run test:conversation` | PASS | Conversaciones simuladas |
| `npm run test:webhook` | PASS | Firma válida 200; firma incorrecta/ausente 401 |
| `npm run test:classifier` | PASS, 32 comprobaciones | Contrato local; no invocó Gemini |
| `npm run check:library:drive` | PASS | Enumeración y lectura real de Drive de solo lectura; Neon solo SELECT |

Los tests Neon preservaron las huellas de las 16 tablas y no dejaron filas
ficticias. No restablecieron secuencias: la suite de biblioteca consumió
`auditoria_accesos_id_seq` 70→81 y `fuentes_id_fuente_seq` 21→24; la suite de
administración consumió auditoría 81→87. Esto es el comportamiento normal de
secuencias PostgreSQL ante `ROLLBACK`; no equivale a filas persistidas. Hubo
intentos de prueba adicionales mientras se completaba la UI, también revertidos.
La lectura final dejó `auditoria_accesos_id_seq` en 87 y `fuentes_id_fuente_seq`
en 24; no se reinició ninguna secuencia.

La prueba real de Drive confirmó dos políticas en la carpeta, ambas con lectura
y hash correctos y las versiones indicadas por Trainmex. El procedimiento interno
también pudo leerse, pero no está en la carpeta. `fuentes` quedó en cero filas
antes/después. No se ejecutó `test:processing` ni una llamada real a Gemini.
Ningún documento real fue aprobado o guardado.

La navegación de biblioteca fue comprobada en el navegador HTTPS privado con un
backend documental simulado, incluido el permiso denegado, sincronización,
borrador, aprobación de un fragmento ficticio, retiro y vista móvil. La captura
pública no inició sesión: mostró el estado correcto «Acceso aún no configurado».
No se probó el login del propietario real.
