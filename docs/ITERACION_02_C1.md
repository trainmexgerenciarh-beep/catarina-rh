# Iteración 02-C1 — migración controlada de Neon

Fecha de ejecución: **11 de noviembre de 2026**.
Resultado: **DDL y configuración autorizados APLICADOS / COMMIT confirmado**.
Esta evidencia no implementa 02-C2 ni acredita operación de tickets o citas
por WhatsApp. ChatGPT/Trainmex revisan y aceptan; Replit ejecuta y documenta.

## Autorización y fuente

Trainmex autorizó exclusivamente el bloque principal corregido del encabezado
«REVISIÓN DE COMPATIBILIDAD 02-C1 Y DDL CORREGIDO — SOLO PROPUESTA» del Plano
Funcional del Google Doc oficial, y por separado cinco horarios institucionales.
El encabezado conserva la fecha de propuesta del 10 de noviembre; la ejecución
ocurrió el 11. Se leyó la exportación oficial con Google Drive en modo GET.
El SQL principal se extrajo de ese bloque, sin modificar sus sentencias.

No se editaron Google Drive ni los dos Markdown rectores: conservan íntegros
el SQL histórico y sus versiones. Este registro documenta la evolución aplicada.
Las validaciones opcionales de horarios/bloqueos quedaron **fuera**.
Contrato definitivo de huella/resultado y retención de recibos: **02-C2 pendiente**.

## Inspección previa y condiciones de parada

Inspección exclusivamente SELECT antes de escribir, repetida inmediatamente
antes del DDL: PostgreSQL 18.6; exactamente 11 tablas públicas; ninguna tabla
equivalente a `operaciones_citas`; citas y horarios vacíos; sin triggers de
usuario ni RLS; campos y tipos compatibles. Se comprobaron columnas de las
11 tablas, restricciones validadas, índices, pertenencia al propietario,
privilegios de esquema/referencias/lectura/inserción y disponibilidad de GiST.
`tickets.id_mensaje_confirmacion TEXT UNIQUE` permanecía presente.
La única extensión instalada era `plpgsql`; no hizo falta instalar ninguna.

La primera preparación local de la consulta de inspección falló por comillas
JavaScript, antes de abrir la conexión o ejecutar SQL. Se corrigió el comando
temporal, no archivos de aplicación, y la inspección pasó. No hubo fallo SQL,
timeout, reintento de escrituras ni ROLLBACK durante la migración ejecutada.
El cliente mostró su advertencia preexistente sobre semántica futura de SSL;
no se cambió la conexión ni ningún Secret.

Convención aprobada para la carga: ISO, lunes=1…domingo=7. SELECT con
`EXTRACT(ISODOW ...)` confirmó lunes=1 y viernes=5. La tabla vacía no tenía
otra convención histórica documentada en datos o constraints. El simulador
existente usa 1–5 para los días laborables, compatible con esta carga; su
domingo JavaScript=0 no debe trasladarse al futuro adaptador ISO.
La zona IANA `America/Mexico_City` está disponible. La sesión de BD usa GMT;
no se modificó. Las horas TIME institucionales se interpretarán con esa
zona explícita en el adaptador futuro, no con un desplazamiento fijo.

Las huellas de contenido se calcularon dentro de Neon mediante representación
JSONB ordenada y MD5, sin exportar contenido de filas ni datos personales.
Son evidencia de igualdad antes/después, no un mecanismo nuevo de seguridad.

## DDL principal exacto ejecutado

SHA-256 del bloque extraído, con saltos LF y sin espacios externos:
`8b1b03e1ab3c3eddeb81c348635e8e09cce5e27c0ac788ede706e99b9b0beddf`.
No es un script de inicio ni una migración que deba volver a ejecutarse.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.tickets, public.citas IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.citas) THEN
    RAISE EXCEPTION 'Migración detenida: existen citas; requiere nueva revisión';
  END IF;
END
$$;
ALTER TABLE public.citas
  ALTER COLUMN id_ticket SET NOT NULL,
  ALTER COLUMN inicio_programado SET NOT NULL,
  ALTER COLUMN fin_programado SET NOT NULL,
  ALTER COLUMN modalidad SET NOT NULL,
  ALTER COLUMN estado SET NOT NULL;
