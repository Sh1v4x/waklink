/* ===================================================================
   Waklink — porte d'entrée
   Vérification côté navigateur : la clé dérivée (PBKDF2-SHA256) saisie
   est comparée à celle d'assets/auth.json. Le mot de passe n'apparaît
   nulle part dans les sources.

   ⚠ Un site statique ne garde aucun secret : cette porte dissuade,
   elle ne protège pas. Les fichiers de media/ restent joignables par
   leur URL directe.
   =================================================================== */

(() => {
  'use strict';

  const CONFIG_URL = 'assets/auth.json';
  const SESSION_KEY = 'waklink.session';
  const MIN_DELAY = 420; // temporisation constante, quel que soit le résultat

  const dom = {
    gate: document.getElementById('gate'),
    form: document.getElementById('gateForm'),
    user: document.getElementById('gateUser'),
    pass: document.getElementById('gatePass'),
    remember: document.getElementById('gateRemember'),
    submit: document.getElementById('gateSubmit'),
    error: document.getElementById('gateError'),
    hint: document.getElementById('gateHint'),
    logout: document.getElementById('logoutBtn'),
  };

  let config = null;

  /* -------------------------------------------------------- dérivation */

  /** Doit rester identique à scripts/set-credentials.mjs. */
  const material = (user, pass) => `${user.trim().toLowerCase().normalize('NFKC')}:${pass.normalize('NFKC')}`;

  const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

  async function derive(user, pass) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(material(user, pass)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(config.salt), iterations: config.iterations },
      key,
      config.keyLength
    );
    return toBase64(bits);
  }

  /** Comparaison à temps constant, par principe. */
  function sameHash(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /* ----------------------------------------------------------- session */

  function readSession() {
    for (const store of [sessionStorage, localStorage]) {
      try {
        const raw = store.getItem(SESSION_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        /* stockage indisponible (navigation privée stricte) */
      }
    }
    return null;
  }

  function writeSession(hash, persist) {
    const payload = JSON.stringify({ hash, at: new Date().toISOString() });
    try {
      (persist ? localStorage : sessionStorage).setItem(SESSION_KEY, payload);
    } catch {
      /* pas de stockage : la session ne durera que le temps de la page */
    }
  }

  function clearSession() {
    for (const store of [sessionStorage, localStorage]) {
      try {
        store.removeItem(SESSION_KEY);
      } catch {
        /* ignoré */
      }
    }
  }

  /* --------------------------------------------------------- ouverture */

  function unlock() {
    document.body.classList.remove('is-locked');
    dom.gate.hidden = true;
    dom.form.reset();
    window.WaklinkApp?.boot();
  }

  function lock(message) {
    document.body.classList.add('is-locked');
    dom.gate.hidden = false;
    setError(message ?? '');
    requestAnimationFrame(() => dom.user.focus());
  }

  function setError(message) {
    dom.error.textContent = message;
    dom.error.hidden = !message;
    if (message) {
      dom.form.classList.remove('shake');
      void dom.form.offsetWidth; // relance l'animation
      dom.form.classList.add('shake');
    }
  }

  function setBusy(busy) {
    dom.submit.disabled = busy;
    dom.submit.classList.toggle('is-busy', busy);
    dom.submit.textContent = busy ? 'Ouverture…' : 'Ouvrir le portail';
  }

  /* -------------------------------------------------------------- init */

  async function init() {
    dom.form.addEventListener('submit', onSubmit);
    dom.logout?.addEventListener('click', () => {
      clearSession();
      window.WaklinkApp?.shutdown();
      location.hash = '';
      lock('Session fermée.');
    });

    try {
      const res = await fetch(CONFIG_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      config = await res.json();
    } catch (err) {
      console.error('[Waklink] assets/auth.json illisible :', err);
      lock('Configuration d’accès introuvable (assets/auth.json).');
      dom.submit.disabled = true;
      return;
    }

    if (dom.hint && config.hint) dom.hint.textContent = config.hint;

    if (!window.isSecureContext || !crypto.subtle) {
      lock('Contexte non sécurisé : ouvrez le site en https ou via localhost.');
      dom.submit.disabled = true;
      return;
    }

    const session = readSession();
    if (session && sameHash(session.hash, config.hash)) unlock();
    else lock();
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (dom.submit.disabled) return;

    const user = dom.user.value;
    const pass = dom.pass.value;
    if (!user || !pass) {
      setError('Identifiant et mot de passe requis.');
      return;
    }

    setBusy(true);
    setError('');

    const started = performance.now();
    let hash = null;
    try {
      hash = await derive(user, pass);
    } catch (err) {
      console.error('[Waklink] dérivation impossible :', err);
    }
    // Même temps de réponse en cas de succès comme d'échec.
    const wait = Math.max(0, MIN_DELAY - (performance.now() - started));
    await new Promise((r) => setTimeout(r, wait));
    setBusy(false);

    if (hash && sameHash(hash, config.hash)) {
      writeSession(hash, dom.remember.checked);
      unlock();
    } else {
      dom.pass.value = '';
      dom.pass.focus();
      setError('Identifiant ou mot de passe invalide.');
    }
  }

  init();
})();
