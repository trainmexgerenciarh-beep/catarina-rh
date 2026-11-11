<script lang="ts">
  import { onMount } from 'svelte';
  import AdminUsers from './AdminUsers.svelte';
  import DirectoryImport from './DirectoryImport.svelte';

  export let mode: 'demo' | 'admin';

  type Row = Record<string, unknown>;
  type Message = { from: 'catarina' | 'persona'; text: string };

  const navItems = [
    { id: 'dashboard', label: 'Resumen', group: 'Inicio', mark: '01' },
    { id: 'agenda', label: 'Agenda', group: 'Operación', mark: '02' },
    { id: 'tickets', label: 'Tickets', group: 'Operación', mark: '03' },
    { id: 'colaboradores', label: 'Directorio', group: 'Administración', mark: '04' },
    { id: 'servicios', label: 'Servicios', group: 'Administración', mark: '05' },
    { id: 'fuentes', label: 'Fuentes', group: 'Administración', mark: '06' },
    { id: 'usuarios', label: 'Usuarios y accesos', group: 'Administración', mark: '12' },
    { id: 'importar', label: 'Importar directorio', group: 'Administración', mark: '13' },
    { id: 'consultas', label: 'Consultas', group: 'Seguimiento', mark: '07' },
    { id: 'voz', label: 'Tu Voz', group: 'Seguimiento', mark: '08' },
    { id: 'encuestas', label: 'Encuestas', group: 'Seguimiento', mark: '09' },
    { id: 'indicadores', label: 'Indicadores', group: 'Seguimiento', mark: '10' },
    { id: 'configuracion', label: 'Configuración', group: 'Sistema', mark: '11' }
  ];

  const resourceLabels: Record<string, string> = Object.fromEntries(
    navItems.map((item) => [item.id, item.label])
  );
  const fields: Record<string, { key: string; label: string; type?: string }[]> = {
    colaboradores: [
      { key: 'id_colaborador', label: 'ID de colaborador' },
      { key: 'nombre', label: 'Nombre completo' },
      { key: 'whatsapp', label: 'WhatsApp' },
      { key: 'centro', label: 'Centro' },
      { key: 'departamento', label: 'Departamento' },
      { key: 'puesto', label: 'Puesto' },
      { key: 'activo', label: 'Activo', type: 'checkbox' }
    ],
    servicios: [
      { key: 'id_servicio', label: 'ID de servicio' },
      { key: 'activo', label: 'Servicio activo', type: 'checkbox' }
    ],
    bloqueos: [
      { key: 'fecha', label: 'Fecha', type: 'date' },
      { key: 'hora_inicio', label: 'Hora de inicio', type: 'time' },
      { key: 'hora_fin', label: 'Hora de término', type: 'time' },
      { key: 'motivo', label: 'Motivo' }
    ],
    fuentes: [
      { key: 'nombre', label: 'Nombre de la fuente' },
      { key: 'categoria', label: 'Categoría', type: 'catalog' },
      { key: 'url_drive', label: 'Enlace de Google Drive', type: 'url' },
      { key: 'version', label: 'Versión' },
      { key: 'vigente_desde', label: 'Vigente desde', type: 'date' },
      { key: 'activo', label: 'Aprobada por Gerente para consultas', type: 'checkbox' }
      ,{ key: 'fuente_inactiva', label: 'Inactiva (si no está aprobada)', type: 'checkbox' }
    ]
  };

  function mexicoDateKey(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    const raw = value instanceof Date ? '' : String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = value instanceof Date ? value : new Date(raw);
    if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  const todayInMexico = () => mexicoDateKey(new Date());

  let ready = false;
  let authenticated = false;
  let configured = true;
  let role = '';
  let email = '';
  let principal = false;
  let rows: Row[] = [];
  let busy = false;
  let loading = false;
  let error = '';
  let notice = '';
  let modal = '';
  let modalRow: Row = {};
  let form: Record<string, unknown> = {};
  let search = '';
  let filterDate = '';
  let filterCategory = '';
  let filterCenter = '';
  let filterDepartment = '';
  let conversationText = '';
  let conversationBusy = false;
  let conversationError = '';
  let messages: Message[] = [];
  let period = todayInMexico().slice(0, 7);
  let categoryOptions: { value: string; label: string }[] = [];
  let categoryOptionsLoaded = false;
  let categoryLoading = false;
  let categoryError = '';
  let loadedResource = '';
  let requestId = 0;
  let resource = 'dashboard';
  let agendaView: 'week' | 'day' = 'week';
  let weekOf = todayInMexico();

  $: viewTitle = resourceLabels[resource] || (resource === 'agenda' ? 'Agenda' : 'Resumen');
  $: visibleRows = rows.filter((row) => {
    const text = Object.values(row).join(' ').toLocaleLowerCase('es');
    const matchesSearch = !search || text.includes(search.toLocaleLowerCase('es'));
    const rowDate = mexicoDateKey(row.fecha || row.inicio_programado || row.creado_en || row.recibida_en || row.enviada_en);
    let matchesDate = !filterDate || rowDate.startsWith(filterDate);
    if (resource === 'agenda' && agendaView === 'week' && !filterDate && rowDate) {
      const anchor = new Date(`${weekOf}T12:00:00Z`);
      const weekday = (anchor.getUTCDay() + 6) % 7;
      const monday = new Date(anchor);
      monday.setUTCDate(anchor.getUTCDate() - weekday);
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      matchesDate = rowDate >= monday.toISOString().slice(0, 10) && rowDate <= sunday.toISOString().slice(0, 10);
    }
    const matchesCategory = !filterCategory || String(row.categoria || row.subcategoria || '').includes(filterCategory);
    const matchesCenter = !filterCenter || String(row.centro || '').includes(filterCenter);
    const matchesDepartment = !filterDepartment || String(row.departamento || '').includes(filterDepartment);
    return matchesSearch && matchesDate && matchesCategory && matchesCenter && matchesDepartment;
  });

  onMount(async () => {
    resource = new URLSearchParams(window.location.search).get('resource') || 'dashboard';
    if (mode === 'admin') {
      try {
        const response = await fetch('/api/admin/session', { credentials: 'same-origin' });
        const session = await response.json();
        configured = Boolean(session.configured);
        authenticated = Boolean(session.authenticated);
        role = session.role || '';
        email = session.email || '';
        principal = Boolean(session.principal);
      } catch {
        error = 'No fue posible verificar la sesión. Revisa tu conexión e inténtalo de nuevo.';
      }
      if (authenticated) ready = true;
    } else {
      ready = true;
    }
  });

  $: if (ready && resource !== loadedResource) loadResource(resource);

  async function loadResource(name: string, force = false) {
    if (!ready || (name === 'voz' && mode === 'admin' && role !== 'gerente')) {
      if (name === 'voz' && mode === 'admin' && role !== 'gerente') error = 'Tu Voz está disponible únicamente para Gerencia de RH.';
      return;
    }
    if (!force && loadedResource === name) return;
    loadedResource = name;
    const current = ++requestId;
    loading = true;
    error = '';
    notice = '';
    if(name === 'simulacion'||name === 'usuarios'||name === 'importar'){
      rows = [];
      loading = false;
      return; // Conversation uses its POST endpoint, not an imaginary data table.
    }
    try {
      const resources = name === 'agenda' ? ['citas', 'bloqueos'] : [name === 'indicadores' ? 'dashboard' : name];
      const responses = await Promise.all(resources.map((resourceName) =>
        fetch(`${mode === 'demo' ? '/api/demo' : '/api/rh'}/${encodeURIComponent(resourceName)}`, { credentials: 'same-origin' })
      ));
      const payloads = await Promise.all(responses.map((response) => response.json().catch(() => ({}))));
      if (current !== requestId) return;
      if (responses.some((response) => response.status === 401)) {
        authenticated = false;
        error = 'La sesión administrativa terminó. Inicia sesión para continuar.';
        return;
      }
      const failedIndex = responses.findIndex((response, index) => !response.ok || payloads[index].error);
      if (failedIndex !== -1) throw new Error(payloads[failedIndex].error || 'No se pudo cargar la información.');
      rows = name === 'agenda'
        ? [
            ...(Array.isArray(payloads[0].rows) ? payloads[0].rows.map((row: Row) => ({ ...row, __agenda_tipo: 'Cita' })) : []),
            ...(Array.isArray(payloads[1].rows) ? payloads[1].rows.map((row: Row) => ({ ...row, __agenda_tipo: 'Bloqueo' })) : [])
          ]
        : Array.isArray(payloads[0].rows) ? payloads[0].rows : [];
      if (payloads[0].role) role = payloads[0].role;
    } catch (reason) {
      if (current === requestId) error = reason instanceof Error ? reason.message : 'Ocurrió un error al cargar los datos.';
    } finally {
      if (current === requestId) loading = false;
    }
  }

  function openForm(resourceName: string, row: Row = {}) {
    modal = resourceName;
    modalRow = row;
    form = { ...row };
    for (const key of ['fecha', 'vigente_desde']) {
      if (typeof form[key] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(form[key] as string))
        form[key] = (form[key] as string).slice(0, 10);
    }
    for (const key of ['hora_inicio', 'hora_fin']) {
      if (typeof form[key] === 'string') form[key] = (form[key] as string).slice(0, 5);
    }
    if (resourceName === 'colaboradores' || resourceName === 'servicios' || resourceName === 'fuentes') {
      if (form.activo === undefined) form.activo = resourceName !== 'fuentes';
    }
    if(resourceName==='fuentes')form.fuente_inactiva=row.estado_documental==='INACTIVA';
    error = '';
    notice = '';
    if (resourceName === 'fuentes' && !categoryOptionsLoaded) void loadCategoryOptions();
  }

  function openAction(actionName: string, row: Row = {}) {
    modal = actionName;
    modalRow = row;
    form = { resultado: '', observaciones: '', recibio_atencion: true, calificacion: '', resolucion: '', comentario: '' };
    if (actionName === 'attendance') {
      form.inicio_real = '';
      form.fin_real = '';
    }
    error = '';
    notice = '';
  }

  async function loadCategoryOptions() {
    categoryLoading = true;
    categoryError = '';
    try {
      const response = await fetch(`${mode === 'demo' ? '/api/demo' : '/api/rh'}/servicios`, { credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) authenticated = false;
      if (!response.ok || payload.error) throw new Error(payload.error || 'No se pudo consultar el catálogo de servicios.');
      const values = new Map<string, string>();
      for (const row of (Array.isArray(payload.rows) ? payload.rows : []) as Row[]) {
        const category = typeof row.categoria === 'string' ? row.categoria.trim() : '';
        const subcategory = typeof row.subcategoria === 'string' ? row.subcategoria.trim() : '';
        if (category) values.set(category, `Categoría · ${category}`);
        if (subcategory && !values.has(subcategory)) values.set(subcategory, `Subcategoría · ${subcategory}`);
      }
      categoryOptions = [...values.entries()].map(([value, label]) => ({ value, label }));
      categoryOptionsLoaded = true;
      if (payload.role) role = payload.role;
    } catch (reason) {
      categoryError = reason instanceof Error ? reason.message : 'No se pudo consultar el catálogo.';
    } finally {
      categoryLoading = false;
    }
  }

  async function postAction(resourceName: string, action: string, data: Row) {
    busy = true;
    error = '';
    notice = '';
    try {
      const response = await fetch(`${mode === 'demo' ? '/api/demo' : '/api/rh'}/${encodeURIComponent(resourceName)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        authenticated = false;
        throw new Error('Tu sesión terminó. Inicia sesión de nuevo.');
      }
      if (!response.ok || payload.error || payload.ok !== true) throw new Error(payload.error || 'El servidor no confirmó el cambio. No se actualizó la vista.');
      modal = '';
      await loadResource(resource, true);
      notice = action === 'verify' ? 'Lectura Drive confirmada. Esta prueba no aprueba el documento como fuente institucional.' :
        action === 'check-export' ? `Lectura desde Replit confirmada. Identidad Drive: ${payload.row?.driveIdentity || 'no verificada'}. Permiso de edición Drive: ${payload.row?.driveCanEdit === true ? 'sí' : 'no confirmado'}. La identidad de Sheets es independiente; esta consulta no escribe.` :
        'Operación confirmada por el servidor.';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'No se pudo completar la operación.';
    } finally {
      busy = false;
    }
  }

  async function submitForm(event: SubmitEvent) {
    event.preventDefault();
    const clean: Row = modal === 'servicios'
      ? { id_servicio: form.id_servicio, activo: form.activo }
      : { ...form };
    for (const key of Object.keys(clean)) {
      if (typeof clean[key] === 'string') clean[key] = (clean[key] as string).trim();
    }
    if (modal === 'bloqueos') {
      await postAction('bloqueos', 'save', clean);
    } else {
      await postAction(modal, 'save', clean);
    }
  }

  async function runRowAction(action: string) {
    const idField: Record<string, string> = {
      tickets: 'id_ticket', citas: 'id_cita', bloqueos: 'id_bloqueo',
      fuentes: 'id_fuente', encuestas: 'id_encuesta'
    };
    const backendResource = resource === 'agenda' ? (modalRow.id_cita ? 'citas' : 'bloqueos') : resource;
    const key = idField[backendResource];
    const data: Row = key ? { [key]: modalRow[key] } : {};
    if (action === 'delete') {
      if (!confirm('¿Eliminar este bloqueo de agenda?')) return;
      await postAction('bloqueos', 'delete', data);
      modal = '';
      return;
    }
    if (action === 'verify') {
      await postAction('fuentes', 'verify', data);
      modal = '';
      return;
    }
    if (action === 'prepare') {
      await postAction('encuestas', 'prepare', data);
      modal = '';
      return;
    }
    if (action === 'close' || action === 'resolve') {
      await postAction('tickets', action, { ...data, resultado: String(form.resultado || '').trim() });
      return;
    }
    if (action === 'attendance') {
      await postAction('citas', action, {
        ...data,
        estado: form.estado,
        observaciones: String(form.observaciones || '').trim(),
        inicio_real: String(form.inicio_real || ''),
        fin_real: String(form.fin_real || '')
      });
      return;
    }
    if (action === 'respond') {
      await postAction('encuestas', action, {
        ...data,
        recibio_atencion: form.recibio_atencion === true || form.recibio_atencion === 'true',
        calificacion: form.calificacion ? Number(form.calificacion) : null,
        resolucion: form.resolucion || '',
        comentario: String(form.comentario || '').trim()
      });
    }
  }

  async function sendConversation(event: SubmitEvent) {
    event.preventDefault();
    const text = conversationText.trim();
    if (!text || conversationBusy) return;
    conversationBusy = true;
    conversationError = '';
    messages = [...messages, { from: 'persona', text }];
    conversationText = '';
    try {
      const response = await fetch('/api/demo/conversation', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, eventId: crypto.randomUUID() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.reply !== 'string' || !payload.reply.trim()) throw new Error(payload.error || 'No se recibió una respuesta válida del servicio.');
      messages = [...messages, { from: 'catarina', text: payload.reply }];
    } catch (reason) {
      conversationError = reason instanceof Error ? reason.message : 'No se pudo enviar el mensaje.';
    } finally {
      conversationBusy = false;
    }
  }

  async function resetConversation() {
    conversationBusy = true;
    conversationError = '';
    try {
      const response = await fetch('/api/demo/conversation', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error(payload.error || 'El servidor no confirmó el reinicio de la sesión.');
      messages = [];
      notice = 'Sesión de demostración reiniciada.';
    } catch (reason) {
      conversationError = reason instanceof Error ? reason.message : 'No se pudo reiniciar la sesión.';
    } finally {
      conversationBusy = false;
    }
  }

  async function logout() {
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      window.location.href = '/login';
    }
  }

  function formatValue(value: unknown, key = '') {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (key.includes('en') || key.includes('fecha') || key.includes('recibida') || key.includes('enviada') || key.includes('respondida') || key === 'inicio_programado' || key === 'fin_programado') {
      const raw = String(value);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : new Date(raw);
      if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'medium',
        timeStyle: String(value).includes(':') ? 'short' : undefined,
        timeZone: 'America/Mexico_City'
      }).format(date);
    }
    return String(value);
  }

  function columnsFor(items: Row[]) {
    const preferred: Record<string, string[]> = {
      dashboard: ['label', 'value', 'detail'],
      agenda: ['__agenda_tipo', 'inicio_programado', 'nombre', 'modalidad', 'estado', 'fecha', 'hora_inicio', 'hora_fin', 'motivo'],
      tickets: ['folio', 'nombre', 'centro', 'departamento', 'resumen', 'estado', 'creado_en'],
      citas: ['inicio_programado', 'nombre', 'modalidad', 'estado', 'observaciones'],
      bloqueos: ['fecha', 'hora_inicio', 'hora_fin', 'motivo'],
      colaboradores: ['id_colaborador', 'nombre', 'whatsapp', 'centro', 'departamento', 'puesto', 'activo'],
      servicios: ['id_servicio', 'categoria', 'subcategoria', 'activo'],
      fuentes: ['nombre', 'categoria', 'version', 'vigente_desde', 'estado_documental', 'aprobador'],
      consultas: ['fecha', 'pregunta_resumen', 'resultado', 'id_ticket'],
      voz: ['recibida_en', 'categoria', 'descripcion', 'estado'],
      encuestas: ['id_cita', 'estado_entrega', 'modo_entrega', 'enviada_en', 'recibio_atencion', 'calificacion', 'resolucion', 'comentario'],
      configuracion: ['label', 'value', 'detail']
    };
    if (!items.length) return preferred[resource] || [];
    const keys = Object.keys(items[0]);
    const chosen = (preferred[resource] || []).filter((key) => keys.includes(key));
    return [...chosen, ...keys.filter((key) => !chosen.includes(key))].slice(0, resource === 'voz' ? 4 : resource === 'encuestas' ? 9 : 7);
  }

  function labelFor(key: string) {
    const labels: Record<string, string> = {
      id_colaborador: 'ID', id_servicio: 'ID', id_ticket: 'Ticket', folio: 'Folio',
      nombre: 'Colaborador', whatsapp: 'WhatsApp', centro: 'Centro', departamento: 'Departamento',
      puesto: 'Puesto', categoria: 'Categoría', subcategoria: 'Subcategoría', activo: 'Activo',
      resumen: 'Resumen', estado: 'Estado', creado_en: 'Creado', inicio_programado: 'Inicio',
      modalidad: 'Modalidad', observaciones: 'Observaciones', fecha: 'Fecha', hora_inicio: 'Desde',
      hora_fin: 'Hasta', motivo: 'Motivo', version: 'Versión', vigente_desde: 'Vigente desde',
      url_drive: 'Enlace', pregunta_resumen: 'Pregunta', resultado: 'Resultado', recibida_en: 'Recibida',
      descripcion: 'Reporte', enviada_en: 'Enviada', id_cita: 'Cita', recibio_atencion: 'Recibió atención',
      calificacion: 'Calificación', resolucion: 'Resolución', comentario: 'Comentario', respondida_en: 'Respondida',
      label: 'Indicador', value: 'Valor', detail: 'Detalle', __agenda_tipo: 'Tipo'
    };
    return labels[key] || key.replaceAll('_', ' ');
  }

  $: currentColumns = columnsFor(visibleRows);
  $: uniqueCategories = [...new Set(rows.map((row) => String(row.categoria || row.subcategoria || '')).filter(Boolean))];
  $: uniqueCenters = [...new Set(rows.map((row) => String(row.centro || '')).filter(Boolean))];
  $: uniqueDepartments = [...new Set(rows.map((row) => String(row.departamento || '')).filter(Boolean))];

  function goTo(next: string) {
    window.location.href = `${mode === 'demo' ? '/demo' : '/panel'}?resource=${encodeURIComponent(next)}`;
  }

  function moveWeek(delta: number) {
    const date = new Date(`${weekOf}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta * 7);
    weekOf = date.toISOString().slice(0, 10);
  }

  function weekLabel() {
    const anchor = new Date(`${weekOf}T12:00:00Z`);
    const monday = new Date(anchor);
    monday.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const short = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' });
    return `${short.format(monday)} — ${short.format(sunday)}`;
  }

  function descriptionFor(name: string) {
    const descriptions: Record<string, string> = {
      agenda: 'Citas y disponibilidad de la única agenda institucional.',
      tickets: 'Contexto de atención, estado y resultado de cada solicitud.',
      colaboradores: 'Directorio mínimo para la atención de colaboradores.',
      servicios: 'Catálogo vigente de categorías y subcategorías.',
      fuentes: 'Biblioteca institucional, distinta del directorio de empleados. Registra Docs o PDF de texto en Drive, título, categoría, versión y vigencia. BORRADOR no responde consultas; solo el administrador aprueba tras comprobar lectura. INACTIVA deja de utilizarse. El aprobador se registra desde la sesión; leer no significa aprobar.',
      consultas: 'Preguntas recibidas y suficiencia de la respuesta documental.',
      voz: 'Buzón de recepción confidencial; lectura restringida a Gerencia de RH.',
      encuestas: 'Atención recibida, satisfacción y resolución son dimensiones separadas.',
      indicadores: 'Lectura operativa de métricas reportadas por el sistema.',
      configuracion: 'Integraciones y preparación del archivo mensual.'
    };
    return descriptions[name] || 'Información operativa de Catarina RH.';
  }
</script>

<svelte:head>
  <title>{viewTitle} · Catarina RH</title>
  <meta name="description" content="Espacio de trabajo de Recursos Humanos de Trainmex." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet" />
</svelte:head>

{#if mode === 'admin' && !authenticated}
  <main class="gate">
    <div class="gate-brand"><span class="brand-mark">C</span><span>CATARINA <i>RH</i></span></div>
    <div class="gate-card">
      <span class="eyebrow">ESPACIO ADMINISTRATIVO</span>
      <h1>{configured ? 'Tu sesión no está activa.' : 'Acceso administrativo pendiente.'}</h1>
      <p>{configured ? 'Inicia sesión con una cuenta autorizada de Recursos Humanos para continuar.' : 'La autenticación administrativa todavía no está configurada. No existe una cuenta universal de acceso.'}</p>
      {#if error}<p class="alert error" role="alert">{error}</p>{/if}
      {#if configured}
        <a class="button primary" href="/login">Ir al inicio de sesión <span aria-hidden="true">→</span></a>
      {:else}
        <div class="setup-note"><strong>Configuración segura</strong><span>Solicita a la persona administradora del proyecto configurar el acceso autorizado. No compartas contraseñas por este medio.</span></div>
      {/if}
      <a class="quiet-link" href="/">Volver a Catarina RH</a>
    </div>
    <span class="gate-foot">MANUFACTURAS TRAINMEX · USO INTERNO</span>
  </main>
{:else if mode === 'admin' && !ready}
  <main class="loading-gate"><div class="skeleton-line"></div><div class="skeleton-box"></div><span>Verificando acceso administrativo…</span></main>
{:else}
  <div class="workspace">
    <aside class="sidebar">
      <a class="brand" href="/" aria-label="Catarina RH, inicio"><span class="brand-mark">C</span><span>CATARINA <i>RH</i></span></a>
      <div class="workspace-tag"><span class="live-dot"></span>{mode === 'demo' ? 'ENTORNO DE PRUEBA' : 'RECURSOS HUMANOS'}</div>
      <nav aria-label="Navegación principal">
        {#each ['Inicio', 'Operación', 'Administración', 'Seguimiento', 'Sistema'] as group}
          <div class="nav-group">
            <p>{group}</p>
            {#each navItems.filter((item) => item.group === group && (item.id !== 'voz' || mode === 'demo' || role === 'gerente') && (!['usuarios','importar'].includes(item.id) || mode === 'admin' && principal)) as item}
              <a class:active={resource === item.id} href="{mode === 'demo' ? '/demo' : '/panel'}?resource={item.id}" on:click|preventDefault={() => goTo(item.id)}>
                <span class="nav-mark">{item.mark}</span><span>{item.label}</span>
                {#if item.id === 'voz'}<span class="restricted">RH</span>{/if}
              </a>
            {/each}
          </div>
        {/each}
      </nav>
      {#if mode === 'demo'}
        <div class="demo-card"><span class="demo-kicker">AISLADO Y FICTICIO</span><p>Este entorno no muestra registros reales de Trainmex.</p><a href="/demo?resource=simulacion" on:click|preventDefault={() => goTo('simulacion')}>Probar conversación <span>→</span></a></div>
      {:else}
        <div class="account-card"><div class="account-avatar">{(email || role || 'RH').slice(0, 2).toUpperCase()}</div><div><strong>{role === 'gerente' ? 'Gerente RH' : role === 'generalista' ? 'Generalista RH' : 'Recursos Humanos'}</strong><small>{email}</small></div><button type="button" aria-label="Cerrar sesión" on:click={logout}>Salir</button></div>
      {/if}
    </aside>
    <main class="main-area">
      <header class="topbar">
        <div class="breadcrumb"><a href="/">Trainmex</a><span>/</span><strong>{resource === 'simulacion' ? 'Simulación' : viewTitle}</strong></div>
        <div class="topbar-right">
          {#if mode === 'demo'}<span class="mode-pill"><span></span>DATOS FICTICIOS</span>{:else}<span class="role-pill">{role === 'gerente' ? 'Gerencia' : 'Generalista'}</span>{/if}
          <span class="date-stamp">{new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' }).format(new Date())}</span>
        </div>
      </header>
      <section class="content">
        {#if resource === 'importar'}
          <DirectoryImport authorized={mode === 'admin' && principal} onImported={() => { resource = 'colaboradores'; loadResource('colaboradores', true); }} />
        {:else if resource === 'usuarios'}
          {#if mode === 'admin' && principal}<AdminUsers authorized={true} />
          {:else}<p class="alert error">Acceso exclusivo del administrador principal.</p>{/if}
        {:else if resource === 'simulacion' && mode === 'demo'}
          <div class="page-heading">
            <div><span class="eyebrow">PRUEBA CONVERSACIONAL · SESIÓN FICTICIA</span><h1>Una conversación, sin tocar datos reales.</h1><p>Escribe como lo haría una persona colaboradora. Esta sesión es independiente del panel.</p></div>
            <button class="button secondary" type="button" on:click={resetConversation} disabled={conversationBusy}>Reiniciar sesión</button>
          </div>
          {#if notice}<div class="alert success" role="status">{notice}</div>{/if}
          <section class="conversation" aria-label="Simulación de conversación">
            <div class="conversation-head"><div class="catarina-avatar">C</div><div><strong>Catarina</strong><span>Recepción de Recursos Humanos · modo de prueba</span></div><span class="session-lock">SESIÓN AISLADA</span></div>
            <div class="thread" aria-live="polite">
              {#if messages.length === 0}<div class="thread-empty"><span class="thread-rule"></span><strong>La conversación empieza aquí.</strong><p>Prueba una consulta sobre nómina, políticas o una cita.</p></div>{/if}
              {#each messages as message}
                <div class:outgoing={message.from === 'persona'} class="bubble-row">
                  {#if message.from === 'catarina'}<span class="mini-mark">C</span>{/if}
                  <p class="bubble">{message.text}</p>
                  {#if message.from === 'persona'}<span class="you-mark">TÚ</span>{/if}
                </div>
              {/each}
              {#if conversationBusy}<div class="bubble-row"><span class="mini-mark">C</span><div class="typing"><i></i><i></i><i></i></div></div>{/if}
            </div>
            {#if conversationError}<p class="alert error" role="alert">{conversationError}</p>{/if}
            <form class="composer" on:submit={sendConversation}>
              <label class="sr-only" for="conversation-text">Mensaje para Catarina</label>
              <input id="conversation-text" bind:value={conversationText} placeholder="Escribe un mensaje para Catarina…" disabled={conversationBusy} />
              <button class="send-button" type="submit" disabled={conversationBusy || !conversationText.trim()}>Enviar <span aria-hidden="true">↗</span></button>
            </form>
            <p class="privacy-line">No envía mensajes a WhatsApp ni consulta documentos externos.</p>
          </section>
        {:else}
          <div class="page-heading">
            <div><span class="eyebrow">{resource === 'dashboard' ? 'CENTRO DE OPERACIÓN' : `CATARINA RH · ${resource.toUpperCase()}`}</span><h1>{resource === 'dashboard' ? 'Buen día. Aquí está RH.' : viewTitle}</h1><p>{resource === 'dashboard' ? 'Una vista clara de la atención y los pendientes de hoy.' : descriptionFor(resource)}</p></div>
            <div class="heading-actions">
              {#if resource === 'agenda'}
                <div class="view-switch"><button class:chosen={agendaView === 'week'} type="button" on:click={() => { agendaView = 'week'; filterDate = ''; }}>Semana</button><button class:chosen={agendaView === 'day'} type="button" on:click={() => { agendaView = 'day'; filterDate ||= todayInMexico(); }}>Día</button></div>
                {#if agendaView === 'week'}<div class="week-controls"><button type="button" aria-label="Semana anterior" on:click={() => moveWeek(-1)}>‹</button><span>{weekLabel()}</span><button type="button" aria-label="Semana siguiente" on:click={() => moveWeek(1)}>›</button></div>{/if}
                <button class="button primary" type="button" on:click={() => openForm('bloqueos')}><span aria-hidden="true">+</span>Agregar bloqueo</button>
              {/if}
              {#if ['colaboradores','fuentes','bloqueos'].includes(resource) && (resource !== 'fuentes' || mode === 'demo' || role === 'gerente')}<button class="button primary" type="button" on:click={() => openForm(resource)}><span aria-hidden="true">+</span>{resource === 'bloqueos' ? 'Agregar bloqueo' : `Agregar ${resource === 'colaboradores' ? 'colaborador' : 'fuente'}`}</button>{/if}
              {#if resource === 'colaboradores' && mode === 'admin' && principal}<a class="button secondary" href="/panel?resource=importar">Importar desde hoja o CSV</a>{/if}
              {#if resource === 'configuracion'}<label class="month-picker">Mes<input type="month" bind:value={period} /></label>{/if}
              <button class="icon-button" type="button" on:click={() => loadResource(resource, true)} aria-label="Actualizar datos" title="Actualizar datos">↻</button>
            </div>
          </div>
          {#if mode === 'demo'}<div class="demo-banner"><span class="banner-mark">i</span><span><strong>Demostración segura</strong> · datos ficticios servidos en un espacio aislado. No son registros laborales reales.</span></div>{/if}
          {#if notice}<div class="alert success" role="status">{notice}</div>{/if}
          {#if error}<div class="alert error" role="alert"><span>{error}</span><button type="button" on:click={() => loadResource(resource, true)}>Reintentar</button></div>{/if}
          {#if resource === 'dashboard'}
            <div class="welcome-strip"><div><span class="eyebrow">HOY EN RECURSOS HUMANOS</span><strong>Atención preparada. Información en orden.</strong><span>Los indicadores se consultan directamente desde el sistema.</span></div><div class="welcome-index"><span>VISTA</span><strong>01<span>/11</span></strong></div></div>
          {/if}
          {#if resource === 'indicadores'}
            <section class="insight-note"><span class="insight-mark">↗</span><div><strong>Indicadores operativos</strong><p>Los resultados se derivan de registros de atención disponibles. La lectura se actualiza al consultar el servicio; no se crean estadísticas paralelas.</p></div></section>
          {/if}
          {#if loading}
            <div class="skeleton-table" aria-label="Cargando información"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
          {:else}
            {#if resource !== 'dashboard' && resource !== 'configuracion' && resource !== 'indicadores'}
              <div class="filters">
                <label class="search-field"><span aria-hidden="true">⌕</span><span class="sr-only">Buscar</span><input bind:value={search} placeholder="Buscar en esta vista…" /></label>
                {#if resource === 'agenda' || resource === 'tickets' || resource === 'encuestas' || resource === 'consultas'}<label class="filter-select"><span class="sr-only">Fecha</span><input type="date" bind:value={filterDate} aria-label="Filtrar por fecha" /></label>{/if}
                {#if uniqueCategories.length}<label class="filter-select"><span class="sr-only">Categoría</span><select bind:value={filterCategory}><option value="">Todas las categorías</option>{#each uniqueCategories as item}<option value={item}>{item}</option>{/each}</select></label>{/if}
                {#if uniqueCenters.length}<label class="filter-select"><span class="sr-only">Centro</span><select bind:value={filterCenter}><option value="">Todos los centros</option>{#each uniqueCenters as item}<option value={item}>{item}</option>{/each}</select></label>{/if}
                {#if uniqueDepartments.length}<label class="filter-select"><span class="sr-only">Departamento</span><select bind:value={filterDepartment}><option value="">Todos los departamentos</option>{#each uniqueDepartments as item}<option value={item}>{item}</option>{/each}</select></label>{/if}
                <span class="result-count">{visibleRows.length} {visibleRows.length === 1 ? 'registro' : 'registros'}</span>
              </div>
            {/if}
            {#if resource === 'configuracion'}
              <section class="export-card">
                <div class="export-icon">EX</div><div class="export-copy"><span class="eyebrow">ARCHIVO HISTÓRICO</span><h2>Preparar exportación mensual</h2><p>Solicita la preparación de tickets ordinarios cerrados. Tu Voz queda fuera del archivo común. La integración con Google Sheets puede no estar habilitada todavía.</p></div>
                <button class="button secondary" type="button" disabled={busy || mode === 'demo' || role !== 'gerente'} on:click={() => postAction('configuracion', 'check-export', {})}>Verificar lectura Sheets</button>
                <button class="button primary" type="button" disabled={busy || !period || mode === 'admin' && role !== 'gerente'} on:click={() => postAction('configuracion', 'export', { month: period })}>{busy ? 'Preparando…' : `Preparar ${period}`}</button>
              </section>
              <section class="integration-status" aria-label="Estado de integraciones de salida">
                <div class="integration-head"><span class="eyebrow">CANALES Y CONECTORES</span><span>ESTADO DE ESTA VISTA</span></div>
                <div><strong>WhatsApp</strong><span>Sin mensajes salientes desde este panel</span><b>DESACTIVADO</b></div>
                <div><strong>Google Drive</strong><span>{mode === 'demo' ? 'La demostración no consulta documentos reales de Drive' : 'Verificación explícita de fuentes; permisos y vigencia requeridos'}</span><b>{mode === 'demo' ? 'DEMO · SIN CONEXIÓN REAL' : 'VERIFICABLE'}</b></div>
                <div><strong>Google Sheets</strong><span>La preparación requiere que el conector esté disponible</span><b>SUJETO A CONFIGURACIÓN</b></div>
              </section>
            {/if}
            {#if visibleRows.length}
              {#if resource === 'dashboard'}
                <div class="metric-grid">
                  {#each visibleRows.slice(0, 6) as row, index}
                    <article class:metric-featured={index === 0} class="metric-card"><div class="metric-top"><span>{String(row.label || 'Indicador')}</span><span class="metric-index">0{index + 1}</span></div><strong>{formatValue(row.value)}</strong><p>{formatValue(row.detail) === '—' ? 'Dato actualizado desde el sistema' : formatValue(row.detail)}</p><span class="metric-rule"></span></article>
                  {/each}
                </div>
                <div class="section-heading"><div><span class="eyebrow">LECTURA DETALLADA</span><h2>Actividad disponible</h2></div><span class="small-tag">DATOS DEL SERVIDOR</span></div>
              {/if}
              {#if resource === 'agenda'}
                <div class="agenda-summary"><div><span class="summary-label">{agendaView === 'day' ? 'DÍA SELECCIONADO' : 'AGENDA INSTITUCIONAL'}</span><strong>{agendaView === 'day' && filterDate ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'America/Mexico_City' }).format(new Date(`${filterDate}T12:00:00Z`)) : agendaView === 'week' ? `Semana del ${weekLabel()}` : 'Citas y bloqueos'}</strong></div><span class="schedule-note">Zona operativa · Ciudad de México</span></div>
              {/if}
              <div class="table-card">
                <div class="table-head"><div><span class="eyebrow">{resource === 'dashboard' ? 'DETALLE' : 'REGISTROS'}</span><strong>{visibleRows.length} {visibleRows.length === 1 ? 'resultado' : 'resultados'}</strong></div><span class="table-origin">{mode === 'demo' ? 'DEMO' : 'NEON'} · EN VIVO</span></div>
                <div class="table-scroll"><table><thead><tr>{#each currentColumns as key}<th>{labelFor(key)}</th>{/each}<th class="actions-col">Acciones</th></tr></thead>
                  <tbody>{#each visibleRows as row}<tr>
                    {#each currentColumns as key}<td>
                      {#if key === 'estado'}<span class="status-badge" class:status-good={String(row[key]).toLowerCase().includes('realiz') || String(row[key]).toLowerCase().includes('resuelt')} class:status-wait={String(row[key]).toLowerCase().includes('pend') || String(row[key]).toLowerCase().includes('program')} class:status-muted={String(row[key]).toLowerCase().includes('cerr')}><i></i>{formatValue(row[key], key)}</span>
                      {:else if key === 'url_drive' && row[key]}<a class="table-link" href={String(row[key])} target="_blank" rel="noreferrer">Abrir fuente ↗</a>
                      {:else if key === 'activo'}<span class:enabled={Boolean(row[key])} class:disabled-state={!Boolean(row[key])} class="active-state">{Boolean(row[key]) ? 'Activo' : 'Inactivo'}</span>
                      {:else}<span class:clamp-text={['resumen','descripcion','comentario','pregunta_resumen','detail'].includes(key)}>{formatValue(row[key], key)}</span>{/if}
                    </td>{/each}
                    <td class="row-actions">
                      {#if resource === 'colaboradores' || (resource === 'servicios' || resource === 'fuentes') && (mode === 'demo' || role === 'gerente')}<button class="text-action" type="button" on:click={() => openForm(resource, row)}>{resource === 'servicios' ? 'Estado' : 'Editar'}</button>{/if}
                      {#if resource === 'tickets'}<button class="text-action" type="button" on:click={() => { modal = 'detail'; modalRow = row; }}>Ver detalle</button>{#if !String(row.estado || '').toLowerCase().includes('resuelt') && !String(row.estado || '').toLowerCase().includes('cerr') }<button class="text-action" type="button" on:click={() => openAction('close', row)}>Cerrar</button><button class="text-action resolve-action" type="button" on:click={() => openAction('resolve', row)}>Resolver</button>{/if}{/if}
                      {#if (resource === 'citas' || resource === 'agenda' && row.id_cita) && !['REALIZADA','NO_ASISTIO'].includes(String(row.estado || '').toUpperCase())}<button class="text-action" type="button" on:click={() => openAction('attendance', row)}>Registrar atención</button>{/if}
                      {#if resource === 'bloqueos' || resource === 'agenda' && row.id_bloqueo}<button class="text-action" type="button" on:click={() => openForm('bloqueos', row)}>Editar</button><button class="text-action danger-action" type="button" on:click={() => { modalRow = row; runRowAction('delete'); }}>Eliminar</button>{/if}
                      {#if resource === 'fuentes'}<button class="text-action" type="button" on:click={() => { modalRow = row; runRowAction('verify'); }}>Verificar</button>{/if}
                      {#if resource === 'encuestas'}<button class="text-action" type="button" on:click={() => { modalRow = row; runRowAction('prepare'); }}>Preparar</button><button class="text-action" type="button" on:click={() => openAction('respond', row)}>Registrar respuesta</button>{/if}
                      {#if resource === 'voz'}<span class="read-only">Solo lectura</span>{/if}
                    </td>
                  </tr>{/each}</tbody>
                </table></div>
              </div>
              {#if resource === 'encuestas'}<p class="policy-caption">La encuesta diferencia atención recibida, satisfacción y resolución. Preparar no envía mensajes al colaborador.</p>{/if}
              {#if resource === 'voz'}<p class="policy-caption">Acceso restringido a Gerencia de RH. Recepción informativa únicamente: no se realiza seguimiento ni se emiten conclusiones desde este espacio.</p>{/if}
            {:else if !loading && !error}
              <div class="empty-state"><div class="empty-mark">{resource === 'agenda' ? 'AG' : resource === 'tickets' ? 'TK' : 'RH'}</div><span class="eyebrow">{search || filterDate || filterCategory || filterCenter || filterDepartment ? 'SIN COINCIDENCIAS' : 'SIN REGISTROS DISPONIBLES'}</span><h2>{search || filterDate || filterCategory || filterCenter || filterDepartment ? 'Prueba con otros filtros.' : resource === 'fuentes' ? 'Aún no hay fuentes autorizadas.' : 'Esta vista está lista para recibir datos.'}</h2><p>{search || filterDate || filterCategory || filterCenter || filterDepartment ? 'Ajusta la búsqueda o elimina uno de los filtros.' : resource === 'fuentes' ? 'Hasta que RH registre una referencia documental autorizada, las respuestas de políticas y procedimientos no deben presentarse como documentadas.' : 'No hay registros que mostrar en este momento. La interfaz no inventa información para llenar el espacio.'}</p>{#if search || filterDate || filterCategory || filterCenter || filterDepartment}<button class="text-action" type="button" on:click={() => { search = ''; filterDate = ''; filterCategory = ''; filterCenter = ''; filterDepartment = ''; }}>Limpiar filtros</button>{/if}</div>
            {/if}
          {/if}
          {#if resource === 'dashboard' && !loading && visibleRows.length}
            <div class="quick-links"><a href="/{mode === 'demo' ? 'demo' : 'panel'}?resource=agenda" on:click|preventDefault={() => goTo('agenda')}><span>01</span><strong>Revisar agenda</strong><i>→</i></a><a href="/{mode === 'demo' ? 'demo' : 'panel'}?resource=tickets" on:click|preventDefault={() => goTo('tickets')}><span>02</span><strong>Ver tickets abiertos</strong><i>→</i></a><a href="/{mode === 'demo' ? 'demo' : 'panel'}?resource=indicadores" on:click|preventDefault={() => goTo('indicadores')}><span>03</span><strong>Consultar indicadores</strong><i>→</i></a></div>
          {/if}
        {/if}
        <footer class="workspace-footer"><span>CATARINA RH <i>/</i> MANUFACTURAS TRAINMEX</span><span>{mode === 'demo' ? 'ENTORNO FICTICIO · SIN DATOS REALES' : 'ESPACIO ADMINISTRATIVO · ACCESO AUTORIZADO'}</span></footer>
      </section>
    </main>
  </div>
{/if}

{#if modal}
  <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) modal = ''; }} on:keydown={(event) => event.key === 'Escape' && (modal = '')}>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
      <div class="modal-head"><div><span class="eyebrow">CATARINA RH · ACCIÓN</span><h2 id="modal-title">{modal === 'detail' ? 'Detalle del ticket' : modal === 'close' ? 'Cerrar ticket' : modal === 'resolve' ? 'Registrar resolución' : modal === 'attendance' ? 'Registrar asistencia' : modal === 'respond' ? 'Registrar respuesta' : modal === 'bloqueos' ? (modalRow.id_bloqueo ? 'Editar bloqueo' : 'Nuevo bloqueo') : `${modalRow.id_colaborador || modalRow.id_servicio || modalRow.id_fuente ? 'Editar' : 'Agregar'} ${modal === 'colaboradores' ? 'colaborador' : modal === 'servicios' ? 'servicio' : modal === 'fuentes' ? 'fuente' : 'registro'}`}</h2></div><button class="close-button" type="button" aria-label="Cerrar" on:click={() => modal = ''}>×</button></div>
      {#if error}<div class="alert error modal-error" role="alert">{error}</div>{/if}
      {#if modal === 'detail'}
        <div class="ticket-detail"><p class="modal-intro">Información recibida del servicio de Recursos Humanos.</p>{#each Object.entries(modalRow) as [key, value]}<div><span>{labelFor(key)}</span><strong>{formatValue(value, key)}</strong></div>{/each}<div class="modal-actions"><button class="button secondary" type="button" on:click={() => modal = ''}>Cerrar detalle</button></div></div>
      {:else if modal === 'close' || modal === 'resolve'}
        <form on:submit|preventDefault={() => runRowAction(modal)}>
          <p class="modal-intro">{modal === 'resolve' ? 'Registrar resolución es una decisión explícita de Recursos Humanos y no equivale a marcar la cita como realizada.' : 'El cierre conserva la diferencia entre un ticket cerrado y un asunto resuelto.'}</p>
          <label class="form-field"><span>Resultado <em>Obligatorio</em></span><textarea bind:value={form.resultado} rows="4" required placeholder="Describe brevemente el resultado registrado por RH"></textarea></label>
          <div class="modal-actions"><button class="button secondary" type="button" on:click={() => modal = ''}>Cancelar</button><button class="button primary" type="submit" disabled={busy || !String(form.resultado || '').trim()}>{busy ? 'Guardando…' : modal === 'resolve' ? 'Registrar resolución' : 'Cerrar ticket'}</button></div>
        </form>
      {:else if modal === 'attendance'}
        <form on:submit|preventDefault={() => runRowAction('attendance')}>
          <p class="modal-intro">La atención realizada y la resolución del ticket son hechos distintos. Registra únicamente lo ocurrido.</p>
          <label class="form-field"><span>Resultado de la cita</span><select bind:value={form.estado} required><option value="">Selecciona una opción</option><option value="REALIZADA">Realizada</option><option value="NO_ASISTIO">No asistió</option></select></label>
          <label class="form-field"><span>Inicio real · America/Mexico_City · opcional</span><input type="datetime-local" bind:value={form.inicio_real} /><small>Se envía tal cual se captura; no se completa con la hora programada.</small></label>
          <label class="form-field"><span>Fin real · America/Mexico_City · opcional</span><input type="datetime-local" bind:value={form.fin_real} /><small>Si se deja vacío, se envía vacío. El servidor interpreta la hora como Ciudad de México.</small></label>
          <label class="form-field"><span>Observaciones</span><textarea bind:value={form.observaciones} rows="3" placeholder="Nota operativa opcional"></textarea></label>
          <div class="modal-actions"><button class="button secondary" type="button" on:click={() => modal = ''}>Cancelar</button><button class="button primary" type="submit" disabled={busy || !form.estado}>{busy ? 'Guardando…' : 'Guardar asistencia'}</button></div>
        </form>
      {:else if modal === 'respond'}
        <form on:submit|preventDefault={() => runRowAction('respond')}>
          <p class="modal-intro">Registra por separado si recibió atención y qué tan resuelto quedó el asunto.</p>
          <label class="form-field"><span>¿Recibió atención?</span><select bind:value={form.recibio_atencion}><option value={true}>Sí</option><option value={false}>No</option></select></label>
          {#if form.recibio_atencion === true || form.recibio_atencion === 'true'}
            <label class="form-field"><span>Calificación de atención · 1 a 5</span><select bind:value={form.calificacion} required><option value="">Selecciona</option>{#each [1,2,3,4,5] as score}<option value={score}>{score}</option>{/each}</select></label>
          {/if}
          {#if form.recibio_atencion === true || form.recibio_atencion === 'true'}
            <label class="form-field"><span>Resolución</span><select bind:value={form.resolucion} required><option value="">Selecciona</option><option value="Sí">Sí</option><option value="Parcialmente">Parcialmente</option><option value="No">No</option></select></label>
          {:else}
            <p class="modal-intro">No recibió atención: no se exige calificación ni se interpreta como «no resuelto».</p>
          {/if}
          <label class="form-field"><span>Comentario opcional</span><textarea bind:value={form.comentario} rows="3"></textarea></label>
          <div class="modal-actions"><button class="button secondary" type="button" on:click={() => modal = ''}>Cancelar</button><button class="button primary" type="submit" disabled={busy || ((form.recibio_atencion === true || form.recibio_atencion === 'true') && (!form.calificacion || !form.resolucion))}>{busy ? 'Guardando…' : 'Guardar respuesta'}</button></div>
        </form>
      {:else}
        <form on:submit={submitForm}>
          <p class="modal-intro">{modal === 'fuentes' ? 'Registra una fuente en borrador (sin aprobar), su versión y vigencia. Verificar solo comprueba lectura de Drive; no aprueba contenido. Solo el Gerente debe marcarla aprobada tras revisar el documento. No se modifica Drive.' : modal === 'bloqueos' ? 'Registra un bloqueo parcial o completo en la agenda institucional.' : modal === 'servicios' ? 'El catálogo conserva sus nombres y categorías. Desde aquí solo se activa o desactiva un servicio existente.' : 'Actualiza la información operativa del registro.'}</p>
          {#each fields[modal] || [] as field}
            {#if field.type === 'checkbox'}<label class="check-field"><input type="checkbox" checked={Boolean(form[field.key])} on:change={(event) => form[field.key] = (event.currentTarget as HTMLInputElement).checked} /><span>{field.label}</span></label>
            {:else if field.type === 'catalog'}
              <label class="form-field"><span>{field.label} <em>Obligatorio</em></span>
                <select bind:value={form.categoria} required disabled={categoryLoading || Boolean(categoryError)}>
                  <option value="">Selecciona una categoría o subcategoría</option>
                  {#if form.categoria && !categoryOptions.some((option) => option.value === form.categoria)}<option value={String(form.categoria)}>Valor actual · {String(form.categoria)}</option>{/if}
                  {#each categoryOptions as option}<option value={option.value}>{option.label}</option>{/each}
                </select>
                {#if categoryLoading}<small>Consultando catálogo de servicios…</small>{/if}
                {#if categoryError}<span class="field-error" role="alert">{categoryError} <button type="button" on:click={loadCategoryOptions}>Reintentar</button></span>{/if}
                {#if !categoryLoading && !categoryError && categoryOptionsLoaded && categoryOptions.length === 0}<span class="field-error">El catálogo no devuelve categorías disponibles. Reintenta o solicita una revisión de Servicios.<button type="button" on:click={() => { categoryOptionsLoaded = false; loadCategoryOptions(); }}>Reintentar</button></span>{/if}
              </label>
            {:else}<label class="form-field"><span>{field.label}{#if ['id_colaborador','nombre','id_servicio','categoria','subcategoria','fecha','hora_inicio','hora_fin','motivo'].includes(field.key)} <em>Obligatorio</em>{/if}</span><input type={field.type || 'text'} bind:value={form[field.key]} readonly={(field.key === 'id_servicio' && Boolean(modalRow.id_servicio)) || (field.key === 'id_colaborador' && Boolean(modalRow.id_colaborador))} required={['id_colaborador','nombre','id_servicio','categoria','subcategoria','fecha','hora_inicio','hora_fin','motivo'].includes(field.key)} /></label>{/if}
          {/each}
          <div class="modal-actions"><button class="button secondary" type="button" on:click={() => modal = ''}>Cancelar</button><button class="button primary" type="submit" disabled={busy || (modal === 'fuentes' && (!form.categoria || categoryLoading || Boolean(categoryError)))}>{busy ? 'Guardando…' : 'Guardar cambios'}</button></div>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0;min-width:320px;background:#f3f4ee;color:#183b39;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
  :global(button),:global(input),:global(select),:global(textarea){font:inherit}
  :global(button:focus-visible),:global(a:focus-visible),:global(input:focus-visible),:global(select:focus-visible),:global(textarea:focus-visible){outline:3px solid #d5795f;outline-offset:2px}
  :global(::selection){background:#d8e7d8;color:#173b37}
  .workspace{min-height:100dvh;display:grid;grid-template-columns:252px minmax(0,1fr);background:#f6f6f1}
  .sidebar{position:sticky;top:0;height:100dvh;display:flex;flex-direction:column;padding:26px 17px 18px;background:#173b39;color:#e8efe8;overflow-y:auto}
  .brand{display:flex;align-items:center;gap:11px;color:#f2f3ec;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:.13em;padding:0 9px}
  .brand i,.gate-brand i{font-style:normal;color:#a9beb1;font-weight:500}
  .brand-mark{display:grid;place-items:center;width:34px;height:34px;background:#df785d;color:#183b39;border-radius:11px 11px 11px 3px;font:600 20px 'Fraunces',serif;letter-spacing:0}
  .workspace-tag{display:flex;align-items:center;gap:9px;margin:31px 8px 20px;padding:10px 11px;background:#244945;border:1px solid #335b55;border-radius:7px;color:#b4c5ba;font:10px 'DM Mono',monospace;letter-spacing:.045em}
  .live-dot{width:7px;height:7px;border-radius:50%;background:#d6a65b;box-shadow:0 0 0 3px #375a4f}
  nav{overflow:auto;scrollbar-width:thin}
  .nav-group{margin-bottom:15px}
  .nav-group>p{margin:0 0 5px 10px;color:#829f93;font:9px 'DM Mono',monospace;letter-spacing:.16em;text-transform:uppercase}
  .nav-group>a{position:relative;display:flex;align-items:center;gap:11px;min-height:36px;margin:2px 0;padding:7px 10px;border-radius:6px;text-decoration:none;color:#cfdbd2;font-size:12px;transition:background .18s ease,color .18s ease,transform .18s ease}
  .nav-group>a:hover{background:#244945;color:#fff;transform:translateX(2px)}
  .nav-group>a.active{background:#e5e9de;color:#183b39;font-weight:700}
  .nav-mark{width:21px;color:#90a89d;font:9px 'DM Mono',monospace}
  .active .nav-mark{color:#cc6d56}
  .restricted{margin-left:auto;color:#dd9a7e;font:9px 'DM Mono',monospace}
  .demo-card{margin-top:auto;padding:15px 13px;background:#204542;border:1px solid #376059;border-radius:8px}
  .demo-kicker{color:#e5a28a;font:9px 'DM Mono',monospace;letter-spacing:.12em}
  .demo-card p{margin:8px 0 13px;color:#c0d0c3;font-size:11px;line-height:1.5}
  .demo-card a{color:#f2e6d3;font-size:11px;font-weight:700;text-decoration:none}.demo-card a span{margin-left:7px}
  .account-card{display:flex;align-items:center;gap:9px;margin-top:auto;padding:12px 6px 0;border-top:1px solid #31524d}
  .account-avatar{display:grid;place-items:center;width:31px;height:31px;border-radius:50%;background:#d2ddd0;color:#24514a;font:11px 'DM Mono',monospace}
  .account-card div:nth-child(2){min-width:0;display:grid;gap:3px;flex:1}.account-card strong{font-size:10px}.account-card small{max-width:116px;overflow:hidden;text-overflow:ellipsis;color:#9bb1a5;font-size:9px}
  .account-card button{padding:6px;border:0;background:none;color:#e3aa91;font-size:10px;cursor:pointer}
  .main-area{min-width:0}
  .topbar{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(20px,4vw,58px);border-bottom:1px solid #e3e5dc;background:#f8f8f3}
  .breadcrumb{display:flex;align-items:center;gap:10px;color:#9aaba1;font-size:11px}.breadcrumb a{color:#748c80;text-decoration:none}.breadcrumb strong{color:#294c47;font-weight:600}
  .topbar-right{display:flex;align-items:center;gap:17px}.mode-pill,.role-pill{display:flex;align-items:center;gap:7px;padding:6px 9px;border-radius:4px;background:#f5eadb;color:#835a3c;font:9px 'DM Mono',monospace;letter-spacing:.04em}.mode-pill span{width:6px;height:6px;border-radius:50%;background:#d08259}.role-pill{background:#e3ede3;color:#406651}
  .date-stamp{color:#82948a;font:10px 'DM Mono',monospace;text-transform:capitalize}
  .content{width:min(100%,1480px);margin:auto;padding:38px clamp(20px,4vw,58px) 20px}
  .page-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin:0 0 26px}
  .eyebrow{display:block;color:#718d80;font:10px 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase}
  h1{margin:9px 0 8px;color:#183b39;font:500 clamp(29px,3.5vw,43px)/1.12 'Fraunces',serif;letter-spacing:-.035em}
  .page-heading p{margin:0;max-width:600px;color:#718179;font-size:13px;line-height:1.65}
  .heading-actions{display:flex;align-items:center;gap:9px;flex-shrink:0}
  .button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:39px;padding:0 15px;border-radius:5px;text-decoration:none;font-size:11px;font-weight:700;cursor:pointer;transition:background .18s ease,transform .18s ease,border-color .18s ease}
  .button:hover:not(:disabled){transform:translateY(-1px)}.button:disabled{opacity:.56;cursor:not-allowed}
  .primary{border:1px solid #244e47;background:#244e47;color:#f6f2e7}.primary:hover:not(:disabled){background:#193d38}
  .secondary{border:1px solid #d9dfd6;background:#fbfbf7;color:#3e5b50}.secondary:hover:not(:disabled){border-color:#9eb3a1}
  .button.primary>span{font-size:17px;font-weight:400}
  .icon-button{display:grid;place-items:center;width:38px;height:38px;border:1px solid #dfe3da;border-radius:5px;background:transparent;color:#557267;font-size:20px;cursor:pointer;transition:transform .3s}.icon-button:hover{transform:rotate(35deg)}
  .view-switch{display:flex;padding:3px;border:1px solid #dfe3da;border-radius:5px}.view-switch button{padding:6px 9px;border:0;border-radius:3px;background:none;color:#73857c;font-size:10px;cursor:pointer}.view-switch button.chosen{background:#244e47;color:#fff}
  .week-controls{display:flex;align-items:center;gap:5px;padding:3px;border:1px solid #dfe3da;border-radius:5px;color:#708379;font:9px 'DM Mono',monospace}.week-controls button{width:23px;height:24px;border:0;border-radius:3px;background:transparent;color:#4c7463;font-size:16px;cursor:pointer}.week-controls button:hover{background:#e7ede5}
  .month-picker{display:flex;align-items:center;gap:8px;color:#718179;font-size:10px}.month-picker input{height:35px;border:1px solid #dfe3da;border-radius:4px;padding:0 8px;background:#fbfbf7;color:#284b43}
  .demo-banner{display:flex;align-items:center;gap:11px;margin:-6px 0 23px;padding:11px 14px;border:1px solid #eee0c4;border-radius:5px;background:#fcf7e9;color:#756a4c;font-size:10px;line-height:1.5}
  .demo-banner strong{color:#645b40}.banner-mark{display:grid;place-items:center;flex:0 0 20px;height:20px;border:1px solid #c8a956;border-radius:50%;font:11px 'DM Mono',monospace;color:#8c7741}
  .welcome-strip{display:flex;justify-content:space-between;align-items:center;margin:0 0 18px;padding:20px 23px;border-radius:8px;background:#e5ebe1;border-left:3px solid #d47b5d}
  .welcome-strip>div:first-child{display:grid;gap:7px}.welcome-strip strong{color:#294b42;font:500 20px 'Fraunces',serif}.welcome-strip>div:first-child>span:last-child{color:#738378;font-size:11px}
  .welcome-index{display:grid;gap:4px;text-align:right}.welcome-index span{color:#84968a;font:9px 'DM Mono',monospace;letter-spacing:.12em}.welcome-index strong{font:16px 'DM Mono',monospace}.welcome-index strong span{color:#9bac9f;font-size:11px}
  .metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px;margin-bottom:34px}
  .metric-card{position:relative;min-height:144px;padding:16px 17px 19px;border:1px solid #e3e6dc;border-radius:7px;background:#fbfbf7;overflow:hidden;transition:transform .2s ease,border-color .2s ease}
  .metric-card:hover{transform:translateY(-2px);border-color:#c3d2c4}.metric-card.metric-featured{background:#264d45;color:#f2f3e9;border-color:#264d45}
  .metric-top{display:flex;align-items:center;justify-content:space-between;color:#6f8277;font-size:11px}.metric-featured .metric-top{color:#bdcfc0}.metric-index{font:9px 'DM Mono',monospace;color:#a0b1a5}
  .metric-card>strong{display:block;margin:17px 0 6px;color:#23473f;font:500 31px 'Fraunces',serif;font-variant-numeric:tabular-nums}.metric-featured>strong{color:#f3eddb}
  .metric-card>p{margin:0;color:#829087;font-size:10px;line-height:1.45}.metric-featured>p{color:#c2d0c2}.metric-rule{position:absolute;left:17px;right:17px;bottom:0;height:3px;background:#d4dfd3}.metric-featured .metric-rule{background:#dd8666}
  .section-heading{display:flex;justify-content:space-between;align-items:end;margin:0 0 12px}.section-heading h2{margin:7px 0 0;font:500 22px 'Fraunces',serif}.small-tag{color:#93a398;font:9px 'DM Mono',monospace;letter-spacing:.08em}
  .filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 13px}
  .search-field{display:flex;align-items:center;gap:8px;min-width:205px;height:36px;padding:0 10px;border:1px solid #e0e4db;border-radius:4px;background:#fbfbf7;color:#8ba095}
  .search-field>span:first-child{font-size:20px;line-height:1}.search-field input{width:100%;border:0;outline:none;background:transparent;color:#294b43;font-size:10px}.search-field input::placeholder{color:#9ca99f}
  .filter-select select,.filter-select input{height:36px;max-width:180px;padding:0 9px;border:1px solid #e0e4db;border-radius:4px;background:#fbfbf7;color:#64776d;font-size:10px}
  .result-count{margin-left:auto;color:#9aa89f;font:9px 'DM Mono',monospace}
  .table-card{border:1px solid #e1e5dc;border-radius:7px;background:#fbfbf8;overflow:hidden}
  .table-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #e7e9e2}
  .table-head>div{display:flex;align-items:center;gap:13px}.table-head strong{color:#36564b;font-size:11px;font-weight:600}.table-origin{color:#a0aca3;font:9px 'DM Mono',monospace;letter-spacing:.08em}
  .table-scroll{overflow:auto;max-width:100%}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{padding:11px 13px;background:#f4f5ef;color:#829188;font:9px 'DM Mono',monospace;letter-spacing:.07em;text-transform:uppercase}td{max-width:260px;padding:12px 13px;border-top:1px solid #edf0e9;color:#53695f;font-size:10px;vertical-align:middle}td:first-child{color:#294b43;font-weight:600}tbody tr{transition:background .15s}tbody tr:hover{background:#f6f7f1}
  .actions-col{width:130px}.row-actions{display:flex;align-items:center;gap:9px;min-width:130px}
  .text-action{padding:3px 0;border:0;background:none;color:#3b7663;font-size:10px;font-weight:700;white-space:nowrap;cursor:pointer}.text-action:hover{text-decoration:underline;text-underline-offset:3px}.resolve-action{color:#bd684f}.danger-action{color:#a45444}.read-only{color:#91a096;font-size:9px}
  .status-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:3px;background:#eff1e9;color:#6b7c70;font-size:9px}.status-badge i{width:5px;height:5px;border-radius:50%;background:#9aa69b}.status-good{background:#e9f1e8;color:#4d7859}.status-good i{background:#5f9b6a}.status-wait{background:#f8f0df;color:#937443}.status-wait i{background:#c39b4f}.status-muted{background:#f1ece7;color:#8b7667}
  .active-state{font-size:9px}.active-state.enabled{color:#52805e}.active-state.disabled-state{color:#a27464}
  .clamp-text{display:inline-block;max-width:260px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}
  .table-link{color:#477966;font-size:10px;text-decoration:none}.table-link:hover{text-decoration:underline}
  .agenda-summary{display:flex;align-items:center;justify-content:space-between;margin:0 0 13px;padding:14px 16px;border:1px solid #e1e5dc;border-radius:6px;background:#edf1e9}.agenda-summary>div{display:grid;gap:5px}.summary-label{color:#829488;font:9px 'DM Mono',monospace;letter-spacing:.1em}.agenda-summary strong{color:#34574b;font:500 17px 'Fraunces',serif;text-transform:capitalize}.schedule-note{color:#84958b;font-size:10px}
  .insight-note{display:flex;gap:13px;margin:0 0 19px;padding:15px 17px;border-left:2px solid #d37b60;background:#eef1e8}.insight-mark{color:#c77356;font-size:18px}.insight-note strong{color:#385c4e;font-size:12px}.insight-note p{margin:4px 0 0;color:#77877b;font-size:10px;line-height:1.55}
  .export-card{display:flex;align-items:center;gap:17px;margin:0 0 23px;padding:19px;border:1px solid #e1e5dc;border-radius:7px;background:#fbfbf8}.export-icon{display:grid;place-items:center;flex:0 0 45px;height:45px;border-radius:5px;background:#e7eee5;color:#46745c;font:11px 'DM Mono',monospace}.export-copy{flex:1}.export-copy h2{margin:6px 0;color:#294b43;font:500 20px 'Fraunces',serif}.export-copy p{max-width:670px;margin:0;color:#77867d;font-size:10px;line-height:1.6}
  .integration-status{margin:0 0 24px;padding:14px 16px;border:1px solid #e2e6dd;border-radius:6px;background:#f5f6f0}.integration-head{display:flex;justify-content:space-between;padding-bottom:10px;color:#a0aca3;font:8px 'DM Mono',monospace;letter-spacing:.08em}.integration-status>div:not(.integration-head){display:grid;grid-template-columns:120px 1fr auto;align-items:center;gap:12px;padding:11px 0;border-top:1px solid #e6e9e1}.integration-status strong{color:#486354;font-size:10px}.integration-status span:not(.eyebrow){color:#829087;font-size:9px}.integration-status b{color:#aa7958;font:8px 'DM Mono',monospace;letter-spacing:.05em}
  .policy-caption{margin:11px 2px;color:#85948a;font-size:10px;line-height:1.6}
  .empty-state{display:grid;justify-items:center;padding:58px 20px;text-align:center;border:1px dashed #d9e0d5;border-radius:8px;background:#f9faf5}.empty-mark{display:grid;place-items:center;width:48px;height:48px;margin-bottom:17px;border-radius:15px 15px 15px 3px;background:#e5ece2;color:#557d65;font:12px 'DM Mono',monospace}.empty-state h2{margin:9px 0;color:#315448;font:500 22px 'Fraunces',serif}.empty-state p{max-width:410px;margin:0 0 14px;color:#839087;font-size:11px;line-height:1.6}
  .quick-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:18px 0 28px}.quick-links a{display:flex;align-items:center;gap:12px;padding:13px;border:1px solid #e3e6dd;border-radius:5px;background:#fafbf6;text-decoration:none;transition:border-color .18s,transform .18s}.quick-links a:hover{transform:translateY(-2px);border-color:#b6c9b9}.quick-links span{color:#c4775e;font:9px 'DM Mono',monospace}.quick-links strong{flex:1;color:#486457;font-size:10px}.quick-links i{color:#819788;font-style:normal}
  .alert{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 14px;padding:11px 13px;border-radius:4px;font-size:11px;line-height:1.5}.alert button{border:0;background:none;color:inherit;font-weight:700;text-decoration:underline;cursor:pointer}.alert.error{border:1px solid #e8cfc6;background:#fbefeb;color:#945b49}.alert.success{border:1px solid #d3e1d1;background:#eef5eb;color:#53795d}
  .skeleton-table{display:grid;gap:13px;padding:22px;border:1px solid #e1e5dc;border-radius:7px;background:#fbfbf8}.skeleton-line{height:12px;border-radius:3px;background:linear-gradient(90deg,#e9ece5 25%,#f1f3ed 45%,#e9ece5 65%);background-size:200% 100%;animation:shimmer 1.5s ease-in-out infinite}.skeleton-line:nth-child(2){width:85%}.skeleton-line:nth-child(3){width:68%}.skeleton-line:nth-child(4){width:92%}
  @keyframes shimmer{to{background-position:-200% 0}}
  .workspace-footer{display:flex;justify-content:space-between;gap:14px;margin-top:45px;padding:15px 0 3px;border-top:1px solid #e2e5dc;color:#a0aca3;font:8px 'DM Mono',monospace;letter-spacing:.08em}.workspace-footer i{margin:0 6px;color:#d28060;font-style:normal}
  .conversation{max-width:820px;margin:0 auto 34px;border:1px solid #e1e5dc;border-radius:8px;background:#fbfbf8;overflow:hidden}
  .conversation-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #e8ebe3;background:#f9faf5}.catarina-avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:12px 12px 12px 3px;background:#244e47;color:#f4e8d5;font:500 19px 'Fraunces',serif}.conversation-head>div:nth-child(2){display:grid;gap:3px}.conversation-head strong{color:#345448;font-size:11px}.conversation-head>div:nth-child(2) span{color:#89978d;font-size:9px}.session-lock{margin-left:auto;color:#9b8a61;font:9px 'DM Mono',monospace;letter-spacing:.08em}
  .thread{min-height:330px;max-height:55vh;display:flex;flex-direction:column;gap:17px;padding:22px 19px;overflow-y:auto;background:radial-gradient(ellipse at 90% 4%,rgba(223,231,218,.35),transparent 42%),#f7f8f2}
  .thread-empty{display:grid;justify-items:center;align-content:center;flex:1;min-height:270px;text-align:center}.thread-rule{width:26px;height:2px;margin-bottom:14px;background:#d47b5d}.thread-empty strong{color:#426052;font:500 20px 'Fraunces',serif}.thread-empty p{color:#8b988e;font-size:10px}
  .bubble-row{display:flex;align-items:flex-end;gap:9px}.bubble-row.outgoing{justify-content:flex-end}.mini-mark,.you-mark{display:grid;place-items:center;flex:0 0 24px;height:24px;border-radius:8px 8px 8px 2px;background:#dce8da;color:#4f7861;font:10px 'Fraunces',serif}.you-mark{border-radius:50%;background:#f1dfcf;color:#996349;font:8px 'DM Mono',monospace}.bubble{max-width:min(72%,560px);margin:0;padding:12px 14px;border:1px solid #e1e6db;border-radius:4px 12px 12px;background:#fff;color:#4a6255;font-size:11px;line-height:1.65;white-space:pre-wrap}.outgoing .bubble{border-color:#e6d6c9;border-radius:12px 4px 12px 12px;background:#f4e9dd;color:#675746}.typing{display:flex;gap:4px;padding:12px 14px;border:1px solid #e1e6db;border-radius:5px;background:#fff}.typing i{width:4px;height:4px;border-radius:50%;background:#80998a;animation:typing 1s infinite alternate}.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}@keyframes typing{to{opacity:.25;transform:translateY(-3px)}}
  .composer{display:flex;gap:10px;padding:13px;border-top:1px solid #e6e9e1}.composer input{flex:1;min-width:0;height:42px;padding:0 13px;border:1px solid #dfe4da;border-radius:4px;background:#fff;color:#365448;font-size:11px}.composer input::placeholder{color:#a0aaa2}.send-button{display:flex;align-items:center;gap:11px;padding:0 15px;border:0;border-radius:4px;background:#244e47;color:#f3f1e7;font-size:10px;font-weight:700;cursor:pointer}.send-button:disabled{opacity:.5;cursor:not-allowed}.privacy-line{margin:0;padding:0 16px 12px;color:#9aa69d;font-size:9px;text-align:right}
  .modal-backdrop{position:fixed;z-index:20;inset:0;display:grid;place-items:center;padding:18px;background:rgba(18,44,40,.54);backdrop-filter:blur(3px);animation:fade-in .16s ease-out}.modal-card{width:min(100%,510px);max-height:min(92dvh,750px);overflow:auto;padding:23px;border:1px solid #e0e5dc;border-radius:8px;background:#f9faf5;box-shadow:0 18px 60px rgba(23,59,57,.23);animation:rise-in .2s ease-out}.modal-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px}.modal-head h2{margin:7px 0 0;color:#24473e;font:500 26px 'Fraunces',serif}.close-button{width:30px;height:30px;border:1px solid #e0e5dc;border-radius:50%;background:transparent;color:#698075;font-size:19px;cursor:pointer}.modal-intro{margin:0 0 17px;color:#7b897f;font-size:10px;line-height:1.6}.form-field{display:grid;gap:6px;margin:0 0 13px;color:#496356;font-size:10px;font-weight:700}.form-field em{color:#b88065;font-size:9px;font-style:normal;font-weight:500}.form-field input,.form-field textarea,.form-field select{width:100%;min-height:38px;padding:9px 10px;border:1px solid #dce2d8;border-radius:4px;background:#fff;color:#365448;font-size:11px}.form-field textarea{resize:vertical;line-height:1.55}.form-field small{color:#87958b;font-size:9px;font-weight:400;line-height:1.5}.form-field .field-error{color:#965c49;font-size:9px;font-weight:500;line-height:1.5}.field-error button{margin-left:4px;padding:0;border:0;background:none;color:#3c745f;font-size:9px;font-weight:700;text-decoration:underline;cursor:pointer}.modal-error{margin-bottom:15px}.check-field{display:flex;align-items:center;gap:9px;margin:5px 0 15px;color:#496356;font-size:11px}.check-field input{accent-color:#2f6653;width:15px;height:15px}.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:21px;padding-top:15px;border-top:1px solid #e4e8df}
  .ticket-detail>div:not(.modal-actions){display:grid;grid-template-columns:140px minmax(0,1fr);gap:14px;padding:10px 0;border-bottom:1px solid #e7ebe2}.ticket-detail>div>span{color:#86948b;font:9px 'DM Mono',monospace;text-transform:uppercase}.ticket-detail>div>strong{color:#4c6658;font-size:10px;font-weight:500;white-space:pre-wrap;overflow-wrap:anywhere}
  @keyframes fade-in{from{opacity:0}to{opacity:1}}@keyframes rise-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .gate{min-height:100dvh;display:flex;flex-direction:column;padding:28px clamp(22px,7vw,100px);background:#f2f3ec;color:#193d39}.gate-brand{display:flex;align-items:center;gap:11px;font-size:12px;font-weight:700;letter-spacing:.12em}.gate-card{width:min(100%,480px);margin:auto;padding:35px 0}.gate-card h1{font-size:clamp(34px,5vw,47px)}.gate-card>p{margin:13px 0 22px;color:#728078;font-size:13px;line-height:1.7}.gate-card .button{margin-top:4px}.setup-note{display:grid;gap:7px;margin:22px 0;padding:15px;border-left:2px solid #d57b5d;background:#e8ece3;color:#66796d;font-size:11px;line-height:1.6}.setup-note strong{color:#31594a}.quiet-link{display:block;margin-top:23px;color:#71877a;font-size:11px;text-decoration:none}.quiet-link:hover{text-decoration:underline}.gate-foot{padding:18px 0;border-top:1px solid #dfe4d9;color:#91a096;font:9px 'DM Mono',monospace;letter-spacing:.11em}
  .loading-gate{min-height:100dvh;display:grid;align-content:center;justify-items:center;gap:13px;background:#f2f3ec;color:#7a8b80;font-size:11px}.loading-gate .skeleton-line{width:190px}.skeleton-box{width:min(85vw,420px);height:180px;border-radius:8px;background:#e8ece4;animation:shimmer 1.4s infinite}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:1050px){.workspace{grid-template-columns:218px minmax(0,1fr)}.sidebar{padding-inline:12px}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.filters{gap:6px}.filter-select select,.filter-select input{max-width:150px}}
  @media(max-width:760px){.workspace{display:block}.sidebar{position:relative;z-index:3;width:100%;height:auto;max-height:none;padding:13px 15px 9px;overflow:visible}.brand{padding:0}.workspace-tag{position:absolute;right:15px;top:12px;margin:0;padding:7px 9px;font-size:8px}.sidebar nav{display:flex;gap:15px;margin-top:13px;overflow:auto;scrollbar-width:none}.sidebar nav::-webkit-scrollbar{display:none}.nav-group{display:contents}.nav-group>p{display:none}.nav-group>a{flex:0 0 auto;min-height:31px;margin:0;padding:6px 9px;font-size:10px;background:#204441}.nav-mark{display:none}.nav-group>a.active{background:#e5e9de}.demo-card,.account-card{display:none}.topbar{height:51px;padding:0 17px}.content{padding:26px 17px 20px}.page-heading{align-items:flex-start;flex-direction:column;margin-bottom:19px}.heading-actions{width:100%;justify-content:flex-start;flex-wrap:wrap}.page-heading .button{min-height:36px}.topbar-right{gap:9px}.date-stamp{display:none}.metric-grid{gap:8px}.metric-card{min-height:128px;padding:13px}.metric-card>strong{font-size:26px}.metric-top{font-size:10px}.filters{align-items:stretch}.search-field{flex:1 1 100%}.filter-select select,.filter-select input{max-width:none;width:100%}.filter-select{flex:1 1 44%}.result-count{align-self:center}.quick-links{grid-template-columns:1fr}.workspace-footer{flex-direction:column;gap:7px}.export-card{align-items:flex-start;flex-wrap:wrap}.export-copy{min-width:calc(100% - 64px)}.integration-status>div:not(.integration-head){grid-template-columns:92px 1fr}.integration-status b{grid-column:2}.agenda-summary{align-items:flex-start;flex-direction:column;gap:9px}.conversation{margin-bottom:20px}.thread{min-height:280px}.page-heading h1{max-width:600px}.session-lock{font-size:8px}}
  @media(max-width:430px){.workspace-tag{font-size:0;width:25px;height:25px;justify-content:center;padding:0;top:16px}.workspace-tag .live-dot{width:7px;height:7px}.sidebar nav{margin-right:-15px;padding-right:15px}.metric-grid{grid-template-columns:1fr 1fr}.metric-card{min-height:120px}.metric-card>p{font-size:9px}.topbar{padding:0 14px}.content{padding-inline:14px}.breadcrumb{gap:7px;font-size:10px}.mode-pill{font-size:8px}.welcome-strip{padding:15px}.welcome-strip strong{font-size:17px}.welcome-index{display:none}.modal-card{padding:18px}.modal-head h2{font-size:23px}.conversation-head{padding:12px}.conversation-head>div:nth-child(2) span{max-width:195px}.bubble{max-width:82%}.composer{gap:6px;padding:9px}.send-button{padding:0 10px}.privacy-line{font-size:8px}}
</style>