ALTER TABLE public.citas
  ADD CONSTRAINT citas_estado_02c_chk CHECK (estado IN ('PROGRAMADA','CANCELADA','REALIZADA','NO_ASISTIO')),
  ADD CONSTRAINT citas_intervalo_02c_chk CHECK (
    isfinite(inicio_programado) AND isfinite(fin_programado)
    AND fin_programado = inicio_programado + INTERVAL '20 minutes'
  ),
  ADD CONSTRAINT citas_modalidad_02c_chk CHECK (modalidad IN ('PRESENCIAL','REMOTA'));
CREATE UNIQUE INDEX citas_unica_programada_por_ticket_02c
  ON public.citas(id_ticket) WHERE estado = 'PROGRAMADA';
ALTER TABLE public.citas
  ADD CONSTRAINT citas_no_solapamiento_programadas_02c
  EXCLUDE USING gist (tstzrange(inicio_programado, fin_programado, '[)') WITH &&)
  WHERE (estado = 'PROGRAMADA');
CREATE TABLE public.operaciones_citas (
  id_evento_meta TEXT PRIMARY KEY,
  tipo_operacion TEXT NOT NULL,
  id_ticket BIGINT NOT NULL REFERENCES public.tickets(id_ticket) ON DELETE NO ACTION,
  id_cita BIGINT NOT NULL REFERENCES public.citas(id_cita) ON DELETE NO ACTION,
  huella_parametros TEXT NOT NULL,
  resultado JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT operaciones_citas_tipo_chk CHECK (tipo_operacion IN ('RESERVAR','CANCELAR','REPROGRAMAR')),
  CONSTRAINT operaciones_citas_resultado_objeto_chk CHECK (jsonb_typeof(resultado) = 'object'),
  CONSTRAINT operaciones_citas_id_evento_no_vacio_chk CHECK (length(btrim(id_evento_meta)) > 0),
  CONSTRAINT operaciones_citas_huella_no_vacia_chk CHECK (length(btrim(huella_parametros)) > 0)
);
COMMIT;
```

### Evidencia por sentencia

Cada sentencia recibió respuesta del servidor. Tiempos observados desde el
cliente en milisegundos, incluidos viaje de red y ejecución; **no** son tiempos
puros de CPU ni una medición exacta de espera o duración de los locks.

| Paso | Sentencia | Resultado | ms |
|---|---|---|---:|
| DDL-1 | BEGIN | PASS | 20.78 |
| DDL-2 | SET LOCAL lock_timeout 5s | PASS | 20.69 |
| DDL-3 | SET LOCAL statement_timeout 60s | PASS | 20.57 |
| DDL-4 | LOCK tickets, citas ACCESS EXCLUSIVE | PASS | 20.61 |
| DDL-5 | DO: detener si existen citas | PASS, vacía | 24.82 |
| DDL-6 | ALTER cinco NOT NULL | PASS | 27.07 |
| DDL-7 | ALTER tres CHECK | PASS | 22.61 |
| DDL-8 | CREATE UNIQUE INDEX parcial | PASS | 24.55 |
| DDL-9 | ALTER EXCLUDE GiST | PASS | 26.86 |
| DDL-10 | CREATE TABLE operaciones_citas | PASS | 35.72 |
| DDL-11 | COMMIT | PASS, confirmado | 21.69 |

Se verificaron los catálogos dentro de la transacción antes de COMMIT y de
nuevo después de confirmarlo. `pg_locks` mostró ACCESS EXCLUSIVE concedido
sobre tickets y citas, además de locks de construcción/FKs sobre los objetos
nuevos. No hubo timeout. Los locks se liberaron al terminar la transacción.
La duración exacta de tenencia no se instrumentó; las verificaciones de
catálogos dentro de la transacción también la prolongaron.

## Carga independiente autorizada de horarios

Una segunda transacción ejecutó BEGIN, los mismos límites locales de 5s/60s,
y `LOCK TABLE public.horarios_atencion IN SHARE ROW EXCLUSIVE MODE`.
Dentro del bloqueo se comprobó por SELECT que seguía vacía; de no ser así
el comando controlador habría abortado sin insertar. Se ejecutó una sola
inserción de los cinco días aprobados con RETURNING para capturar IDs,
se validaron los cinco valores antes de COMMIT y se confirmó el COMMIT.

```sql
INSERT INTO public.horarios_atencion
  (dia_semana,hora_inicio,hora_fin,duracion_cita,activo)
