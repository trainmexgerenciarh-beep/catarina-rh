# Catarina RH — registro técnico para Gestión del Proyecto

Fecha de corte: 11 de noviembre de 2026.
Fuente funcional: Maestro v1.2, Plano base v1.1/adenda 1.2 y Gestión del Proyecto
del documento oficial. Este registro documenta ejecución y evidencia en el
repositorio; **no sustituye ni modifica la aceptación o tablero de Google Drive**.
ChatGPT/Trainmex validan, aceptan y autorizan; Replit programa y prueba.

## Iteración 02-C2 — adaptadores y unidad transaccional aislados

**IMPLEMENTADA / SUITES PASS / PENDIENTE DE ACEPTACIÓN.** Sin conexión al webhook
ni escrituras Neon. No se ejecutó 02-C3; 02-C4 continúa separada.

| Registro | Evidencia actual |
|---|---|
| Unidad de trabajo | Una conexión por operación; bloqueo institucional común para agenda/tickets; resultado solo después de COMMIT confirmado. |
| Recibos | Versión 1 mínima, huella canónica, snapshot original por evento, colisión de clave controlada, recuperación sin borrador. Sin borrado/expiración automática; retención definitiva pendiente. |
| Agenda preparada | Alta/cancelación/reprogramación atómicas con recibo, consulta, disponibilidad, propiedad/servicio activo y reloj BD posterior a locks. No activa conversación remota. |
| Tickets | Comparte protocolo; un evento no aplica ticket y cita; CANCELADA no bloquea cierre explícito, sin resolución automática. |
| Pruebas | persistence 21 grupos; agenda 24; payroll 15; conversation, processing completo con Gemini, webhook, check y build PASS. |
| Neon | Solo SELECT: 12 tablas, 15 servicios activos, cinco horarios aprobados; tickets/citas/recibos 0 antes y después. Sin DDL, datos sintéticos ni rollback de escritura real. |
| Límites | Concurrencia y fallos COMMIT exclusivamente simulados. Webhook continúa en memoria; contexto volátil con 120 minutos y sin continuidad multiproceso. |
| Próximo control | ChatGPT/Trainmex revisan/aceptan; 02-C3 requiere plan y autorización independiente, no iniciar por inferencia. |

Contrato, diagramas, fallo inicial del mock corregido, pruebas y deudas:
[Iteración 02-C2](ITERACION_02_C2.md). Google Drive y rectores sin modificar.

## Iteración 02-C1 — migración controlada autorizada

**APLICADA / VERIFICACIÓN DE CATÁLOGOS Y COMMIT PASS / PENDIENTE DE ACEPTACIÓN.**
Solo DDL principal corregido y cinco horarios autorizados. No se inició 02-C2.
Las secciones anteriores de 02-A/02-B se conservan debajo como antecedentes.

| Registro | Evidencia actual |
|---|---|
| Preinspección | 11 tablas, cero citas/horarios; ninguna tabla técnica equivalente; permisos, tipos, índices y GiST compatibles; ISO confirmado para carga 1–5. |
| DDL exacto | 11 sentencias del bloque oficial, una transacción COMMIT confirmada; 12 tablas, operaciones_citas vacía; cinco NOT NULL, tres CHECK, UNIQUE parcial y EXCLUDE GiST en citas. |
| Horarios | Segunda transacción; tabla vacía comprobada bajo SHARE ROW EXCLUSIVE; cinco filas ISO 1–5, 14:00–17:30, 20 minutos, activas, IDs 1–5; COMMIT confirmado. |
| Integridad | Constraints validados e índices valid/ready. Huellas del contenido de las otras diez tablas originales iguales; esquemas distintos de citas intactos. Sin extensiones ni triggers de usuario nuevos. |
| Persistencia comprobada | Conexión nueva vio estructura y cinco horarios confirmados. No equivale a pruebas COMMIT de tickets, citas o recibos, ni concurrencia de adaptadores. |
| Exclusiones | Sin CHECK opcionales, fixtures, pruebas de escritura o cambios al código/webhook. No se ejecutaron suites npm ni se reutilizaron PASS históricos. Sin salientes WhatsApp ni despliegue. |
| Próximo control | ChatGPT/Trainmex aceptan 02-C1 y definen autorización separada de 02-C2; contrato/retención de recibos siguen pendientes. |

Detalle de sentencias, tiempos, objetos, conteos y reversión no ejecutada:
[Migración 02-C1](ITERACION_02_C1.md). Se preservaron rectores e histórico SQL.
No se editó Google Drive ni se declaró recepción operativa.

## Iteración 02-B — agenda institucional en simulación

