# CATARINA RH — PLANO FUNCIONAL Y MODELO DE DATOS

**Empresa:** Manufacturas Trainmex  
**Proyecto rector:** Optimus Prime  
**Versión del documento:** 1.0  
**Fecha de corte:** 3 de noviembre de 2026  
**Estado:** Plano funcional validado provisionalmente; esquema PostgreSQL inicial implementado y probado en Neon.  
**Destino:** Fuentes de Catarina, Replit y repositorio GitHub cuando se configure.

> **Cómo usar este archivo:** Reúne en un único documento el contenido que normalmente se distribuiría entre `PLANO-PROYECTO.md` y `MODELO-DATOS.md`. Se consolida por decisión del usuario para evitar documentos duplicados. No reemplaza el **Estándar Universal de Desarrollo con IA de Trainmex v1.0** ni el **Documento Maestro de Control**, que registra el estado y las decisiones. Si para adherirse literalmente a la estructura de archivos del estándar se requieren más adelante dos archivos separados, podrán dividirse estas dos partes sin alterar su contenido.
>
> **Convención de decisiones:** **APROBADO** = debe respetarse; **PROPUESTO** = no implementar como obligación sin revisar; **PENDIENTE** = no asumir ni programar por cuenta propia. No crear candados, restricciones, roles, nuevas tablas o integraciones no acordadas sin consulta previa. Distinguir esto de las claves primarias y relaciones ya ejecutadas que hacen funcionar la base.

---

# PARTE I. PLANO FUNCIONAL

## 1. Propósito — APROBADO

Catarina RH será el sistema de autoservicio y gestión de servicios de Recursos Humanos de Trainmex. El colaborador se comunicará desde **su WhatsApp personal** con un asistente inteligente que responderá preguntas basándose en **documentación autorizada**. Si la consulta necesita atención humana, el asistente **obtendrá primero contexto suficiente** para crear un ticket y posteriormente permitirá **agendar una cita**.

La atención humana **no se dará por conversación de WhatsApp**; será presencial o remota conforme al centro de trabajo. El sistema administrará servicios, tickets, citas, tiempos, encuestas, indicadores y un buzón de quejas/denuncias vinculado a las necesidades de seguimiento de la NOM-035.

Resultados buscados: menos dudas repetitivas; citas mejor preparadas; seguimiento de casos; medición de tiempos y satisfacción; identificación de temas frecuentes para mejorar comunicación y capacitación; seguimiento de denuncias.

## 2. Personas que utilizan Catarina — APROBADO / PENDIENTE

- **Colaboradores:** aproximadamente 120–130 trabajadores, desde WhatsApp; no se les exigirá instalar otra aplicación para las consultas habituales.
- **Usuarios administrativos:** únicamente el **Generalista de RH** y el **Gerente de RH**. Ambos trabajarán con casos.
- **Agenda:** una sola agenda institucional y una sola persona encargada de realizar la atención.
- **PENDIENTE:** no se ha decidido un esquema de permisos diferenciado entre los dos administradores; no interpretar que tienen necesariamente el mismo acceso ni crear jerarquías sin solicitud.

## 3. Directorio e identificación — APROBADO

Recursos Humanos mantendrá el directorio y realizará altas/actualizaciones de forma administrativa. **No habrá autorregistro ni verificación iniciada por el chatbot.** El número de WhatsApp sirve para localizar el registro y el **ID oficial del colaborador** es su identificador principal.

Datos mínimos: ID, nombre, WhatsApp, centro, departamento, puesto, activo/inactivo. Si no se localiza el teléfono, el sistema orientará a solicitar su actualización mediante el procedimiento habitual de RH. No duplicar expedientes laborales completos ni almacenar salario, datos bancarios, CURP o RFC para este propósito.

## 4. Autoservicio con IA — APROBADO

