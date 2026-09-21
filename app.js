(() => {
  const cfg = window.BPG_ADMIN;
  if (!cfg || !window.supabase) {
    document.body.innerHTML =
      '<p style="padding:24px">Config / Supabase JS manquant.</p>';
    return;
  }

  const client = window.supabase.createClient(
    cfg.supabaseUrl,
    cfg.supabaseAnonKey,
  );

  const loginView = document.getElementById('loginView');
  const dashView = document.getElementById('dashView');
  const btnLogout = document.getElementById('btnLogout');
  const btnLogin = document.getElementById('btnLogin');
  const btnRefresh = document.getElementById('btnRefresh');
  const loginErr = document.getElementById('loginErr');
  const dashErr = document.getElementById('dashErr');
  const dashStatus = document.getElementById('dashStatus');
  const truckGrid = document.getElementById('truckGrid');
  const emailEl = document.getElementById('email');
  const passwordEl = document.getElementById('password');

  function isAdminEmail(email) {
    const e = (email || '').trim().toLowerCase();
    return (cfg.adminEmails || []).map((x) => x.toLowerCase()).includes(e);
  }

  function fmtMs(ms) {
    if (!ms) return '—';
    try {
      return new Date(Number(ms)).toLocaleString('fr-FR');
    } catch (_) {
      return String(ms);
    }
  }

  function showLoggedOut() {
    loginView.classList.remove('hidden');
    dashView.classList.add('hidden');
    btnLogout.classList.add('hidden');
  }

  function showLoggedIn() {
    loginView.classList.add('hidden');
    dashView.classList.remove('hidden');
    btnLogout.classList.remove('hidden');
  }

  async function ensureAdminSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (!session) {
      showLoggedOut();
      return null;
    }
    const email = session.user?.email || '';
    if (!isAdminEmail(email)) {
      await client.auth.signOut();
      showLoggedOut();
      loginErr.textContent =
        'Compte non autorisé pour l’admin franchise. Utilisez le compte admin.';
      return null;
    }
    showLoggedIn();
    return session;
  }

  async function loadTrucks() {
    dashErr.textContent = '';
    dashStatus.textContent = 'Chargement des syncs…';
    truckGrid.innerHTML = '';

    const { data: folders, error } = await client.storage
      .from(cfg.syncBucket)
      .list('', { limit: 200, sortBy: { column: 'name', order: 'asc' } });

    if (error) {
      dashErr.textContent = error.message;
      dashStatus.textContent = '';
      return;
    }

    const truckIds = (folders || [])
      .map((f) => f.name)
      .filter((n) => n && !n.includes('.'));

    if (truckIds.length === 0) {
      dashStatus.textContent =
        'Aucun camion synchronisé pour l’instant. Lance une sync depuis l’app camion.';
      return;
    }

    dashStatus.textContent = `${truckIds.length} dossier(s) camion.`;

    for (const userId of truckIds) {
      const card = document.createElement('article');
      card.className = 'truck';
      card.innerHTML = `<h2>${userId}</h2><p class="meta">Lecture du manifeste…</p>`;
      truckGrid.appendChild(card);

      try {
        const { data: blob, error: dlErr } = await client.storage
          .from(cfg.syncBucket)
          .download(`${userId}/sync_manifest.json`);
        if (dlErr) throw dlErr;
        const text = await blob.text();
        const manifest = JSON.parse(text);
        const fs = manifest.financeStats || {};
        card.innerHTML = `
          <h2>${userId.slice(0, 8)}…</h2>
          <p class="meta">
            <strong>Dernière sync</strong> : ${fmtMs(manifest.updatedAtMs)}<br/>
            <strong>Source</strong> : ${manifest.source || '—'}<br/>
            <strong>Contenu</strong> : ${fmtMs(fs.contentUpdatedAtMs)}<br/>
            Recettes max : ${fmtMs(fs.recMaxMs)} · Dépenses max : ${fmtMs(fs.depMaxMs)}
          </p>
          <span class="badge">sync_manifest.json</span>
        `;
        card.title = userId;
      } catch (e) {
        card.innerHTML = `
          <h2>${userId.slice(0, 8)}…</h2>
          <p class="meta">Pas de manifeste (ou erreur) : ${(e && e.message) || e}</p>
        `;
        card.title = userId;
      }
    }
  }

  btnLogin.addEventListener('click', async () => {
    loginErr.textContent = '';
    btnLogin.disabled = true;
    try {
      const email = emailEl.value.trim();
      const password = passwordEl.value;
      if (!isAdminEmail(email)) {
        throw new Error('Cet e-mail n’est pas dans la liste admin.');
      }
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const session = await ensureAdminSession();
      if (session) await loadTrucks();
    } catch (e) {
      loginErr.textContent = (e && e.message) || String(e);
    } finally {
      btnLogin.disabled = false;
    }
  });

  btnLogout.addEventListener('click', async () => {
    await client.auth.signOut();
    showLoggedOut();
  });

  btnRefresh.addEventListener('click', () => loadTrucks());

  passwordEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') btnLogin.click();
  });

  ensureAdminSession().then((s) => {
    if (s) loadTrucks();
  });
})();
