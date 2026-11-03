# CATARINA RH — DOCUMENTO MAESTRO DE CONTROL

**Empresa:** Manufacturas Trainmex  
**Proyecto rector:** Optimus Prime  
**Versión:** 1.1  
**Fecha de actualización:** 3 de noviembre de 2026  
**Estado:** Plano funcional validado; 11 tablas PostgreSQL creadas y verificadas en Neon; pruebas SQL de los flujos principales superadas; registros ficticios limpiados. Preparación de Replit pendiente.  
**Propósito:** Fuente de continuidad para ChatGPT, Replit y cualquier agente autorizado. Este documento consolida las decisiones de esta conversación y diferencia las decisiones acordadas de propuestas y pendientes.

> **Regla de lectura:** Lo marcado como **APROBADO** debe respetarse. Lo marcado **PROPUESTO** requiere validación antes de fijarse como requisito. Lo marcado **PENDIENTE** no debe inferirse ni implementarse por iniciativa del agente.

## 1. Objetivo y alcance — APROBADO

Catarina RH será un sistema de autoservicio y gestión de servicios de Recursos Humanos de Trainmex. El colaborador utilizará **su WhatsApp personal** para formular consultas; un asistente inteligente responderá con **fuentes documentales autorizadas**, clasificará dudas y, cuando se requiera atención humana, recopilará previamente el motivo y ofrecerá una **cita**. La atención humana **no se prestará mediante chat de WhatsApp**, sino presencialmente o de forma remota, según el centro de trabajo. La aplicación administrará tickets, agenda, registro de atención, encuestas, indicadores y un buzón de quejas/denuncias ligado al seguimiento de la NOM-035.

Objetivos: reducir consultas repetitivas; organizar citas con contexto previo; registrar tiempos desde la solicitud hasta la atención y eventual resolución; medir satisfacción; identificar preguntas frecuentes para mejorar procedimientos, comunicación y capacitación; conservar seguimiento de denuncias.

## 2. Actores y administración — APROBADO / PENDIENTE

- **Colaboradores:** población aproximada de 120–130 personas, usuarias del canal WhatsApp. No usarán una aplicación adicional para las consultas habituales.
- **Usuarios administrativos:** **Generalista de RH y Gerente de RH**. Ambos trabajarán con los casos. **APROBADO:** solo estos dos actores administrativos en el alcance actual.
- **Una agenda institucional y una persona que realiza la atención**. **APROBADO**.
- **No están definidos permisos detallados ni jerarquías de acceso entre esos dos usuarios. PENDIENTE.** No asumir que necesariamente tienen las mismas facultades ni construir roles adicionales.
- **Regla de control del usuario:** no añadir arbitrariamente candados, verificaciones, jerarquías, autorizaciones o servicios. Antes de proponer o implementar cualquier restricción o mecanismo adicional no acordado, explicarlo y pedir decisión. Las medidas técnicas indispensables para no exponer credenciales y datos deben señalarse explícitamente, sin convertirlas en procesos de negocio no solicitados.

## 3. Directorio e identificación — APROBADO

RH dará de alta y actualizará individualmente a los colaboradores a partir de su información existente. **No habrá autorregistro ni proceso de verificación gestionado por el chatbot.**

Campos: `id_colaborador` (identificador oficial), nombre, WhatsApp, centro de trabajo, departamento, puesto y activo/inactivo. El **ID** será la referencia principal del colaborador; el **número de WhatsApp** servirá para localizarlo. Un teléfono no registrado deberá canalizarse a RH para actualización por las vías existentes. No duplicar expediente laboral ni cargar salarios, CURP, RFC o información bancaria al directorio de Catarina.

## 4. Flujo de autoservicio y ticket — APROBADO