1. Recibir un mensaje y reconocer el número en el directorio.
2. Interpretar la pregunta, el tema y subtema.
3. Consultar políticas, procedimientos, instructivos o preguntas frecuentes autorizadas.
4. Responder de forma clara únicamente cuando exista información suficiente.
5. Registrar la consulta de manera resumida para estadísticas.
6. Si requiere atención humana, recopilar el motivo de manera breve y adaptativa antes de ofrecer horarios.

**Ejemplo de aclaración de nómina:** preguntar periodo (semana actual/anterior), concepto (horas extra, descuento u otro) y explicación del colaborador. No convertir el flujo en un interrogatorio ni inventar conclusiones sobre pagos.

**Fuentes documentales:** RH podrá agregar, modificar, clasificar o desactivar referencias; los documentos vivirán en Google Drive. La base guardará la referencia y metadatos mínimos. Comenzar con pocas fuentes y ampliar gradualmente. El proveedor/modelo de IA sigue **PENDIENTE**.

## 5. Tickets y atención — APROBADO

- Un ticket surge cuando una consulta requiere gestión humana.
- Guardar folio, colaborador, servicio, descripción original, resumen, fecha/hora de creación, estado y resultado.
- El administrador revisa el antecedente antes de atender.
- Registrar inicio efectivo y término de atención, así como resolución cuando exista.
- **Atención realizada ≠ asunto resuelto.** El asunto puede quedar pendiente aun después de la cita.
- Estados funcionales propuestos: **Pendiente de cita, Cita programada, En atención, Atendido, Resuelto, Concluido**. No convertir estos textos en restricciones SQL adicionales antes de acordar cambios.

## 6. Agenda — APROBADO / PENDIENTE

- Una agenda institucional, editable por RH.
- Horario inicial **lunes a viernes de 14:00 a 17:30**.
- Propuesta operativa inicial del plano: intervalos de **20 minutos**.
- Citas presenciales o remotas para colaboradores de distintos centros.
- Consultar disponibilidad, reservar sin doble asignación, cancelar y reprogramar.
- Bloquear festivos, ausencias, días enteros u horas específicas; permitir modificar horarios.
- **PENDIENTE:** precisar si «20 minutos entre colaboradores» significa duración de la cita o separación adicional. No dar por resuelta la interpretación para la programación definitiva.
- **PENDIENTE operativo:** concretar la presentación de zona horaria en las citas remotas al implementar ese módulo.

## 7. Encuestas — APROBADO

Al finalizar administrativamente una atención, Catarina iniciará el envío de una encuesta asociada con la **cita realizada**. Contenido mínimo: calificación **1–5**, resolución **Sí / Parcialmente / No**, y comentario opcional. Registrar fecha de envío y de respuesta. La falta de respuesta no elimina el registro de atención. El uso de mensajes salientes por WhatsApp deberá respetar las condiciones aplicables de Meta, cuya configuración exacta se resolverá al integrar el canal.

## 8. Buzón de denuncias — APROBADO / PENDIENTE

- Sección independiente de los tickets ordinarios, orientada a quejas sobre el entorno laboral y seguimiento vinculado con NOM-035-STPS-2018.
- Registrar folio, colaborador (si es identificada por WhatsApp), categoría, relato, recepción, estado, actuaciones sucesivas y conclusión.
- La IA **no** juzga la veracidad, ni resuelve jurídicamente el caso.
- Los dos administradores de RH son las personas contempladas para trabajar con los reportes.
- Estados funcionales: **Recibida, En revisión, En seguimiento, Concluida**.
- No aplicar encuesta ordinaria de satisfacción ni incluir denuncias en la exportación general de tickets.
- **PENDIENTE:** modalidad anónima por formulario web. No construida ni aprobada. El canal identificado por WhatsApp no debe presentarse como anónimo.
- El buzón no sustituye por sí solo todas las obligaciones de la NOM-035.

## 9. Indicadores — APROBADO

A partir de la información operativa, sin tablas adicionales de estadísticas:

