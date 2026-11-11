# 02-D1A — memoria local acotada, SIN CAMBIO DE ESQUEMA

11 de noviembre de 2026. Base `3035a744c3c06746b596802f18046b94bc4ea3fd`.
**IMPLEMENTADA / NUEVE GRUPOS NUEVOS PASS / OCHO REGRESIONES PASS /
E2E C4 SIMULADO PASS / PENDIENTE ACEPTACIÓN CHATGPT–TRAINMEX.**

La aceptación de 02-C4 en los tres apartados rectores fue contrastada en el
diagnóstico previo: integración controlada, no piloto. La nueva autorización
habilita SOLO memoria local y propuesta escrita, no persistencia compartida.
No se modifica Google Drive ni los documentos rectores/versiones.

## Qué cambió

`conversation-memory.ts` aporta caché técnica y barrido incremental común.
Nómina/agenda lo reutilizan sin sustituir motores ni reglas de negocio.

| Parámetro | Valor | Motivo y alcance |
|---|---:|---|
| Inactividad funcional | **120 minutos**, `>=` | Sin cambios; acceso directo rechaza borrador vencido incluso si no corrió timer. |
| Intervalo de mantenimiento | 5 segundos | Trabajo pequeño en proceso residente; no cron/servicio nuevo. |
| Trabajo de barrido | Hasta 200 entradas por mapa/pasada | No recorrer todas las sesiones/cachés en cada petición. Pase finito evita inanición con inserciones continuas. |
| TTL técnico de IDs/hashes RAM | 24 horas fijo | Un día técnico de deduplicación local frente a la anterior memoria ilimitada; NO ventana garantizada de Meta ni TTL laboral. |
| Capacidad de cada caché | 10.000 entradas | Presupuesto técnico, no máximo de mensajes aceptados ni de colaboradores. |
| Payload estimado por caché | 4 MiB | Cuenta UTF-8 de clave/valor + 128 bytes de estimación por entrada; NO medición/límite de heap real. |

Hay una caché para la capa de agenda y una para nómina: presupuestos de
payload agregados hasta 8 MiB por motor compuesto, además de overhead de
JavaScript, sesiones y colas. No se afirma límite global de RSS.
No hay tope arbitrario que expulse borradores activos para cumplir capacidad.
Colas/peticiones activas no tienen un nuevo límite de negocio.

### Limpieza sin mensaje entrante y acceso seguro

- Timer Node `unref()` barre aunque no lleguen mensajes mientras el proceso
  esté residente y su event loop avance. No mantiene vivo el proceso por sí solo.
- Nómina limpia conjuntamente sesión y menú asociado; agenda limpia contexto
  vencido y su borrador de nómina. Un fallo de dependencia tras modificar menú
  también deja la sesión registrada para poder limpiarla.
- No se barre una sesión con trabajo en su cola ni en la cola externa de agenda,
  incluso cuando esa tarea espera identificación/SQL y aún no entró a nómina.
- El control de acceso al estado aplica además el TTL al mensaje que va a
  procesarse: un estado vencido no queda utilizable por estar pendiente el barrido.
  Ese reinicio lógico necesario no se confunde con expulsión del recolector.
- No hay garantía de borrado físico al milisegundo 120: la cola ocupada,
  saturación/suspensión y las pasadas acotadas pueden retrasarlo.
  Para N filas estables, una revisión completa requiere aproximadamente
  `ceil(N/200)` pasadas más reinicio del cursor. Con 10.000 entradas, la cola
  física del caché puede requerir unos 255 segundos después del vencimiento,
  sin contar pausas del proceso; en acceso ya es inválida.
- Cada pase congela su presupuesto de filas. Inserciones continuas no mantienen
  el iterador siguiendo indefinidamente la cola e impidiendo revisar filas viejas.
- Recarga de desarrollo dispone del motor si Vite notifica HMR. `dispose()`
  detiene timers y deja drenar el trabajo antes de retirar sus estados.

**Entorno suspendido/serverless:** no se promete que ejecute timers. La seguridad
no depende del intervalo: control por acceso + barrido conservador. Si el
proceso muere, desaparece RAM. No se configuró alojamiento ni servidor permanente.

### Caché limitada y duplicados

Lecturas/repeticiones no deslizan TTL. Entradas caducadas son inválidas en
acceso; capacidad elimina FIFO únicamente metadatos, no sesiones/tickets.
Un ID mayor que todo el presupuesto no se almacena en caché, pero NO se trunca
ni cambia su uso en los repositorios durables.

La memoria finita puede olvidar una entrada antes de 24 h por capacidad.
Mensajes sin efecto persistente pueden volver a evaluarse al olvidar su ID:
no hay deduplicación durable nueva ni promesa de exactly-once del diálogo.
La garantía de no renovar actividad se refiere a duplicados aún reconocibles
en caché o por sus claves durables; no se puede reconocer universalmente lo
que ya se olvidó sin almacenar evidencia adicional. Esa brecha no se oculta.
Un replay durable desconocido en RAM puede descartar un borrador incierto
siguiendo la protección C4; puede ser necesario volver a preguntar.

Tickets y recibos aplicados se consultan antes de depender del caché/borrador.
Olvidar IDs RAM o reiniciar NO borra ni hace caducar Neon. Se conserva la
recuperación de folio/resultado y no se reejecuta una operación confirmada.
No se trasladan las 24 h RAM a operaciones_citas ni a tickets.id_mensaje_confirmacion.
Retención provisional sigue sin purgas automáticas de recibos en estas pruebas.