1. Llega una consulta desde WhatsApp y se vincula con el directorio.
2. Catarina identifica tema/subtema y consulta políticas, procedimientos o preguntas frecuentes autorizadas.
3. Si la fuente es suficiente, responde automáticamente; se contabiliza la consulta y su categoría.
4. Si requiere intervención humana, **antes de mostrar horarios** pide una explicación suficiente para preparar al administrador. Preguntas cortas y adaptativas, sin interrogatorios. Ejemplo de nómina: semana actual/anterior, concepto involucrado (p. ej. horas extra) y relato del problema.
5. Se genera un **ticket con folio, fecha/hora, relato original, categoría, resumen y estado**. Catarina propone la cita según disponibilidad.
6. RH consulta el contexto antes de atender y registra inicio, término, resultado y, en su caso, resolución posterior.

**Importante:** atención realizada ≠ asunto resuelto. La consulta, el ticket, la cita y la resolución son hechos relacionados, pero distintos. No se requiere atender manualmente conversaciones por WhatsApp.

## 5. Agenda — APROBADO / PENDIENTE

- **Una sola agenda**, editable por RH.
- Horario inicial: **lunes a viernes, 14:00–17:30 horas**.
- Bloques iniciales propuestos en el plano validado: **20 minutos**; se podrán bloquear fechas, festivos, ausencias y horarios parciales. Cancelación y reprogramación; sin doble asignación de un mismo horario.
- Atención presencial o remota de acuerdo con el centro de trabajo, incluyendo otros sitios como CEDIS.
- **PENDIENTE:** confirmar si «20 minutos entre un colaborador y otro» significa **duración total de cada cita** o **separación adicional entre citas**. No programar la interpretación definitiva sin confirmarla.
- La zona horaria de citas remotas y su tratamiento concreto se concretará al implementar el módulo, sin inventar reglas adicionales.

## 6. Encuestas e indicadores — APROBADO

Al marcar la atención como realizada, se inicia una encuesta posterior, vinculada a esa atención. Contenido inicial: calificación de **1 a 5**, resolución **sí / parcialmente / no** y comentario opcional. Registrar envío y respuesta, cuando ocurran. El envío saliente por WhatsApp debe ajustarse a las reglas y posibles costos de Meta, especialmente si la ventana de servicio ya cerró. No equiparar falta de encuesta con falta de atención.

Indicadores previstos: volumen de consultas; asuntos frecuentes por categoría/subtema, departamento y centro; consultas respondidas automáticamente; preguntas que no encontraron fuente; tickets; citas reservadas, realizadas o no atendidas; tiempo desde apertura de ticket hasta atención; duración efectiva de atención; tiempo hasta resolución; nivel de resolución; calificación de satisfacción y necesidades recurrentes de capacitación/comunicación. Calcularlos a partir de registros operativos; **no crear una base separada de indicadores** por anticipación.

## 7. Fuentes documentales — APROBADO

Catarina consultará políticas, procedimientos, instructivos, prestaciones generales, comunicados y preguntas frecuentes **aprobados**. El módulo administrativo permitirá **agregar, actualizar, clasificar y desactivar** fuentes gradualmente. Los documentos se alojarán en **Google Drive**; la base guardará únicamente sus referencias y metadatos mínimos (nombre, categoría, enlace, versión/vigencia si existen, activo). **No incrustar reglas institucionales de RH en el código** cuando puedan administrarse mediante fuentes. Empezar con pocas fuentes y ampliar según uso real.

## 8. Quejas y denuncias / NOM-035 — APROBADO / PENDIENTE

Existirá un **buzón digital de quejas y denuncias** con folio, relato, categoría, fecha de recepción, estado, registros de seguimiento y fecha de conclusión. Serán expedientes separados de los tickets ordinarios. El Generalista y el Gerente de RH serán los actores administrativos que trabajarán con estos casos.

El módulo apoya la recepción y seguimiento de reportes relacionados con el entorno laboral y la **NOM-035-STPS-2018**, pero **no reemplaza todas las obligaciones de la norma** ni implica decidir automáticamente sobre el fondo de una denuncia. La IA no determina veracidad ni emite resoluciones laborales.