- Volumen de consultas, categorías y subtemas más frecuentes.
- Preguntas sin respuesta documental y asuntos que motivaron citas.
- Tickets creados, citas programadas, realizadas, canceladas o no asistidas.
- Tiempo desde apertura de ticket hasta comienzo de atención.
- Duración efectiva de la atención y tiempo hasta resolución.
- Estado de resolución y satisfacción de 1 a 5.
- Tendencias por centro y departamento para definir necesidades de comunicación o capacitación.

## 10. Panel administrativo — APROBADO COMO ALCANCE FUNCIONAL

Interfaz web para el Generalista y Gerente de RH con secciones de: resumen inicial, colaboradores, servicios/tickets, agenda, fuentes de conocimiento, encuestas/indicadores, denuncias y configuraciones operativas. **Una sola aplicación**, no múltiples sistemas. La programación concreta de pantallas se hará por iteraciones, sin agregar módulos por iniciativa del agente.

## 11. Archivo histórico — APROBADO / PENDIENTE

- **PostgreSQL en Neon:** base de trabajo para registros operativos.
- **Google Sheets:** destino de exportación mensual de tickets ordinarios cerrados, con identificadores y datos relacionados necesarios; comprobar registros exportados y evitar duplicados.
- Guardar la fecha del archivo en el ticket, cuando aplique.
- **No eliminar registros automáticamente de Neon por ahora.** Exportar datos no reduce el espacio de Neon mientras los originales sigan allí.
- **PENDIENTE:** plazo de conservación, depuración eventual y criterios de elegibilidad detallados. La sugerencia de 90 días no fue aprobada como regla.
- Excluir denuncias y sus seguimientos del archivo general.

## 12. Arquitectura y orden — APROBADO / PROPUESTO

| Responsabilidad | Herramienta | Estado |
|---|---|---|
| Diseño y control | ChatGPT y documentos de referencia | En ejecución |
| Desarrollo inicial | Replit | Aprobado; aún no creado |
| Aplicación | SvelteKit + TypeScript | Aprobado |
| Datos operativos | PostgreSQL en Neon | Aprobado; **11 tablas creadas** |
| Documentos institucionales | Google Drive | Aprobado como fuente; integración no desarrollada |
| Archivo histórico | Google Sheets | Aprobado como destino; automatización no desarrollada |
| Canal del colaborador | WhatsApp Business Platform / Cloud API | Previsto; no conectado |
| Motor de IA | API por decidir | Pendiente |
| Código y versiones | GitHub | Aprobado; repositorio aún no creado/verificado |
| Producción | Railway recomendado; estándar permite también Vercel/Replit | **Propuesto, no aprobado** |

**Secuencia acordada:** definir modelo → crear tablas directamente en Neon → probar con datos ficticios → desarrollar en Replit sobre el esquema existente → guardar código y SQL en GitHub desde etapas tempranas → publicar pronto en plataforma seleccionada sin reconstruir la aplicación.

## 13. Avance verificado al 3 de noviembre de 2026

**Completado y respaldado por capturas de Neon compartidas durante la conversación:**

1. Proyecto `catarina-rh` creado en **Neon Free**, región **AWS US East 2 (Ohio)**.
2. Rama visible: **`production`**; base visible: **`neondb`**.
3. **11 tablas** verificadas mediante consulta a `information_schema.tables`.
4. Prueba ficticia `TEST001`: colaborador → servicio «Nomina / Horas extra» → ticket → cita, consultados con relaciones correctas; también se visualizaron centro, departamento y puesto.
5. Actualización de atención ficticia con inicio/término, estado «Atendido» y resultado pendiente de resolver.
6. Encuesta ficticia vinculada a la cita: **18 minutos** de atención, calificación **4**, resolución **Parcialmente** y comentario.
7. Denuncia ficticia: folio, categoría «Entorno laboral», estado «En revisión» y seguimiento relacionado.
8. Limpieza ejecutada y consulta de comprobación: **0 registros** en `colaboradores`, `tickets`, `citas`, `encuestas`, `denuncias`, `seguimientos_denuncia` y `servicios`.