## Reglas y textos conservados

No se cambian respuestas de negocio, catálogo/Gemini, identidad, resumen y
confirmación, viernes, agenda, estados, horarios, margen PostgreSQL, recibos v1
ni unidades transaccionales. GET y POST RAW HMAC/validación integral del lote
se conservan. Única adición en ruta: liberación de memoria de desarrollo.
SIMULATION_ONLY sigue SIN SALIDA, no «sin persistencia».

Tras perder borrador un «confirmo» aislado no crea operación; recuperar el
ID de un efecto confirmado devuelve lo confirmado sin reconstruir intención.
TTL nunca cierra/resuelve ticket ni cancela una reserva.

## Pruebas nuevas — `npm run test:memory`

**9 grupos PASS**, solo reloj/scheduler/SQL ficticios:

1. Timer sin entrada: menú/nómina permanecen a 119:59.999 y se retiran a 120.
2. 50.000 IDs: capacidad/bytes, rechazo de entrada de caché sobredimensionada,
   TTL fijo sin renovación, bytes finales cero.
3. 200 entradas máximo por pasada, protección de filas ocupadas y justicia
   del recorrido bajo inserciones continuas.
4. Duplicado no renueva inactividad; acceso expira aun sin callback de timer.
5. Tarea en cola externa detenida en lookup: barrido conserva ambas capas.
6. Reinicio en **11 puntos**: menú, tema/fecha/resumen, oferta, selección,
   intención de cancelar/mover y selección de reprogramación. Confirmación
   aislada no cambia datos.
7. Timer retira agenda/nómina/menú sin entrada; confirmación caducada sin efecto.
8. Ticket recuperable tras TTL técnico y reinicio, mismo folio/registro,
   sin renovar contexto ni mutar SQL simulado.
9. Recibo de cita recuperable tras limpieza/reinicio, sin repetir negocio.

Primer intento de la suite nueva se detuvo por propietario de fixture
inconsistente (`SYNTHETIC` frente al propietario del fake SQL). Se corrigió
solo la dependencia de identidad del test; no Neon ni adaptadores. Resultado
final 9/9 PASS. No se atribuye la primera corrida fallida a un proveedor.

## Regresiones realmente ejecutadas

| Comando | Resultado |
|---|---|
| `test:persistence` | PASS, 21 grupos |
| `test:agenda` | PASS, 24 grupos |
| `test:payroll` | PASS, 15 grupos |
| `test:conversation` | PASS |
| `test:processing` | PASS completo, 32 comprobaciones locales, catálogo real15 y Gemini real incluidos pago/requisitos de premios |
| `test:webhook` | PASS, HTTPS firma válida200 / incorrecta401 / ausente401 |
| `check` | PASS, 0 errores/advertencias |
| `build` | PASS |
| `test:webhook:e2e` adicional | PASS, 6 grupos, incluye lote parcial y 503, acuse perdido simulado y reinicio |

Tests de contexto/SQL son ficticios; `test:processing` solo lee Neon y llama
Gemini. `test:webhook` envía petición sintética firmada al dev HTTPS, no Graph
API ni WhatsApp saliente. No hubo INSERT/UPDATE/DELETE, DDL ni fixtures reales;
no se ejecutaron suites Neon de COMMIT/rollback de negocio.
Se reinició solo workflow de desarrollo tras el lote de código. Avisos
SSL/adapter-auto anteriores permanecen, sin cambios para ocultarlos.

## Diseño entregado aparte, NO ejecutado

[ITERACION_02_D1_PROPUESTA.md](ITERACION_02_D1_PROPUESTA.md) contiene DDL
provisional de contextos_conversacion y eventos_entrantes, FKs/checks/índices,
lease/fencing, una conexión por unidad, orden de locks, retención, reversión,
pruebas propuestas y decisiones. Los nombres/tipos actuales se contrastaron
con SELECT de catálogos y conexión forzada read-only: 12 tablas, ninguna de las
dos propuestas presente. No se consultaron datos personales.

**No se aprobó ni aplicó 12→14**. Código actual no importa/ejecuta ese SQL
ni sabe leer esas tablas. Tampoco se cambia el JSONB v1 de recibos actuales.

## Límites y material para actualizar tres apartados rectores

- Maestro: 02-D1A refuerza memoria local sin nuevo módulo, salida o piloto.
  No afirmar continuidad entre procesos/reinicios.
- Plano: limpieza periódica conservadora + control por acceso; 120 min
  funcionales intactos; cachés24h/10.000/4MiB estimados por capa. Sin DDL real.
  Dos tablas solo propuesta pendiente de aprobación.
- Gestión: 9 grupos nuevos, 6 E2E adicionales y ocho regresiones PASS;
  metadatos Neon solo lectura, sin fixtures ni consumo de secuencias por tests
  de esta subetapa. Añadir SHA del reporte al aceptar; Google Drive no editado.

Falta decidir instancia única frente a sesiones compartidas, permiso de
resumen, DDL exacto, retención/compactación y pruebas integradas posteriores.
Reinicios siguen perdiendo borradores; operación/canal/piloto requieren
autorización separada. No se publica ni se implementan políticas, Tu Voz,
panel, encuestas o envío. ChatGPT/Trainmex aceptan; Replit programa/prueba.