**PENDIENTE:** denuncia anónima a través de formulario web; **no aprobada**. La ruta actualmente contemplada es la identificada por WhatsApp, por lo que **no debe prometerse anonimato**. No agregar una encuesta ordinaria de satisfacción a denuncias. No exportar denuncias a la hoja histórica general de tickets.

## 9. Tecnologías y alojamiento — APROBADO / PROPUESTO

| Función | Tecnología / decisión | Estado |
|---|---|---|
| Desarrollo inicial | Replit, con asistencia de IA | APROBADO |
| Framework / lenguaje | SvelteKit + TypeScript | APROBADO, estándar Trainmex modalidad B |
| Base operativa | PostgreSQL en Neon | APROBADO |
| Fuentes documentales | Google Drive | APROBADO |
| Archivo histórico de tickets | Google Sheets | APROBADO como destino de exportación |
| Canal del colaborador | WhatsApp Business Platform / Cloud API oficial | APROBADO como integración prevista |
| Motor de IA | API externa, proveedor/modelo por seleccionar | PENDIENTE |
| Código y versiones | GitHub como repositorio oficial | APROBADO; sincronizar durante desarrollo, no solo al final |
| Alojamiento productivo | Railway | **PROPUESTO, NO APROBADO**. El estándar permite Vercel, Railway o Replit. |

**Orden acordado:** diseñar el modelo aquí, **crear las tablas reales directamente en Neon**, comprobarlas con datos ficticios, y luego desarrollar en Replit sobre la estructura existente. Preparar migración/publicación temprana en alojamiento autorizado, evitando reconstruir la aplicación. El desarrollo inicia en Replit; GitHub debe incorporarse desde fases tempranas y conservar el código y SQL.

**Estado técnico comprobado al 3 de noviembre de 2026:** proyecto Neon `catarina-rh` creado, base `neondb`, rama `production`, región AWS US East 2 (Ohio), plan Free; **11 tablas creadas**. Todavía no se ha verificado la creación de repositorio GitHub, aplicación Replit, publicación o conexión con Meta.

## 10. Modelo de datos PostgreSQL — ESQUEMA EJECUTADO Y VERIFICADO

El modelo inicial de **11 tablas** ya fue creado mediante SQL en la base `neondb`, rama `production` de Neon. Una consulta a `information_schema.tables` confirmó los 11 nombres. El SQL efectivamente ejecutado y las especificaciones funcionales están documentados en **`CATARINA_RH_PLANO_FUNCIONAL_Y_MODELO_DATOS_v1.0.md`**. **No solicitar a Replit que vuelva a crear ni sustituir tablas.** Cualquier cambio posterior debe acordarse, no aplicarse por suposición.

| Tabla | Campos mínimos previstos |
|---|---|
| `colaboradores` | `id_colaborador`, `nombre`, `whatsapp`, `centro`, `departamento`, `puesto`, `activo` |
| `servicios` | `id_servicio`, `categoria`, `subcategoria`, `activo` |
| `tickets` | `id_ticket`, `id_colaborador`, `id_servicio`, `descripcion`, `resumen`, `estado`, `creado_en`, `resuelto_en`, `cerrado_en`, `resultado`, `archivado_en` |
| `citas` | `id_cita`, `id_ticket`, `inicio_programado`, `fin_programado`, `modalidad`, `estado`, `inicio_real`, `fin_real`, `observaciones` |
| `horarios_atencion` | `id_horario`, `dia_semana`, `hora_inicio`, `hora_fin`, `duracion_cita`, `activo` |
| `bloqueos_agenda` | `id_bloqueo`, `fecha`, `hora_inicio`, `hora_fin`, `motivo` |
| `consultas` | `id_consulta`, `id_colaborador`, `id_servicio`, `fecha`, `pregunta_resumen`, `resultado`, `contexto`, `id_ticket` |
| `fuentes` | `id_fuente`, `nombre`, `categoria`, `url_drive`, `version`, `vigente_desde`, `activo` |
| `encuestas` | `id_encuesta`, `id_cita`, `enviada_en`, `respondida_en`, `calificacion`, `resolucion`, `comentario` |
| `denuncias` | `id_denuncia`, `id_colaborador`, `categoria`, `descripcion`, `recibida_en`, `estado`, `concluida_en` |
| `seguimientos_denuncia` | `id_seguimiento`, `id_denuncia`, `fecha`, `descripcion` |

