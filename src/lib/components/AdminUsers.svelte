<script lang="ts">
  export let authorized = false;

  type UserRole = 'gerente' | 'generalista';
  type UserRow = { email: string; role: UserRole; activo: boolean; revision: string | number };
  type AuditRow = { actor: string; accion: string; cuenta: string; fecha: string };
  type Action = 'add' | 'edit' | 'activate' | 'deactivate' | 'revoke';

  let rows: UserRow[] = [];
  let audit: AuditRow[] = [];
  let loading = false;
  let busy = false;
  let loaded = false;
  let attempted = false;
  let error = '';
  let notice = '';
  let editorOpen = false;
  let editing: UserRow | null = null;
  let email = '';
  let newEmail = '';
  let dialogAction: Action | '' = '';
  let dialogUser: UserRow | null = null;

  $: if (authorized && !attempted) {
    attempted = true;
    void loadUsers();
  }

  async function loadUsers() {
    if (!authorized || loading) return;
    loading = true;
    error = '';
    try {
      const response = await fetch('/api/admin/users', { credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw new Error(payload.error || 'No fue posible cargar las cuentas administrativas.');
      rows = Array.isArray(payload.rows) ? payload.rows : [];
      audit = Array.isArray(payload.audit) ? payload.audit : [];
      loaded = true;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Ocurrió un error al consultar las cuentas.';
    } finally {
      loading = false;
    }
  }

  function openAdd() {
    editing = null;
    email = '';
    newEmail = '';
    error = '';
    notice = '';
    editorOpen = true;
  }

  function openEdit(user: UserRow) {
    if (user.role === 'gerente') return;
    editing = user;
    email = user.email;
    newEmail = user.email;
    error = '';
    notice = '';
    editorOpen = true;
  }

  function requestAction(action: Action, user: UserRow) {
    if (user.role === 'gerente') return;
    dialogAction = action;
    dialogUser = user;
    error = '';
  }

  function closeDialogs() {
    if (busy) return;
    editorOpen = false;
    dialogAction = '';
    dialogUser = null;
    error = '';
  }

  async function postAction(action: Action, account: string, changedEmail = '') {
    busy = true;
    error = '';
    notice = '';
    const body: Record<string, string> = {
      action,
      email: account,
      role: 'generalista'
    };
    if (action === 'edit') body.newEmail = changedEmail;
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error || payload.ok === false) {
        throw new Error(payload.error || 'El servidor no confirmó el cambio.');
      }
      editorOpen = false;
      dialogAction = '';
      dialogUser = null;
      notice = action === 'add' ? 'Cuenta agregada.' :
        action === 'edit' ? 'Correo actualizado.' :
        action === 'activate' ? 'Cuenta activada.' :
        action === 'deactivate' ? 'Cuenta desactivada.' : 'Acceso revocado.';
      loaded = false;
      await loadUsers();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'No se pudo completar la operación.';
    } finally {
      busy = false;
    }
  }

  async function submitEditor(event: SubmitEvent) {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanNewEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail || (editing && !cleanNewEmail)) return;
    await postAction(editing ? 'edit' : 'add', cleanEmail, cleanNewEmail);
  }

  async function confirmAction() {
    if (!dialogAction || !dialogUser || busy) return;
    await postAction(dialogAction, dialogUser.email);
  }

  function actionTitle(action: Action) {
    return action === 'activate' ? 'Activar cuenta' :
      action === 'deactivate' ? 'Desactivar cuenta' : 'Revocar acceso';
  }

  function actionDescription(action: Action, account: string) {
    if (action === 'activate') return `La cuenta ${account} podrá volver a iniciar sesión con su credencial privada.`;
    if (action === 'deactivate') return `La cuenta ${account} dejará de tener acceso mientras permanezca desactivada.`;
    return `Se desactivará ${account} y se invalidarán sus sesiones. Podrás reactivarla; las sesiones anteriores no reviven.`;
  }

  function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || '—';
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Mexico_City'
    }).format(date);
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet" />
</svelte:head>