VALUES
  (1,TIME '14:00',TIME '17:30',20,TRUE),
  (2,TIME '14:00',TIME '17:30',20,TRUE),
  (3,TIME '14:00',TIME '17:30',20,TRUE),
  (4,TIME '14:00',TIME '17:30',20,TRUE),
  (5,TIME '14:00',TIME '17:30',20,TRUE)
RETURNING id_horario,dia_semana,hora_inicio,hora_fin,duracion_cita,activo;
```

| Paso | Sentencia | Resultado | ms |
|---|---|---|---:|
| H-1 | BEGIN | PASS | 20.86 |
| H-2 | SET LOCAL lock_timeout 5s | PASS | 20.58 |
| H-3 | SET LOCAL statement_timeout 60s | PASS | 20.65 |
| H-4 | LOCK horarios SHARE ROW EXCLUSIVE | PASS | 20.60 |
| H-5 | INSERT cinco filas y RETURNING | PASS | 22.89 |
| H-6 | COMMIT | PASS, confirmado | 21.27 |

| id_horario | ISO | Día | Inicio | Fin | Duración | Activo |
|---:|---:|---|---|---|---:|---|
| 1 | 1 | Lunes | 14:00 | 17:30 | 20 | true |
| 2 | 2 | Martes | 14:00 | 17:30 | 20 | true |
| 3 | 3 | Miércoles | 14:00 | 17:30 | 20 | true |
| 4 | 4 | Jueves | 14:00 | 17:30 | 20 | true |
| 5 | 5 | Viernes | 14:00 | 17:30 | 20 | true |

Son configuración institucional autorizada, no fixtures ni reservas.
No se crearon sábado/domingo ni otra agenda. Por cálculo del horario,
el último bloque completo es 17:00–17:20; no se implementó un adaptador que
consuma estas filas. Su estructura no tiene zona horaria propia.

## Objetos aplicados y verificación final

### En citas

- NOT NULL en `id_ticket`, `inicio_programado`, `fin_programado`, `modalidad`,
  `estado`. PostgreSQL 18 los representa también como constraints nombrados
  `citas_id_ticket_not_null`, `citas_inicio_programado_not_null`,
  `citas_fin_programado_not_null`, `citas_modalidad_not_null`,
  `citas_estado_not_null`.
- CHECK: `citas_estado_02c_chk`, `citas_intervalo_02c_chk`,
  `citas_modalidad_02c_chk`.
- Índice btree UNIQUE parcial:
  `citas_unica_programada_por_ticket_02c`.
- Constraint EXCLUDE y su índice GiST asociado:
  `citas_no_solapamiento_programadas_02c`.
- PK y FK anteriores conservadas.

### Nueva tabla operaciones_citas

Solo las siete columnas del SQL anterior, todas NOT NULL.
PK `operaciones_citas_pkey` y su índice btree;
FK `operaciones_citas_id_ticket_fkey`, `operaciones_citas_id_cita_fkey`;
los cuatro CHECK nombrados en el SQL y los siete NOT NULL correspondientes.
No tiene IDENTITY ni secuencia nueva.
Las FKs crean sus triggers internos PostgreSQL automáticamente:
**no se creó ningún trigger de usuario**.

### Comparación inicial/final

| Tabla | Antes | Después |
|---|---:|---:|
| colaboradores | 0 | 0 |
| servicios | 15 | 15 |
| tickets | 0 | 0 |
| citas | 0 | 0 |
| horarios_atencion | 0 | 5 |
| bloqueos_agenda | 0 | 0 |
| consultas | 0 | 0 |
| fuentes | 0 | 0 |
| encuestas | 0 | 0 |
| denuncias | 0 | 0 |
| seguimientos_denuncia | 0 | 0 |
| operaciones_citas | No existía | 0 |

Inicio del comando controlado: 2026-11-11 14:25:36.251 UTC;
fin de comprobación final: 14:25:38.916 UTC
(08:25:36–08:25:38 en America/Mexico_City).

- **PASS**: tabla adicional única; total 12 tablas.
- **PASS**: definiciones de constraints verificadas con
  `pg_get_constraintdef`; todos validados.
- **PASS**: índices valid/ready; parcial UNIQUE y exclusión GiST con predicado
  exactamente PROGRAMADA. Campos y tipos coinciden con el SQL autorizado.
- **PASS**: contenido/huellas de las otras diez tablas originales idénticos.
  Tickets, colaboradores y servicios sin cambios de contenido ni estructura.
- **PASS**: columnas/constraints/índices de las diez tablas originales
  diferentes de citas intactos; tampoco se modificó el esquema de horarios.
- **PASS**: extensiones y triggers de usuario sin cambios.
- **PASS**: conexión cerrada y conexión nueva abierta; 12 tablas,
  cinco horarios con mismos IDs/valores y cero recibos tras ambos COMMIT.
- **NO EJECUTADO**: inserciones negativas para provocar CHECK/FK/UNIQUE/EXCLUDE,
  reservas concurrentes, adaptadores, tickets sintéticos o E2E de webhook.
  La inspección de catálogos no sustituye esas pruebas funcionales.
- **NO EJECUTADO**: suites npm; alcance exclusivo de DDL/configuración y
  documentación, sin cambios a aplicación/pruebas ni fixtures autorizados.
  No se atribuyen a esta entrega los PASS históricos de 02-A/02-B.

## Riesgos, límites y reversión

- DDL y carga fueron **dos transacciones independientes**, ambas confirmadas.
  Cada una era atómica; el conjunto no es una única transacción. Si la carga
  hubiera fallado, el DDL ya confirmado habría permanecido aplicado.
- ACCESS EXCLUSIVE bloquea accesos concurrentes; el límite de espera acota
  adquisición, no todo el tiempo que se conserva el lock. El statement_timeout
  es por sentencia. No se modificaron parámetros globales.
- Duración de 20 min global, también para futuras modalidades e históricos;
  no rechaza por sí misma reservas fuera de horario o con margen insuficiente.
- Solo PROGRAMADA participa de exclusión/UNIQUE, aunque su hora haya pasado.
  Las transiciones legales tras finalizar requieren el futuro servicio;
  el DDL no impide SQL externo que marque un histórico prematuramente.
- Las dos FKs no prueban que cita y ticket correspondan entre sí; debe
  validarse transaccionalmente en 02-C2. No se añadieron restricciones extra.
- PK de recibos y UNIQUE de tickets son espacios separados; el futuro
  servicio debe gestionar reintentos y usos contradictorios de eventos.
- No se ha fijado canonización/contrato de huella, esquema de resultado ni
  retención. No se produjo ni borró ningún recibo. Contexto sigue en memoria.
- El webhook sigue con repositorios simulados. No hay citas/tickets operativos
  por WhatsApp ni prueba de COMMIT/concurrencia de sus adaptadores.
- No se añadieron validaciones opcionales, extensiones, columnas extra,
  panel, encuestas, políticas, Tu Voz ni mensajería saliente.

**Reversión no ejecutada**. Antes de COMMIT un fallo habría requerido
ROLLBACK. Después de COMMIT cualquier reversión requiere nueva autorización:
reinspeccionar dependencias/contenido bajo bloqueo, comprobar que no existen
operaciones legítimas y capturar definición previa. Para horarios, validar
individualmente IDs 1–5 y todos sus valores antes de una eventual eliminación
selectiva autorizada; nunca borrar por rango general o por día solamente.
Restaurar los cinco campos de citas a nullable y retirar solo las restricciones,
índice y tabla añadidos requeriría un plan DDL específico aprobado. No usar
DROP CASCADE, no borrar recibos legítimos ni restablecer secuencias.
Los cinco horarios se conservan: son el resultado esperado, no residuos.

## Documentación y siguiente control

Se añadió este registro y se actualizaron README, replit.md y control técnico.
La verificación documental comprueba el hash del SQL frente al bloque ejecutado,
el diff y que solo cambien Markdown; no hay scripts nuevos de migración,
modificaciones de aplicación, pruebas, Secrets, Meta, hosting o despliegue.
Google Drive queda a cargo de ChatGPT/Trainmex.
**02-C1 aplicada; pendiente de revisión/aceptación. 02-C2 no iniciada.**
