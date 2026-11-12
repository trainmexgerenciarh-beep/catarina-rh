# Administración de usuarios y configuración — 11 de noviembre de 2026

**Implementado y probado; pendiente configuración privada del titular.**
Base: `b3a12eed9f87278c5087ac9878f2b64938f0d317`.
Sin publicación, envío WhatsApp, cron externo ni cambios en Google Docs,
Meta, Secrets o alojamiento.

## 1. Entrega funcional

Ruta: `/panel?resource=usuarios`, submenú **Administración > Usuarios y accesos**.

- Visible exclusivamente para el administrador principal autenticado.
- Listado, alta y edición de correo de gestores; activar, desactivar y revocar.
- Solo dos roles existentes: `gerente` (administrador principal) y
  `generalista` (gestor). No existe promoción de gestores a administrador.
  El formulario muestra el rol gestor fijo: no hay un tercer rol al cual cambiar.
- El principal está fijado a la cuenta expresamente autorizada por Trainmex.
  No es transferible ni desactivable por estas rutas; tampoco se ofrece borrado.
- Las rutas GET/POST `/api/admin/users` y la carga SSR de esa pantalla comprueban
  autorización en servidor; modificar el cliente no concede acceso.
- POST exige origen válido y JSON limitado mediante las protecciones existentes.
- Cada petición autenticada contra RH, sesión o readiness consulta estado,
  rol y revisión de acceso en Neon. Revocar/desactivar impide nuevos accesos;
  incrementar revisión invalida sesiones anteriores. Reactivar no las revive.
- Un correo nuevo necesita además credencial privada; conocerlo, añadirlo en UI
  o poseer una sesión anterior no basta. Editar correo obliga a configurar la
  credencial correspondiente al nuevo correo.
- Auditoría transaccional mínima: actor, acción, cuenta afectada y fecha.
  Sin contraseña, hash de contraseña, token ni narración en la auditoría.
- SQL parametrizado; cambios administrativos serializados con advisory lock
  transaccional y comprobación del principal activo dentro de esa transacción.

Las sesiones administrativas siguen siendo opacas, revocables, de ocho horas y
**en memoria por proceso**: reinicio pide login y otra instancia falla cerrada.
Se requiere una instancia/afinidad para el panel hasta otra solución aprobada.
Esto no cambia el contexto durable de colaboradores ni sus 120 minutos.
Una revocación bloquea la siguiente comprobación; no cancela retroactivamente
una petición que ya había sido autorizada y estaba en ejecución.

## 2. Migración ejecutada y evidencia

Inspección previa: 14 tablas, sin estructura equivalente de cuentas/accesos;
`fuentes` conservaba sus siete columnas; 15 servicios activos y cinco horarios.

Ejecutado explícitamente, no al arrancar:

`node scripts/migrate-admin-users.mjs --authorized-additive-admin`

Una transacción, `lock_timeout=3s`, `statement_timeout=10s`, COMMIT confirmado:

1. **public.usuarios_rh**: email TEXT PK; role TEXT NOT NULL; activo BOOLEAN
   NOT NULL DEFAULT true; revision BIGINT NOT NULL DEFAULT 1; creado_en
   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp().
   CHECK de correo normalizado/formato/longitud máxima, dos roles, revisión
   positiva y principal fijo/activo.
2. **usuarios_rh_unico_administrador**: UNIQUE parcial de role='gerente'.
3. **public.auditoria_accesos**: id BIGINT IDENTITY PK, actor/accion/cuenta
   TEXT NOT NULL, fecha TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp().
   La secuencia IDENTITY y los índices PK son objetos implícitos.

DDL exacto reproducible en `scripts/migrate-admin-users.mjs`.
No ALTER ni cambios de columnas, datos o restricciones en las 14 tablas previas.
No claves ni hashes privados en estas tablas. Total actual: **16 tablas**.
Se compararon conteos/huellas de las 14 originales antes/después del DDL:
idénticos. Se conservaron los 15 servicios y los cinco horarios.

No se insertaron cuentas duraderas: `usuarios_rh=0`, `auditoria_accesos=0`
al terminar. El bootstrap está preparado pero **NO ejecutado**.

Pruebas nuevas: fixtures de metadatos dentro de una transacción exterior
ROLLBACK; las transacciones del repositorio se sustituyen por SAVEPOINT en la
misma conexión, conservando SQL, checks, índice y auditoría reales.
La fila de principal usa la dirección fijada por el CHECK, sin contraseña en DB;
los gestores usan dominios ficticios. Nada se hace visible tras COMMIT porque
no hay COMMIT exterior de fixtures. Huellas y conteos de las **16 tablas**
idénticos antes/después.

Dos ejecuciones incrementales consumieron la secuencia nueva de auditoría:
sin usar → 5 → 10. No se restableció. No se consumieron secuencias operativas
de tickets/citas/encuestas/fuentes por estas pruebas.

Reversión: volver al código anterior deshabilita esta UI; antes debe revocarse
el acceso de gestores en configuración privada. Preferir conservar tablas
aditivas sin uso. Borrar tablas o auditoría requiere otra autorización;
no se ejecutó ningún DROP, borrado global ni restauración de secuencias.
El acceso SQL privilegiado del titular sigue fuera de los permisos del panel;
los controles de aplicación no sustituyen administración de credenciales DB.