{#if authorized}
  <section class="admin-users" aria-labelledby="users-title">
    <header class="page-heading">
      <div>
        <span class="eyebrow">CATARINA RH · ADMINISTRACIÓN</span>
        <h1 id="users-title">Usuarios y accesos</h1>
        <p>Gestiona quién puede entrar al espacio administrativo de Trainmex.</p>
      </div>
      <div class="heading-actions">
        <button class="button secondary refresh" type="button" on:click={() => { loaded = false; void loadUsers(); }} disabled={loading || busy}>
          <span aria-hidden="true">↻</span><span>Actualizar</span>
        </button>
        <button class="button primary" type="button" on:click={openAdd} disabled={busy}>
          <span aria-hidden="true">+</span>Agregar cuenta
        </button>
      </div>
    </header>

    <aside class="security-note" aria-label="Nota de seguridad">
      <span class="note-mark" aria-hidden="true">i</span>
      <div>
        <strong>El correo identifica la cuenta; no otorga acceso.</strong>
        <p>El inicio de sesión requiere una credencial privada configurada por la persona titular. Catarina RH no muestra, almacena ni envía contraseñas o tokens desde esta pantalla.</p>
      </div>
    </aside>

    {#if notice}<div class="alert success" role="status">{notice}</div>{/if}
    {#if error && !editorOpen && !dialogAction}
      <div class="alert error" role="alert"><span>{error}</span><button type="button" on:click={() => { loaded = false; void loadUsers(); }}>Reintentar</button></div>
    {/if}

    <section class="accounts-section" aria-labelledby="account-list-title">
      <div class="section-head">
        <div><span class="eyebrow">CUENTAS AUTORIZADAS</span><h2 id="account-list-title">Administración de cuentas</h2></div>
        {#if loaded}<span class="count-tag">{rows.length} {rows.length === 1 ? 'cuenta' : 'cuentas'}</span>{/if}
      </div>

      {#if loading && !loaded}
        <div class="account-skeleton" aria-label="Cargando cuentas">
          <div class="skeleton-row"><i></i><i></i><i></i></div>
          <div class="skeleton-row"><i></i><i></i><i></i></div>
        </div>
      {:else if !error || loaded}
        {#if rows.length}
          <div class="account-list">
            {#each rows as user (user.email)}
              <article class="account-row">
                <div class="account-ident">
                  <span class="account-avatar" aria-hidden="true">{user.role === 'gerente' ? 'G' : 'RH'}</span>
                  <div class="account-details">
                    <strong>{user.email}</strong>
                    <span>Revisión {user.revision}</span>
                  </div>
                </div>
                <div class="account-meta">
                  <span class:manager-role={user.role === 'gerente'} class="role-badge">{user.role === 'gerente' ? 'Gerente' : 'Generalista'}</span>
                  <span class:inactive={!user.activo} class="status-badge"><i></i>{user.activo ? 'Activa' : 'Inactiva'}</span>
                </div>
                <div class="row-actions">
                  {#if user.role === 'gerente'}
                    <span class="locked-label">Administración protegida</span>
                  {:else}
                    <button class="text-action" type="button" on:click={() => openEdit(user)}>Editar correo</button>
                    <button class:danger-action={user.activo} class="text-action" type="button" on:click={() => requestAction(user.activo ? 'deactivate' : 'activate', user)}>
                      {user.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button class="text-action danger-action" type="button" on:click={() => requestAction('revoke', user)}>Revocar</button>
                  {/if}
                </div>
              </article>
            {/each}
          </div>
        {:else if !loading}
          <div class="empty-state">
            <span class="empty-mark">RH</span>
            <span class="eyebrow">SIN CUENTAS DISPONIBLES</span>
            <h3>No hay cuentas para mostrar.</h3>
            <p>La respuesta del servicio no contiene cuentas administrativas en este momento.</p>
          </div>
        {/if}
      {/if}
    </section>

    <section class="audit-section" aria-labelledby="audit-title">
      <div class="section-head">
        <div><span class="eyebrow">TRAZABILIDAD</span><h2 id="audit-title">Actividad reciente</h2></div>
        <span class="small-tag">REGISTRO DEL SERVIDOR</span>
      </div>
      {#if loading && !loaded}
        <div class="audit-skeleton" aria-label="Cargando auditoría"><i></i><i></i></div>
      {:else if audit.length}
        <div class="audit-table-wrap">
          <table>
            <thead><tr><th>Quién</th><th>Acción</th><th>Cuenta</th><th>Fecha</th></tr></thead>
            <tbody>
              {#each audit.slice(0, 8) as entry, index (`${entry.fecha}-${index}`)}
                <tr><td>{entry.actor || '—'}</td><td>{entry.accion || '—'}</td><td>{entry.cuenta || '—'}</td><td>{formatDate(entry.fecha)}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if loaded}
        <p class="audit-empty">No hay movimientos de auditoría disponibles.</p>
      {/if}
    </section>

    <footer class="page-footer"><span>CATARINA RH <i>/</i> MANUFACTURAS TRAINMEX</span><span>ACCESO AUTORIZADO · USO INTERNO</span></footer>
  </section>

  {#if editorOpen}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) closeDialogs(); }}>
      <div class="modal-card" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="editor-title">
        <div class="modal-head">
          <div><span class="eyebrow">CUENTAS · GENERALISTA</span><h2 id="editor-title">{editing ? 'Editar correo gestor' : 'Agregar cuenta'}</h2></div>
          <button class="close-button" type="button" aria-label="Cerrar formulario" on:click={closeDialogs} disabled={busy}>×</button>
        </div>
        {#if error}<p class="alert error modal-alert" role="alert">{error}</p>{/if}
        <form on:submit={submitEditor}>
          {#if editing}
            <label class="form-field"><span>Correo actual</span><input type="email" bind:value={email} autocomplete="email" required readonly /></label>
            <label class="form-field"><span>Correo nuevo <em>Obligatorio</em></span><input type="email" bind:value={newEmail} autocomplete="email" required maxlength="254" /></label>
          {:else}
            <label class="form-field"><span>Correo gestor <em>Obligatorio</em></span><input type="email" bind:value={email} autocomplete="email" required maxlength="254" /></label>
          {/if}
          <div class="role-display"><span>Rol asignado</span><strong>Generalista</strong><small>El rol se administra desde este flujo y no puede cambiarse aquí.</small></div>
          <p class="form-note">La persona titular deberá configurar su credencial privada por el canal autorizado. Este formulario no crea ni envía contraseñas.</p>
          <div class="modal-actions"><button class="button secondary" type="button" on:click={closeDialogs} disabled={busy}>Cancelar</button><button class="button primary" type="submit" disabled={busy}>{busy ? 'Guardando…' : editing ? 'Guardar correo' : 'Agregar cuenta'}</button></div>
        </form>
      </div>
    </div>
  {/if}

  {#if dialogAction && dialogUser}
    <div class="modal-backdrop" role="presentation" on:click={(event) => { if (event.target === event.currentTarget) closeDialogs(); }}>
      <div class="modal-card compact-modal" role="alertdialog" tabindex="-1" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <div class="modal-head">
          <div><span class="eyebrow">CONFIRMACIÓN · ACCESO</span><h2 id="confirm-title">{actionTitle(dialogAction)}</h2></div>
          <button class="close-button" type="button" aria-label="Cerrar confirmación" on:click={closeDialogs} disabled={busy}>×</button>
        </div>
        {#if error}<p class="alert error modal-alert" role="alert">{error}</p>{/if}
        <p class="confirm-copy" id="confirm-description">{actionDescription(dialogAction, dialogUser.email)}</p>
        <div class="modal-actions">
          <button class="button secondary" type="button" on:click={closeDialogs} disabled={busy}>Cancelar</button>
          <button class:danger-button={dialogAction !== 'activate'} class="button primary" type="button" on:click={confirmAction} disabled={busy}>{busy ? 'Procesando…' : actionTitle(dialogAction)}</button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .admin-users{--ink:#183b39;--deep:#244e47;--muted:#718179;--line:#e3e6dc;--paper:#fbfbf7;--coral:#d5795f;--sage:#e5ebe1;max-width:1480px;margin:0 auto;padding:38px clamp(18px,4vw,58px) 22px;color:var(--ink);font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
  .admin-users *{box-sizing:border-box}
  .admin-users button,.modal-card input{font:inherit}
  .admin-users :focus-visible{outline:3px solid var(--coral);outline-offset:3px}
  .page-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:25px}
  .eyebrow{display:block;color:#718d80;font:10px 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase}
  h1{margin:9px 0 8px;color:var(--ink);font:500 clamp(30px,3.5vw,43px)/1.12 'Fraunces',serif;letter-spacing:-.035em}
  .page-heading p{margin:0;color:var(--muted);font-size:13px;line-height:1.65}
  .heading-actions{display:flex;align-items:center;gap:9px;flex-shrink:0}
  .button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:40px;padding:0 15px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;transition:background .18s ease,transform .18s ease,border-color .18s ease}
  .button:hover:not(:disabled){transform:translateY(-1px)}
  .button:disabled{opacity:.56;cursor:not-allowed}
  .primary{border:1px solid var(--deep);background:var(--deep);color:#f6f2e7}
  .primary:hover:not(:disabled){background:#193d38}
  .secondary{border:1px solid #d9dfd6;background:var(--paper);color:#3e5b50}
  .secondary:hover:not(:disabled){border-color:#9eb3a1}
  .button.primary>span{font-size:17px;font-weight:400}
  .refresh>span:first-child{font-size:18px}
  .security-note{display:flex;align-items:flex-start;gap:13px;margin:0 0 28px;padding:15px 17px;border:1px solid #e9dfc9;border-left:3px solid #d5a55c;border-radius:5px;background:#fcf7e9}
  .note-mark{display:grid;place-items:center;flex:0 0 21px;height:21px;border:1px solid #c8a956;border-radius:50%;color:#8c7741;font:11px 'DM Mono',monospace}
  .security-note strong{display:block;color:#574f3b;font-size:12px}
  .security-note p{margin:5px 0 0;color:#746d58;font-size:11px;line-height:1.6}
  .alert{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 18px;padding:11px 14px;border:1px solid;border-radius:5px;font-size:11px;line-height:1.5}
  .alert.success{border-color:#cbdcc8;background:#edf4e9;color:#3d664d}
  .alert.error{border-color:#e6c6bd;background:#fbefeb;color:#94503f}
  .alert button{border:0;background:none;color:inherit;font-size:11px;font-weight:700;text-decoration:underline;cursor:pointer}
  .accounts-section,.audit-section{margin-top:28px}
  .section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:12px}
  .section-head h2{margin:7px 0 0;color:#294b42;font:500 22px/1.2 'Fraunces',serif}
  .count-tag,.small-tag{padding:6px 9px;border:1px solid #e2e6dc;border-radius:4px;background:#f8f8f3;color:#75867b;font:9px 'DM Mono',monospace;letter-spacing:.06em}
  .account-list{overflow:hidden;border:1px solid var(--line);border-radius:7px;background:var(--paper)}
  .account-row{display:grid;grid-template-columns:minmax(200px,1.4fr) minmax(170px,.8fr) minmax(230px,1fr);align-items:center;gap:16px;padding:17px 19px;border-bottom:1px solid #eaebe4}
  .account-row:last-child{border-bottom:0}
  .account-ident{display:flex;align-items:center;gap:12px;min-width:0}
  .account-avatar{display:grid;place-items:center;flex:0 0 38px;height:38px;border-radius:12px 12px 12px 3px;background:#e1e9dd;color:#315b4e;font:500 12px 'DM Mono',monospace}
  .account-details{display:grid;gap:4px;min-width:0}
  .account-details strong{overflow-wrap:anywhere;color:#294b42;font-size:12px;font-weight:700}
  .account-details span{color:#91a096;font:9px 'DM Mono',monospace}
  .account-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .role-badge,.status-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border-radius:4px;background:#e9efe7;color:#496c55;font:9px 'DM Mono',monospace}
  .role-badge.manager-role{background:#f5eadb;color:#835a3c}
  .status-badge{background:#edf4e9;color:#3e704e}
  .status-badge i{width:6px;height:6px;border-radius:50%;background:#5e9b67}
  .status-badge.inactive{background:#f1f1ec;color:#7e8880}
  .status-badge.inactive i{background:#9ba39b}
  .row-actions{display:flex;justify-content:flex-end;align-items:center;gap:14px;flex-wrap:wrap}
  .text-action{padding:4px 0;border:0;background:none;color:#557267;font-size:10px;font-weight:700;cursor:pointer}
  .text-action:hover{text-decoration:underline}
  .text-action.danger-action{color:#a65c48}
  .locked-label{color:#85958b;font:9px 'DM Mono',monospace}
  .empty-state{display:grid;justify-items:center;padding:39px 20px;border:1px dashed #d9dfd6;border-radius:7px;background:#f9f9f4;text-align:center}
  .empty-mark{display:grid;place-items:center;width:40px;height:40px;margin-bottom:15px;border-radius:12px 12px 12px 3px;background:#e5ebe1;color:#315b4e;font:500 12px 'DM Mono',monospace}
  .empty-state h3{margin:8px 0 5px;color:#294b42;font:500 21px 'Fraunces',serif}
  .empty-state p{max-width:400px;margin:0;color:var(--muted);font-size:11px;line-height:1.6}
  .audit-section{padding-top:3px}
  .audit-table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:7px;background:var(--paper)}
  table{width:100%;border-collapse:collapse;text-align:left}
  th{padding:11px 15px;background:#f2f4ed;color:#819187;font:9px 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase}
  td{padding:12px 15px;border-top:1px solid #eaebe4;color:#54675d;font-size:10px;line-height:1.45;overflow-wrap:anywhere}
  td:last-child{white-space:nowrap;color:#85948b;font:9px 'DM Mono',monospace}
  .audit-empty{padding:17px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:#809086;font-size:11px}
  .account-skeleton{display:grid;gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:7px;background:var(--line)}
  .skeleton-row{display:flex;align-items:center;gap:20px;padding:20px;background:var(--paper)}
  .skeleton-row i,.audit-skeleton i{display:block;height:10px;border-radius:6px;background:linear-gradient(90deg,#e9ece4,#f3f4ee,#e9ece4);background-size:200% 100%;animation:shimmer 1.5s ease-in-out infinite}
  .skeleton-row i:first-child{width:34%}.skeleton-row i:nth-child(2){width:20%}.skeleton-row i:last-child{width:25%;margin-left:auto}
  .audit-skeleton{display:grid;gap:9px;padding:16px;border:1px solid var(--line);border-radius:7px;background:var(--paper)}
  .audit-skeleton i{width:100%}
  @keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
  .page-footer{display:flex;justify-content:space-between;gap:12px;margin-top:42px;padding:17px 0 0;border-top:1px solid #e3e5dc;color:#90a096;font:9px 'DM Mono',monospace;letter-spacing:.06em}
  .page-footer i{padding:0 5px;color:#d5795f;font-style:normal}
  .modal-backdrop{position:fixed;z-index:20;inset:0;display:grid;place-items:center;padding:18px;background:rgba(21,48,43,.48);backdrop-filter:blur(3px)}
  .modal-card{width:min(100%,510px);max-height:min(90dvh,760px);overflow:auto;padding:24px;border:1px solid #e0e5db;border-radius:9px;background:#fbfbf7;box-shadow:0 20px 60px rgba(25,57,49,.2);animation:arrive .2s ease both}
  .compact-modal{width:min(100%,450px)}
  @keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:19px}
  .modal-head h2{margin:7px 0 0;color:#294b42;font:500 25px/1.2 'Fraunces',serif}
  .close-button{width:31px;height:31px;border:1px solid #e0e5db;border-radius:5px;background:transparent;color:#60766a;font-size:20px;line-height:1;cursor:pointer}
  .form-field{display:grid;gap:7px;margin:15px 0;color:#50675c;font-size:11px;font-weight:600}
  .form-field em{color:#b26d54;font-size:9px;font-style:normal;font-weight:500}
  .form-field input{width:100%;height:40px;padding:0 11px;border:1px solid #d9dfd6;border-radius:4px;background:#fffefa;color:#294b42;font-size:12px}
  .form-field input[readonly]{background:#f1f3ed;color:#839087}
  .role-display{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px;padding:12px;border:1px solid #e3e6dc;border-radius:5px;background:#f3f5ef;color:#65776d;font-size:10px}
  .role-display strong{color:#496c55;font:10px 'DM Mono',monospace;text-transform:uppercase}
  .role-display small{grid-column:1/-1;color:#8a978e;font-size:9px;line-height:1.5}
  .form-note{margin:13px 0;color:#79877e;font-size:10px;line-height:1.6}
  .modal-alert{margin-bottom:14px}
  .modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:23px}
  .confirm-copy{margin:8px 0;color:#64766c;font-size:12px;line-height:1.7;overflow-wrap:anywhere}
  .danger-button{border-color:#9d5745;background:#9d5745}
  .danger-button:hover:not(:disabled){background:#854735}
  @media(max-width:850px){.account-row{grid-template-columns:minmax(180px,1fr) minmax(140px,.7fr)}.row-actions{grid-column:1/-1;justify-content:flex-start;padding-left:50px}.locked-label{margin-left:0}}
  @media(max-width:600px){.admin-users{padding-top:27px}.page-heading{align-items:flex-start;flex-direction:column}.heading-actions{width:100%}.heading-actions .button{flex:1}.account-row{grid-template-columns:1fr;gap:12px;padding:15px}.account-meta{padding-left:50px}.row-actions{grid-column:auto;padding-left:50px;justify-content:flex-start;gap:13px}.section-head{align-items:flex-start}.small-tag{font-size:8px}.page-footer{flex-direction:column;line-height:1.6}.modal-card{padding:20px}.refresh{flex:0 0 auto!important}.refresh>span:last-child{display:none}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
</style>
