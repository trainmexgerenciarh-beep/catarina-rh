# Iteración 02-B — agenda institucional única en simulación

Fecha: 10 de noviembre de 2026. **IMPLEMENTADA Y PROBADA EN SIMULACIÓN**;
pendiente de aceptación de ChatGPT/Trainmex. Fuentes: Maestro v1.2,
Plano base v1.1 con Adenda 1.2 y control del proyecto previamente sincronizado.
No se modificaron los dos documentos rectores ni Google Drive.

## Separación obligatoria de 02-A y de WhatsApp

El pendiente de 02-A sigue abierto: la prueba integrada anterior usó ROLLBACK,
no probó COMMIT durable ni concurrencia real entre conexiones. El webhook
continúa con tickets ficticios en memoria y no está conectado al adaptador
de escritura Neon.

02-B se expone como **motor componible de simulación**
`createAgendaReception(dependencies, tickets, agenda, { now })`. Reutiliza
`createPayrollReception` sin modificarlo. Las pruebas recorren recepción,
confirmación del ticket, oferta y gestión de reserva ficticia. No se conectó
este nuevo motor al webhook ni se añadió transporte de mensajes o UI operativa.
Ni tickets ni reservas se declaran operativos por WhatsApp.

## Inspección previa de Neon — solo lectura

Se inspeccionaron columnas, tipos, nulabilidad y restricciones de `citas`,
`horarios_atencion`, `bloqueos_agenda` y `tickets` mediante BEGIN READ ONLY.
Los cuatro conteos iniciales eran cero; el control posterior de lectura
también confirmó cero, con los 15 servicios activos intactos.

| Estructura existente | Compatibilidad / diferencia frente a garantías futuras |
|---|---|
| `citas.id_cita` BIGINT identity PK, `id_ticket` FK | Identidad y asociación disponibles. No hay unicidad de reserva activa por ticket. |
| `inicio_programado`, `fin_programado` TIMESTAMPTZ | Pueden representar instantes IANA convertidos. No hay CHECK de duración/orden ni exclusión de solapamientos. |
| `modalidad`, `estado`, `observaciones` TEXT | Representación compatible, pero sin enumeraciones o reglas de transición impuestas por PostgreSQL. |
| `horarios_atencion`: día SMALLINT, inicio/fin TIME, duración SMALLINT, activo BOOLEAN | Configurable según el modelo. No hay filas cargadas ni convención de día impuesta por CHECK; el simulador usa ISO 1=lunes a 5=viernes. |
| `bloqueos_agenda`: fecha DATE e inicio/fin TIME | Permite representar bloqueos parciales o de día no hábil, sin tabla de festivos nueva. |
| `tickets`: estado y cierre/resolución separados, confirmación UNIQUE | Conservado. Esa unicidad de tickets NO garantiza idempotencia de operaciones de citas. |

Estas diferencias no bloquean una implementación **solo en memoria**, que no
necesita migraciones. No se aplicó ni preparó una migración ejecutable.
Antes de cualquier persistencia de agenda se necesita una propuesta y aprobación
independientes. No hubo INSERT/UPDATE/DELETE, consumo de secuencias ni DDL
en Neon en esta iteración.

## Reglas implementadas

- Una instancia compartida de `createSimulatedAgenda` representa **una sola
  persona/recurso institucional**, no una agenda por trabajador ni modalidad.
  Todos los tickets compiten por la misma ocupación. Solo se crea modalidad
  `presencial`, exclusivamente para tickets de servicios activos de Nómina.
- Horario inicial ficticio lunes-viernes 14:00–17:30, configurado en memoria,
  **no leído como una configuración ya cargada en Neon**. Se pueden sustituir
  ventanas/días activos conforme a los campos del modelo. Duración obligatoria
  de 20 minutos; no hay buffer. Diez bloques por ventana inicial: 14:00–14:20
  hasta 17:00–17:20; 17:20–17:40 no se ofrece.
- Calendario y presentación con `America/Mexico_City` vía Intl/IANA; no depende
  del TZ del proceso ni de un UTC offset fijo. Se usa reloj inyectable.
- Anticipación **>=7 200 000 ms**, tanto al ofrecer como al registrar.
  Exactamente 120 minutos cumple; 119m59s no. Se permite el mismo día.
- Se excluyen fines de semana, días sin ventana activa, bloques incompletos,
  inicios pasados, ocupaciones confirmadas y cualquier intersección con bloqueos
  parciales o de día completo. Los intervalos son semiabiertos: terminar al
  inicio de otra cita/bloqueo no solapa.
- Se revalida la configuración actual y ocupaciones al confirmar. Elegir una
  opción NO registra ni asegura disponibilidad.
- Cancelar pide intención explícita. Reprogramar pide intención, luego una
  nueva selección y confirmación final. Se revalidan margen de al menos 120
  minutos de la cita original y de la nueva, según AG-02/AG-03.
- La sustitución de horario es atómica en el simulador: si falla, conserva la
  reserva original; si tiene éxito, libera la ocupación anterior sin crear una
  segunda cita activa para el ticket. La reserva conserva su ID ficticio.
- Se consulta la cita vinculada al ticket y propietario autorizado. Con varias
  citas se pide cuál modificar, sin elegir una arbitrariamente.
- Reservar, cancelar y reprogramar **no modifican los campos del ticket** ni lo
  marcan resuelto. En esta simulación el ticket conserva el estado de 02-A;
  no se inventa una sincronización productiva de estados entre tablas.