## 3. Arranque seguro: qué debe hacer el titular

Cuentas autorizadas, confirmadas por Trainmex:

- Administrador único: **trainmexgerenciarh@gmail.com**, rol `gerente`.
- Gestor inicial: **trainmexrh@gmail.com**, rol `generalista`.

**RH_ADMIN_ACCOUNTS está AUSENTE.** No hubo login con identidades reales.
No se ha configurado OAuth Google ni verificado propiedad del buzón por OAuth:
se conserva el login local seguro ya existente, no acceso por correo solamente.

Procedimiento vigente, en terminal privada:

1. Verificar fuera del chat la identidad y asignación de ambas cuentas.
2. Ejecutar una vez `npm run admin:bootstrap-initial`. El comando solicita dos
   contraseñas distintas con entrada oculta, fija los correos/roles autorizados
   y genera un único arreglo JSON con hashes scrypt, en archivo ignorado de
   permisos 0600. Nunca guarda o imprime las contraseñas.
3. Copiar personalmente ese arreglo como Secret `RH_ADMIN_ACCOUNTS`. No incluir
   su contenido en el chat, comandos, logs, Git ni capturas. `SESSION_SECRET` ya
   está presente y no se cambia.
4. Reiniciar **Start application** y el principal inicia sesión por HTTPS en
   `/login` con su contraseña privada. Solo después de verificar su contraseña,
   el servidor crea en una transacción las dos cuentas iniciales si `usuarios_rh`
   está vacío. El gestor no puede inicializar el sistema.
5. Eliminar el archivo local privado. El acceso por correo sin la contraseña
   elegida no se acepta.

Si Neon ya tiene cuentas, una fila parcial, o la configuración no coincide
exactamente, el bootstrap de primer login falla cerrado y no cambia datos. El
comando explícito preexistente `npm run admin:activate -- --verified-private-config`
sigue disponible únicamente para una operación manual autorizada por el titular;
no se ejecuta automáticamente.

Para agregar gestores: el principal añade la cuenta desde UI; el titular
configura su objeto scrypt en el mismo Secret mediante el procedimiento privado
y reinicia para cargarlo. No hace falta otra migración ni editar código.
Si cambia el correo, debe cambiar también el objeto privado. El rol de todos
los gestores permanece generalista. Quitar acceso se hace inmediatamente desde
UI; después se puede retirar su objeto de configuración.

Esta solución mínima no implementa invitaciones por correo, restablecimiento
automático de contraseña ni SSO; no se inventan credenciales para aparentar alta
operativa. La configuración privada inicial es el bloqueo concreto de acceso.

## 4. Directorio y biblioteca son distintos

**Directorio** identifica colaboradores por número de empleado (`id_colaborador`),
nombre, WhatsApp normalizado, centro, departamento, puesto y activo. No sustituye
cuentas administrativas ni permite altas por mensajes de WhatsApp.

**Fuentes** contiene referencias a documentos autorizados, no empleados:
título, categoría del catálogo, enlace Drive, versión y fecha de vigencia.
El aprobador es el administrador autenticado que guarda la aprobación, no una
persona arbitraria declarada por cliente. Se muestra en el listado.

Flujo en Administración > Fuentes:

1. Agregar enlace Google Docs o PDF con texto en Drive y metadatos.
2. Guardar **BORRADOR**: aprobación desmarcada, inactiva desmarcada.
3. **Verificar** comprueba acceso/lectura sin aprobar el contenido.
4. Solo el administrador puede aprobar explícitamente marcando aprobación;
   el servidor vuelve a comprobar lectura antes de guardar.
5. Para retirar: desmarcar aprobación y marcar **Inactiva**.
   Si se marcan ambas, la aprobación prevalece; desmarcarla para retirar.

Se reutiliza `fuentes.activo` para elegibilidad. BORRADOR/INACTIVA y aprobador
se derivan de la última acción `fuente_*` auditada en la nueva tabla, dentro
de la misma transacción de guardado. No se añadieron columnas a fuentes.
Registros históricos sin auditoría no reciben aprobadores inventados.
La aprobación no congela el archivo Drive: una versión nueva debe revisarse y
registrarse; no se implementó bloqueo de edición ni historial íntegro del archivo.

Lectura: solo hosts Drive/Docs HTTPS y tipos Google Docs o PDF, máximo 10 MB de
entrada y 500 000 caracteres extraídos. PDF se procesa localmente con `unpdf`;
documentos escaneados sin texto requieren versión legible, **sin OCR automático**.
No se sube el PDF a otro servicio. No se guardan transcripciones en logs.
La lectura real del rector mediante el conector ya conectado fue PASS;
no convierte ese documento en política aprobada ni registra una fuente.

## 5. Meta: inspección de presencia, no de valores