**Alcance de la verificación:** la última consulta de limpieza no comprobó el número de filas en `consultas`, `fuentes`, `horarios_atencion` ni `bloqueos_agenda`. No se ha probado aún la integración con WhatsApp, IA, Drive, Sheets o la aplicación web. No confundir pruebas SQL con un sistema ya implementado.

---

# PARTE II. MODELO DE DATOS Y ESQUEMA REAL EN NEON

## 14. Alcance y regla de economía de datos

El diseño inicial contiene **11 tablas en el esquema `public`** de PostgreSQL. Estas tablas ya se crearon en Neon; **Replit no debe recrearlas ni reemplazarlas**. El desarrollo debe consultar la estructura real y trabajar con ella.

No se han creado tablas adicionales de roles, permisos, catálogos separados de departamentos/centros/puestos, auditoría genérica, estadísticas, expedientes laborales completos ni transcripciones completas de WhatsApp. Cualquier nueva tabla o cambio de estructura debe explicarse y acordarse antes de ejecutarse.

## 15. Tablas existentes y campos

| Tabla | Campos del esquema creado |
|---|---|
| `colaboradores` | `id_colaborador TEXT PRIMARY KEY`, `nombre TEXT`, `whatsapp TEXT`, `centro TEXT`, `departamento TEXT`, `puesto TEXT`, `activo BOOLEAN DEFAULT TRUE` |
| `servicios` | `id_servicio BIGINT IDENTITY PRIMARY KEY`, `categoria TEXT`, `subcategoria TEXT`, `activo BOOLEAN DEFAULT TRUE` |
| `tickets` | `id_ticket BIGINT IDENTITY PRIMARY KEY`, `id_colaborador TEXT`, `id_servicio BIGINT`, `descripcion TEXT`, `resumen TEXT`, `estado TEXT`, `creado_en TIMESTAMPTZ DEFAULT NOW()`, `resuelto_en TIMESTAMPTZ`, `cerrado_en TIMESTAMPTZ`, `resultado TEXT`, `archivado_en TIMESTAMPTZ` |
| `citas` | `id_cita BIGINT IDENTITY PRIMARY KEY`, `id_ticket BIGINT`, `inicio_programado TIMESTAMPTZ`, `fin_programado TIMESTAMPTZ`, `modalidad TEXT`, `estado TEXT`, `inicio_real TIMESTAMPTZ`, `fin_real TIMESTAMPTZ`, `observaciones TEXT` |
| `horarios_atencion` | `id_horario BIGINT IDENTITY PRIMARY KEY`, `dia_semana SMALLINT`, `hora_inicio TIME`, `hora_fin TIME`, `duracion_cita SMALLINT`, `activo BOOLEAN DEFAULT TRUE` |
| `bloqueos_agenda` | `id_bloqueo BIGINT IDENTITY PRIMARY KEY`, `fecha DATE`, `hora_inicio TIME`, `hora_fin TIME`, `motivo TEXT` |
| `consultas` | `id_consulta BIGINT IDENTITY PRIMARY KEY`, `id_colaborador TEXT`, `id_servicio BIGINT`, `fecha TIMESTAMPTZ DEFAULT NOW()`, `pregunta_resumen TEXT`, `resultado TEXT`, `contexto JSONB`, `id_ticket BIGINT` |
| `fuentes` | `id_fuente BIGINT IDENTITY PRIMARY KEY`, `nombre TEXT`, `categoria TEXT`, `url_drive TEXT`, `version TEXT`, `vigente_desde DATE`, `activo BOOLEAN DEFAULT TRUE` |
| `encuestas` | `id_encuesta BIGINT IDENTITY PRIMARY KEY`, `id_cita BIGINT`, `enviada_en TIMESTAMPTZ`, `respondida_en TIMESTAMPTZ`, `calificacion SMALLINT`, `resolucion TEXT`, `comentario TEXT` |
| `denuncias` | `id_denuncia BIGINT IDENTITY PRIMARY KEY`, `id_colaborador TEXT`, `categoria TEXT`, `descripcion TEXT`, `recibida_en TIMESTAMPTZ DEFAULT NOW()`, `estado TEXT`, `concluida_en TIMESTAMPTZ` |
| `seguimientos_denuncia` | `id_seguimiento BIGINT IDENTITY PRIMARY KEY`, `id_denuncia BIGINT`, `fecha TIMESTAMPTZ DEFAULT NOW()`, `descripcion TEXT` |