Relaciones: colaborador→tickets/consultas/denuncias; servicio→tickets/consultas; ticket→citas; cita→encuesta; consulta→ticket opcional; denuncia→seguimientos. Una cita puede ser reprogramada mediante registro de estado o nueva cita; el detalle operativo se probará al implementar. No duplicar nombres/puestos en tickets. Catálogos de departamento, centro y puesto **no se separarán en tablas adicionales por ahora**. Tampoco habrá tablas de estadísticas, permisos, auditoría genérica o historiales completos de mensajes sin aprobación.

Tipos sugeridos: identificadores oficiales tipo texto; IDs internos numéricos; fechas/hora de eventos con `TIMESTAMPTZ`; fechas y horas puras con `DATE`/`TIME`; `BOOLEAN`, `TEXT` y, solo para contexto necesario, `JSONB`. Los estados se definieron a nivel funcional, no como restricciones SQL complejas.

Estados propuestos: tickets «pendiente de cita», «cita programada», «en atención», «atendido», «resuelto», «concluido»; citas «programada», «cancelada», «realizada», «no asistió»; denuncias «recibida», «en revisión», «en seguimiento», «concluida». El estado final debe reflejar la diferencia entre atención realizada y caso resuelto.

## 11. Archivo histórico y economía de almacenamiento — APROBADO / PENDIENTE

- Exportación **mensual** de tickets ordinarios cerrados a Google Sheets, incluyendo datos vinculados necesarios para consulta histórica.
- Guardar folios e identificadores de origen, evitar duplicados y comprobar la exportación.
- **No implementar eliminación automática en Neon por ahora**. Exportar no libera espacio por sí solo.
- Medir uso real antes de decidir depuración y plazo de retención. En conversación se sugirió **90 días** como antigüedad mínima y umbrales de alerta; **no quedaron aprobados como regla definitiva**.
- Denuncias y seguimientos **no** participan en el archivo común.
- No guardar archivos grandes o transcripciones completas sin necesidad establecida.

## 12. Etapas y entregables — APROBADO COMO MÉTODO

Conforme a las siete etapas del Estándar Universal Trainmex:

1. **Definición:** completada y **Plano Funcional v1.0 validado provisionalmente** por el usuario.
2. **Diseño:** plano funcional y modelo de datos definidos; SQL inicial **ejecutado** y probado en Neon. Ajustes posteriores solo cuando se acuerden.
3. **Preparación:** proyecto Neon y estructura inicial de datos **completados**; repositorio GitHub y aplicación Replit **pendientes**.
4. **Desarrollo:** pendiente; primera entrega preferente: núcleo administrativo (directorio, servicios, tickets y agenda), con pruebas ficticias.
5. **Datos:** proyecto y tablas en Neon creados; probadas relaciones principales mediante datos ficticios, luego eliminados. Falta conexión de Catarina y las integraciones externas.
6. **Publicación:** pendiente decisión final de plataforma y despliegue temprano de versión estable.
7. **Operación:** pendiente WhatsApp, IA documental, encuestas, denuncias, reportes y archivo automatizado.

**Organización documental para Catarina:** el usuario ya cuenta con el Estándar Universal Trainmex v1.0. Por economía documental, **`CATARINA_RH_PLANO_FUNCIONAL_Y_MODELO_DATOS_v1.0.md`** consolida provisionalmente el contenido de `PLANO-PROYECTO.md` y `MODELO-DATOS.md` en un solo documento, a solicitud del usuario. El presente maestro es la bitácora de control. **Nota:** el estándar enumera los archivos funcional y de datos por separado; si en la preparación del repositorio se requiere seguir literalmente esos nombres, podrán separarse desde el documento combinado sin inventar ni cambiar contenido. El estándar no se modifica.

