(() => {
  const cfg = window.BPG_ADMIN;
  if (!cfg || !window.supabase) {
    document.body.innerHTML = '<p style="padding:24px">Config / Supabase JS manquant.</p>';
    return;
  }

  const LS_KEY = 'bpg_truck_names_v1';
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  const loginView = document.getElementById('loginView');
  const listView = document.getElementById('listView');
  const bilanView = document.getElementById('bilanView');
  const detailsView = document.getElementById('detailsView');
  const btnLogout = document.getElementById('btnLogout');
  const btnLogin = document.getElementById('btnLogin');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnBack = document.getElementById('btnBack');
  const btnDetails = document.getElementById('btnDetails');
  const btnBackBilan = document.getElementById('btnBackBilan');
  const hideTests = document.getElementById('hideTests');
  const loginErr = document.getElementById('loginErr');
  const dashErr = document.getElementById('dashErr');
  const dashStatus = document.getElementById('dashStatus');
  const truckTableBody = document.getElementById('truckTableBody');
  const bilanContent = document.getElementById('bilanContent');
  const detailsContent = document.getElementById('detailsContent');
  const emailEl = document.getElementById('email');
  const passwordEl = document.getElementById('password');

  /** @type {Array<{userId:string, manifest:any}>} */
  let trucks = [];
  let selectedId = null;

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
  const COMPANY_ORDER = Object.keys(COMPANY_LABELS);
  const KIND_LABELS = {
    recette: 'Encaissement',
    depense: 'Dépense',
    note: 'Note',
    etiquette: 'Étiquette',
    frigo: 'Frigo',
    inventaire: 'Inventaire',
  };

  function loadLocalNames() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function isTestTruck(userId, name) {
    const n = (name || '').toLowerCase();
    if (n.includes('compte test') || n.includes('test')) return true;
    if ((cfg.truckNames || {})[userId] === 'Compte test') return true;
    return false;
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
    if (!Number.isFinite(n) || n <= 0 || n > 1e14) return '—';
    try {
      return new Date(n).toLocaleString('fr-FR');
    } catch (_) {
      return String(ms);
    }
  }

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function syncBadge(updatedAtMs) {
    if (!updatedAtMs) return '<span class="badge mute">Inconnue</span>';
    const ageH = (Date.now() - Number(updatedAtMs)) / 3600000;
    if (ageH <= 48) return '<span class="badge ok">Récente</span>';
    if (ageH <= 24 * 7) return '<span class="badge warn">En retard</span>';
    return '<span class="badge bad">Ancienne</span>';
  }

  function fs(manifest) {
    return (manifest && manifest.financeStats) || {};
  }

  function showOnly(view) {
    loginView.classList.add('hidden');
    listView.classList.add('hidden');
    bilanView.classList.add('hidden');
    detailsView.classList.add('hidden');
    view.classList.remove('hidden');
  }

  async function ensureAdminSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data.session;
    if (!session) {
      btnLogout.classList.add('hidden');
      showOnly(loginView);
      return null;
    }
    if (!isAdminEmail(session.user?.email || '')) {
      await client.auth.signOut();
      btnLogout.classList.add('hidden');
      showOnly(loginView);
      loginErr.textContent = 'Compte non autorisé pour l’admin franchise.';
      return null;
    }
    btnLogout.classList.remove('hidden');
    showOnly(listView);
    return session;
  }

  function visibleTrucks() {
    const hide = hideTests.checked;
    return trucks.filter((t) => {
      const name = displayNameFor(t.userId, t.manifest);
      if (hide && isTestTruck(t.userId, name)) return false;
      return true;
    });
  }

  function renderList() {
    const rows = visibleTrucks();
    dashStatus.textContent = `${rows.length} camion(s) affiché(s) / ${trucks.length} dossier(s).`;
    truckTableBody.innerHTML = '';
    if (rows.length === 0) {
      truckTableBody.innerHTML =
        '<tr><td colspan="5" class="meta">Aucun camion à afficher.</td></tr>';
      return;
    }
    for (const t of rows) {
      const name = displayNameFor(t.userId, t.manifest);
      const ville = (t.manifest?.companyProfile?.ville || '—');
      const stats = fs(t.manifest);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="name">${escapeHtml(name)}</div>
          <div class="meta">${escapeHtml(t.manifest?.email || t.userId.slice(0, 8) + '…')}</div>
        </td>
        <td>${escapeHtml(ville)}</td>
        <td>${fmtMoney(stats.recSumMonth)}</td>
        <td>${fmtMs(t.manifest?.updatedAtMs)}</td>
        <td>${syncBadge(t.manifest?.updatedAtMs)}</td>
      `;
      tr.addEventListener('click', () => openBilan(t.userId));
      truckTableBody.appendChild(tr);
    }
  }

  function findTruck(userId) {
    return trucks.find((t) => t.userId === userId) || null;
  }

  function lastEntryHtml(stats) {
    const le = stats.lastEntry;
    if (!le) return '—';
    const kind = KIND_LABELS[le.kind] || le.kind || 'Saisie';
    const amount = le.amount != null ? ` · ${fmtMoney(le.amount)}` : '';
    return `${escapeHtml(kind)} — ${escapeHtml(le.label || '')}${amount}<br/><span class="meta">${fmtMs(le.ms || stats.lastEntryMs)}</span>`;
  }

  function openBilan(userId) {
    const t = findTruck(userId);
    if (!t) return;
    selectedId = userId;
    const name = displayNameFor(userId, t.manifest);
    const stats = fs(t.manifest);
    const month = stats.statsMonth || 'mois en cours';
    const year = stats.statsYear || new Date().getFullYear();
    bilanContent.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <h2 style="margin:0 0 6px;">${escapeHtml(name)}</h2>
        <p class="sub" style="margin:0;">${escapeHtml(t.manifest?.email || userId)}</p>
      </div>
      <div class="bilan-grid">
        <div class="card">
          <h3 style="margin:0 0 12px;">Activité</h3>
          <div class="info-row"><span>Dernière sync</span><strong>${fmtMs(t.manifest?.updatedAtMs)} <span class="meta">(${escapeHtml(t.manifest?.source || '—')})</span></strong></div>
          <div class="info-row"><span>Dernière saisie</span><strong>${lastEntryHtml(stats)}</strong></div>
          <div class="info-row"><span>État sync</span><strong>${syncBadge(t.manifest?.updatedAtMs)}</strong></div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;">Finance</h3>
          <div class="kpi-grid">
            <div class="kpi">
              <div class="label">CA mois (${escapeHtml(String(month))})</div>
              <div class="value">${fmtMoney(stats.recSumMonth)}</div>
            </div>
            <div class="kpi">
              <div class="label">Dépenses mois</div>
              <div class="value">${fmtMoney(stats.depSumMonth)}</div>
            </div>
            <div class="kpi">
              <div class="label">CA année ${escapeHtml(String(year))}</div>
              <div class="value">${fmtMoney(stats.recSumYear)}</div>
            </div>
            <div class="kpi">
              <div class="label">Dépenses année ${escapeHtml(String(year))}</div>
              <div class="value">${fmtMoney(stats.depSumYear)}</div>
            </div>
          </div>
          <p class="sub" style="margin-top:12px;">
            ${(stats.recSumMonth == null && stats.recSumYear == null)
              ? 'Chiffres mois/année absents du manifeste — relancer une sync depuis l’app camion pour les remplir.'
              : 'Montants TTC issus de la dernière sync cloud.'}
          </p>
        </div>
      </div>
    `;
    showOnly(bilanView);
  }

  function openDetails() {
    const t = findTruck(selectedId);
    if (!t) return;
    const name = displayNameFor(selectedId, t.manifest);
    const profile = t.manifest?.companyProfile || {};
    const stats = fs(t.manifest);
    const rows = [];
    for (const key of COMPANY_ORDER) {
      const val = (profile[key] || '').trim();
      if (!val) continue;
      rows.push(`<div class="info-row"><span>${escapeHtml(COMPANY_LABELS[key])}</span><strong>${escapeHtml(val)}</strong></div>`);
    }
    detailsContent.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <h2 style="margin:0 0 6px;">Détails — ${escapeHtml(name)}</h2>
        <p class="sub" style="margin:0;">Fiche entreprise et volumes</p>
      </div>
      <div class="bilan-grid">
        <div class="card">
          <h3 style="margin:0 0 10px;">Entreprise</h3>
          ${rows.length ? rows.join('') : '<p class="sub">Fiche entreprise vide.</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 10px;">Volumes</h3>
          <div class="info-row"><span>Recettes</span><strong>${stats.recCount ?? '—'}</strong></div>
          <div class="info-row"><span>Dépenses</span><strong>${stats.depCount ?? '—'}</strong></div>
          <div class="info-row"><span>Notes</span><strong>${stats.postItCount ?? '—'}</strong></div>
          <div class="info-row"><span>Étiquettes</span><strong>${stats.labelCount ?? '—'}</strong></div>
          <div class="info-row"><span>Ingrédients</span><strong>${stats.catalogueIngCount ?? '—'}</strong></div>
          <div class="info-row"><span>Id compte</span><strong><code>${escapeHtml(selectedId)}</code></strong></div>
        </div>
      </div>
    `;
    showOnly(detailsView);
  }

  async function loadTrucks() {
    dashErr.textContent = '';
    dashStatus.textContent = 'Chargement…';
    trucks = [];
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

    for (const userId of truckIds) {
      try {
        const { data: blob, error: dlErr } = await client.storage
          .from(cfg.syncBucket)
          .download(`${userId}/sync_manifest.json`);
        if (dlErr) throw dlErr;
        const manifest = JSON.parse(await blob.text());
        trucks.push({ userId, manifest });
      } catch (e) {
        trucks.push({ userId, manifest: null });
      }
    }
    trucks.sort((a, b) =>
      displayNameFor(a.userId, a.manifest).localeCompare(
        displayNameFor(b.userId, b.manifest),
        'fr',
      ),
    );
    renderList();
  }

  btnLogin.addEventListener('click', async () => {
    loginErr.textContent = '';
    btnLogin.disabled = true;
    try {
      const email = emailEl.value.trim();
      const password = passwordEl.value;
      if (!isAdminEmail(email)) throw new Error('Cet e-mail n’est pas admin.');
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
    trucks = [];
    selectedId = null;
    btnLogout.classList.add('hidden');
    showOnly(loginView);
  });

  btnRefresh.addEventListener('click', () => loadTrucks());
  hideTests.addEventListener('change', () => renderList());
  btnBack.addEventListener('click', () => {
    selectedId = null;
    showOnly(listView);
  });
  btnDetails.addEventListener('click', () => openDetails());
  btnBackBilan.addEventListener('click', () => {
    if (selectedId) openBilan(selectedId);
    else showOnly(listView);
  });
  passwordEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') btnLogin.click();
  });

  ensureAdminSession().then((s) => {
    if (s) loadTrucks();
  });
})();
