# 02-D1 — propuesta provisional de contexto y eventos compartidos

**SOLO DISEÑO. NO DDL EJECUTADO. NO APROBADO PASAR DE 12 A 14 TABLAS.**
Fecha: 11 de noviembre de 2026. Implementación independiente de
[02-D1A](ITERACION_02_D1A.md), que únicamente limita memoria local.
Documento Maestro v1.2 y Plano/adenda 1.2 no se modifican.

## Contraste SELECT de Neon real

Conexión PostgreSQL con `default_transaction_read_only=on`, comprobado mediante
SHOW. Únicamente catálogos information_schema/pg_constraint; sin registros,
fixtures, BEGIN/COMMIT de prueba ni DML/DDL. Hay 12 tablas; ninguno de los dos
nombres siguientes existe. Se verificaron:

- `colaboradores.id_colaborador TEXT NOT NULL PRIMARY KEY`.
- `tickets.id_ticket BIGINT PRIMARY KEY`, FK `id_colaborador TEXT`,
  `id_mensaje_confirmacion TEXT NULL UNIQUE`.
- `citas.id_cita BIGINT PRIMARY KEY`, `id_ticket BIGINT NOT NULL` con FK,
  instantes TIMESTAMPTZ; cuatro estados y modalidad TEXT; CHECK 20 min finitos,
  exclusión GiST de PROGRAMADA.
- `operaciones_citas.id_evento_meta TEXT PRIMARY KEY`, ticket/cita BIGINT
  NOT NULL con FKs, huella TEXT, resultado JSONB objeto NOT NULL,
  `creado_en TIMESTAMPTZ NOT NULL`. Tres operaciones aplicadas exclusivamente.

Los tipos de las FKs propuestas coinciden. No se alteran estas cuatro tablas
ni las ocho restantes. Antes de cualquier ejecución debe repetirse revisión
de permisos, nombres, restricciones/índices, dependencias y datos actuales.
Esta lectura no es validación ejecutada del SQL siguiente ni autorización.

## Decisiones previas

1. Autorizar dos tablas aditivas y DDL revisado específico (12→14).
2. Autorizar o no resumen breve del borrador: el DDL por defecto NO permite
   texto narrativo. Con esa opción la continuidad es estructurada; al perder
   RAM se vuelve a pedir explicación antes de confirmar.
3. Autorizar parámetros de lease, máximo de contexto y protocolos de espera.
   Un lease NO cambia el TTL funcional de 120 min.
4. Política provisional: sin purga automática de recibos/IDs durante pruebas.
   Duración definitiva, privacidad y tratamiento de eventos antiguos requieren
   decisión posterior. No convertir 120 min o 24 h de RAM en retención Neon.
5. Autorizar código/refactor de unidad de trabajo y pruebas sintéticas por
   separado; aquí no se ejecuta ni prepara una migración automática.

## DDL SQL detallado PROVISIONAL — nunca ejecutar como parte de 02-D1A

Precondiciones: ambos nombres e índices ausentes, tipos/FKs contrastados,
privilegios suficientes, revisión de filas existentes, plan de reversión,
respaldo institucional/proveedor conforme al proceso autorizado. Fallar ante
objeto equivalente o divergencia; NO usar IF NOT EXISTS para ocultarla.
Sin extensiones, triggers, servicios ni ALTER sobre tablas actuales.