## 12 bis. Evidencia de ejecución y pruebas Neon — VERIFICADO

Capturas compartidas en esta conversación muestran:

1. Proyecto `catarina-rh` en Neon Free, **AWS US East 2 (Ohio)**; rama `production`; base `neondb`.
2. Consulta de existencia con **11 tablas**: `bloqueos_agenda`, `citas`, `colaboradores`, `consultas`, `denuncias`, `encuestas`, `fuentes`, `horarios_atencion`, `seguimientos_denuncia`, `servicios` y `tickets`.
3. Prueba con colaborador ficticio `TEST001`: relación de colaborador → servicio → ticket → cita; recuperación de centro, departamento y puesto.
4. Atención ficticia registrada con **18 minutos** y ticket **Atendido** sin marcarlo como resuelto. Encuesta vinculada: calificación **4**, resolución **Parcialmente** y comentario.
5. Denuncia ficticia con estado **En revisión** y seguimiento correctamente relacionado.
6. Limpieza de pruebas: consulta final mostró **0 registros** en `colaboradores`, `tickets`, `citas`, `encuestas`, `denuncias`, `seguimientos_denuncia` y `servicios`. **No se comprobó por esa consulta el conteo de las cuatro tablas restantes.**

El esquema y las relaciones básicas funcionan para las pruebas anteriores. **No se han probado todavía:** conflicto de doble reserva, integraciones externas, respuestas del chatbot, interfaz administrativa ni archivado mensual.

## 13. Decisiones expresamente pendientes

1. Si los **20 minutos** representan duración de cita o separación adicional.
2. Si se incorporará recepción de denuncias **anónimas** en una etapa posterior.
3. Elección definitiva de **Railway / Vercel / Replit** como alojamiento de producción; Railway solo se ha recomendado.
4. Selección del proveedor/modelo de **API de IA** y estimación real de consumo.
5. Permisos específicos, si los hubiera, entre Generalista y Gerente RH; no inventarlos.
6. Detalle operativo de la conexión con WhatsApp: número existente/nuevo, configuración en Meta, modalidades y plantillas.
7. Criterios de depuración/retención de datos luego de exportación histórica.

Estos pendientes **no impiden diseñar el SQL de las tablas básicas**. Los que afecten una función concreta deberán resolverse antes de implementarla.

## 14. Próximo paso exacto

**Preparar el proyecto Catarina RH en Replit a partir del estándar, este maestro y el plano/modelo combinado; configurar GitHub como repositorio oficial desde una etapa temprana y conectar la aplicación a la base PostgreSQL YA EXISTENTE en Neon.** Empezar por el núcleo administrativo de colaboradores, servicios y tickets, con pruebas ficticias. No pedir a Replit que genere, reemplace o migre tablas sin autorización. Publicación posterior en proveedor autorizado, aún pendiente de selección definitiva.

**Está verificado:** Neon, su base `neondb` y las 11 tablas. **No presentar como configurados:** GitHub, Replit, Meta, IA, Google Drive/Sheets integrados ni Railway, porque no se han comprobado.

## 15. Instrucción de continuidad para cualquier agente

Lee este documento y el Estándar Universal Trainmex v1.0 antes de modificar el proyecto. Conserva las decisiones **APROBADAS**; distingue **PROPUESTAS** y **PENDIENTES**; no inventes campos, módulos, restricciones, roles, servicios ni decisiones técnicas. No comiences a programar funciones no aprobadas. Antes de añadir un candado o control no acordado, explica concretamente qué problema resuelve y solicita decisión. Al terminar cada iteración, comunica qué se hizo, cómo se probó, qué quedó pendiente y qué archivos/versiones cambiaron. Mantén actualizados el plano funcional, modelo de datos y este registro maestro.

---

**Nota de alcance:** Este documento recoge decisiones y pruebas verificadas con capturas de Neon. **El esquema de datos existe y fue probado; la aplicación web y las integraciones aún no están implementadas.**
