/* ===================================================================
   Waklink — portail de lecture
   Données : manifest.json, généré par scripts/build-manifest.mjs
   =================================================================== */

(() => {
  'use strict';

  const EAGER_PAGES = 2; // planches chargées sans attendre le scroll
  const TRANSITION_MS = 620;
  const DEFAULT_RATIO = 1200 / 1878;

  const el = (id) => document.getElementById(id);

  const dom = {
    home: el('home'),
    libraryContent: el('libraryContent'),
    libraryCount: el('libraryCount'),
    reader: el('reader'),
    readerBar: el('readerBar'),
    readerScroll: el('readerScroll'),
    readerPages: el('readerPages'),
    readerTitle: el('readerTitle'),
    readerMeta: el('readerMeta'),
    readerProgress: el('readerProgress'),
    readerProgressFill: el('readerProgressFill'),
    readerLoading: el('readerLoading'),
    chapterEnd: el('chapterEnd'),
    chapterEndTitle: el('chapterEndTitle'),
    nextChapterBtn: el('nextChapterBtn'),
    veil: el('veil'),
  };

  const state = {
    manifest: null,
    /** Liste plate de tous les tomes lisibles, dans l'ordre de la bibliothèque. */
    flat: [],
    current: null, // { series, tome, flatIndex }
    lastY: 0,
    barHidden: false,
  };

  const timers = { open: 0, veil: 0 };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ décor */

  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildDecor() {
    document.querySelectorAll('.portal-glyphs').forEach((holder) => {
      for (let i = 0; i < 12; i++) {
        const g = document.createElement('span');
        g.style.transform = `translateX(-50%) rotate(${i * 30}deg)`;
        holder.appendChild(g);
      }
    });

    const host = document.querySelector('.particles');
    if (!host || reducedMotion) return;
    const rnd = mulberry32(20260812);
    const between = (a, b) => a + rnd() * (b - a);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 30; i++) {
      const size = between(2, 6);
      const gold = i % 4 === 0;
      const p = document.createElement('span');
      p.style.left = `${between(0, 100)}%`;
      p.style.top = `${between(10, 100)}%`;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.background = gold ? 'var(--gold)' : 'var(--cyan)';
      p.style.boxShadow = `0 0 ${between(8, 20).toFixed(1)}px ${gold ? 'rgba(243,230,200,0.8)' : 'rgba(95,227,234,0.9)'}`;
      p.style.setProperty('--dx', `${between(-70, 70).toFixed(0)}px`);
      p.style.animation = `drift ${between(7, 16).toFixed(1)}s linear ${between(0, 9).toFixed(1)}s infinite`;
      frag.appendChild(p);
    }
    host.appendChild(frag);
  }

  /* -------------------------------------------------------- utilitaires */

  const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

  function routeFor(series, tome) {
    return `#/${encodeURIComponent(series.slug)}/${encodeURIComponent(tome.slug)}`;
  }

  function findByRoute(hash) {
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2) return null;
    const [seriesSlug, tomeSlug] = parts;
    return state.flat.find((e) => e.series.slug === seriesSlug && e.tome.slug === tomeSlug) ?? null;
  }

  /* ------------------------------------------------------- bibliothèque */

  function cardFor(series, tome) {
    const readable = tome.pageCount > 0;

    const card = document.createElement(readable ? 'a' : 'button');
    card.className = 'card';
    if (readable) {
      card.href = routeFor(series, tome);
      card.setAttribute('aria-label', `Lire ${tome.title} — ${plural(tome.pageCount, 'planche')}`);
    } else {
      card.type = 'button';
      card.disabled = true;
    }

    const frame = document.createElement('div');
    frame.className = 'card-frame';

    const cover = document.createElement('div');
    cover.className = 'card-cover';

    if (tome.cover) {
      const img = document.createElement('img');
      img.src = tome.cover.src;
      img.alt = `Couverture — ${tome.title}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      if (tome.cover.width) {
        img.width = tome.cover.width;
        img.height = tome.cover.height;
      }
      cover.appendChild(img);
    } else {
      const empty = document.createElement('div');
      empty.className = 'card-cover-empty';
      empty.textContent = 'Sans planche';
      cover.appendChild(empty);
    }

    const badge = document.createElement('div');
    badge.className = 'card-badge';
    badge.textContent = tome.label;

    const text = document.createElement('div');
    text.className = 'card-text';
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = tome.title;
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.textContent = tome.description ?? (readable ? plural(tome.pageCount, 'planche') : 'À paraître');
    text.append(title, meta);

    cover.append(badge, text);
    frame.appendChild(cover);

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const status = document.createElement('span');
    status.textContent = tome.status;
    foot.appendChild(status);
    if (readable) {
      const read = document.createElement('span');
      read.className = 'card-read';
      read.textContent = 'Lire →';
      foot.appendChild(read);
    }

    card.append(frame, foot);
    return card;
  }

  function renderLibrary() {
    const { series } = state.manifest;
    dom.libraryContent.textContent = '';

    const withTomes = series.filter((s) => s.tomes.length > 0);

    if (!withTomes.length) {
      const empty = document.createElement('p');
      empty.className = 'library-empty';
      empty.innerHTML =
        'Aucun webtoon détecté. Ajoutez un dossier <code>media/&lt;serie&gt;/&lt;tome&gt;/</code> ' +
        'puis relancez <code>npm run build</code>.';
      dom.libraryContent.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const s of withTomes) {
      const section = document.createElement('section');
      section.className = 'series';

      const head = document.createElement('div');
      head.className = 'series-head';
      const name = document.createElement('h2');
      name.className = 'series-name';
      name.textContent = s.title;
      const count = document.createElement('span');
      count.className = 'series-count';
      count.textContent = `${plural(s.tomeCount, 'tome')} · ${plural(s.pageCount, 'planche')}`;
      head.append(name, count);

      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const tome of s.tomes) grid.appendChild(cardFor(s, tome));

      section.append(head, grid);
      frag.appendChild(section);
    }
    dom.libraryContent.appendChild(frag);

    const totalTomes = withTomes.reduce((n, s) => n + s.tomeCount, 0);
    const totalPages = withTomes.reduce((n, s) => n + s.pageCount, 0);
    dom.libraryCount.textContent = `${plural(totalTomes, 'tome')} · ${plural(totalPages, 'planche')}`;
  }

  /* ------------------------------------------------------------ lecteur */

  function pageNode(page, index) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    // Boîte au ratio exact : la planche réserve sa place avant d'être chargée,
    // donc aucun saut de mise en page pendant le défilement.
    const ratio = page.width && page.height ? page.width / page.height : DEFAULT_RATIO;
    wrap.style.aspectRatio = String(ratio);

    const img = document.createElement('img');
    img.src = page.src;
    img.alt = `Planche ${page.index}`;
    img.loading = index < EAGER_PAGES ? 'eager' : 'lazy';
    img.fetchPriority = index < EAGER_PAGES ? 'high' : 'auto';
    img.decoding = 'async';
    img.draggable = false;
    if (page.width) {
      img.width = page.width;
      img.height = page.height;
    }
    // Le ratio estimé est remplacé par le ratio réel dès le décodage.
    const applyRealRatio = () => {
      if (img.naturalWidth) wrap.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      if (index === 0) dom.readerLoading.hidden = true;
    };
    if (img.complete && img.naturalWidth) applyRealRatio();
    else img.addEventListener('load', applyRealRatio);
    if (index === 0) img.addEventListener('error', () => (dom.readerLoading.hidden = true));

    wrap.appendChild(img);
    return wrap;
  }

  function renderPages() {
    const { tome } = state.current;
    const frag = document.createDocumentFragment();
    tome.pages.forEach((page, i) => frag.appendChild(pageNode(page, i)));
    dom.readerPages.appendChild(frag);
  }

  function nextEntry() {
    if (!state.current) return null;
    const i = state.current.flatIndex + 1;
    return i < state.flat.length ? state.flat[i] : null;
  }

  function updateProgress() {
    const scroller = dom.readerScroll;
    const { tome } = state.current;
    const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const y = scroller.scrollTop;
    const ratio = Math.min(1, Math.max(0, y / max));

    dom.readerProgressFill.style.width = `${(ratio * 100).toFixed(2)}%`;

    // Page courante = celle qui occupe le tiers haut du viewport.
    const probe = y + scroller.clientHeight * 0.34;
    const nodes = dom.readerPages.children;
    let current = 1;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].offsetTop <= probe) current = i + 1;
      else break;
    }
    dom.readerProgress.textContent = `${current} / ${tome.pageCount}`;

    // Masquage de la barre à la descente, réapparition à la montée.
    const goingDown = y > state.lastY + 4;
    const goingUp = y < state.lastY - 4;
    state.lastY = y;
    if (goingDown && y > 160) setBarHidden(true);
    else if (goingUp || y < 80) setBarHidden(false);
  }

  function setBarHidden(hidden) {
    if (state.barHidden === hidden) return;
    state.barHidden = hidden;
    dom.readerBar.classList.toggle('is-hidden', hidden);
  }

  function mountReader(entry) {
    state.current = entry;
    state.lastY = 0;

    const { tome } = entry;
    dom.readerPages.textContent = '';
    dom.readerTitle.textContent = tome.title;
    dom.readerMeta.textContent = [tome.status, plural(tome.pageCount, 'planche')].join(' · ');
    dom.readerProgress.textContent = `1 / ${tome.pageCount}`;
    dom.readerProgressFill.style.width = '0%';
    dom.readerLoading.hidden = false;
    setBarHidden(false);

    const next = nextEntry();
    dom.chapterEndTitle.textContent = next ? next.tome.title : 'Vous êtes à jour';
    dom.nextChapterBtn.hidden = !next;

    dom.reader.hidden = false;
    document.body.classList.add('is-reading');
    dom.home.setAttribute('aria-hidden', 'true');
    dom.readerScroll.scrollTop = 0;

    renderPages();
    document.title = `${tome.title} · Waklink`;
  }

  function unmountReader() {
    dom.reader.hidden = true;
    dom.readerPages.textContent = '';
    dom.readerLoading.hidden = true;
    document.body.classList.remove('is-reading');
    dom.home.removeAttribute('aria-hidden');
    state.current = null;
    document.title = 'Waklink · Portail des Chroniques du Krosmoz';
  }

  function playVeil() {
    if (reducedMotion) return;
    clearTimeout(timers.veil);
    dom.veil.hidden = false;
    // Redémarre l'animation à chaque ouverture.
    dom.veil.querySelector('.veil-burst').style.animation = 'none';
    void dom.veil.offsetWidth;
    dom.veil.querySelector('.veil-burst').style.animation = '';
    timers.veil = setTimeout(() => {
      dom.veil.hidden = true;
    }, TRANSITION_MS + 380);
  }

  /* ------------------------------------------------------------ routage */

  function applyRoute() {
    const entry = findByRoute(location.hash);

    if (!entry) {
      unmountReader();
      return;
    }
    if (state.current && state.current.tome === entry.tome) return;

    playVeil();
    clearTimeout(timers.open);
    const delay = reducedMotion ? 0 : TRANSITION_MS;
    timers.open = setTimeout(() => mountReader(entry), delay);
  }

  function goHome() {
    if (location.hash && location.hash !== '#/') history.pushState(null, '', location.pathname + location.search);
    unmountReader();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function bindEvents() {
    window.addEventListener('hashchange', applyRoute);
    window.addEventListener('popstate', applyRoute);

    dom.readerScroll.addEventListener('scroll', () => {
      if (state.current) requestAnimationFrame(updateProgress);
    }, { passive: true });

    document.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'home') {
        e.preventDefault();
        goHome();
      } else if (action === 'next') {
        e.preventDefault();
        const next = nextEntry();
        if (next) location.hash = routeFor(next.series, next.tome);
      }
    });

    // Sur mobile, une tape sur la planche fait réapparaître la barre.
    dom.readerPages.addEventListener('click', () => setBarHidden(!state.barHidden));

    document.addEventListener('keydown', (e) => {
      if (!state.current) return;
      if (e.key === 'Escape') {
        goHome();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        dom.readerScroll.scrollBy({ top: dom.readerScroll.clientHeight * 0.85, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        dom.readerScroll.scrollBy({ top: -dom.readerScroll.clientHeight * 0.85, behavior: 'smooth' });
      }
    });
  }

  /* -------------------------------------------------------------- init */

  /**
   * Chargement de la bibliothèque. Appelé par assets/auth.js une fois la
   * porte franchie — jamais avant, pour ne rien afficher à un visiteur bloqué.
   */
  async function boot() {
    if (state.manifest) {
      // Reconnexion après déconnexion : le manifest est déjà en mémoire.
      applyRoute();
      return;
    }

    try {
      const res = await fetch(`manifest.json?v=${document.lastModified.replace(/\D/g, '')}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.manifest = await res.json();
    } catch (err) {
      dom.libraryContent.innerHTML =
        '<p class="library-empty">Manifest illisible. Lancez <code>npm run build</code> ' +
        'pour régénérer <code>manifest.json</code>.</p>';
      console.error('[Waklink] chargement du manifest impossible :', err);
      return;
    }

    state.flat = state.manifest.series.flatMap((series) =>
      series.tomes.filter((t) => t.pageCount > 0).map((tome) => ({ series, tome, flatIndex: 0 }))
    );
    state.flat.forEach((entry, i) => {
      entry.flatIndex = i;
    });

    renderLibrary();
    applyRoute();
  }

  /** Déconnexion : on ferme le lecteur et on vide l'écran. */
  function shutdown() {
    unmountReader();
    clearTimeout(timers.open);
    clearTimeout(timers.veil);
    dom.veil.hidden = true;
  }

  buildDecor();
  bindEvents();

  window.WaklinkApp = { boot, shutdown };
})();