| Nombre | Comprobación |
|---|---|
| WHATSAPP_ACCESS_TOKEN | PRESENTE |
| WHATSAPP_APP_SECRET | PRESENTE |
| WHATSAPP_BUSINESS_ACCOUNT_ID | PRESENTE |
| WHATSAPP_PHONE_NUMBER_ID | PRESENTE |
| WHATSAPP_VERIFY_TOKEN | PRESENTE |
| WHATSAPP_OUTBOUND_APPROVED | AUSENTE |
| WHATSAPP_OUTBOUND_ALLOWLIST | AUSENTE |
| RH_ADMIN_ACCOUNTS | AUSENTE |

Los antecedentes de Meta Developers/Cloud API/número TEST/webhook verificado
no se cuestionan ni se pide volver a crearlos.
**Vigencia del token: NO VERIFICADA**, no se supone caducado.
**Número TEST frente a business actual: NO VERIFICADO** por esta inspección.
La presencia de un identificador no lo distingue; no se examinaron sus valores.
No se hicieron llamadas de introspección Graph ni envíos; falta autorización
concreta para consultar esa metadata si el titular desea verificación técnica.
No se imprimieron prefijos, longitudes, firmas ni tokens.

Los dos controles ausentes mantienen la salida bloqueada, además de la capacidad
explícita requerida por el transporte. El cron sigue usando FAKE_ONLY y rechaza
despacho real. No deben activarse esos controles por esta entrega.

## 6. Pruebas ejecutadas

| Prueba | Resultado y alcance |
|---|---|
| `test:admin` | **8 grupos PASS**. PostgreSQL real con ROLLBACK; cuentas/roles/revisión/auditoría/checks; Drive mock y extracción PDF real local ficticia |
| `test:auth:browser` | **7 grupos PASS**. HTTPS SSR real aislado, login/logout/cookies/CSRF/reinicio; rutas API/pantalla usuarios 401/403; UI de cinco acciones con API de datos mock, 1440/402 px |
| `test:ui` | **8 grupos PASS**. Navegador real sobre demo aislada; no datos personales |
| `test:processing` | **PASS**, 32 casos locales y 11 casos Gemini real contra catálogo activo leído en Neon |
| `test:persistence` / `test:agenda` / `test:payroll` | **21 / 24 / 15 grupos PASS**, repositorios simulados |
| `test:conversation` | **PASS**, conversaciones ficticias |
| `test:webhook:e2e` / `test:memory` | **6 / 9 grupos PASS**, simulación |
| `test:integral` / `test:preactivation` | **9 / 13 grupos PASS**, integración local/scheduler/Sheets simulados |
| `test:webhook` | HTTPS público autenticado ficticio: **200/401/401 PASS** |
| `check` / `build` | **PASS**, cero errores/cero warnings; adapter-node |
| Lectura Drive real | **PASS**, contenido no impreso, sin aprobar ni modificar |
| Vista `/panel` sin sesión | Captura móvil: acceso pendiente, sin datos sensibles |

No ejecutado: login de personas reales, introspección Meta, envío WhatsApp,
escritura Sheets, cron externo o deployment. No se les atribuye PASS.
No se repitieron suites históricas Neon con COMMIT de tickets/citas/encuestas;
sus guardas de metadata se ajustaron al nuevo total de 16 tablas, sin cambiar
escenarios. La verificación SQL nueva usó exclusivamente ROLLBACK.
No se han probado alta y login reales sobre la configuración privada pendiente:
se probaron UI mock, autenticación HTTPS aislada y repositorio SQL real separados.

## 7. Lista mínima que debe entregar el propietario

1. **Acceso:** confirmar control privado de los dos correos y completar
   RH_ADMIN_ACCOUNTS con hashes mediante los pasos de la sección 3. Ninguna
   contraseña, clave o token en chat. No hace falta inventar otro usuario admin.
2. **Piloto:** directorio autorizado de 3–5 personas, con número de empleado,
   nombre, WhatsApp normalizado, centro, departamento, puesto y activo, por canal
   privado. Esto no autoriza contactarlas automáticamente.
3. **Documentos:** 2–5 archivos oficiales existentes sobre inducción, horarios,
   asistencia, permisos o vacaciones, según estén aprobados: enlace Drive
   legible por la identidad integradora, título, categoría, versión, fecha de
   vigencia y aprobador. No fabricar un documento que todavía no existe.
4. **Sheets:** URL/ID de una hoja vacía de PRUEBA expresamente autorizada y permiso
   Editor para la identidad integradora conectada. No se creó ni escribió otra
   hoja. Configurar privadamente RH_EXPORT_SPREADSHEET_ID cuando se autorice.
5. **Meta:** ninguno de los cinco Secrets básicos inspeccionados está ausente.
   Solo queda verificar vigencia/tipo de número/plantillas y destinatarios
   concretos antes de una futura activación autorizada; no volver a pedir
   herramientas ya existentes ni suponer que el token expiró. Los controles
   de salida ausentes son deliberados: no habilitarlos todavía.

No se cambió alojamiento ni se publicó. Elegir fecha de piloto, habilitar envíos,
planificador externo o publicar exige autorización aparte; esta entrega no la
supone. Google Docs lo actualizarán ChatGPT/Trainmex después de revisar este informe.