```sql
-- SOLO PROPUESTA SUJETA A AUTORIZACION Y REVISION. NO EJECUTADA.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.contextos_conversacion (
  canal TEXT NOT NULL CHECK (length(btrim(canal)) > 0),
  id_colaborador TEXT NOT NULL
    REFERENCES public.colaboradores(id_colaborador) ON DELETE RESTRICT,
  version_esquema SMALLINT NOT NULL DEFAULT 1 CHECK (version_esquema = 1),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  estado JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (
      jsonb_typeof(estado) = 'object'
      AND octet_length(estado::text) <= 8192
      AND (estado - ARRAY[
        'pantalla','categoria','fase','id_servicio','viernes','id_ticket',
        'id_cita','inicio_candidato','modalidad','requiere_explicacion',
        'hash_resumen'
      ]::text[]) = '{}'::jsonb
    ),
  ultimo_evento_nuevo_en TIMESTAMPTZ NOT NULL,
  vence_en TIMESTAMPTZ NOT NULL,
  lease_token UUID,
  lease_hasta TIMESTAMPTZ,
  lease_generacion BIGINT NOT NULL DEFAULT 0 CHECK (lease_generacion >= 0),
  PRIMARY KEY (canal, id_colaborador),
  CHECK (isfinite(ultimo_evento_nuevo_en) AND isfinite(vence_en)
    AND vence_en = ultimo_evento_nuevo_en + interval '120 minutes'),
  CHECK ((lease_token IS NULL) = (lease_hasta IS NULL)),
  CHECK (lease_hasta IS NULL OR isfinite(lease_hasta))
);
CREATE INDEX contextos_conversacion_vence_idx
  ON public.contextos_conversacion (vence_en);

CREATE TABLE public.eventos_entrantes (
  id_evento_meta TEXT PRIMARY KEY
    CHECK (length(id_evento_meta) > 0
      AND id_evento_meta = btrim(id_evento_meta)
      AND id_evento_meta !~ '[[:space:]]'),
  canal TEXT NOT NULL CHECK (length(btrim(canal)) > 0),
  id_colaborador TEXT NOT NULL
    REFERENCES public.colaboradores(id_colaborador) ON DELETE RESTRICT,
  version_huella SMALLINT NOT NULL DEFAULT 1 CHECK (version_huella = 1),
  huella_entrada TEXT NOT NULL CHECK (huella_entrada ~ '^[a-f0-9]{64}$'),
  emitido_en TIMESTAMPTZ,
  primera_recepcion_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  procesado_en TIMESTAMPTZ,
  estado_tecnico TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado_tecnico IN ('PENDIENTE','PROCESADO','COMPACTADO')),
  revision_contexto_antes BIGINT CHECK (revision_contexto_antes >= 0),
  revision_contexto_despues BIGINT CHECK (revision_contexto_despues >= 0),
  id_ticket BIGINT REFERENCES public.tickets(id_ticket) ON DELETE RESTRICT,
  id_cita BIGINT REFERENCES public.citas(id_cita) ON DELETE RESTRICT,
  resultado_minimo JSONB,
  CHECK (resultado_minimo IS NULL OR (
    resultado_minimo ?& ARRAY['version','codigo','aplicado']::text[]
    AND (resultado_minimo - ARRAY['version','codigo','aplicado']::text[]) = '{}'::jsonb
    AND resultado_minimo->'version' = '1'::jsonb
    AND jsonb_typeof(resultado_minimo->'codigo') = 'string'
    AND resultado_minimo->>'codigo' IN (
      'MENU_PREPARADO','ACLARACION_PREPARADA','TICKET_CONFIRMADO',
      'CITA_CONFIRMADA','CITA_CANCELADA','CITA_REPROGRAMADA',
      'CIERRE_SIN_CITA','ENTRADA_DESCARTADA','OPERACION_ARCHIVADA'
    )
    AND jsonb_typeof(resultado_minimo->'aplicado') = 'boolean'
  )),
  CHECK (id_cita IS NULL OR id_ticket IS NOT NULL),
  CHECK (isfinite(primera_recepcion_en)
    AND (emitido_en IS NULL OR isfinite(emitido_en))
    AND (procesado_en IS NULL OR isfinite(procesado_en))),
  CHECK (
    (estado_tecnico = 'PENDIENTE'
      AND procesado_en IS NULL AND resultado_minimo IS NULL
      AND id_ticket IS NULL AND id_cita IS NULL
      AND revision_contexto_antes IS NULL AND revision_contexto_despues IS NULL)
    OR
    (estado_tecnico IN ('PROCESADO','COMPACTADO')
      AND procesado_en IS NOT NULL
      AND revision_contexto_antes IS NOT NULL
      AND revision_contexto_despues IS NOT NULL
      AND revision_contexto_despues >= revision_contexto_antes
      AND resultado_minimo IS NOT NULL
      AND jsonb_typeof(resultado_minimo) = 'object'
      AND octet_length(resultado_minimo::text) <= 2048)
  )
);
CREATE INDEX eventos_entrantes_procesado_idx
  ON public.eventos_entrantes (procesado_en)
  WHERE estado_tecnico <> 'PENDIENTE';

COMMIT;
```

