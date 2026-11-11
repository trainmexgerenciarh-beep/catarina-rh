<svelte:head>
  <title>Catarina RH · Trainmex</title>
  <meta name="description" content="Catarina, recepción y gestión de Recursos Humanos para Trainmex." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet" />
</svelte:head>

<main>
  <div class="frame">
    <header>
      <a class="brand" href="/" aria-label="Catarina RH, inicio"><span class="brand-mark">C</span><span>CATARINA <i>RH</i></span></a>
      <div class="header-note"><span class="signal"></span>MANUFACTURAS TRAINMEX <b>/</b> RECURSOS HUMANOS</div>
      <a class="header-link" href="/login">Acceso RH <span aria-hidden="true">↗</span></a>
    </header>

    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow"><i></i> RECEPCIÓN DIGITAL · RECURSOS HUMANOS</span>
        <h1>Un primer paso.<br /><em>Con una persona al centro.</em></h1>
        <p class="lead">Catarina ayuda a las personas de Trainmex a encontrar orientación y a RH a preparar cada atención con claridad.</p>
        <div class="hero-actions">
          <a class="action-primary" href="/demo">Explorar demostración <span aria-hidden="true">→</span></a>
          <a class="action-secondary" href="/login">Entrar al espacio de RH <span aria-hidden="true">↗</span></a>
        </div>
        <div class="hero-meta"><span class="meta-line"></span><span>UN ESPACIO DE ATENCIÓN, NO OTRO TRÁMITE.</span></div>
      </div>
      <div class="hero-art" aria-label="Ilustración abstracta de una conversación guiada">
        <div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div>
        <div class="art-sun"></div>
        <div class="art-panel"><div class="art-panel-top"><span>CATARINA</span><span>01 / 03</span></div><div class="art-line"></div><div class="art-quote">“Cuéntame un poco más para orientarte mejor.”</div><div class="art-chip"><span></span> Recepción con contexto</div></div>
        <div class="art-caption"><span>ATENCIÓN</span><strong>Humana<br />por diseño.</strong></div>
        <span class="art-index">C · RH</span>
      </div>
    </section>

    <section class="access-section" aria-labelledby="access-title">
      <div class="section-intro"><span class="eyebrow">ELIGE TU ESPACIO</span><h2 id="access-title">Dos entradas.<br /><em>Un mismo compromiso.</em></h2></div>
      <div class="access-list">
        <a class="access-row" href="/demo">
          <span class="access-num">01</span><span class="access-icon">D</span>
          <span class="access-copy"><strong>Conocer la experiencia</strong><small>Recorre un entorno de prueba con información ficticia y conversa con Catarina.</small></span>
          <span class="access-arrow">↗</span>
        </a>
        <a class="access-row" href="/login">
          <span class="access-num">02</span><span class="access-icon admin">RH</span>
          <span class="access-copy"><strong>Espacio de Recursos Humanos</strong><small>Acceso para personal autorizado de RH. Requiere una sesión administrativa.</small></span>
          <span class="access-arrow">↗</span>
        </a>
      </div>
    </section>

    <section class="principles">
      <div class="principle-heading"><span class="eyebrow">CÓMO TRABAJA CATARINA</span><span class="principle-count">01 — 03</span></div>
      <div class="principle-grid">
        <article><span class="principle-number">01</span><h3>Escucha antes<br />de clasificar.</h3><p>Una recepción breve y cercana para entender qué necesita cada persona.</p></article>
        <article><span class="principle-number">02</span><h3>Prepara, no<br />promete de más.</h3><p>Cuando hace falta RH, organiza contexto y agenda sin sustituir la atención humana.</p></article>
        <article><span class="principle-number">03</span><h3>La información<br />tiene origen.</h3><p>Las respuestas documentales se apoyan en fuentes autorizadas por Recursos Humanos.</p></article>
      </div>
    </section>

    <section class="scope">
      <div class="scope-mark">i</div>
      <div><span class="eyebrow">ALCANCE CON TRANSPARENCIA</span><p>Catarina no calcula nómina, no determina la veracidad de un reporte y no emite resoluciones laborales. La atención especializada ocurre con el equipo de Recursos Humanos.</p></div>
      <span class="scope-end">TRAINMEX · RH</span>
    </section>

    <footer><a class="brand footer-brand" href="/"><span class="brand-mark">C</span><span>CATARINA <i>RH</i></span></a><span>MANUFACTURAS TRAINMEX <b>/</b> SERVICIO DE RECURSOS HUMANOS</span><a href="/login">Acceso administrativo</a></footer>
  </div>
