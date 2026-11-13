<script lang="ts">
  import { onMount } from 'svelte';

  export let principal = false;

  type Status = 'BORRADOR' | 'PENDIENTE_REVISION' | 'APROBADO' | 'INACTIVO';
  type DocType = 'PROCEDIMIENTO_INTERNO' | 'POLITICA/PREGUNTAS_TRABAJADOR';
  type Approval = { actor?: string; at?: string; hash?: string; version?: string; fragments?: string[] };
  type LibraryMeta = {
    v: number; kind: 'document'; driveId?: string; rootId?: string; folder?: string; mimeType?: string;
    status: Status; type?: DocType; hash?: string; revision?: number | string; lastRead?: string;
    issuedOn?: string; expiresOn?: string; approval?: Approval; proposal?: Record<string, unknown>; error?: string;
  };
  type DocumentRow = {
    id_fuente: string | number; nombre: string; categoria?: string; url_drive?: string;
    version?: string; vigente_desde?: string; biblioteca: LibraryMeta;
  };
  type RootRow = { id_fuente: string | number; nombre: string; url_drive?: string; biblioteca: { kind: 'root'; driveId?: string; enabled?: boolean; lastSync?: string; error?: string } };
  type LibraryPayload = { documents?: DocumentRow[]; roots?: RootRow[]; suggestedRoot?: { name?: string; url?: string }; resources?: { directoryId?: string; exportId?: string }; principal?: boolean };
  type Tab = 'Carpetas' | 'Por revisar' | 'Aprobados' | 'Inactivos';
  const tabs: Tab[] = ['Carpetas', 'Por revisar', 'Aprobados', 'Inactivos'];
  const types: { value: DocType; label: string }[] = [
    { value: 'PROCEDIMIENTO_INTERNO', label: 'Procedimiento interno' },
    { value: 'POLITICA/PREGUNTAS_TRABAJADOR', label: 'Política / preguntas de trabajador' }
  ];

  let documents: DocumentRow[] = [];
  let roots: RootRow[] = [];
  let suggestedRoot: LibraryPayload['suggestedRoot'];
  let resources: LibraryPayload['resources'] = {};
  let activeTab: Tab = 'Carpetas';
  let selected: DocumentRow | null = null;
  let loading = true;
  let loaded = false;
  let busy = false;
  let error = '';
  let notice = '';
  let query = '';
  let content = '';
  let readHash = '';
  let readBusy = false;
  let readError = '';
  let docType: DocType = 'PROCEDIMIENTO_INTERNO';
  let rootDialog = false;
  let manualDialog = false;
  let resourcesDialog = false;
  let rootUrl = '';
  let rootName = '';
  let manualUrl = '';
  let directoryUrl = '';
  let exportUrl = '';

  $: visibleDocuments = documents.filter((doc) => {
    const status = doc.biblioteca?.status;
    if (activeTab === 'Por revisar' && !['BORRADOR', 'PENDIENTE_REVISION'].includes(status) && !doc.biblioteca.proposal) return false;
    if (activeTab === 'Aprobados' && status !== 'APROBADO') return false;
    if (activeTab === 'Inactivos' && status !== 'INACTIVO') return false;
    const text = `${doc.nombre} ${doc.categoria || ''} ${doc.version || ''}`.toLocaleLowerCase('es');
    return !query || text.includes(query.toLocaleLowerCase('es'));
  });
  $: selectedOutdated = Boolean(selected?.biblioteca?.approval?.hash && readHash && selected.biblioteca.approval.hash !== readHash);
  $: canApprove = Boolean(principal && selected && readHash &&
    (!selected.biblioteca.hash || selected.biblioteca.hash === readHash) &&
    selected.biblioteca.status !== 'INACTIVO');

  async function loadLibrary() {
    loading = true;
    error = '';
    try {
      const response = await fetch('/api/admin/library', { credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw new Error(payload.error || 'No fue posible cargar la biblioteca.');
      const data = payload as LibraryPayload;
      documents = Array.isArray(data.documents) ? data.documents : [];
      roots = Array.isArray(data.roots) ? data.roots : [];
      suggestedRoot = data.suggestedRoot;
      if (!roots.length && !rootUrl.trim() && suggestedRoot?.url) {
        rootUrl = suggestedRoot.url;
        rootName = suggestedRoot.name || '';
      }
      resources = data.resources || {};
      loaded = true;
      if (selected) selected = documents.find((item) => item.id_fuente === selected?.id_fuente) || null;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Ocurrió un error al consultar la biblioteca.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadLibrary();
  });

  async function post(body: Record<string, unknown>, reload = true) {
    busy = true;
    error = '';
    notice = '';
    try {
      const response = await fetch('/api/admin/library', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error || payload.ok !== true) {
        const code = payload.code ? ` (${payload.code})` : '';
        throw new Error((payload.error || 'El servidor no confirmó la operación.') + code);
      }
      if (reload) {
        await loadLibrary();
        const current = selected && documents.find((item) => item.id_fuente === selected?.id_fuente);
        if (current) selected = current;
      }
      return payload;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'No se pudo completar la operación.';
      return null;
    } finally {
      busy = false;
    }
  }

  function openDocument(doc: DocumentRow) {
    selected = doc;
    docType = doc.biblioteca.approval
      ? doc.biblioteca.type ?? 'PROCEDIMIENTO_INTERNO'
      : /^\s*pol[ií]tica\b/i.test(doc.nombre)
        ? 'POLITICA/PREGUNTAS_TRABAJADOR'
        : doc.biblioteca.type ?? 'PROCEDIMIENTO_INTERNO';
    content = '';
    readHash = '';
    readError = '';
  }

  function closeDocument() {
    selected = null;
    content = '';
    readHash = '';
    readError = '';
  }

  async function readDocument() {
    if (!selected || readBusy) return;
    readBusy = true;
    readError = '';
    content = '';
    readHash = '';
    try {
      const response = await fetch('/api/admin/library', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', id: selected.id_fuente })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error || typeof payload.content !== 'string') throw new Error(payload.error || 'No se pudo leer el archivo de forma privada.');
      content = payload.content;
      readHash = typeof payload.hash === 'string' ? payload.hash : '';
      if (selected.biblioteca.hash !== readHash || (selected.biblioteca.approval?.hash && selected.biblioteca.approval.hash !== readHash)) {
        const invalidated: DocumentRow = { ...selected, biblioteca: { ...selected.biblioteca, hash: readHash, status: selected.biblioteca.status === 'INACTIVO' ? 'INACTIVO' : 'PENDIENTE_REVISION' } };
        selected = invalidated;
        documents = documents.map((doc) => doc.id_fuente === invalidated.id_fuente ? invalidated : doc);
        if (invalidated.biblioteca.approval?.hash && invalidated.biblioteca.approval.hash !== readHash) {
          notice = 'El documento cambió. Lee esta versión y vuelve a validarla para activar las respuestas.';
        }
      }
    } catch (reason) {
      readError = reason instanceof Error ? reason.message : 'No fue posible leer el archivo.';
    } finally {
      readBusy = false;
    }
  }

  async function approve() {
    if (!selected || !canApprove) return;
    const result = await post({
      action: 'approve', id: selected.id_fuente, tipo: docType,
      expectedHash: readHash, confirmed: true
    });
    if (result) {
      notice = result.workerEnabled
        ? 'Política validada y activada para consultas de colaboradores.'
        : 'Documento validado para RH; no se usará en respuestas a colaboradores.';
      closeDocument();
    }
  }

  async function deactivate(doc: DocumentRow) {
    if (!principal || !window.confirm(`¿Marcar “${doc.nombre}” como inactivo?`)) return;
    const result = await post({ action: 'deactivate', id: doc.id_fuente });
    if (result && selected?.id_fuente === doc.id_fuente) closeDocument();
    if (result) notice = 'Documento retirado. Catarina dejará de usarlo en respuestas.';
  }

  async function saveRoot(event: SubmitEvent) {
    event.preventDefault();
    if (!principal || !rootUrl.trim()) return;
    const result = await post({ action: 'root-save', url: rootUrl.trim(), name: rootName.trim() });
    if (result) {
      rootDialog = false;
      rootUrl = '';
      rootName = '';
      notice = 'Carpeta registrada.';
    }
  }

  async function syncRoot(root: RootRow) {
    if (!principal) return;
    const result = await post({ action: 'sync', id: root.id_fuente });
    if (result) notice = 'Sincronización solicitada.';
  }

  async function disableRoot(root: RootRow) {
    if (!principal || !window.confirm(`¿Desactivar la carpeta “${root.nombre}”?`)) return;
    const result = await post({ action: 'root-disable', id: root.id_fuente });
    if (result) notice = 'Carpeta desactivada.';
  }

  async function addManual(event: SubmitEvent) {
    event.preventDefault();
    if (!manualUrl.trim()) return;
    const result = await post({ action: 'manual', url: manualUrl.trim() });
    if (result) {
      manualDialog = false;
      manualUrl = '';
      notice = 'Documento incorporado como borrador para revisión. No está publicado.';
    }
  }

  async function saveResources(event: SubmitEvent) {
    event.preventDefault();
    if (!principal) return;
    const result = await post({ action: 'resources', directoryUrl: directoryUrl.trim(), exportUrl: exportUrl.trim() });
    if (result) {
      resourcesDialog = false;
      notice = 'Enlaces de recursos actualizados.';
    }
  }

  function statusLabel(status?: Status, type?: DocType) {
    return status === 'APROBADO' ? (type === 'POLITICA/PREGUNTAS_TRABAJADOR' ? 'Activa para colaboradores' : 'Validado · solo RH') :
      status === 'PENDIENTE_REVISION' ? 'Pendiente de revisión' :
      status === 'INACTIVO' ? 'Inactivo' : 'Borrador · privado';
  }
  function categoryLabel(value?: string) {
    return !value || value === 'Por definir' ? 'Políticas y procedimientos' : value;
  }
  function formatDate(value?: string) {
    if (!value) return 'No registrada';
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' }).format(date);
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet" />
</svelte:head>

<div class="library-shell">
<section class="library" aria-labelledby="library-title">
  <header class="page-heading">
    <div>
      <span class="eyebrow">CATARINA RH · CONTROL DOCUMENTAL</span>
      <h1 id="library-title">Biblioteca de documentos</h1>
      <p>Revisa cada documento y actívalo con un clic. Solo el administrador principal puede aprobarlo.</p>
    </div>
    <div class="heading-actions">
      <button class="button secondary" type="button" on:click={() => void loadLibrary()} disabled={loading || busy}>↻ Actualizar</button>
      {#if principal}<button class="button secondary" type="button" on:click={() => { manualDialog = true; error = ''; }}>Agregar documento</button>{/if}
    </div>
  </header>

  <aside class="security-note">
    <span class="note-mark" aria-hidden="true">!</span>
    <div><strong>Una política aprobada queda disponible completa para consultas.</strong><p>Al abrir una ficha puedes revisar el documento; con un clic el administrador la activa. Los procedimientos internos permanecen solo para RH. Catarina consulta la versión aprobada guardada en Neon, no Drive en cada mensaje. Sincroniza la carpeta cuando cambies o retires un archivo.</p></div>
  </aside>

  {#if notice}<div class="alert success" role="status">{notice}</div>{/if}
  {#if error}<div class="alert error" role="alert"><span>{error}</span><button type="button" on:click={() => void loadLibrary()}>Reintentar</button></div>{/if}
  {#if !principal && loaded && (roots.some((root) => root.biblioteca.error) || documents.some((doc) => doc.biblioteca.error))}
    <div class="alert error" role="status">Hay fuentes con error o acceso incompleto. La administración de carpetas corresponde únicamente a Gerencia.</div>
  {/if}

  <section class="roots-section" aria-labelledby="roots-title">
    <div class="section-head">
      <div><span class="eyebrow">FUENTES DRIVE</span><h2 id="roots-title">Carpetas conectadas</h2></div>
      {#if principal}<div class="inline-actions"><button class="text-action" type="button" on:click={() => { resourcesDialog = true; directoryUrl = resources?.directoryId ? `https://docs.google.com/spreadsheets/d/${resources.directoryId}/edit` : ''; exportUrl = resources?.exportId ? `https://docs.google.com/spreadsheets/d/${resources.exportId}/edit` : ''; }}>Enlaces de recursos</button><button class="button secondary compact" type="button" on:click={() => { rootDialog = true; rootUrl = roots[0]?.url_drive || suggestedRoot?.url || ''; rootName = roots[0]?.nombre || suggestedRoot?.name || ''; }} disabled={loading || busy}>Registrar carpeta</button></div>{/if}
    </div>
    {#if loading && !loaded}
      <div class="root-skeleton"><i></i><i></i></div>
    {:else if roots.length}
      <div class="root-list">
        {#each roots as root (root.id_fuente)}
          <article class="root-row">
            <span class:disabled={!root.biblioteca.enabled} class="folder-mark" aria-hidden="true">F</span>
            <div class="root-info"><strong>{root.nombre || 'Carpeta sin nombre'}</strong><span>{root.biblioteca.driveId ? `Drive · ${root.biblioteca.driveId}` : 'Identificador Drive no disponible'} · Última sincronización: {formatDate(root.biblioteca.lastSync)}</span>
              {#if root.biblioteca.error}<small class="source-error">{root.biblioteca.error}</small>{/if}
            </div>
            <span class:inactive={!root.biblioteca.enabled} class="status-badge"><i></i>{root.biblioteca.enabled ? 'Activa' : 'Desactivada'}</span>
            {#if principal}<div class="root-actions"><button class="text-action" type="button" on:click={() => syncRoot(root)} disabled={busy || !root.biblioteca.enabled}>Sincronizar / Revisar cambios</button>{#if root.biblioteca.enabled}<button class="text-action danger-action" type="button" on:click={() => disableRoot(root)} disabled={busy}>Desactivar</button>{:else}<button class="text-action" type="button" on:click={() => post({action:'root-save',url:root.url_drive,name:root.nombre})} disabled={busy}>Reactivar carpeta</button>{/if}</div>{/if}
          </article>
        {/each}
      </div>
    {:else}
      <div class="incomplete-state"><span class="empty-mark">RH</span><div><strong>No hay carpetas registradas.</strong><p>La carpeta institucional ya proporcionada se precarga al registrarla. La lectura se comprueba antes de guardar.</p></div>{#if principal}<button class="button secondary compact" type="button" on:click={() => { rootDialog = true; rootUrl = suggestedRoot?.url || ''; rootName = suggestedRoot?.name || ''; }} disabled={loading || busy}>Registrar carpeta</button>{/if}</div>
    {/if}
    {#if resources?.directoryId || resources?.exportId}
      <div class="resource-links"><span>Recursos registrados</span><span>Directorio: {resources.directoryId ? 'configurado' : 'pendiente'}</span><span>Exportación: {resources.exportId ? 'configurada' : 'pendiente'}</span></div>
    {:else}
      <p class="resource-pending">Fuentes incompletas: los enlaces de directorio y exportación aún no están confirmados.</p>
    {/if}
  </section>

  <section class="documents-section" aria-labelledby="documents-title">
    <div class="section-head doc-heading">
      <div><span class="eyebrow">DOCUMENTOS DE RH</span><h2 id="documents-title">Documentos</h2></div>
      <label class="search"><span class="sr-only">Buscar documentos</span><input bind:value={query} placeholder="Buscar por nombre o categoría" /></label>
    </div>
    <div class="tabs" role="tablist" aria-label="Estado de documentos">
      {#each tabs as tab}
        <button class:active={activeTab === tab} type="button" role="tab" aria-selected={activeTab === tab} on:click={() => activeTab = tab}>{tab}<span>{tab === 'Carpetas' ? documents.length : tab === 'Por revisar' ? documents.filter((doc) => ['BORRADOR', 'PENDIENTE_REVISION'].includes(doc.biblioteca.status)).length : tab === 'Aprobados' ? documents.filter((doc) => doc.biblioteca.status === 'APROBADO').length : documents.filter((doc) => doc.biblioteca.status === 'INACTIVO').length}</span></button>
      {/each}
    </div>
    {#if loading && !loaded}
      <div class="doc-skeleton"><i></i><i></i><i></i></div>
    {:else if visibleDocuments.length}
      <div class="document-list">
        {#each visibleDocuments as doc (doc.id_fuente)}
          <article class="document-row">
            <div class="doc-icon" aria-hidden="true">DOC</div>
            <div class="doc-main"><div class="doc-titleline"><h3>{doc.nombre || 'Documento sin nombre'}</h3><span class:approved={doc.biblioteca.status === 'APROBADO'} class:pending={doc.biblioteca.status === 'PENDIENTE_REVISION'} class:inactive={doc.biblioteca.status === 'INACTIVO'} class="doc-status">{statusLabel(doc.biblioteca.status, doc.biblioteca.type)}</span></div>
              <p>{categoryLabel(doc.categoria)}{doc.version ? ` · versión ${doc.version}` : ''}</p>
              <small>{doc.biblioteca.mimeType || 'Tipo de archivo no informado'} · Revisión {doc.biblioteca.revision ?? '—'}</small>
              {#if doc.biblioteca.error}<small class="source-error">{doc.biblioteca.error}</small>{/if}
            </div>
             <div class="doc-actions"><button class="text-action" type="button" on:click={() => openDocument(doc)}>Abrir ficha</button>{#if principal && doc.biblioteca.status !== 'INACTIVO'}<button class="text-action danger-action" type="button" on:click={() => deactivate(doc)} disabled={busy}>Retirar</button>{/if}</div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="empty-state"><span class="empty-mark">RH</span><span class="eyebrow">SIN RESULTADOS</span><h3>No hay documentos en esta vista.</h3><p>{query ? 'Prueba con otro término o limpia la búsqueda.' : 'El registro manual permanece disponible aunque no haya carpetas conectadas.'}</p><button class="text-action" type="button" on:click={() => { activeTab = 'Carpetas'; query = ''; }}>Ver todos los documentos</button></div>
    {/if}
  </section>
  <footer class="page-footer"><span>CATARINA RH <i>/</i> MANUFACTURAS TRAINMEX</span><span>LECTURA PRIVADA · PUBLICACIÓN BAJO APROBACIÓN</span></footer>
</section>

{#if selected}
  <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) closeDocument(); }}>
    <div class="modal-card detail-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="detail-title">
      <div class="modal-head"><div><span class="eyebrow">FICHA DOCUMENTAL · {selected.biblioteca.status}</span><h2 id="detail-title">{selected.nombre}</h2></div><button class="close-button" type="button" aria-label="Cerrar ficha" on:click={closeDocument}>×</button></div>
      {#if selectedOutdated}<div class="alert error">El hash de esta lectura difiere del hash aprobado. La aprobación previa no puede considerarse vigente.</div>{/if}
      <div class="detail-grid">
        <div><span>Tema</span><strong>{categoryLabel(selected.categoria)}</strong></div>
        <div><span>Tipo</span><strong>{docType === 'POLITICA/PREGUNTAS_TRABAJADOR' ? 'Política para colaboradores' : 'Procedimiento interno'}</strong></div>
        <div><span>Versión</span><strong>{selected.version || 'Leída del documento al aprobar'}</strong></div>
      </div>
      {#if selected.biblioteca.approval}
        <div class="approval-record"><span class="eyebrow">VALIDACIÓN REGISTRADA</span><p><strong>{selected.biblioteca.approval.actor || 'Administrador'}</strong> · {selected.biblioteca.approval.version ? `versión ${selected.biblioteca.approval.version}` : 'revisión vigente de Drive'}</p></div>
      {/if}
      <div class="private-read">
        <div class="private-head"><div><span class="eyebrow">LECTURA TEMPORAL · SOLO ESTA FICHA</span><h3>Contenido privado</h3></div><button class="button secondary compact" type="button" on:click={readDocument} disabled={readBusy}>{readBusy ? 'Leyendo…' : content ? 'Volver a leer' : 'Leer en privado'}</button></div>
        <p>Lee el archivo antes de activarlo. Al activar una política, Catarina guarda esa revisión en Neon; un procedimiento interno nunca se usa para responder a colaboradores.</p>
        {#if readError}<p class="alert error" role="alert">{readError}</p>{/if}
        {#if content}<pre class="document-content">{content}</pre>{/if}
      </div>
      <div class="proposal-form">
        <div class="form-title"><div><span class="eyebrow">USO DEL DOCUMENTO</span><h3>Decide cómo lo usará Catarina</h3></div><span class="private-tag">{selected.biblioteca.status === 'APROBADO' ? 'VALIDADO' : 'PENDIENTE'}</span></div>
        {#if principal}
          <label class="form-field"><span>Tipo de documento</span><select bind:value={docType}>{#each types as item}<option value={item.value}>{item.label}</option>{/each}</select></label>
          <p class="form-note">La categoría solo organiza la biblioteca y se asigna automáticamente. Una política activa queda disponible completa para consultas; un procedimiento interno queda reservado a RH.</p>
        {:else}
          <p class="role-note">Solo el administrador principal puede agregar, retirar o activar documentos.</p>
        {/if}
        <div class="modal-actions">
          {#if principal && selected.biblioteca.status !== 'APROBADO'}
            <button class="button primary" type="button" on:click={approve} disabled={busy || !canApprove || !content}>{busy ? 'Guardando…' : docType === 'POLITICA/PREGUNTAS_TRABAJADOR' ? 'Validar y activar para colaboradores' : 'Validar solo para RH'}</button>
          {/if}
        </div>
      </div>
      {#if error}<div class="alert error" role="alert">{error}</div>{/if}
    </div>
  </div>
{/if}

{#if rootDialog}
  <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) rootDialog = false; }}>
    <div class="modal-card compact-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="root-dialog-title">
      <div class="modal-head"><div><span class="eyebrow">SOLO GERENCIA · DRIVE</span><h2 id="root-dialog-title">Registrar carpeta</h2></div><button class="close-button" type="button" aria-label="Cerrar" on:click={() => rootDialog = false}>×</button></div>
      <p class="form-note">Pega el enlace autorizado que proporciona el dueño. No se inventa ni se crea una carpeta.</p>
      <form on:submit={saveRoot}><label class="form-field"><span>Nombre de referencia</span><input bind:value={rootName} placeholder="Opcional; se usa el título de Drive" /></label><label class="form-field"><span>Enlace Drive</span><input bind:value={rootUrl} required placeholder="URL o ID de la carpeta" /></label>{#if error}<p class="alert error">{error}</p>{/if}<div class="modal-actions"><button class="button secondary" type="button" on:click={() => rootDialog = false}>Cancelar</button><button class="button primary" type="submit" disabled={busy || !principal}>{busy ? 'Guardando…' : 'Registrar carpeta'}</button></div></form>
    </div>
  </div>
{/if}

{#if manualDialog}
  <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) manualDialog = false; }}>
    <div class="modal-card compact-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="manual-title">
      <div class="modal-head"><div><span class="eyebrow">ALTA MANUAL · BORRADOR</span><h2 id="manual-title">Agregar documento</h2></div><button class="close-button" type="button" aria-label="Cerrar" on:click={() => manualDialog = false}>×</button></div>
      <p class="form-note">Usa el enlace real del documento. La incorporación nunca lo aprueba ni lo publica; la revisión se completa en su ficha.</p>
      <form on:submit={addManual}><label class="form-field"><span>URL del documento Drive</span><input bind:value={manualUrl} type="url" required placeholder="Pega aquí el enlace autorizado" /></label>{#if error}<p class="alert error">{error}</p>{/if}<div class="modal-actions"><button class="button secondary" type="button" on:click={() => manualDialog = false}>Cancelar</button><button class="button primary" type="submit" disabled={busy}>{busy ? 'Agregando…' : 'Agregar como borrador'}</button></div></form>
    </div>
  </div>
{/if}

{#if resourcesDialog}
  <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) resourcesDialog = false; }}>
    <div class="modal-card compact-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="resources-title">
      <div class="modal-head"><div><span class="eyebrow">SOLO GERENCIA · RECURSOS</span><h2 id="resources-title">Enlaces registrados</h2></div><button class="close-button" type="button" aria-label="Cerrar" on:click={() => resourcesDialog = false}>×</button></div>
      <p class="form-note">Los enlaces entregados ya están configurados. Solo reemplázalos por otros recursos autorizados de este proyecto; no se cambian permisos de Google.</p>
      <form on:submit={saveResources}><label class="form-field"><span>URL de directorio</span><input bind:value={directoryUrl} type="url" required placeholder="Pega el enlace autorizado para actualizar" /></label><label class="form-field"><span>URL de exportación</span><input bind:value={exportUrl} type="url" required placeholder="Pega el enlace autorizado para actualizar" /></label>{#if error}<p class="alert error">{error}</p>{/if}<div class="modal-actions"><button class="button secondary" type="button" on:click={() => resourcesDialog = false}>Cancelar</button><button class="button primary" type="submit" disabled={busy || !principal}>{busy ? 'Guardando…' : 'Guardar enlaces'}</button></div></form>
    </div>
  </div>
{/if}

</div>
<style>
  .library-shell{--ink:#183b39;--deep:#244e47;--muted:#718179;--line:#e3e6dc;--paper:#fbfbf7;--coral:#d5795f;--sage:#e5ebe1;font-family:'DM Sans',sans-serif;color:var(--ink)}
  .library{--ink:#183b39;--deep:#244e47;--muted:#718179;--line:#e3e6dc;--paper:#fbfbf7;--coral:#d5795f;--sage:#e5ebe1;max-width:1480px;margin:0 auto;padding:38px clamp(18px,4vw,58px) 22px;color:var(--ink);font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
  .library-shell *{box-sizing:border-box}button,input,select{font:inherit}.library-shell :focus-visible{outline:3px solid var(--coral);outline-offset:3px}
  .page-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:25px}.eyebrow{display:block;color:#718d80;font:10px 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase}
  h1{margin:9px 0 8px;color:var(--ink);font:500 clamp(30px,3.5vw,43px)/1.12 'Fraunces',serif;letter-spacing:-.035em}.page-heading p{margin:0;color:var(--muted);font-size:13px;line-height:1.65}
  .heading-actions,.inline-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 14px;border:1px solid transparent;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;transition:background .18s ease,transform .18s ease,border-color .18s ease}
  .button:hover:not(:disabled){transform:translateY(-1px)}.button:disabled{opacity:.54;cursor:not-allowed}.primary{border-color:var(--deep);background:var(--deep);color:#f6f2e7}.primary:hover:not(:disabled){background:#193d38}.secondary{border-color:#d9dfd6;background:var(--paper);color:#3e5b50}.secondary:hover:not(:disabled){border-color:#9eb3a1}.compact{min-height:34px;padding:0 11px;font-size:10px}
  .security-note{display:flex;align-items:flex-start;gap:13px;margin:0 0 25px;padding:14px 17px;border:1px solid #e9dfc9;border-left:3px solid #d5a55c;border-radius:5px;background:#fcf7e9}.note-mark{display:grid;place-items:center;flex:0 0 21px;height:21px;border:1px solid #c8a956;border-radius:50%;color:#8c7741;font:11px 'DM Mono',monospace}.security-note strong{display:block;color:#574f3b;font-size:12px}.security-note p{margin:5px 0 0;color:#746d58;font-size:11px;line-height:1.6}
  .alert{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 15px;padding:11px 14px;border:1px solid;border-radius:5px;font-size:11px;line-height:1.5}.alert.success{border-color:#cbdcc8;background:#edf4e9;color:#3d664d}.alert.error{border-color:#e6c6bd;background:#fbefeb;color:#94503f}.alert button{border:0;background:none;color:inherit;font-size:11px;font-weight:700;text-decoration:underline;cursor:pointer}
  .roots-section,.documents-section{margin-top:27px}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:12px}.section-head h2{margin:7px 0 0;color:#294b42;font:500 22px/1.2 'Fraunces',serif}.root-list,.document-list{overflow:hidden;border:1px solid var(--line);border-radius:7px;background:var(--paper)}
  .root-row{display:grid;grid-template-columns:40px minmax(170px,1fr) auto auto;align-items:center;gap:13px;padding:13px 16px;border-bottom:1px solid #eaebe4}.root-row:last-child,.document-row:last-child{border-bottom:0}.folder-mark,.doc-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:11px 11px 11px 3px;background:#e5ebe1;color:#315b4e;font:10px 'DM Mono',monospace}.folder-mark.disabled{opacity:.45}
  .root-info{display:grid;gap:4px;min-width:0}.root-info strong,.doc-main h3{overflow-wrap:anywhere;color:#294b42;font-size:12px}.root-info>span,.doc-main p{color:#829087;font-size:10px;line-height:1.5}.source-error{color:#a35240!important}.status-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border-radius:4px;background:#edf4e9;color:#3e704e;font:9px 'DM Mono',monospace;white-space:nowrap}.status-badge i{width:6px;height:6px;border-radius:50%;background:#5e9b67}.status-badge.inactive{background:#f1f1ec;color:#7e8880}.status-badge.inactive i{background:#9ba39b}.root-actions,.doc-actions{display:flex;justify-content:flex-end;align-items:center;gap:13px;flex-wrap:wrap}
  .text-action{padding:4px 0;border:0;background:none;color:#557267;font-size:10px;font-weight:700;cursor:pointer}.text-action:hover{text-decoration:underline}.text-action:disabled{opacity:.45;cursor:not-allowed}.danger-action{color:#a65c48}
  .resource-links{display:flex;gap:15px;flex-wrap:wrap;margin-top:10px;color:#829087;font:9px 'DM Mono',monospace}.resource-links span:first-child{color:#526a5e}.resource-pending{margin:9px 0 0;color:#a17a45;font-size:10px}.incomplete-state{display:flex;align-items:center;gap:13px;padding:16px;border:1px dashed #d9dfd6;border-radius:7px;background:#f9f9f4}.incomplete-state .empty-mark{flex:0 0 38px;margin:0}.incomplete-state strong{color:#37564a;font-size:11px}.incomplete-state p{margin:4px 0 0;color:#839087;font-size:10px;line-height:1.5}.incomplete-state .button{margin-left:auto;flex-shrink:0}
  .doc-heading{margin-bottom:10px}.search input{width:min(270px,42vw);height:36px;padding:0 11px;border:1px solid #d9dfd6;border-radius:4px;background:#fffefa;color:#294b42;font-size:10px}.tabs{display:flex;gap:5px;margin-bottom:11px;border-bottom:1px solid var(--line)}.tabs button{display:flex;align-items:center;gap:8px;padding:10px 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:#75867b;font-size:10px;font-weight:700;cursor:pointer}.tabs button.active{border-bottom-color:#477263;color:#31594d}.tabs button span{display:grid;place-items:center;min-width:19px;height:19px;padding:0 4px;border-radius:9px;background:#edf0e9;color:#73847a;font:9px 'DM Mono',monospace}
  .document-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:13px;padding:15px 16px;border-bottom:1px solid #eaebe4}.doc-icon{width:36px;height:36px;border-radius:5px;background:#edf0e9;color:#78877e;font-size:8px}.doc-main{min-width:0}.doc-titleline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.doc-main h3{margin:0;font-weight:700}.doc-status{padding:5px 7px;border-radius:3px;background:#f7efdf;color:#926c38;font:8px 'DM Mono',monospace;letter-spacing:.02em}.doc-status.approved{background:#e7f0e5;color:#46704e}.doc-status.pending{background:#fff2df;color:#a17234}.doc-status.inactive{background:#efefeb;color:#7e8880}.doc-main p{margin:5px 0 3px}.doc-main small{display:block;color:#9aa49b;font:9px 'DM Mono',monospace}.doc-actions{padding-left:8px}
  .empty-state{display:grid;justify-items:center;padding:35px 20px;border:1px dashed #d9dfd6;border-radius:7px;background:#f9f9f4;text-align:center}.empty-mark{display:grid;place-items:center;width:38px;height:38px;margin-bottom:12px;border-radius:11px 11px 11px 3px;background:#e5ebe1;color:#315b4e;font:500 11px 'DM Mono',monospace}.empty-state h3{margin:8px 0 5px;color:#294b42;font:500 21px 'Fraunces',serif}.empty-state p{max-width:420px;margin:0 0 8px;color:var(--muted);font-size:11px;line-height:1.6}
  .root-skeleton,.doc-skeleton{display:grid;gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:7px;background:var(--line)}.root-skeleton i,.doc-skeleton i{display:block;height:54px;background:linear-gradient(90deg,#e9ece4,#f3f4ee,#e9ece4);background-size:200% 100%;animation:shimmer 1.5s ease-in-out infinite}.doc-skeleton i{height:70px}@keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
  .page-footer{display:flex;justify-content:space-between;gap:12px;margin-top:37px;padding:17px 0 0;border-top:1px solid #e3e5dc;color:#90a096;font:9px 'DM Mono',monospace;letter-spacing:.06em}.page-footer i{padding:0 5px;color:#d5795f;font-style:normal}
  .modal-backdrop{position:fixed;z-index:30;inset:0;display:grid;place-items:center;padding:16px;background:rgba(21,48,43,.48);backdrop-filter:blur(3px)}.modal-card{width:min(100%,650px);max-height:min(92dvh,900px);overflow:auto;padding:23px;border:1px solid #e0e5db;border-radius:9px;background:#fbfbf7;box-shadow:0 20px 60px rgba(25,57,49,.2);animation:arrive .2s ease both}.compact-modal{width:min(100%,470px)}.detail-modal{width:min(100%,800px)}@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:17px}.modal-head h2{margin:7px 0 0;color:#294b42;font:500 25px/1.2 'Fraunces',serif}.close-button{width:31px;height:31px;border:1px solid #e0e5db;border-radius:5px;background:transparent;color:#60766a;font-size:20px;line-height:1;cursor:pointer}
  .detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid #e2e6dc;border-radius:5px;background:#e2e6dc}.detail-grid>div{display:grid;align-content:start;gap:5px;min-width:0;padding:10px;background:#f8f8f3}.detail-grid span{color:#8a978e;font:8px 'DM Mono',monospace;letter-spacing:.06em;text-transform:uppercase}.detail-grid strong{color:#405b4e;font-size:10px;overflow-wrap:anywhere}
  .approval-record{margin-top:12px;padding:12px;border:1px solid #dfe6dc;border-radius:5px;background:#f0f4ed}.approval-record p{margin:7px 0 0;color:#607367;font-size:10px}
  .private-read,.proposal-form{margin-top:17px;padding-top:15px;border-top:1px solid #e4e7de}.private-head,.form-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.private-head h3,.form-title h3{margin:5px 0 0;color:#31564a;font:500 18px 'Fraunces',serif}.private-read>p{margin:6px 0 10px;color:#839087;font-size:10px;line-height:1.5}.document-content{max-height:260px;overflow:auto;margin:8px 0;padding:14px;border:1px solid #dfe4da;border-radius:4px;background:#f4f5ef;color:#4d6356;font:11px/1.7 'DM Mono',monospace;white-space:pre-wrap;overflow-wrap:anywhere}
  .private-tag{padding:6px 8px;border:1px solid #e8dfcc;border-radius:3px;background:#fbf5e8;color:#957440;font:8px 'DM Mono',monospace;white-space:nowrap}.form-field{display:grid;gap:6px;margin:12px 0;color:#50675c;font-size:10px;font-weight:600}.form-field select{width:100%;min-height:37px;padding:8px 10px;border:1px solid #d9dfd6;border-radius:4px;background:#fffefa;color:#294b42;font-size:11px}.form-note{margin:8px 0;color:#79877e;font-size:9px;line-height:1.55}.role-note{margin-top:13px;padding:11px;border:1px solid #e9dfc9;border-radius:4px;background:#fcf7e9;color:#776a4d;font-size:10px;line-height:1.55}.modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:17px}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:850px){.root-row{grid-template-columns:40px minmax(0,1fr) auto}.root-actions{grid-column:2/-1;justify-content:flex-start}.document-row{grid-template-columns:40px minmax(0,1fr)}.doc-actions{grid-column:2;justify-content:flex-start;padding-left:0}.detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:600px){.library{padding-top:27px}.page-heading{align-items:flex-start;flex-direction:column}.heading-actions{width:100%}.heading-actions .button{flex:1}.section-head{align-items:flex-start;flex-direction:column}.inline-actions{width:100%;justify-content:space-between}.root-row{grid-template-columns:36px minmax(0,1fr);gap:9px;padding:13px}.root-row>.status-badge{grid-column:2;justify-self:start}.root-actions{grid-column:2}.incomplete-state{align-items:flex-start;flex-wrap:wrap}.incomplete-state .button{margin-left:50px}.doc-heading{gap:10px}.search{width:100%}.search input{width:100%}.tabs{overflow-x:auto}.tabs button{flex:0 0 auto;padding:9px 8px;font-size:9px}.document-row{padding:13px;gap:9px}.doc-titleline{align-items:flex-start;flex-direction:column;gap:6px}.doc-actions{gap:12px}.page-footer{flex-direction:column;line-height:1.6}.modal-card{padding:18px}.detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.modal-actions{flex-wrap:wrap}.modal-actions .button{flex:1}.private-head{align-items:flex-start}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
</style>
