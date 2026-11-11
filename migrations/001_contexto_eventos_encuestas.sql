-- Autorización integral Trainmex: dos tablas aditivas y atención en encuesta.
-- Ejecutar explícitamente, nunca al arrancar la aplicación.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE public.contextos_conversacion (
  canal TEXT NOT NULL CHECK (canal = 'whatsapp'),
  id_colaborador TEXT NOT NULL REFERENCES public.colaboradores(id_colaborador) ON DELETE RESTRICT,
  version_esquema SMALLINT NOT NULL DEFAULT 1 CHECK (version_esquema = 1),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  estado JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(estado) = 'object' AND octet_length(estado::text) <= 16384
    AND (estado - ARRAY['menu','nomina','agenda','recepcion']::text[]) = '{}'::jsonb),
  ultimo_evento_nuevo_en TIMESTAMPTZ NOT NULL,
  vence_en TIMESTAMPTZ NOT NULL,
  lease_token UUID,
  lease_hasta TIMESTAMPTZ,
  lease_generacion BIGINT NOT NULL DEFAULT 0 CHECK (lease_generacion >= 0),
  PRIMARY KEY (canal,id_colaborador),
  CHECK (isfinite(ultimo_evento_nuevo_en) AND isfinite(vence_en)
    AND vence_en = ultimo_evento_nuevo_en + interval '120 minutes'),
  CHECK ((lease_token IS NULL) = (lease_hasta IS NULL)),
  CHECK (lease_hasta IS NULL OR isfinite(lease_hasta))
);
CREATE INDEX contextos_conversacion_vence_idx ON public.contextos_conversacion(vence_en);
CREATE TABLE public.eventos_entrantes (
  id_evento_meta TEXT PRIMARY KEY CHECK (length(id_evento_meta)>0
    AND id_evento_meta=btrim(id_evento_meta) AND id_evento_meta !~ '[[:space:]]'),
  canal TEXT NOT NULL CHECK (canal='whatsapp'),
  id_colaborador TEXT NOT NULL REFERENCES public.colaboradores(id_colaborador) ON DELETE RESTRICT,
  version_huella SMALLINT NOT NULL DEFAULT 1 CHECK (version_huella=1),
  huella_entrada TEXT NOT NULL CHECK (huella_entrada ~ '^[a-f0-9]{64}$'),
  emitido_en TIMESTAMPTZ,
  primera_recepcion_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  procesado_en TIMESTAMPTZ,
  estado_tecnico TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado_tecnico IN ('PENDIENTE','PROCESADO','COMPACTADO')),
  revision_contexto_antes BIGINT CHECK (revision_contexto_antes>=0),
  revision_contexto_despues BIGINT CHECK (revision_contexto_despues>=revision_contexto_antes),
  id_ticket BIGINT REFERENCES public.tickets(id_ticket) ON DELETE RESTRICT,
  id_cita BIGINT REFERENCES public.citas(id_cita) ON DELETE RESTRICT,
  resultado_minimo JSONB CHECK (resultado_minimo IS NULL OR
    (jsonb_typeof(resultado_minimo)='object' AND octet_length(resultado_minimo::text)<=2048
    AND (resultado_minimo - ARRAY['version','codigo','aplicado','folio']::text[])='{}'::jsonb
    AND resultado_minimo->'version'='1'::jsonb
    AND jsonb_typeof(resultado_minimo->'codigo')='string'
    AND jsonb_typeof(resultado_minimo->'aplicado')='boolean')),
  CHECK (id_cita IS NULL OR id_ticket IS NOT NULL),
  CHECK (isfinite(primera_recepcion_en) AND (emitido_en IS NULL OR isfinite(emitido_en))
    AND (procesado_en IS NULL OR isfinite(procesado_en))),
  CHECK ((estado_tecnico='PENDIENTE' AND procesado_en IS NULL AND resultado_minimo IS NULL
    AND revision_contexto_antes IS NULL AND revision_contexto_despues IS NULL)
    OR (estado_tecnico IN ('PROCESADO','COMPACTADO') AND procesado_en IS NOT NULL
    AND resultado_minimo IS NOT NULL AND revision_contexto_antes IS NOT NULL
    AND revision_contexto_despues IS NOT NULL))
);
CREATE INDEX eventos_entrantes_procesado_idx ON public.eventos_entrantes(procesado_en)
  WHERE estado_tecnico<>'PENDIENTE';
ALTER TABLE public.encuestas ADD COLUMN recibio_atencion BOOLEAN;
COMMIT;