Dos PKs implican dos índices únicos; se proponen además los dos índices de
fechas anteriores. **El índice vence_idx NO borra automáticamente filas**:
PostgreSQL no convierte un índice en recolector TTL. Purga y autorización
de conservación deben diseñarse aparte. FK no se añade de eventos a contexto:
el contexto debe poder caducar sin borrar evidencia de deduplicación.

8 KiB/2 KiB son presupuestos técnicos propuestos, no cuotas de usuarios ni
reglas laborales; requieren revisión antes de ejecución. Los CHECK JSON no
validan todos sus valores ni privacidad: el codec de aplicación debe rechazar
tipos/claves/estados extra, textos en campos de enum, IDs inventados y payloads.
Los CHECK no hacen cumplir por sí mismos el protocolo de leases o transiciones.
No se introduce hoy resumen narrativo; si Trainmex lo aprueba habrá que
revisar expresamente el contrato/DDL y la eliminación al vencer.

Las FKs separadas NO demuestran titularidad ni que cita corresponda a ticket;
esa comprobación sigue siendo transaccional y obligatoria, como en 02-C2.

## Contrato mínimo

- Meta ID original completo, no truncado ni derivado de sesión/teléfono/lote.
  PK global compatible con claves de negocio actuales; canal/propietario deben
  coincidir en replay. No registrar estado delivery/read en este contrato de
  mensajes entrantes: compartirían ID con otros eventos y necesitan diseño aparte.
- Huella v1 de campos semánticos canónicos por mensaje (tipo, remitente
  autenticado/canal, texto), no hash del POST completo. Igual ID/huella
  recupera resultado; diferencia produce conflicto. Hash no anonimiza texto
  predecible ni permite reconstruirlo. No guardar payload completo.
- Resultado mínimo versionado, por ejemplo
  `{"version":1,"codigo":"ACLARACION_PREPARADA","aplicado":false}`.
  Referencias/revisiones van en columnas técnicas. Sin pregunta/respuesta,
  nombre, teléfono o narración. Códigos/contrato provisional deben revisarse
  antes de implementar; no son estados nuevos de tickets/citas.
- PENDIENTE no equivale a operación aplicada. Error transitorio deja posible
  reentrega. Un rechazo sin recibo de cita conserva revalidación aprobada;
  no se congela un error reintentable como éxito. Pregunta/menú ya preparado
  puede finalizar PROCESADO sin efecto de negocio.
- COMPACTADO queda definido para diseño futuro, NO autoriza compactar datos.
  Sin borrar automáticamente operaciones_citas ni claves de tickets.
- Lease_token lo genera la aplicación (UUID aleatorio), sin extensión PG.
  La generación/versionado y token cercan workers viejos; no son locks
  mantenidos durante una llamada Gemini.

## Una conexión por transacción, orden uniforme y fencing

```text
HMAC RAW -> validar lote -> identidad activa
TX1: conexión única
  lock fila contexto -> lock/insert evento
  validar/reclamar lease, token y generación; leer revisión
  COMMIT del reclamo, NO del negocio
Gemini fuera de transacción, si hace falta
TX2: conexión única
  lock institucional agenda existente
  -> contexto -> evento -> ticket -> cita / identidad / servicio
  comprobar token, generación, revisión, lease vigente y propietario
  comprobar TTL del contexto, nueva actividad (no duplicate), intención
  recuperar recibo/ticket existente ANTES de depender del borrador
  validar calendario y reloj PostgreSQL DESPUÉS de locks
  negocio + recibo aplicado + contexto + evento PROCESADO
  COMMIT único; solo después se reconoce resultado funcional
```

TX1 no solicita el lock de agenda y no puede esperar recursos que toma
TX2 después de contexto/evento. Todos los escritores deben respetar ese
orden y hacer reclamos cortos; no mantener locks esperando leases ocupados.
Un lease ocupado devuelve situación reintentable, no promesa de aplicación.
TX1 y TX2 pueden usar conexiones distintas entre sí; dentro de CADA unidad
no se abre una conexión secundaria ni se anida BEGIN/COMMIT de adaptadores.