</main>

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0;min-width:320px;background:#f3f4ed;color:#1e403b;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
  :global(a:focus-visible){outline:3px solid #d7795d;outline-offset:4px}
  main{min-height:100dvh;overflow:hidden}.frame{width:min(100%,1440px);margin:0 auto;padding:0 clamp(20px,6.5vw,96px)}
  header{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dfe4d9}
  .brand{display:flex;align-items:center;gap:10px;color:#21443e;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:.13em}.brand i{color:#739084;font-style:normal;font-weight:500}
  .brand-mark{display:grid;place-items:center;width:31px;height:31px;border-radius:10px 10px 10px 3px;background:#df795c;color:#20423d;font:600 19px 'Fraunces',serif;letter-spacing:0}
  .header-note{display:flex;align-items:center;gap:9px;color:#809287;font:9px 'DM Mono',monospace;letter-spacing:.08em}.header-note b,footer b{color:#cf795d;font-weight:400}.signal{width:6px;height:6px;border-radius:50%;background:#d79558}
  .header-link{color:#557568;font-size:10px;font-weight:700;text-decoration:none}.header-link span{margin-left:7px;color:#d17558}
  .hero{position:relative;display:grid;grid-template-columns:1.05fr .95fr;align-items:center;min-height:490px;padding:50px 0 54px}
  .hero-copy{position:relative;z-index:2;max-width:620px;padding:14px 0}.eyebrow{color:#738d7e;font:9px 'DM Mono',monospace;letter-spacing:.15em}.hero-copy>.eyebrow{display:flex;align-items:center;gap:8px}.hero-copy>.eyebrow i{display:inline-block;width:19px;height:1px;background:#d57a5d}
  h1{margin:22px 0 19px;color:#183e39;font:500 clamp(43px,6.1vw,76px)/.99 'Fraunces',serif;letter-spacing:-.055em}h1 em,.section-intro h2 em{color:#658473;font-weight:500}
  .lead{max-width:440px;margin:0;color:#65796e;font-size:14px;line-height:1.8}
  .hero-actions{display:flex;align-items:center;gap:23px;margin-top:29px}.action-primary{display:inline-flex;align-items:center;gap:22px;min-height:45px;padding:0 15px;border-radius:4px;background:#244e46;color:#f6f0e5;font-size:11px;font-weight:700;text-decoration:none;transition:transform .2s,background .2s}.action-primary:hover{transform:translateY(-2px);background:#193d38}.action-primary span{color:#dda082;font-size:16px}
  .action-secondary{color:#557467;font-size:10px;font-weight:700;text-decoration:none}.action-secondary span{margin-left:7px;color:#d0785c}.action-secondary:hover{text-decoration:underline;text-underline-offset:4px}
  .hero-meta{display:flex;align-items:center;gap:9px;margin-top:41px;color:#96a399;font:8px 'DM Mono',monospace;letter-spacing:.12em}.meta-line{width:27px;height:1px;background:#d0775c}
  .hero-art{position:relative;justify-self:end;width:min(100%,490px);height:365px;overflow:hidden;background:#e6ebe1;border-radius:46% 46% 3px 3px}
  .hero-art:after{position:absolute;content:'';inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.1'/%3E%3C/svg%3E");opacity:.13;pointer-events:none}
  .art-orbit{position:absolute;border:1px solid rgba(93,126,106,.26);border-radius:50%;transform:rotate(-28deg)}.orbit-one{width:440px;height:220px;left:9px;top:53px}.orbit-two{width:370px;height:185px;left:44px;top:77px}
  .art-sun{position:absolute;top:42px;right:71px;width:124px;height:124px;border-radius:50%;background:#d98767;opacity:.92}
  .art-panel{position:absolute;left:50%;top:50%;width:min(73%,325px);padding:20px 20px 21px;transform:translate(-44%,-42%);border:1px solid rgba(252,250,238,.9);background:rgba(250,250,243,.88);box-shadow:0 19px 50px rgba(62,94,74,.11);backdrop-filter:blur(8px)}
  .art-panel-top{display:flex;justify-content:space-between;color:#819487;font:8px 'DM Mono',monospace;letter-spacing:.1em}.art-line{width:27px;height:2px;margin:18px 0 13px;background:#d47c60}.art-quote{max-width:250px;color:#2e5147;font:500 22px/1.2 'Fraunces',serif}
  .art-chip{display:inline-flex;align-items:center;gap:7px;margin-top:19px;padding:7px 8px;background:#e8eee5;color:#708477;font-size:8px}.art-chip span{width:5px;height:5px;border-radius:50%;background:#d57c5e}
  .art-caption{position:absolute;right:23px;bottom:25px;display:grid;gap:5px;text-align:right}.art-caption span{color:#849689;font:8px 'DM Mono',monospace;letter-spacing:.12em}.art-caption strong{color:#34584a;font:500 18px/1.02 'Fraunces',serif}.art-index{position:absolute;left:19px;bottom:20px;color:#92a397;font:9px 'DM Mono',monospace}
  .access-section{display:grid;grid-template-columns:.75fr 1.25fr;gap:50px;padding:37px 0 45px;border-top:1px solid #dfe4d9}
  .section-intro h2{margin:13px 0 0;color:#21443c;font:500 clamp(27px,3.5vw,40px)/1.1 'Fraunces',serif;letter-spacing:-.035em}.section-intro h2 em{font-style:normal}
  .access-list{display:grid}.access-row{display:grid;grid-template-columns:28px 43px 1fr 20px;align-items:center;gap:13px;padding:14px 8px;border-bottom:1px solid #e0e5dc;text-decoration:none;transition:background .18s,padding .18s}.access-row:first-child{border-top:1px solid #e0e5dc}.access-row:hover{padding-left:13px;background:#edf0e8}
  .access-num{color:#9bad9f;font:9px 'DM Mono',monospace}.access-icon{display:grid;place-items:center;width:39px;height:39px;border-radius:12px 12px 12px 3px;background:#dfe9dd;color:#4a785d;font:500 16px 'Fraunces',serif}.access-icon.admin{font:9px 'DM Mono',monospace;background:#f0e4d8;color:#a0694e}
  .access-copy{display:grid;gap:4px}.access-copy strong{color:#36584c;font-size:11px}.access-copy small{max-width:410px;color:#829087;font-size:10px;line-height:1.5}.access-arrow{color:#ce795c;font-size:16px;text-align:right;transition:transform .18s}.access-row:hover .access-arrow{transform:translate(2px,-2px)}
  .principles{padding:27px 0 40px;border-top:1px solid #dfe4d9}.principle-heading{display:flex;justify-content:space-between}.principle-count{color:#99a89c;font:9px 'DM Mono',monospace}
  .principle-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:28px}.principle-grid article{position:relative;padding:0 18px 0 0}.principle-number{color:#d07b5e;font:9px 'DM Mono',monospace}.principle-grid h3{margin:12px 0 8px;color:#2c5046;font:500 22px/1.1 'Fraunces',serif}.principle-grid p{max-width:250px;margin:0;color:#7e8c82;font-size:10px;line-height:1.65}
  .scope{display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:15px;margin:0 0 30px;padding:16px;border:1px solid #e8dfca;background:#f8f5eb}.scope-mark{display:grid;place-items:center;width:22px;height:22px;border:1px solid #c5ac71;border-radius:50%;color:#967e47;font:10px 'DM Mono',monospace}.scope .eyebrow{color:#a28d59;font-size:8px}.scope p{max-width:750px;margin:5px 0 0;color:#756e58;font-size:10px;line-height:1.6}.scope-end{color:#b2a47b;font:8px 'DM Mono',monospace;letter-spacing:.08em}
  footer{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0 22px;border-top:1px solid #dfe4d9;color:#9ba89e;font:8px 'DM Mono',monospace;letter-spacing:.08em}.footer-brand{font-family:'DM Sans',sans-serif;font-size:9px}footer>a:last-child{color:#71877a;font:9px 'DM Sans',sans-serif;letter-spacing:0;text-decoration:none}
  @media(max-width:760px){.frame{padding-inline:22px}header{height:66px}.header-note{display:none}.hero{grid-template-columns:1fr;gap:24px;padding:45px 0 37px}.hero-copy{padding:0}.hero-art{justify-self:center;width:min(100%,460px);height:310px}.hero-actions{gap:15px;flex-wrap:wrap}.hero-meta{margin-top:28px}.access-section{grid-template-columns:1fr;gap:20px;padding-top:27px}.principle-grid{gap:17px}.principle-grid h3{font-size:19px}.scope{grid-template-columns:25px 1fr}.scope-end{display:none}}
  @media(max-width:480px){.frame{padding-inline:17px}header{height:61px}.header-link{font-size:9px}.hero{padding-top:38px;gap:19px}h1{font-size:clamp(42px,12vw,58px)}.lead{font-size:12px}.hero-art{height:260px}.art-sun{width:91px;height:91px;right:35px;top:32px}.art-panel{padding:15px;width:76%}.art-quote{font-size:19px}.art-caption{right:14px;bottom:15px}.access-row{grid-template-columns:22px 37px 1fr 15px;gap:9px;padding-inline:3px}.access-icon{width:35px;height:35px}.access-copy small{font-size:9px}.principle-grid{grid-template-columns:1fr;gap:20px;margin-top:21px}.principle-grid article{display:grid;grid-template-columns:27px 1fr;column-gap:9px}.principle-grid h3{grid-column:2;margin:0 0 6px;font-size:19px}.principle-number{grid-row:1 / span 2;padding-top:4px}.principle-grid p{grid-column:2}.scope{padding:13px;gap:10px}.scope p{font-size:9px}footer{align-items:flex-start;flex-wrap:wrap}footer>span{width:100%;order:3;font-size:7px}}
</style>