**Nota técnica de exactitud:** En el SQL ejecutado los identificadores numéricos se definen con `GENERATED BY DEFAULT AS IDENTITY`, y los campos vinculados incluyen las referencias SQL detalladas a continuación. No declarar restricciones `NOT NULL`, `UNIQUE`, `CHECK`, índices especiales u otros mecanismos adicionales que no existan en este SQL sin presentar antes la necesidad.

## 16. Relaciones que ya forman parte del esquema

- `tickets.id_colaborador` → `colaboradores.id_colaborador`
- `tickets.id_servicio` → `servicios.id_servicio`
- `citas.id_ticket` → `tickets.id_ticket`
- `consultas.id_colaborador` → `colaboradores.id_colaborador`
- `consultas.id_servicio` → `servicios.id_servicio`
- `consultas.id_ticket` → `tickets.id_ticket`
- `encuestas.id_cita` → `citas.id_cita`
- `denuncias.id_colaborador` → `colaboradores.id_colaborador`
- `seguimientos_denuncia.id_denuncia` → `denuncias.id_denuncia`

`horarios_atencion`, `bloqueos_agenda` y `fuentes` son independientes. No hay tabla para las cuentas administrativas ni mecanismo de acceso escogido: eso sigue pendiente de diseño antes de implementar la interfaz administrativa.

## 17. SQL del esquema inicial que se ejecutó en Neon

**Referencia de estructura — NO volver a ejecutar sobre la base existente sin necesidad.** Se incluye para que los agentes comprendan exactamente qué se creó y puedan conservarlo en el repositorio de código.