- Negativa expresa a agendar, sin reserva vigente, conserva el cierre de 02-A
  «cerrado sin cita» y no resuelto. Silencio, menú, «cancelar» la conversación
  y caducidad no cancelan reservas ni resuelven tickets. Para cancelar una
  reserva debe pedir «cancelar cita» y confirmar.
- Un resultado exitoso solo se prepara después del registro simulado.
  Todos los mensajes nuevos de agenda avisan que no hay reserva real en Neon.

### Conversación y búsqueda

Tras confirmar el resumen de nómina, el motor ofrece agenda simulada. «Sí»
presenta seis opciones numeradas; seleccionar pregunta «¿confirmas?».
«Más opciones» pagina; «opciones AAAA-MM-DD» permite otra fecha de búsqueda.
El horizonte por defecto es **14 días de búsqueda simulada**, configurable
entre 1 y 31 días por llamada al repositorio. No se declara un límite funcional
productivo aprobado de anticipación máxima.

«Consultar cita», «cancelar cita» y «reprogramar cita» operan solo sobre reservas
del propietario autorizado. La autorización se comprueba en cada mensaje y
la asociación/servicio del ticket se valida antes de cada mutación de agenda.

## Atomicidad, idempotencia y límites

La validación y mutación del repositorio no contienen await: son indivisibles
en **un proceso JavaScript y una instancia compartida**. Dos solicitudes
simultáneas simuladas al mismo bloque obtienen un solo éxito; la segunda no
crea reserva. Dos confirmaciones con la misma clave recuperan la misma reserva.
Reutilizar una clave para otra intención/propietario se rechaza.

El motor serializa por teléfono y deduplica IDs técnicos. No guarda una lista
de mensajes ni respuestas preparadas: el nuevo contexto solo contiene propietario,
ticket/cita, opciones/selección, fase y última actividad. Los IDs de operaciones
ya procesadas se conservan en memoria para evitar efectos repetidos.

- Caducidad lógica exacta tras >=120 minutos sin actividad aceptada; los
  duplicados no renuevan ese tiempo. Limpieza de contexto al siguiente tráfico.
- Caducar o reiniciar el **motor** no borra reservas de una instancia de agenda
  compartida que siga viva. Una nueva consulta puede recuperarlas allí.
- Reiniciar el **proceso**, crear otra agenda o usar múltiples procesos pierde
  o separa reservas, bloqueos/configuración e idempotencia. NO hay garantía
  distribuida, persistencia, recuperación durable ni consistencia entre instancias.
- Reservas y claves técnicas crecen durante la simulación hasta descartar la
  instancia; no se implementó retención productiva ni limpieza periódica.
- El relato breve de nómina permanece únicamente en el repositorio/borrador
  ficticio existente de 02-A; 02-B no añade transcripciones ni copias históricas.

### Propuesta futura, NO implementada ni ejecutada

Antes de conectar Neon: aprobar una transacción de reserva/reprogramación que
revalide identidad, ticket, horario, bloqueos y margen; una restricción de
exclusión de rangos de citas vigentes para **el recurso institucional único**;
unicidad de cita activa por ticket; y correlación durable de operaciones para
reintentos de reservar/cancelar/reprogramar. Incluir coordinación transaccional
de cambios de bloqueos/horarios para que no compitan con reservas.

Esta propuesta requiere revisión del esquema, migración mínima autorizada y
pruebas reales entre conexiones con limpieza acordada. No se agregó columna,
restricción, servicio, cola, bloqueo PostgreSQL ni infraestructura de este tipo.
Tampoco cierra el pendiente durable de tickets de 02-A.

## Pruebas ejecutadas

| Comando | Resultado real |
|---|---|
| `npm run test:agenda` | **PASS**, 24 grupos de pruebas ficticias, sin Secrets ni conexiones externas. |
| `npm run test:payroll` | **PASS**, 15 grupos simulados sin cambiar 02-A. |
| `npm run test:payroll:neon` | **PASS solo lectura**. Se omitió deliberadamente `--rollback-authorized`: no hubo escrituras reales, ni siquiera reversibles. |
| `npm run test:conversation` | **PASS**. |
| `npm run test:processing` | **PASS completo**, 32 comprobaciones locales, catálogo real/Gemini, pago y reglas del premio y sin clasificar. |
| `npm run test:webhook` | **PASS**, firma válida 200, incorrecta y ausente 401. |
| `npm run check` | **PASS**, 0 errores, 0 advertencias. |
| `npm run build` | **PASS**, sin despliegue. |

La suite de agenda cubre ventana y configuración, viernes frente a fines de
semana, zona IANA, umbrales exactos, bloqueos parciales/día completo, ocupación
simultánea, reintentos, cambio de disponibilidad, elección vencida, confirmación
de intención, cancelación, reprogramación atómica, conservación de ticket,
consulta/vínculo, varias reservas, acceso denegado, servicio no permitido,
caducidad y pérdida de memoria. Incluye fallo simulado de repositorio sin
anunciar éxito.

**Incidencia de desarrollo corregida:** la primera ejecución no inició las
pruebas por una propiedad de parámetro TypeScript no admitida por el modo
strip-only de Node. Se sustituyó por un campo/constructor compatible, sin
dependencias nuevas. La primera ronda posterior pasó 21 grupos; la final
ampliada pasó 24. No hay fallos pendientes en los comandos anteriores.
Persisten avisos previos no bloqueantes de SSL futuro de pg y adapter-auto.

No se desarrollaron políticas, Tu Voz, encuestas, correo ni panel RH. No hubo
WhatsApp saliente, publicación, cambios de Meta, Secrets, alojamiento o
visibilidad GitHub. ChatGPT/Trainmex revisan y aceptan esta evidencia antes de
cualquier siguiente fase.
