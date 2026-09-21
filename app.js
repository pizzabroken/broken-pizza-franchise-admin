(() => {
  const cfg = window.BPG_ADMIN;
  if (!cfg || !window.supabase) {
    document.body.innerHTML =
      '<p style="padding:24px">Config / Supabase JS manquant.</p>';
    return;
  }

  const LS_KEY = 'bpg_truck_names_v1';

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

  function loadLocalNames() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function saveLocalName(userId, name) {
    const map = loadLocalNames();
    const n = (name || '').trim();
    if (n) map[userId] = n;
    else delete map[userId];
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  }

  function displayNameFor(userId, manifest) {
    const local = loadLocalNames()[userId];
    if (local) return local;
    const configured = (cfg.truckNames || {})[userId];
    if (configured) return configured;
    if (manifest && manifest.truckName) return String(manifest.truckName);
    if (manifest && manifest.email) return String(manifest.email);
    return `Camion ${userId.slice(0, 8)}`;
  }

  function isAdminEmail(email) {
    const e = (email || '').trim().toLowerCase();
    return (cfg.adminEmails || []).map((x) => x.toLowerCase()).includes(e);
  }

  function fmtMs(ms) {
    if (!ms) return '—';
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '—';
    // Garde-fou : timestamps aberrants (secondes mal converties, etc.)
    if (n > 1e14) return '—';
    try {
      return new Date(n).toLocaleString('fr-FR');
    } catch (_) {
      return String(ms);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  const COMPANY_LABELS = {
    raison_sociale: 'Raison sociale',
    nom_commercial: 'Nom commercial',
    forme_juridique: 'Forme juridique',
    siret: 'SIRET',
    tva_intracom: 'TVA intracom',
    rcs: 'RCS',
    adresse: 'Adresse',
    code_postal: 'Code postal',
    ville: 'Ville',
    telephone: 'Téléphone',
    email: 'E-mail société',
  };

  const COMPANY_ORDER = [
    'raison_sociale',
    'nom_commercial',
    'forme_juridique',
    'siret',
    'tva_intracom',
    'rcs',
    'adresse',
    'code_postal',
    'ville',
    'telephone',
    'email',
  ];

  function companyProfileHtml(manifest) {
    const raw = (manifest && manifest.companyProfile) || {};
    const lines = [];
    for (const key of COMPANY_ORDER) {
      const val = (raw[key] || '').trim();
      if (!val) continue;
      lines.push(
        `<div class="info-row"><span>${escapeHtml(COMPANY_LABELS[key] || key)}</span><strong>${escapeHtml(val)}</strong></div>`,
      );
    }
    if (lines.length === 0) {
      return '<p class="meta">Fiche entreprise vide — à remplir dans l’app puis resynchroniser.</p>';
    }
    return `<div class="company-block">${lines.join('')}</div>`;
  }

  function renderTruckCard(card, userId, manifest) {
    const name = displayNameFor(userId, manifest);
    const accountEmail = (manifest && manifest.email) || '';
    const fs = (manifest && manifest.financeStats) || {};
    card.innerHTML = `
      <h2>${escapeHtml(name)}</h2>
      <p class="meta">
        ${accountEmail ? `<strong>Compte app</strong> : ${escapeHtml(accountEmail)}<br/>` : ''}
        <strong>Id</strong> : <code>${escapeHtml(userId)}</code><br/>
        <strong>Dernière sync</strong> : ${fmtMs(manifest && manifest.updatedAtMs)} ·
        <strong>Source</strong> : ${escapeHtml((manifest && manifest.source) || '—')}<br/>
        Contenu : ${fmtMs(fs.contentUpdatedAtMs)}
      </p>
      ${companyProfileHtml(manifest)}
      <div class="row" style="margin-top:12px;">
        <button type="button" class="secondary btn-rename">Renommer</button>
      </div>
    `;
    card.title = userId;
    card.querySelector('.btn-rename').addEventListener('click', () => {
      const next = prompt('Nom du camion (vide = effacer le surnom local) :', name);
      if (next === null) return;
      saveLocalName(userId, next);
      renderTruckCard(card, userId, manifest);
    });
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

    dashStatus.textContent = `${truckIds.length} camion(s).`;

    for (const userId of truckIds) {
      const card = document.createElement('article');
      card.className = 'truck';
      card.innerHTML = `<h2>${escapeHtml(userId.slice(0, 8))}…</h2><p class="meta">Lecture du manifeste…</p>`;
      truckGrid.appendChild(card);

      try {
        const { data: blob, error: dlErr } = await client.storage
          .from(cfg.syncBucket)
          .download(`${userId}/sync_manifest.json`);
        if (dlErr) throw dlErr;
        const text = await blob.text();
        const manifest = JSON.parse(text);
        renderTruckCard(card, userId, manifest);
      } catch (e) {
        renderTruckCard(card, userId, null);
        const meta = card.querySelector('.meta');
        if (meta) {
          meta.innerHTML += `<br/><span class="err">Manifeste : ${(e && e.message) || e}</span>`;
        }
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
