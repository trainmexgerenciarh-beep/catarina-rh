<script lang="ts">
  export let authorized = false;
  export let onImported: (() => void) | undefined = undefined;

  type ImportRow = {
    line: number;
    id_colaborador?: string;
    nombre?: string;
    whatsapp?: string;
    centro?: string | null;
    departamento?: string;
    puesto?: string;
    activo?: boolean;
    originalPhone?: string;
    originalStatus?: string;
    action: 'ALTA' | 'SIN_CAMBIOS' | 'CAMBIO_BLOQUEADO' | 'RECHAZO';
    reason: string;
    changes?: string[];
  };
  type Preview = {
    rows: ImportRow[];
    counts: { altas: number; sinCambios: number; cambios: number; rechazos: number };
  };
  type Source = 'sheet' | 'local';

  let source: Source = 'sheet';
  let text = '';
  let fileName = '';
  let preview: Preview | null = null;
  let token = '';
  let busy = false;
  let error = '';
  let notice = '';
  let confirmed = false;
  let successCount: number | null = null;
  let fileInput: HTMLInputElement;

  $: canConfirm = Boolean(preview && token && preview.counts.altas > 0 && confirmed && !busy);

  function invalidatePreview() {
    preview = null;
    token = '';
    confirmed = false;
    successCount = null;
    error = '';
    notice = '';
  }

  function changeSource(next: Source) {
    if (busy || source === next) return;
    source = next;
    invalidatePreview();
  }

  function changeText(value: string) {
    text = value;
    invalidatePreview();
  }

  async function readFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    invalidatePreview();
    if (!file) {
      fileName = '';
      return;
    }
    fileName = file.name;
    if (file.size > 200 * 1024) {
      text = '';
      error = 'El archivo supera el límite de 200 KB. Elige uno más pequeño.';
      input.value = '';
      fileName = '';
      return;
    }
    try {
      text = await file.text();
      error = '';
    } catch {
      text = '';
      error = 'No fue posible leer el archivo local. Inténtalo de nuevo.';
      input.value = '';
      fileName = '';
    }
  }

  async function requestPreview() {
    if (!authorized || busy) return;
    if (source === 'local' && !text.trim()) {
      error = 'Pega el contenido CSV/TSV o selecciona un archivo local antes de revisar.';
      return;
    }
    busy = true;
    error = '';
    notice = '';
    preview = null;
    token = '';
    confirmed = false;
    successCount = null;
    try {
      const body = source === 'sheet'
        ? { action: 'preview', source: 'sheet' }
        : { action: 'preview', source: 'local', text };
      const response = await fetch('/api/admin/directory-import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error || !payload.preview || typeof payload.token !== 'string') {
        throw new Error(payload.error || 'El servidor no devolvió una vista previa válida.');
      }
      const counts = payload.preview.counts;
      if (!Array.isArray(payload.preview.rows) || !counts ||
          !['altas', 'sinCambios', 'cambios', 'rechazos'].every((key) => Number.isFinite(counts[key]))) {
        throw new Error('La respuesta de vista previa está incompleta. No se habilitó el alta.');
      }
      preview = payload.preview as Preview;
      token = payload.token;
      notice = 'Vista previa recibida. Revisar no incorpora registros.';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'No se pudo generar la vista previa.';
    } finally {
      busy = false;
    }
  }

  async function confirmImport() {
    if (!authorized || !canConfirm || !preview || !token) return;
    busy = true;
    error = '';
    notice = '';
    try {
      const body = source === 'sheet'
        ? { action: 'confirm', token, source: 'sheet' }
        : { action: 'confirm', token, source: 'local', text };
      const response = await fetch('/api/admin/directory-import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error || !Number.isInteger(payload.inserted) || payload.updated !== 0) {
        const conflictMessage = response.status === 409 || response.status === 410
          ? 'La vista previa venció o el directorio cambió. Genera una vista previa nueva antes de confirmar.'
          : 'El servidor no confirmó el resultado. No se reportó el alta como exitosa.';
        throw new Error(payload.error || conflictMessage);
      }
      if (payload.inserted < 0) throw new Error('El servidor devolvió un resultado inválido. No se reportó el alta como exitosa.');
      successCount = payload.inserted;
      notice = `${payload.inserted} ${payload.inserted === 1 ? 'registro incorporado' : 'registros incorporados'}; no se actualizaron registros existentes.`;
      token = '';
      confirmed = false;
      onImported?.();
    } catch (reason) {
      preview = null;
      token = '';
      confirmed = false;
      error = reason instanceof Error
        ? reason.message
        : 'No se pudo confirmar. El token puede haber vencido o el directorio pudo cambiar; genera una vista previa nueva.';
    } finally {
      busy = false;
    }
  }

  function display(value: string | null | undefined) {
    if (value === null && value !== undefined) return 'A DEFINIR (opcional)';
    return value?.trim() || '—';
  }

  function statusLabel(value: boolean | undefined) {
    return value === undefined ? '—' : value ? 'Activo' : 'Inactivo';
  }

  function actionLabel(action: ImportRow['action']) {
    return action === 'ALTA' ? 'Alta posible' :
      action === 'SIN_CAMBIOS' ? 'Sin cambios' :
      action === 'CAMBIO_BLOQUEADO' ? 'Cambio bloqueado' : 'Rechazo';
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet" />
</svelte:head>

{#if authorized}
  <section class="directory-import" aria-labelledby="import-title">
    <header class="page-heading">
      <div>
        <span class="eyebrow">CATARINA RH · RECEPCIÓN INTERNA</span>
        <h1 id="import-title">Importar directorio</h1>
        <p>Revisa la información privada antes de decidir si se incorporan nuevas personas.</p>
      </div>
      <span class="admin-stamp"><i></i> ADMINISTRADOR</span>
    </header>

    <aside class="security-note" aria-label="Reglas de importación">
      <span class="note-mark" aria-hidden="true">i</span>
      <div>
        <strong>Vista previa y alta son pasos distintos.</strong>
        <p>Los registros existentes jamás se sobrescriben y las personas ausentes de la entrada no se desactivan. El alta solo agrega nuevos registros tras una confirmación expresa.</p>
      </div>
    </aside>

    {#if error}<div class="alert error" role="alert"><span>{error}</span>{#if preview}<button type="button" on:click={requestPreview} disabled={busy}>Generar vista previa nueva</button>{/if}</div>{/if}
    {#if notice}<div class="alert success" role="status">{notice}</div>{/if}

    <section class="source-panel" aria-labelledby="source-title">
      <div class="section-head">
        <div><span class="eyebrow">ORIGEN DE DATOS</span><h2 id="source-title">Elige una entrada para revisar</h2></div>
        <span class="small-tag">MÁXIMO LOCAL · 200 KB</span>
      </div>
      <div class="source-options" role="group" aria-label="Fuente del directorio">
        <button type="button" class:chosen={source === 'sheet'} class="source-choice" on:click={() => changeSource('sheet')} aria-pressed={source === 'sheet'} disabled={busy}>
          <span class="source-index">01</span><span><strong>Hoja configurada</strong><small>Hoja 1 · conexión ya establecida</small></span><i class="choice-mark"></i>
        </button>
        <button type="button" class:chosen={source === 'local'} class="source-choice" on:click={() => changeSource('local')} aria-pressed={source === 'local'} disabled={busy}>
          <span class="source-index">02</span><span><strong>Archivo o texto local</strong><small>CSV o TSV · no se envía a Sheets</small></span><i class="choice-mark"></i>
        </button>
      </div>

      {#if source === 'local'}
        <div class="local-input">
          <label class="form-field" for="directory-file"><span>Archivo local <em>CSV / TSV</em></span></label>
          <div class="file-row">
            <input bind:this={fileInput} id="directory-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" on:change={readFile} disabled={busy} />
            {#if fileName}<span class="file-name" title={fileName}>{fileName}</span>{/if}
          </div>
          <label class="form-field" for="directory-text"><span>O pega el contenido</span></label>
          <textarea id="directory-text" value={text} on:input={(event) => changeText((event.currentTarget as HTMLTextAreaElement).value)} rows="6" maxlength="204800" placeholder="número de empleado,nombre completo,departamento,WhatsApp,puesto,estatus&#10;…" disabled={busy}></textarea>
          <p class="field-hint">El texto se conserva solo en esta pantalla y se envía al endpoint privado para generar la vista previa.</p>
        </div>
      {/if}

      <div class="source-actions">
        <span class="privacy-label"><i></i>{source === 'sheet' ? 'Lectura del origen configurado' : 'Archivo local privado · sin transferencia a Sheets'}</span>
        <button class="button primary" type="button" on:click={requestPreview} disabled={busy || (source === 'local' && !text.trim())}>
          {busy ? 'Revisando…' : 'Generar vista previa'} <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>

    {#if busy && !preview}
      <section class="preview-loading" aria-label="Generando vista previa"><div class="loading-head"></div><div class="loading-row"></div><div class="loading-row"></div><span>Revisando la entrada sin incorporarla…</span></section>
    {/if}

    {#if preview}
      <section class="preview-section" aria-labelledby="preview-title">
        <div class="section-head preview-title-row">
          <div><span class="eyebrow">REVISIÓN · {source === 'sheet' ? 'HOJA CONFIGURADA' : 'ENTRADA LOCAL'}</span><h2 id="preview-title">Resultado por fila</h2></div>
          <span class="count-tag">{preview.rows.length} {preview.rows.length === 1 ? 'fila' : 'filas'}</span>
        </div>

        <div class="summary-strip" aria-label="Resumen de resultados">
          <div class="summary-item add"><strong>{preview.counts.altas}</strong><span>Altas posibles</span></div>
          <div class="summary-item"><strong>{preview.counts.sinCambios}</strong><span>Sin cambios</span></div>
          <div class="summary-item blocked"><strong>{preview.counts.cambios}</strong><span>Cambios bloqueados</span></div>
          <div class="summary-item rejected"><strong>{preview.counts.rechazos}</strong><span>Rechazos</span></div>
        </div>

        {#if preview.rows.length}
          <div class="row-list">
            {#each preview.rows as row (row.line)}
              <article class="preview-row">
                <div class="row-top">
                  <span class="line-number">LÍNEA {row.line}</span>
                  <span class:status-add={row.action === 'ALTA'} class:status-blocked={row.action === 'CAMBIO_BLOQUEADO'} class:status-rejected={row.action === 'RECHAZO'} class="action-badge">{actionLabel(row.action)}</span>
                </div>
                <div class="identity">
                  <strong>{display(row.nombre)}</strong>
                  <span class="employee-id">{display(row.id_colaborador)}</span>
                </div>
                <div class="field-grid">
                  <div class="data-cell phone-cell"><span>WhatsApp normalizado</span><strong>{display(row.whatsapp)}</strong>{#if row.originalPhone && row.originalPhone !== row.whatsapp}<small>Entrada: {row.originalPhone}</small>{/if}</div>
                  <div class="data-cell"><span>Estatus</span><strong>{statusLabel(row.activo)}</strong>{#if row.originalStatus}<small>Entrada: {row.originalStatus}</small>{/if}</div>
                  <div class="data-cell"><span>Centro</span><strong class:undefined-center={row.centro === null}>{display(row.centro)}</strong></div>
                  <div class="data-cell"><span>Departamento</span><strong>{display(row.departamento)}</strong></div>
                  <div class="data-cell"><span>Puesto</span><strong>{display(row.puesto)}</strong></div>
                </div>
                {#if row.changes?.length}
                  <div class="change-details"><span>Campos detectados</span><p>{row.changes.join(' · ')}</p></div>
                {/if}
                <p class="row-reason">{row.reason || 'Sin observaciones adicionales.'}</p>
              </article>
            {/each}
          </div>
        {:else}
          <div class="empty-state"><span class="empty-mark">RH</span><strong>No hay filas para revisar.</strong><p>La fuente respondió sin registros de entrada. No se realizó ningún alta.</p></div>
        {/if}

        {#if preview.counts.altas > 0 && token}
          <section class="confirm-panel" aria-labelledby="confirm-heading">
            <div class="confirm-copy">
              <span class="eyebrow">DECISIÓN DEL ADMINISTRADOR</span>
              <h3 id="confirm-heading">Solo se agregarán las altas posibles.</h3>
              <p>Los cambios detectados en registros existentes quedan bloqueados. Los registros ausentes no se desactivan.</p>
            </div>
            <label class="confirm-check"><input type="checkbox" bind:checked={confirmed} disabled={busy} /><span>Confirmo que revisé las filas y autorizo incorporar únicamente las <strong>{preview.counts.altas} altas posibles</strong>.</span></label>
            <button class="button primary confirm-button" type="button" on:click={confirmImport} disabled={!canConfirm}>
              {busy ? 'Confirmando…' : 'Confirmar altas'}
            </button>
          </section>
        {:else if preview.counts.altas === 0}
          <div class="no-insert"><strong>No hay altas posibles.</strong><span>La confirmación no está disponible; revisar esta entrada no modificó el directorio.</span></div>
        {/if}
      </section>
    {/if}

    {#if successCount !== null}
      <div class="completed" role="status"><span class="completed-mark">✓</span><div><strong>Operación confirmada por el servidor</strong><p>{successCount} altas agregadas. Registros existentes sin cambios.</p></div></div>
    {/if}

    <footer class="page-footer"><span>CATARINA RH <i>/</i> MANUFACTURAS TRAINMEX</span><span>DATOS PRIVADOS · ACCESO AUTORIZADO</span></footer>
  </section>
{:else}
  <section class="restricted-state" role="alert">
    <span class="eyebrow">ACCESO RESTRINGIDO · CATARINA RH</span>
    <h1>Solo para administración</h1>
    <p>La recepción e incorporación del directorio está reservada al administrador autorizado de Trainmex.</p>
  </section>
{/if}

<style>
  .directory-import{--ink:#183b39;--deep:#244e47;--muted:#718179;--line:#e3e6dc;--paper:#fbfbf7;--coral:#d5795f;--sage:#e5ebe1;max-width:1480px;margin:0 auto;padding:38px clamp(18px,4vw,58px) 22px;color:var(--ink);font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
  .directory-import *,.restricted-state *{box-sizing:border-box}
  .directory-import button,.directory-import input,.directory-import textarea{font:inherit}
  .directory-import :focus-visible,.restricted-state :focus-visible{outline:3px solid var(--coral);outline-offset:3px}
  .page-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:25px}
  .eyebrow{display:block;color:#718d80;font:10px 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase}
  h1{margin:9px 0 8px;color:var(--ink);font:500 clamp(30px,3.5vw,43px)/1.12 'Fraunces',serif;letter-spacing:-.035em}
  .page-heading p{margin:0;color:var(--muted);font-size:13px;line-height:1.65}
  .admin-stamp{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #d9e3d6;border-radius:4px;background:#f3f6ef;color:#53745e;font:9px 'DM Mono',monospace;letter-spacing:.08em;white-space:nowrap}
  .admin-stamp i,.privacy-label i{width:7px;height:7px;border-radius:50%;background:#5e9b67}
  .security-note{display:flex;align-items:flex-start;gap:13px;margin:0 0 25px;padding:15px 17px;border:1px solid #e9dfc9;border-left:3px solid #d5a55c;border-radius:5px;background:#fcf7e9}
  .note-mark{display:grid;place-items:center;flex:0 0 21px;height:21px;border:1px solid #c8a956;border-radius:50%;color:#8c7741;font:11px 'DM Mono',monospace}
  .security-note strong{display:block;color:#574f3b;font-size:12px}
  .security-note p{margin:5px 0 0;color:#746d58;font-size:11px;line-height:1.6}
  .alert{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px;padding:11px 14px;border:1px solid;border-radius:5px;font-size:11px;line-height:1.5}
  .alert.success{border-color:#cbdcc8;background:#edf4e9;color:#3d664d}
  .alert.error{border-color:#e6c6bd;background:#fbefeb;color:#94503f}
  .alert button{flex-shrink:0;border:0;background:none;color:inherit;font-size:11px;font-weight:700;text-decoration:underline;cursor:pointer}
  .source-panel,.preview-section{padding:20px;border:1px solid var(--line);border-radius:7px;background:var(--paper)}
  .section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:14px}
  .section-head h2{margin:7px 0 0;color:#294b42;font:500 22px/1.2 'Fraunces',serif}
  .small-tag,.count-tag{padding:6px 9px;border:1px solid #e2e6dc;border-radius:4px;background:#f8f8f3;color:#75867b;font:9px 'DM Mono',monospace;letter-spacing:.06em;white-space:nowrap}
  .source-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .source-choice{display:flex;align-items:center;gap:13px;min-width:0;padding:14px;border:1px solid #e1e5dc;border-radius:5px;background:#fbfbf7;text-align:left;cursor:pointer;transition:border-color .18s ease,background .18s ease,transform .18s ease}
  .source-choice:hover{transform:translateY(-1px);border-color:#a8b9a9}
  .source-choice.chosen{border-color:#6c9179;background:#f0f5ed;box-shadow:inset 0 0 0 1px #6c9179}
  .source-index{color:#91a096;font:10px 'DM Mono',monospace}
  .source-choice>span:nth-child(2){display:grid;gap:4px;flex:1;min-width:0}
  .source-choice strong{color:#36574a;font-size:12px}
  .source-choice small{color:#849187;font-size:10px;line-height:1.4}
  .choice-mark{width:13px;height:13px;border:1px solid #bec9bd;border-radius:50%}
  .chosen .choice-mark{border:4px solid #557a60;background:#f6f7f1}
  .local-input{margin-top:19px;padding-top:17px;border-top:1px solid #e9ebe4}
  .form-field{display:grid;gap:7px;margin:0 0 8px;color:#50675c;font-size:11px;font-weight:600}
  .form-field em{color:#879589;font-size:9px;font-style:normal;font-weight:500}
  .file-row{display:flex;align-items:center;gap:12px;margin-bottom:15px;min-height:37px}
  .file-row input{max-width:100%;color:#60736a;font-size:10px}
  .file-row input::file-selector-button{min-height:34px;margin-right:9px;padding:0 11px;border:1px solid #d9dfd6;border-radius:4px;background:#f7f8f2;color:#42624f;font:600 10px 'DM Sans',sans-serif;cursor:pointer}
  .file-name{max-width:240px;overflow:hidden;color:#718179;font:9px 'DM Mono',monospace;text-overflow:ellipsis;white-space:nowrap}
  textarea{display:block;width:100%;resize:vertical;min-height:115px;padding:11px;border:1px solid #d9dfd6;border-radius:4px;background:#fffefa;color:#294b42;font:11px/1.55 'DM Mono',monospace}
  textarea::placeholder{color:#aab3aa}
  .field-hint{margin:7px 0 0;color:#89968d;font-size:10px;line-height:1.55}
  .source-actions{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-top:18px;padding-top:15px;border-top:1px solid #e9ebe4}
  .privacy-label{display:inline-flex;align-items:center;gap:8px;color:#789083;font:9px 'DM Mono',monospace;line-height:1.5}
  .privacy-label i{width:6px;height:6px;flex:0 0 6px}
  .button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:40px;padding:0 15px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;transition:background .18s ease,transform .18s ease,border-color .18s ease}
  .button:hover:not(:disabled){transform:translateY(-1px)}
  .button:disabled{opacity:.54;cursor:not-allowed}
  .primary{border:1px solid var(--deep);background:var(--deep);color:#f6f2e7}
  .primary:hover:not(:disabled){background:#193d38}
  .button.primary>span{font-size:16px;font-weight:400}
  .preview-loading{display:grid;gap:11px;margin-top:23px;padding:20px;border:1px solid var(--line);border-radius:7px;background:var(--paper)}
  .preview-loading>span{color:#78877e;font-size:10px}
  .loading-head,.loading-row{height:12px;border-radius:5px;background:linear-gradient(90deg,#e9ece4,#f3f4ee,#e9ece4);background-size:200% 100%;animation:shimmer 1.5s ease-in-out infinite}
  .loading-head{width:36%;height:18px}.loading-row{width:100%;height:42px}
  @keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
  .preview-section{margin-top:23px}
  .preview-title-row{margin-bottom:17px}
  .summary-strip{display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden;margin-bottom:17px;border:1px solid #e4e7df;border-radius:5px;background:#f8f8f3}
  .summary-item{display:grid;gap:4px;padding:12px 14px;border-right:1px solid #e6e8e1}
  .summary-item:last-child{border-right:0}
  .summary-item strong{color:#36574a;font:500 22px 'Fraunces',serif}
  .summary-item span{color:#839087;font:9px 'DM Mono',monospace}
  .summary-item.add strong{color:#4f8059}.summary-item.blocked strong{color:#a36c43}.summary-item.rejected strong{color:#a65c48}
  .row-list{display:grid;gap:10px}
  .preview-row{padding:15px;border:1px solid #e4e7df;border-radius:5px;background:#fffefa}
  .row-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px}
  .line-number{color:#96a197;font:9px 'DM Mono',monospace;letter-spacing:.08em}
  .action-badge{padding:5px 8px;border-radius:3px;background:#f0f1ec;color:#738078;font:9px 'DM Mono',monospace}
  .action-badge.status-add{background:#e9f2e7;color:#42714d}
  .action-badge.status-blocked{background:#f7efe3;color:#93663e}
  .action-badge.status-rejected{background:#f8ece8;color:#9b5747}
  .identity{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
  .identity strong{color:#294b42;font-size:13px;overflow-wrap:anywhere}
  .employee-id{color:#89968d;font:9px 'DM Mono',monospace;overflow-wrap:anywhere}
  .field-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
  .data-cell{display:grid;align-content:start;gap:5px;min-width:0;padding:9px;background:#f7f8f3;border-radius:3px}
  .data-cell>span,.change-details>span{color:#8a988e;font:8px 'DM Mono',monospace;letter-spacing:.04em;text-transform:uppercase}
  .data-cell strong{color:#4c6257;font-size:10px;font-weight:600;overflow-wrap:anywhere}
  .data-cell strong.undefined-center{color:#8d774d;font:9px 'DM Mono',monospace}
  .data-cell small{color:#9a8172;font-size:9px;overflow-wrap:anywhere}
  .change-details{display:flex;align-items:flex-start;gap:10px;margin-top:10px;padding:9px 10px;border-left:2px solid #d7b87f;background:#fcf8ed}
  .change-details>span{flex:0 0 auto;padding-top:2px;color:#8e7852}
  .change-details p{margin:0;color:#70664e;font-size:10px;line-height:1.5;overflow-wrap:anywhere}
  .row-reason{margin:10px 0 0;color:#829087;font-size:10px;line-height:1.55}
  .empty-state{display:grid;justify-items:center;padding:32px 20px;border:1px dashed #d9dfd6;border-radius:7px;background:#f9f9f4;text-align:center}
  .empty-mark{display:grid;place-items:center;width:36px;height:36px;margin-bottom:11px;border-radius:11px 11px 11px 3px;background:#e5ebe1;color:#315b4e;font:500 11px 'DM Mono',monospace}
  .empty-state strong{color:#36574a;font:500 19px 'Fraunces',serif}
  .empty-state p{max-width:400px;margin:6px 0 0;color:#839087;font-size:10px;line-height:1.6}
  .confirm-panel{display:grid;grid-template-columns:1fr auto;align-items:center;gap:16px;margin-top:17px;padding:17px;border:1px solid #d6e1d2;border-radius:5px;background:#f0f5ec}
  .confirm-copy h3{margin:7px 0 4px;color:#294b42;font:500 19px 'Fraunces',serif}
  .confirm-copy p{max-width:590px;margin:0;color:#718179;font-size:10px;line-height:1.55}
  .confirm-check{display:flex;grid-column:1;align-items:flex-start;gap:9px;max-width:590px;color:#5c6f62;font-size:10px;line-height:1.55;cursor:pointer}
  .confirm-check input{width:15px;height:15px;flex:0 0 15px;margin:0;accent-color:#41684e}
  .confirm-check strong{color:#365c43}
  .confirm-button{grid-column:2;grid-row:1 / span 2;min-width:155px}
  .no-insert{display:flex;align-items:center;gap:10px;margin-top:17px;padding:12px 14px;border:1px solid #e6e8e0;border-radius:5px;background:#f7f8f3;color:#718179;font-size:10px;line-height:1.5}
  .no-insert strong{color:#4d6756}
  .completed{display:flex;align-items:center;gap:12px;margin-top:17px;padding:14px;border:1px solid #cbdcc8;border-radius:5px;background:#edf4e9}
  .completed-mark{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#dcebd8;color:#47754f;font-size:13px}
  .completed strong{color:#3d664d;font-size:11px}.completed p{margin:4px 0 0;color:#65806a;font-size:10px}
  .page-footer{display:flex;justify-content:space-between;gap:12px;margin-top:32px;padding:17px 0 0;border-top:1px solid #e3e5dc;color:#90a096;font:9px 'DM Mono',monospace;letter-spacing:.06em}
  .page-footer i{padding:0 5px;color:var(--coral);font-style:normal}
  .restricted-state{max-width:1480px;margin:0 auto;padding:clamp(35px,7vw,75px) clamp(18px,4vw,58px);color:#183b39;font-family:'DM Sans',sans-serif}
  .restricted-state h1{font:500 clamp(30px,3.5vw,43px)/1.12 'Fraunces',serif}
  .restricted-state p{max-width:520px;color:#718179;font-size:13px;line-height:1.7}
  @media(max-width:850px){.field-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.confirm-panel{grid-template-columns:1fr}.confirm-button{grid-column:1;grid-row:auto;justify-self:start}}
  @media(max-width:600px){.directory-import{padding-top:27px}.page-heading{align-items:flex-start;flex-direction:column}.admin-stamp{align-self:flex-start}.source-panel,.preview-section{padding:15px}.section-head{align-items:flex-start}.source-options{grid-template-columns:1fr}.source-actions{align-items:stretch;flex-direction:column}.source-actions .button{width:100%}.summary-item{padding:10px 8px}.summary-item strong{font-size:19px}.summary-item span{font-size:8px;line-height:1.35}.field-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.identity{align-items:flex-start;flex-direction:column;gap:4px}.preview-row{padding:12px}.change-details{flex-direction:column;gap:5px}.no-insert{align-items:flex-start;flex-direction:column}.page-footer{flex-direction:column;line-height:1.6}.small-tag{font-size:8px}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
</style>