```sql
BEGIN;

CREATE TABLE colaboradores (
    id_colaborador TEXT PRIMARY KEY,
    nombre TEXT,
    whatsapp TEXT,
    centro TEXT,
    departamento TEXT,
    puesto TEXT,
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE servicios (
    id_servicio BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    categoria TEXT,
    subcategoria TEXT,
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE tickets (
    id_ticket BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id_colaborador TEXT REFERENCES colaboradores(id_colaborador),
    id_servicio BIGINT REFERENCES servicios(id_servicio),
    descripcion TEXT,
    resumen TEXT,
    estado TEXT,
    creado_en TIMESTAMPTZ DEFAULT NOW(),
    resuelto_en TIMESTAMPTZ,
    cerrado_en TIMESTAMPTZ,
    resultado TEXT,
    archivado_en TIMESTAMPTZ
);

CREATE TABLE citas (
    id_cita BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id_ticket BIGINT REFERENCES tickets(id_ticket),
    inicio_programado TIMESTAMPTZ,
    fin_programado TIMESTAMPTZ,
    modalidad TEXT,
    estado TEXT,
    inicio_real TIMESTAMPTZ,
    fin_real TIMESTAMPTZ,
    observaciones TEXT
);

CREATE TABLE horarios_atencion (
    id_horario BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    dia_semana SMALLINT,
    hora_inicio TIME,
    hora_fin TIME,
    duracion_cita SMALLINT,
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE bloqueos_agenda (
    id_bloqueo BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    fecha DATE,
    hora_inicio TIME,
    hora_fin TIME,
    motivo TEXT
);

CREATE TABLE consultas (
    id_consulta BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id_colaborador TEXT REFERENCES colaboradores(id_colaborador),
    id_servicio BIGINT REFERENCES servicios(id_servicio),
    fecha TIMESTAMPTZ DEFAULT NOW(),
    pregunta_resumen TEXT,
    resultado TEXT,
    contexto JSONB,
    id_ticket BIGINT REFERENCES tickets(id_ticket)
);

CREATE TABLE fuentes (
    id_fuente BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    nombre TEXT,
    categoria TEXT,
    url_drive TEXT,
    version TEXT,
    vigente_desde DATE,
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE encuestas (
    id_encuesta BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id_cita BIGINT REFERENCES citas(id_cita),
    enviada_en TIMESTAMPTZ,
    respondida_en TIMESTAMPTZ,
    calificacion SMALLINT,
    resolucion TEXT,
    comentario TEXT
);

CREATE TABLE denuncias (
    id_denuncia BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id_colaborador TEXT REFERENCES colaboradores(id_colaborador),
    categoria TEXT,
    descripcion TEXT,
    recibida_en TIMESTAMPTZ DEFAULT NOW(),
    estado TEXT,
    concluida_en TIMESTAMPTZ
);

CREATE TABLE seguimientos_denuncia (
    id_seguimiento BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id_denuncia BIGINT REFERENCES denuncias(id_denuncia),
    fecha TIMESTAMPTZ DEFAULT NOW(),
    descripcion TEXT
);

COMMIT;
```

## 18. Qué datos se guardan y dónde

| Dato | Destino |
|---|---|
| Directorio, servicios, tickets, citas, horarios, bloqueos, consultas resumidas, encuestas, denuncias y seguimientos | Neon (`neondb`, rama `production`) |
| Políticas y procedimientos oficiales | Google Drive |
| Nombre, categoría, URL, versión/vigencia de fuentes | Tabla `fuentes` en Neon |
| Copias históricas mensuales de tickets cerrados, cuando se programe | Google Sheets |
| Código fuente, documentación y esquema SQL | GitHub, cuando exista el repositorio |

En particular, el contexto de conversación en `consultas.contexto` es **mínimo y opcional**, no un registro indiscriminado de mensajes.

## 19. Estado real y límites de las pruebas

- **Realizado:** creación de esquema y prueba con datos ficticios; consulta de relaciones de colaboradores, tickets, citas, encuestas y denuncias/seguimientos.
- **Realizado:** eliminación de los registros de prueba generados, verificada en **7 tablas** (`colaboradores`, `tickets`, `citas`, `encuestas`, `denuncias`, `seguimientos_denuncia`, `servicios`).
- **No verificado todavía:** datos de las otras 4 tablas en la última consulta de limpieza; lógica de reserva concurrente; notificaciones; consulta documental; panel; integración real con WhatsApp; archivo mensual.
- **No inferir:** que ya existe la aplicación, que Neon está conectado a Replit, que el repositorio GitHub ya existe o que Railway fue contratado.

## 20. Instrucción de continuidad para Replit

Leer junto con **Estándar Universal Trainmex v1.0** y **Documento Maestro de Control de Catarina RH v1.1**. El esquema PostgreSQL ya existe y es la fuente operativa: primero **inspeccionarlo y conectarse**, no generar tablas nuevas, resetear datos ni imponer migraciones por iniciativa propia. Proponer y construir únicamente los módulos que se vayan indicando, probando con información ficticia y manteniendo la documentación actualizada.

**Decisiones pendientes relevantes:** intervalos de 20 minutos; denuncias anónimas; plataforma definitiva de producción; proveedor de IA; permisos específicos entre los dos administradores; número y configuración de WhatsApp; política de depuración posterior a la exportación. Ninguno debe convertirse silenciosamente en un requisito implementado.