**IMPLEMENTADA / PRUEBAS PASS / PENDIENTE DE ACEPTACIÓN.** Motor separado de
simulación que compone 02-A sin cambiar el webhook ni el adaptador Neon.
No se declara operación de tickets ni reservas por WhatsApp.

| Registro | Evidencia actual |
|---|---|
| Esquema agenda | Inspección READ ONLY de citas, horarios_atencion, bloqueos_agenda y tickets; campos compatibles con simulación. No hay exclusión de solapamiento ni idempotencia de citas en Neon. Sin migración/escrituras. |
| Agenda única | Un recurso compartido en memoria, presencial para Nómina; 20 minutos consecutivos, lunes-viernes 14:00–17:30 y zona IANA. |
| Reserva y gestión | Oferta, elección, confirmación, consulta, cancelación y reprogramación ficticias; margen exacto de 120 minutos y revalidación de disponibilidad. |
| Consistencia | Atomicidad e idempotencia solo en instancia/proceso compartidos; sin garantía distribuida ni durable. |
| Pruebas | test:agenda 24 grupos PASS; test:payroll 15 grupos PASS; conversation, processing completo, webhook, check y build PASS. test:payroll:neon PASS exclusivamente de lectura, sin opción de escritura. |
| 02-A durable | **SIGUE PENDIENTE**, no comprobado COMMIT/reinicio/concurrencia real. Webhook no conectado a escritura Neon. |
| Próximo control | ChatGPT/Trainmex revisan/aceptan. Propuesta futura de exclusión/idempotencia en Neon solo documentada, no ejecutada. No se actualizó Drive. |

Detalle reproducible, límites y fallo inicial TypeScript/Node ya corregido:
[Iteración 02-B](ITERACION_02_B.md). Conteos de citas/tickets/horarios/bloqueos
iniciales y en la revisión posterior: 0; catálogo activo conservado en 15.

## Estado de la Iteración 02-A

**IMPLEMENTADO EN SIMULACIÓN / ADAPTADOR VALIDADO EN NEON CON ROLLBACK.**
Actualización: prueba controlada autorizada del 10 de noviembre de 2026,
documentada en [Integración 02-A](PRUEBA_INTEGRACION_02_A.md). El webhook continúa
simulado; no se comprobó COMMIT durable ni concurrencia real entre conexiones.
No declarar terminado el Paquete Funcional 01 ni autorizado el inicio de 02-B.

| Registro | Estado y evidencia | Próximo paso / criterio |
|---|---|---|
| Compatibilidad de 11 tablas | COMPROBADA por metadatos de solo lectura. Folio sobre IDENTITY; estados texto y cierre separado de resolución compatibles. | Conservar SQL histórico; no recrear tablas. |
| Ajuste mínimo autorizado | APLICADO Y VERIFICADO: solo `tickets.id_mensaje_confirmacion TEXT UNIQUE`, opcional. Sin estructura equivalente previa; 0 tickets antes/después; campos originales conservados. | Cualquier otro cambio requiere nueva autorización. |
| Recepción de nómina 02-A | IMPLEMENTADA EN SIMULACIÓN: ocho conceptos activos, viernes, explicación breve, resumen confirmado, ticket/folio. | Aceptación funcional por ChatGPT/Trainmex. |
| Cierre sin cita | PASS simulado: solo negativa expresa, fecha de cierre y no resuelto. Menú, cancelar, silencio y expiración no cierran. | Mostrar posteriormente en RH; panel no implementado. |
| Idempotencia confirmada | PASS en simulación: reintentos simultáneos, respuesta perdida, reinicio del motor y dos procesos Node con base ficticia persistida. | No equiparar con concurrencia/escritura real de Neon. |
| SES-01 | PASS: 119m59s conserva, 120m caduca; duplicados no renuevan actividad ni recuperan borrador expirado. | Contexto no compartido ni recuperable tras reinicio; pendiente antes de producción. |
| Adaptador PostgreSQL | **PASS integrado con ROLLBACK**: INSERT, dos reintentos secuenciales, folio estable, recuperación con nuevo adaptador y cierre sin cita/no resuelto; tres fixtures retirados, 11 tablas conservadas. | COMMIT durable, reinicio y concurrencia entre conexiones no ejecutados. No habilitado en webhook. |
| Agenda 02-B | Autorizada posteriormente e implementada **solo como simulación**, según sección superior. | No autoriza reservas Neon/WhatsApp ni resuelve el hito durable 02-A. |

## Resultados ejecutados en la entrega inicial (histórico)

