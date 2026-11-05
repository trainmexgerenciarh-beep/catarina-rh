<svelte:head>
  <meta
    name="description"
    content="Base técnica inicial de Catarina RH para Trainmex."
  />
</svelte:head>

<main>
  <div class="shell">
    <header>
      <a class="brand" href="/" aria-label="Catarina RH, inicio">
        <span class="brand-mark" aria-hidden="true">C</span>
        <span>CATARINA <span class="brand-light">RH</span></span>
      </a>
      <span class="environment"><span></span> Base técnica</span>
    </header>

    <section class="intro" aria-labelledby="page-title">
      <p class="eyebrow">MANUFACTURAS TRAINMEX · RECURSOS HUMANOS</p>
      <h1 id="page-title">Una base lista para conectar.</h1>
      <p class="lead">
        Catarina RH inicia con la infraestructura y las integraciones técnicas
        aprobadas. Los flujos de atención se incorporarán en iteraciones
        posteriores.
      </p>
    </section>

    <section class="status-grid" aria-label="Componentes preparados">
      <article class="status-card">
        <div class="card-top">
          <span class="number">01</span>
          <span class="status">Preparado</span>
        </div>
        <h2>Aplicación</h2>
        <p>SvelteKit y TypeScript</p>
      </article>
      <article class="status-card">
        <div class="card-top">
          <span class="number">02</span>
          <span class="status">Conexión comprobable</span>
        </div>
        <h2>Datos</h2>
        <p>PostgreSQL existente en Neon</p>
      </article>
      <article class="status-card">
        <div class="card-top">
          <span class="number">03</span>
          <span class="status">Conexión comprobable</span>
        </div>
        <h2>Inteligencia</h2>
        <p>API oficial de Google Gemini</p>
      </article>
      <article class="status-card">
        <div class="card-top">
          <span class="number">04</span>
          <span class="status">Endpoint disponible</span>
        </div>
        <h2>WhatsApp</h2>
        <p>Verificación y recepción básica de webhook</p>
      </article>
    </section>

    <aside class="scope-note">
      <span class="note-icon" aria-hidden="true">i</span>
      <p>
        Esta iteración no crea ni modifica tablas y no procesa conversaciones,
        citas, tickets ni respuestas documentales.
      </p>
    </aside>

    <footer>
      <span>TRAINMEX <span class="footer-divider">/</span> CATARINA RH</span>
      <span>Preparación técnica · Iteración 01</span>
    </footer>
  </div>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    background: #f5f7f4;
    color: #172b2b;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  main {
    min-height: 100vh;
    padding: 0 32px;
  }

  .shell {
    width: min(100%, 1080px);
    margin: 0 auto;
  }

  header {
    height: 88px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #dfe6e1;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 11px;
    color: #193c3a;
    text-decoration: none;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.105em;
  }

  .brand-mark {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border-radius: 10px;
    background: #1c554f;
    color: white;
    font-size: 17px;
    letter-spacing: 0;
  }

  .brand-light {
    color: #6c8982;
    font-weight: 500;
  }

  .environment {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #60716d;
    font-size: 12px;
    font-weight: 600;
  }

  .environment span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #d4a349;
  }

  .intro {
    max-width: 690px;
    padding: 78px 0 50px;
  }

  .eyebrow {
    margin: 0 0 17px;
    color: #65817a;
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.16em;
  }

  h1 {
    margin: 0;
    color: #193c3a;
    font-size: clamp(37px, 6vw, 58px);
    font-weight: 650;
    letter-spacing: -0.055em;
    line-height: 1.05;
  }

  .lead {
    max-width: 600px;
    margin: 21px 0 0;
    color: #5c6e69;
    font-size: 16px;
    line-height: 1.75;
  }

  .status-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .status-card {
    min-height: 156px;
    padding: 19px 19px 20px;
    border: 1px solid #e1e8e3;
    border-radius: 13px;
    background: #fff;
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .number {
    color: #94a59f;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .status {
    color: #35705e;
    font-size: 10px;
    font-weight: 700;
    text-align: right;
  }

  h2 {
    margin: 25px 0 5px;
    color: #193c3a;
    font-size: 16px;
    font-weight: 650;
  }

  .status-card p {
    margin: 0;
    color: #72817b;
    font-size: 12px;
    line-height: 1.5;
  }

  .scope-note {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-top: 25px;
    padding: 16px 18px;
    border: 1px solid #e7e1cc;
    border-radius: 11px;
    background: #fbf9f1;
  }

  .note-icon {
    display: grid;
    flex: 0 0 19px;
    width: 19px;
    height: 19px;
    place-items: center;
    border: 1px solid #b8a568;
    border-radius: 50%;
    color: #89793f;
    font-size: 12px;
    font-weight: 700;
  }

  .scope-note p {
    margin: 1px 0 0;
    color: #6e684f;
    font-size: 12px;
    line-height: 1.55;
  }

  footer {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    margin-top: 70px;
    padding: 20px 0 26px;
    border-top: 1px solid #dfe6e1;
    color: #86958f;
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.08em;
  }

  .footer-divider {
    margin: 0 6px;
    color: #c2cbc4;
  }

  @media (max-width: 760px) {
    main {
      padding: 0 22px;
    }

    .intro {
      padding: 58px 0 35px;
    }

    .status-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 430px) {
    main {
      padding: 0 17px;
    }

    header {
      height: 72px;
    }

    .environment {
      font-size: 11px;
    }

    .status-grid {
      gap: 10px;
    }

    .status-card {
      min-height: 145px;
      padding: 15px;
    }

    footer {
      flex-direction: column;
      gap: 8px;
      margin-top: 48px;
    }
  }
</style>