Es indispensable adaptar repositorios actuales para aceptar el cliente de
la unidad de trabajo. Llamar `execute()` actual desde una transacción externa
NO consigue esta atomicidad: hoy abre y confirma su propia transacción.

Al retomar un lease expirado se cambia token/generación. Worker anterior no
puede finalizar aunque termine Gemini después. Caducidad o borrado/recreación
de contexto exige token nuevo; comparar solo revisión permitiría ABA.
Renovar lease no renueva los 120 minutos de actividad del colaborador.

Recibo COMMIT con acuse perdido se recupera. Para migración de claves previas
02-C4, consultar primero tickets/operaciones y crear, si corresponde, evidencia
técnica compatible bajo el mismo lock; nunca clasificar como nuevo un ID
de negocio anterior solo porque falta en eventos_entrantes.

Una fila PENDIENTE sin contenido no es cola duradera: tras morir el proceso
se necesita la reentrega original. No responder HTTP 200 a trabajo aún no
finalizado prometiendo recuperar un cuerpo que solo se tiene como hash.
Sin reentrega, recuperar intención puede requerir preguntar de nuevo.

## Lotes, retención y privacidad

Unidad de deduplicación es mensaje original, no POST. Lote parcial conserva
prefijo confirmado y permite retomar sufijo; no crear IDs por ordinales.
No atribuir orden humano definitivo a timestamps iguales o POST concurrentes;
contexto/revisión dan orden de aplicación y lo ambiguo debe aclararse.
No usar un único ID para confirmar a la vez ticket y cita, contra protocolo.

Provisional durante pruebas: conservar recibos y claves técnicos, sin purga.
Antes de producción Trainmex debe aprobar plazos a partir de política vigente
Meta verificada, margen operativo y privacidad. Ni TTL 120 min ni 24 h RAM
definen esos plazos, y no se impone aquí un plazo legal.

Si se retiran recibos/keys de negocio en etapa posterior, escribir/verificar
primero marcador mínimo transaccional y hacer que TODOS los lectores lo
consulten. Sin guardar resultado original no se promete replay del snapshot;
solo no repetir efectos. Borrar también el marcador pierde deduplicación
ilimitada: exigiría política aprobada de rechazo de entradas antiguas.
FKs RESTRICT obligan a coordinar archivo/borrado; no autorizar CASCADE.

## Reversión y pruebas propuestas, NO ejecutadas

- DDL aditivo bajo transacción: fallo -> ROLLBACK completo. No reintentar
  con IF NOT EXISTS ante incompatibilidad.
- Activar solo tras aceptación. Para revertir código detener consumidores
  coordinadamente; conservar recibos/marcadores. No volver a código antiguo
  que ignore la única evidencia restante tras compactar.
- No DROP tras uso real como limpieza automática. Contextos vencidos solo
  se retirarían sin lease vigente; registros de pruebas por IDs exactos,
  dependencias en orden y autorización específica.
- Fixtures y mocks primero; luego permiso nuevo para pruebas PostgreSQL con
  rollback y, por separado, COMMIT temporal y dos procesos.
- Aceptación: mismo ID/cambio de huella, lease vencido/worker tardío, dos
  procesos, reinicio en cada fase, timestamp/reorden, TTL, prefijo de lote
  aplicado, recibo antiguo, resultado perdido post-COMMIT y compatibilidad
  ticket/cita; sin salida y con limpieza exacta.

## Alternativa sin tablas nuevas

Un proceso, memoria reforzada 02-D1A, reconfirmación de borradores perdidos,
recuperación por folio/clave existente y política explícita de reinicios.
No hay continuidad al reiniciar ni deduplicación durable de mensajes sin
efecto. La caché limitada no cambia ese hecho y puede olvidar entradas por
edad/capacidad antes de morir el proceso. No usar archivos locales como falsa
sesión compartida. Un piloto necesita aceptación de estos riesgos y permiso
de canal/operación independiente; sigue prohibido aquí.