| Comando / comprobación | Resultado real |
|---|---|
| `npm run test:payroll` | **PASS**, 15 grupos, exclusivamente simulados; incluye ocho servicios, acceso, viernes ambiguos/incorrectos, confirmación, corrección, cierre, caducidad, concurrencia/reinicio y SQL simulado. |
| `npm run test:conversation` | **PASS**, regresión de menú, tres categorías, Tu Voz, navegación, contexto y rechazo de IDs desconocidos. |
| `npm run test:processing` | **PASS completo**, Neon solo lectura, catálogo 15 = 8/5/2, 32 comprobaciones locales del contrato y Gemini real para todos los casos, incluidos pago/requisitos de premios y «sin clasificar». No hubo fallo externo en esta ejecución. |
| `npm run test:webhook` | **PASS**, firma válida HTTP 200, incorrecta 401, ausente 401. Remitente ficticio no autorizado; no prueba un flujo operativo real de colaborador. |
| `npm run check` | **PASS**, 0 errores, 0 advertencias de Svelte/TypeScript. |
| `npm run build` | **PASS**, compilación sin publicación. |
| Lectura final de Neon | **PASS**, 11 tablas, 15 servicios activos, 0 tickets y 0 claves de confirmación almacenadas. |
| Workflow y página inicial | Workflow en ejecución; vista inicial carga. Sin pantallas nuevas ni cambios visuales. Logs con conteos/códigos, sin datos personales ni contenido. |
| Integración real de INSERT/UPDATE y concurrencia Neon | **NO EJECUTADA**: no existe permiso para insertar registros ficticios. No se declara PASS. |

Persisten avisos previos de semántica futura de SSL de `pg` y de selección de
destino productivo de `adapter-auto`; no impidieron las comprobaciones y no se
cambió conexión, configuración o alojamiento para ocultarlos.

## Bitácora de ejecución y límites

1. Se leyó la actualización oficial y se inspeccionó el esquema antes de editar.
2. Se detectó la ausencia de correlación durable para confirmaciones y se detuvo
   el trabajo para pedir autorización mínima.
3. Trainmex autorizó exclusivamente la columna opcional única, previa revisión
   de equivalencia, preservación de registros y sin INSERT de pruebas.
4. Se aplicó y comprobó ese único DDL. El repositorio guarda la referencia SQL
   solo como auditoría, sin migraciones automáticas.
5. Se desarrolló el flujo, se preservaron HMAC/GET y el clasificador INC-001, y
   se ejecutaron las suites anteriores. No se alteró el catálogo ni otras tablas.
6. El webhook permanece con repositorio ficticio en memoria y sin transporte
   saliente. Reiniciar el webhook pierde tickets ficticios; la prueba durable
   usa una base falsa separada del proceso, no infraestructura productiva.
7. No se cambió Meta, Secrets, visibilidad de GitHub ni despliegue. No se
   implementaron políticas documentales, denuncias, encuestas, panel o agenda.

Evidencia detallada: [Iteración 02-A](ITERACION_02_A.md).
La trazabilidad exacta del commit se reporta en la entrega y en Git, sin incluir
una referencia circular al propio hash dentro de este archivo.

## Prueba controlada posterior autorizada

`npm run test:payroll:neon -- --rollback-authorized`: **PASS**. Un colaborador
sintético sin teléfono, un servicio sintético y un ticket, exclusivamente
dentro de una transacción exterior con ROLLBACK. Conteos iniciales/finales:
colaboradores 0/0, servicios 15/15, tickets 0/0, citas 0/0; las otras siete
tablas 0/0. Las huellas internas de contenido y esquema permanecieron iguales.
No se usaron registros reales ni se imprimieron claves, folios o contenido.
Las secuencias IDENTITY no se revierten necesariamente; no se restablecieron.

Regresiones repetidas: **PASS** test:payroll (15 grupos), test:conversation,
test:processing completo (incluidos ambos casos del premio), test:webhook,
check (0 errores/advertencias) y build. No se editó Google Drive.
La recuperación ensayada usa un adaptador nuevo dentro de la misma transacción,
no una desconexión de red ni reinicio. Evidencia, aislamiento y limpieza:
[prueba controlada](PRUEBA_INTEGRACION_02_A.md).

## Pendientes concretos actuales

- Aceptar la prueba controlada ya autorizada/ejecutada y decidir si procede
  un ensayo separado de COMMIT, reinicio y concurrencia entre conexiones con
  fixtures temporalmente persistidos. No afirmar esas garantías ni habilitar
  escrituras desde el webhook por iniciativa propia.
- Aceptación funcional/técnica por ChatGPT/Trainmex e incorporación de esta
  evidencia al control rector si corresponde.
- Contexto y reentregas de pasos no confirmados entre procesos/reinicios:
  limitación documentada, no solución productiva. Cualquier persistencia extra
  necesita revisión/autorización.
- 02-B ahora tiene autorización y motor separado de simulación, no operación
  real. Los módulos posteriores permanecen fuera de alcance y sin iniciar.
