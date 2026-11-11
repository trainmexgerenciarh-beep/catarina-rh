<script lang="ts">
  import { onMount } from 'svelte';

  let email = '';
  let password = '';
  let configured = true;
  let authenticated = false;
  let loading = true;
  let submitting = false;
  let error = '';

  onMount(async () => {
    try {
      const response = await fetch('/api/admin/session', { credentials: 'same-origin' });
      const session = await response.json();
      configured = Boolean(session.configured);
      authenticated = Boolean(session.authenticated);
      if (authenticated) window.location.href = '/panel';
    } catch {
      error = 'No fue posible verificar el estado de acceso. Inténtalo de nuevo.';
    } finally {
      loading = false;
    }
  });

  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    if (submitting || !email.trim() || !password) return;
    submitting = true;
    error = '';
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo iniciar sesión.');
      window.location.href = '/panel';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'No se pudo iniciar sesión. Revisa tus datos e inténtalo otra vez.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Acceso de RH · Catarina</title>
  <meta name="description" content="Acceso seguro para personal autorizado de Recursos Humanos de Trainmex." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet" />
</svelte:head>

<main>
  <div class="login-frame">
    <header><a class="brand" href="/"><span class="brand-mark">C</span><span>CATARINA <i>RH</i></span></a><span class="system-label">TRAINMEX <b>/</b> ESPACIO RH</span></header>
    <div class="login-grid">
      <section class="intro">
        <span class="eyebrow">ACCESO ADMINISTRATIVO</span>
        <h1>La atención empieza por cuidar el acceso.</h1>
        <p>Un espacio de trabajo para Generalista y Gerencia de Recursos Humanos.</p>
        <div class="access-pledge"><span class="pledge-mark">i</span><p>Los datos operativos solo se muestran después de validar una sesión autorizada.</p></div>
        <div class="intro-foot"><span>01</span><span>PRIVACIDAD Y CONTROL OPERATIVO</span></div>
      </section>
      <section class="form-panel" aria-labelledby="login-title">
        <span class="eyebrow">SESION DE RH</span>
        <h2 id="login-title">Te damos la bienvenida.</h2>
        <p class="form-lead">Ingresa con las credenciales que te asignó la administración del proyecto.</p>
        {#if loading}
          <div class="loading-card" aria-label="Verificando acceso"><span></span><span></span><span></span></div>
        {:else if !configured}
          <div class="pending-state" role="status">
            <span class="pending-mark">—</span><strong>Acceso aún no configurado</strong>
            <p>La autenticación administrativa no está habilitada. No hay una contraseña compartida ni una cuenta universal.</p>
            <p class="pending-instruction">La persona titular debe autorizar cuentas específicas de Generalista o Gerencia y configurarlas mediante Secrets. No envíes contraseñas por correo o chat. La guía segura está en docs/PREACTIVACION.md.</p>
          </div>
        {:else}
          {#if error}<div class="alert" role="alert">{error}</div>{/if}
          <form on:submit={signIn}>
            <label><span>Correo autorizado</span><input type="email" autocomplete="username" bind:value={email} required placeholder="nombre@trainmex.com" disabled={submitting} /></label>
            <label><span>Contraseña</span><input type="password" autocomplete="current-password" bind:value={password} required placeholder="Tu contraseña" disabled={submitting} /></label>
            <button type="submit" disabled={submitting || !email.trim() || !password}>{submitting ? 'Validando acceso…' : 'Iniciar sesión'}<span aria-hidden="true">→</span></button>
          </form>
          <p class="credential-note">Si no tienes acceso, contacta con la persona responsable de administrar Catarina RH.</p>
        {/if}
        <a class="back-link" href="/">← Volver a Catarina RH</a>
      </section>
    </div>
    <footer><span>CATARINA RH <i>/</i> MANUFACTURAS TRAINMEX</span><span>USO INTERNO · ACCESO CONTROLADO</span></footer>
  </div>
</main>

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0;min-width:320px;background:#f3f4ed;color:#1d413b;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
  :global(input),:global(button){font:inherit}:global(a:focus-visible),:global(input:focus-visible),:global(button:focus-visible){outline:3px solid #d77b5d;outline-offset:3px}
  main{min-height:100dvh}.login-frame{width:min(100%,1340px);min-height:100dvh;margin:auto;padding:0 clamp(20px,7vw,100px);display:flex;flex-direction:column}
  header{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dfe4d9}
  .brand{display:flex;align-items:center;gap:10px;color:#21443e;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:.13em}.brand i{color:#769084;font-style:normal;font-weight:500}.brand-mark{display:grid;place-items:center;width:31px;height:31px;border-radius:10px 10px 10px 3px;background:#df795c;color:#20423d;font:600 19px 'Fraunces',serif;letter-spacing:0}
  .system-label{color:#829388;font:9px 'DM Mono',monospace;letter-spacing:.09em}.system-label b{padding:0 5px;color:#ce795d;font-weight:400}
  .login-grid{flex:1;display:grid;grid-template-columns:1.05fr .95fr;align-items:center;gap:clamp(40px,8vw,110px);padding:45px 0}
  .intro{position:relative;max-width:530px;padding:20px 0}.eyebrow{color:#728c7d;font:9px 'DM Mono',monospace;letter-spacing:.15em}
  .intro h1{max-width:520px;margin:19px 0;color:#1d403a;font:500 clamp(42px,5.5vw,68px)/1.04 'Fraunces',serif;letter-spacing:-.055em}
  .intro>p{max-width:390px;margin:0;color:#708177;font-size:13px;line-height:1.8}
  .access-pledge{display:flex;align-items:flex-start;gap:11px;max-width:395px;margin-top:31px;padding:13px 14px;border-left:2px solid #d47a5e;background:#e8ece3}.pledge-mark{display:grid;place-items:center;flex:0 0 18px;height:18px;border:1px solid #b9a76e;border-radius:50%;color:#8d7b4a;font:9px 'DM Mono',monospace}.access-pledge p{margin:1px 0;color:#697b6e;font-size:10px;line-height:1.6}
  .intro-foot{display:flex;align-items:center;gap:10px;margin-top:50px;color:#9ca99e;font:8px 'DM Mono',monospace;letter-spacing:.12em}.intro-foot span:first-child{color:#d0795c}
  .form-panel{width:min(100%,438px);justify-self:end;padding:clamp(23px,4vw,39px);border:1px solid #e0e5da;border-radius:8px;background:#fafbf6;box-shadow:0 15px 42px rgba(48,79,61,.05)}
  .form-panel h2{margin:11px 0 8px;color:#24473e;font:500 30px 'Fraunces',serif;letter-spacing:-.02em}.form-lead{margin:0 0 25px;color:#829087;font-size:11px;line-height:1.65}
  form{display:grid;gap:15px}form label{display:grid;gap:7px;color:#496255;font-size:10px;font-weight:700}form input{width:100%;height:42px;padding:0 12px;border:1px solid #dfe4da;border-radius:4px;background:#fff;color:#314f44;font-size:11px}form input::placeholder{color:#a5afa6}form input:disabled{opacity:.7}
  form button{display:flex;align-items:center;justify-content:space-between;height:43px;margin-top:5px;padding:0 14px;border:1px solid #244e46;border-radius:4px;background:#244e46;color:#f4efe3;font-size:11px;font-weight:700;cursor:pointer;transition:background .2s,transform .2s}form button:hover:not(:disabled){background:#193e38;transform:translateY(-1px)}form button:disabled{opacity:.55;cursor:not-allowed}form button span{color:#e2a083;font-size:16px}
  .credential-note{margin:15px 0 0;color:#9aa69c;font-size:9px;line-height:1.6}.back-link{display:inline-block;margin-top:25px;color:#668173;font-size:10px;text-decoration:none}.back-link:hover{text-decoration:underline;text-underline-offset:3px}
  .alert{margin:0 0 14px;padding:10px 12px;border:1px solid #e9d1c7;border-radius:4px;background:#fbefeb;color:#915c49;font-size:10px;line-height:1.5}
  .pending-state{display:grid;justify-items:start;gap:8px;padding:18px 15px;border:1px solid #e8e0c9;background:#f8f5eb;color:#766b4d}.pending-mark{display:grid;place-items:center;width:29px;height:29px;border:1px solid #d2c18e;border-radius:50%;color:#98844c}.pending-state strong{color:#5d5b43;font:500 18px 'Fraunces',serif}.pending-state p{margin:0;color:#80775c;font-size:10px;line-height:1.65}.pending-state .pending-instruction{margin-top:5px;padding-top:10px;border-top:1px solid #e8e0cc}
  .loading-card{display:grid;gap:11px;padding:19px;border:1px solid #e3e7de;border-radius:5px}.loading-card span{height:12px;border-radius:3px;background:linear-gradient(90deg,#e8ece4 25%,#f0f2ec 45%,#e8ece4 65%);background-size:200% 100%;animation:shimmer 1.3s infinite}.loading-card span:nth-child(2){width:82%}.loading-card span:nth-child(3){width:60%}@keyframes shimmer{to{background-position:-200% 0}}
  footer{display:flex;justify-content:space-between;gap:15px;padding:17px 0 22px;border-top:1px solid #dfe4d9;color:#99a69c;font:8px 'DM Mono',monospace;letter-spacing:.08em}footer i{margin:0 5px;color:#ce795d;font-style:normal}
  @media(max-width:760px){.login-frame{padding-inline:22px}header{height:66px}.login-grid{grid-template-columns:1fr;gap:24px;align-content:center;padding:35px 0}.intro{padding:0}.intro h1{max-width:600px;font-size:clamp(39px,8vw,58px)}.intro-foot{display:none}.form-panel{justify-self:stretch;width:100%;max-width:540px;padding:24px}.intro>p{font-size:12px}.access-pledge{margin-top:19px}}
  @media(max-width:440px){.login-frame{padding-inline:16px}.system-label{font-size:8px}.form-panel{padding:20px}.form-panel h2{font-size:27px}footer{flex-direction:column;gap:8px;font-size:7px}}
</style>
