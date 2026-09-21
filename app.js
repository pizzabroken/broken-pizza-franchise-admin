(() => {
  const cfg = window.BPG_ADMIN;
  if (!cfg || !window.supabase) {
    document.body.innerHTML = '<p style="padding:24px">Config / Supabase JS manquant.</p>';
    return;
  }

  const LS_KEY = 'bpg_truck_names_v1';
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const TruckDb = window.BPG_TruckDb;

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

  /** @type {{tab:string, financeKind:string, financeMonth:string, financeQ:string, financeOffset:number, invId:number|null, hygSub:string, releveFrigo:string, releveMonth:string, releveOffset:number}} */
  let detailsState = defaultDetailsState();

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

  function defaultDetailsState() {
    return {
      tab: 'finance',
      financeKind: 'recette',
      financeMonth: '',
      financeQ: '',
      financeOffset: 0,
      invId: null,
      hygSub: 'releves',
      releveFrigo: '',
      releveMonth: '',
      releveOffset: 0,
    };
  }

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
    return TruckDb.fmtMs(ms);
  }

  function fmtMoney(v) {
    return TruckDb.fmtMoney(v);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function syncBadge(updatedAtMs) {
    const alerts = TruckDb.computeAlerts({ updatedAtMs });
    if (!updatedAtMs) return '<span class="badge mute">Inconnue</span>';
    if (alerts.syncStale) {
      return `<span class="badge bad">Sync &gt; 72 h${alerts.syncAgeH != null ? ` (${alerts.syncAgeH} h)` : ''}</span>`;
    }
    const ageH = (Date.now() - Number(updatedAtMs)) / 3600000;
    if (ageH <= 48) return '<span class="badge ok">Récente</span>';
    return '<span class="badge warn">À surveiller</span>';
  }

  function truckAlerts(manifest, liveInv = null) {
    return TruckDb.computeAlerts(manifest, liveInv);
  }

  function alertsHtml(alerts) {
    const bits = [];
    if (alerts.syncStale) {
      bits.push(
        `<div class="alert-banner bad">Pas de sync depuis plus de 72 h${alerts.syncAgeH != null ? ` (${alerts.syncAgeH} h)` : ''}.</div>`,
      );
    }
    if (alerts.inv.alertMissing) {
      const miss = (alerts.inv.missing || []).join(', ') || 'sections manquantes';
      bits.push(
        `<div class="alert-banner bad">Inventaire ${String(alerts.inv.month).padStart(2, '0')}/${alerts.inv.year} non rentré (échéance le 15) — manque : ${escapeHtml(miss)}.</div>`,
      );
    } else if (alerts.inv.dueDayReached) {
      bits.push(
        `<div class="alert-banner ok">Inventaire ${String(alerts.inv.month).padStart(2, '0')}/${alerts.inv.year} OK.</div>`,
      );
    } else {
      bits.push(
        `<div class="alert-banner mute">Inventaire ${String(alerts.inv.month).padStart(2, '0')}/${alerts.inv.year} à contrôler au 15.</div>`,
      );
    }
    return bits.join('');
  }

  function alertChips(alerts) {
    const chips = [];
    if (alerts.syncStale) chips.push('<span class="badge bad">Sync &gt; 72 h</span>');
    if (alerts.inv.alertMissing) chips.push('<span class="badge bad">Inventaire 15</span>');
    if (!chips.length) chips.push('<span class="badge ok">OK</span>');
    return chips.join(' ');
  }

  function fs(manifest) {
    return (manifest && manifest.financeStats) || {};
  }

  function safeFilePart(s) {
    return String(s || 'camion')
      .replace(/[^\w\-]+/g, '_')
      .slice(0, 40);
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
    const alertCount = rows.filter((t) => truckAlerts(t.manifest).hasAny).length;
    dashStatus.textContent = `${rows.length} camion(s) · ${alertCount} alerte(s) · ${trucks.length} dossier(s).`;
    truckTableBody.innerHTML = '';
    if (rows.length === 0) {
      truckTableBody.innerHTML =
        '<tr><td colspan="5" class="meta">Aucun camion à afficher.</td></tr>';
      return;
    }
    for (const t of rows) {
      const name = displayNameFor(t.userId, t.manifest);
      const ville = t.manifest?.companyProfile?.ville || '—';
      const stats = fs(t.manifest);
      const alerts = truckAlerts(t.manifest);
      const tr = document.createElement('tr');
      if (alerts.hasAny) tr.classList.add('row-alert');
      tr.innerHTML = `
        <td>
          <div class="name">${escapeHtml(name)}</div>
          <div class="meta">${escapeHtml(t.manifest?.email || t.userId.slice(0, 8) + '…')}</div>
        </td>
        <td>${escapeHtml(ville)}</td>
        <td>${fmtMoney(stats.recSumMonth)}</td>
        <td>${fmtMs(t.manifest?.updatedAtMs)}<div class="meta">${syncBadge(t.manifest?.updatedAtMs)}</div></td>
        <td>${alertChips(alerts)}</td>
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
    const alerts = truckAlerts(t.manifest);
    bilanContent.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <h2 style="margin:0 0 6px;">${escapeHtml(name)}</h2>
        <p class="sub" style="margin:0;">${escapeHtml(t.manifest?.email || userId)}</p>
      </div>
      <div class="alerts-stack" style="margin-bottom:16px;">${alertsHtml(alerts)}</div>
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
        </div>
      </div>
    `;
    showOnly(bilanView);
  }

  async function openDetails() {
    if (!selectedId) return;
    detailsState = defaultDetailsState();
    showOnly(detailsView);
    detailsContent.innerHTML = `
      <div class="card">
        <p class="sub" id="detailsLoadMsg">Préparation…</p>
        <div class="progress-bar"><div id="detailsLoadBar"></div></div>
      </div>`;
    const msg = document.getElementById('detailsLoadMsg');
    try {
      await TruckDb.loadTruckDb(client, cfg.syncBucket, selectedId, (m) => {
        if (msg) msg.textContent = m;
      });
      renderDetails();
    } catch (e) {
      detailsContent.innerHTML = `
        <div class="card">
          <p class="err">${escapeHtml((e && e.message) || String(e))}</p>
          <p class="sub">Le ZIP cloud est peut-être absent pour ce camion. Relancer une sync depuis l’app.</p>
        </div>`;
    }
  }

  /** @type {any} */
  let activeTruckDb = null;

  function renderDetails() {
    const t = findTruck(selectedId);
    renderDetailsWithDb(t);
  }

  function refreshDetailsPanel() {
    const panel = document.getElementById('detailsPanel');
    if (!panel || !activeTruckDb) {
      renderDetails();
      return;
    }
    const t = findTruck(selectedId);
    const name = displayNameFor(selectedId, t?.manifest);
    const liveInv = activeTruckDb.inventoryStatus();
    if (detailsState.tab === 'synthese') panel.innerHTML = renderSynthese(t, activeTruckDb.counts(), liveInv);
    else if (detailsState.tab === 'finance') renderFinancePanel(panel, activeTruckDb, name);
    else if (detailsState.tab === 'inventaires') renderInventairesPanel(panel, activeTruckDb, name);
    else renderHygienePanel(panel, activeTruckDb, name);
  }

  async function renderDetailsWithDb(t) {
    const truckDb = await TruckDb.loadTruckDb(client, cfg.syncBucket, selectedId);
    activeTruckDb = truckDb;
    const name = displayNameFor(selectedId, t?.manifest);
    const counts = truckDb.counts();
    const liveInv = truckDb.inventoryStatus();
    const alerts = truckAlerts(t?.manifest, liveInv);
    const tabs = [
      ['synthese', 'Synthèse'],
      ['finance', `Finance (${counts.recettes + counts.depenses})`],
      ['inventaires', `Inventaires (${counts.inventaires})`],
      ['hygiene', `Hygiène (${counts.releves + counts.etiquettes})`],
    ];

    detailsContent.innerHTML = `
      <div class="card details-head">
        <div>
          <h2 style="margin:0 0 4px;">Détails — ${escapeHtml(name)}</h2>
          <p class="sub" style="margin:0;">Données de la dernière sync cloud (lecture seule)</p>
        </div>
        <div class="counts-strip">
          <span>${counts.recettes} recettes</span>
          <span>${counts.depenses} dépenses</span>
          <span>${counts.inventaires} inventaires</span>
          <span>${counts.releves} relevés</span>
          <span>${counts.etiquettes} étiquettes</span>
        </div>
      </div>
      <div class="alerts-stack" style="margin-bottom:14px;">${alertsHtml(alerts)}</div>
      <div class="tabs" id="detailsTabs">
        ${tabs
          .map(
            ([id, label]) =>
              `<button type="button" class="tab-btn${detailsState.tab === id ? ' active' : ''}" data-tab="${id}">${escapeHtml(label)}</button>`,
          )
          .join('')}
      </div>
      <div id="detailsPanel"></div>
    `;

    detailsContent.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        detailsState.tab = btn.getAttribute('data-tab');
        detailsState.financeOffset = 0;
        detailsState.releveOffset = 0;
        renderDetailsWithDb(t);
      });
    });

    const panel = document.getElementById('detailsPanel');
    if (detailsState.tab === 'synthese') panel.innerHTML = renderSynthese(t, counts, liveInv);
    else if (detailsState.tab === 'finance') renderFinancePanel(panel, truckDb, name);
    else if (detailsState.tab === 'inventaires') renderInventairesPanel(panel, truckDb, name);
    else renderHygienePanel(panel, truckDb, name);
  }

  function renderSynthese(t, counts, liveInv) {
    const profile = t?.manifest?.companyProfile || {};
    const rows = [];
    for (const key of COMPANY_ORDER) {
      const val = (profile[key] || '').trim();
      if (!val) continue;
      rows.push(
        `<div class="info-row"><span>${escapeHtml(COMPANY_LABELS[key])}</span><strong>${escapeHtml(val)}</strong></div>`,
      );
    }
    const inv = liveInv || TruckDb.inventoryStatusFromStats(fs(t?.manifest));
    return `
      <div class="bilan-grid">
        <div class="card">
          <h3 style="margin:0 0 10px;">Entreprise</h3>
          ${rows.length ? rows.join('') : '<p class="sub">Fiche entreprise vide.</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 10px;">Volumes synchronisés</h3>
          <div class="info-row"><span>Recettes</span><strong>${counts.recettes}</strong></div>
          <div class="info-row"><span>Dépenses</span><strong>${counts.depenses}</strong></div>
          <div class="info-row"><span>Inventaires</span><strong>${counts.inventaires} (${counts.lignesInv} lignes)</strong></div>
          <div class="info-row"><span>Frigos</span><strong>${counts.frigos}</strong></div>
          <div class="info-row"><span>Relevés</span><strong>${counts.releves}</strong></div>
          <div class="info-row"><span>Étiquettes</span><strong>${counts.etiquettes}</strong></div>
          <div class="info-row"><span>Notes</span><strong>${counts.notes}</strong></div>
          <div class="info-row"><span>Inv. mois</span><strong>${escapeHtml((inv.recorded || []).join(', ') || 'aucun')} / requis ${(inv.required || []).join(', ')}</strong></div>
        </div>
      </div>`;
  }

  function renderFinancePanel(panel, truckDb, truckName) {
    const kind = detailsState.financeKind;
    const data =
      kind === 'recette'
        ? truckDb.recettes({
            month: detailsState.financeMonth,
            q: detailsState.financeQ,
            offset: detailsState.financeOffset,
          })
        : truckDb.depenses({
            month: detailsState.financeMonth,
            q: detailsState.financeQ,
            offset: detailsState.financeOffset,
          });

    const monthOpts = [
      `<option value="">Tous les mois</option>`,
      ...data.months.map(
        (m) =>
          `<option value="${escapeHtml(m)}"${m === detailsState.financeMonth ? ' selected' : ''}>${escapeHtml(m)}</option>`,
      ),
    ].join('');

    const typeLabel = kind === 'recette' ? 'Type' : 'Catégorie';
    const rowsHtml = data.rows
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(TruckDb.fmtDay(r.ms))}</td>
        <td>${escapeHtml(r.type)}</td>
        <td>${escapeHtml(r.libelle || '—')}</td>
        <td class="num">${fmtMoney(r.montant)}</td>
        <td class="meta">${escapeHtml(r.note || '')}</td>
      </tr>`,
      )
      .join('');

    panel.innerHTML = `
      <div class="card">
        <div class="toolbar tight">
          <div class="seg">
            <button type="button" class="seg-btn${kind === 'recette' ? ' active' : ''}" data-fk="recette">Recettes</button>
            <button type="button" class="seg-btn${kind === 'depense' ? ' active' : ''}" data-fk="depense">Dépenses</button>
          </div>
          <select id="finMonth">${monthOpts}</select>
          <input id="finQ" type="search" placeholder="Rechercher…" value="${escapeHtml(detailsState.financeQ)}" />
          <button type="button" class="secondary" id="finExport">Exporter CSV</button>
          <span class="sub">${data.totalCount} ligne(s) · total ${fmtMoney(data.totalAmount)}</span>
        </div>
        <div class="table-wrap plain">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>${typeLabel}</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="5" class="meta">Aucune entrée.</td></tr>'}
            </tbody>
          </table>
        </div>
        ${pagerHtml(data.offset, data.limit, data.totalCount, 'fin')}
      </div>`;

    panel.querySelectorAll('[data-fk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        detailsState.financeKind = btn.getAttribute('data-fk');
        detailsState.financeOffset = 0;
        refreshDetailsPanel();
      });
    });
    panel.querySelector('#finMonth').addEventListener('change', (ev) => {
      detailsState.financeMonth = ev.target.value;
      detailsState.financeOffset = 0;
      refreshDetailsPanel();
    });
    let qTimer;
    const finQ = panel.querySelector('#finQ');
    finQ.addEventListener('input', (ev) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        detailsState.financeQ = ev.target.value.trim();
        detailsState.financeOffset = 0;
        refreshDetailsPanel();
        const again = document.getElementById('finQ');
        if (again) {
          again.focus();
          const len = again.value.length;
          again.setSelectionRange(len, len);
        }
      }, 250);
    });
    bindPager(panel, 'fin', data, (next) => {
      detailsState.financeOffset = next;
      refreshDetailsPanel();
    });
    panel.querySelector('#finExport').addEventListener('click', () => {
      const all =
        kind === 'recette'
          ? truckDb.recettes({
              month: detailsState.financeMonth,
              q: detailsState.financeQ,
              offset: 0,
              limit: 100000,
            })
          : truckDb.depenses({
              month: detailsState.financeMonth,
              q: detailsState.financeQ,
              offset: 0,
              limit: 100000,
            });
      const stamp = new Date().toISOString().slice(0, 10);
      TruckDb.downloadCsv(
        `${safeFilePart(truckName)}_${kind}_${stamp}.csv`,
        ['date', typeLabel.toLowerCase(), 'libelle', 'montant', 'note'],
        all.rows.map((r) => [
          TruckDb.fmtDay(r.ms),
          r.type,
          r.libelle,
          String(r.montant).replace('.', ','),
          r.note,
        ]),
      );
    });
  }

  function renderInventairesPanel(panel, truckDb, truckName) {
    const list = truckDb.inventaires();
    if (!detailsState.invId && list.length) detailsState.invId = list[0].id;
    const selected = list.find((x) => x.id === detailsState.invId) || null;
    const lines = selected ? truckDb.inventaireLignes(selected.id) : [];
    const valeur = lines.reduce((s, l) => s + l.valeur, 0);

    panel.innerHTML = `
      <div class="split-pane">
        <div class="card side-list">
          <h3 style="margin:0 0 10px;">Périodes</h3>
          <div class="side-scroll">
            ${
              list
                .map((inv) => {
                  const label = `${String(inv.mois).padStart(2, '0')}/${inv.annee} · ${inv.section}`;
                  return `<button type="button" class="side-item${inv.id === detailsState.invId ? ' active' : ''}" data-inv="${inv.id}">
                    <strong>${escapeHtml(label)}</strong>
                    <span class="meta">${inv.enregistre ? 'Enregistré' : 'Brouillon'} · ${escapeHtml(TruckDb.fmtDay(inv.createdMs))}</span>
                  </button>`;
                })
                .join('') || '<p class="sub">Aucun inventaire.</p>'
            }
          </div>
        </div>
        <div class="card">
          <div class="toolbar tight">
            <h3 style="margin:0;">${selected ? escapeHtml(`${String(selected.mois).padStart(2, '0')}/${selected.annee} — ${selected.section}`) : 'Lignes'}</h3>
            <button type="button" class="secondary" id="invExport" ${selected ? '' : 'disabled'}>Exporter CSV</button>
            <span class="sub">${lines.length} ligne(s) · valeur HT ${fmtMoney(valeur)}</span>
          </div>
          <div class="table-wrap plain">
            <table class="data-table">
              <thead>
                <tr><th>Ingrédient</th><th>Qté</th><th>Unité</th><th>PU HT</th><th>Valeur HT</th></tr>
              </thead>
              <tbody>
                ${
                  lines
                    .map(
                      (l) => `<tr>
                      <td>${escapeHtml(l.ingredient)}</td>
                      <td class="num">${l.qty}</td>
                      <td>${escapeHtml(l.unite || '—')}</td>
                      <td class="num">${fmtMoney(l.prixHt)}</td>
                      <td class="num">${fmtMoney(l.valeur)}</td>
                    </tr>`,
                    )
                    .join('') || '<tr><td colspan="5" class="meta">Sélectionne un inventaire.</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>`;

    panel.querySelectorAll('[data-inv]').forEach((btn) => {
      btn.addEventListener('click', () => {
        detailsState.invId = Number(btn.getAttribute('data-inv'));
        refreshDetailsPanel();
      });
    });
    const exp = panel.querySelector('#invExport');
    if (exp && selected) {
      exp.addEventListener('click', () => {
        const stamp = `${selected.annee}-${String(selected.mois).padStart(2, '0')}_${selected.section}`;
        TruckDb.downloadCsv(
          `${safeFilePart(truckName)}_inventaire_${stamp}.csv`,
          ['ingredient', 'quantite', 'unite', 'prix_ht', 'valeur_ht'],
          lines.map((l) => [
            l.ingredient,
            String(l.qty).replace('.', ','),
            l.unite || '',
            String(l.prixHt).replace('.', ','),
            String(l.valeur).replace('.', ','),
          ]),
        );
      });
    }
  }

  function renderHygienePanel(panel, truckDb, truckName) {
    const sub = detailsState.hygSub;
    panel.innerHTML = `
      <div class="card">
        <div class="toolbar tight">
          <div class="seg">
            <button type="button" class="seg-btn${sub === 'releves' ? ' active' : ''}" data-hyg="releves">Relevés</button>
            <button type="button" class="seg-btn${sub === 'frigos' ? ' active' : ''}" data-hyg="frigos">Équipements</button>
            <button type="button" class="seg-btn${sub === 'etiquettes' ? ' active' : ''}" data-hyg="etiquettes">Étiquettes</button>
          </div>
          <button type="button" class="secondary" id="hygExport">Exporter CSV</button>
        </div>
        <div id="hygBody"></div>
      </div>`;

    panel.querySelectorAll('[data-hyg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        detailsState.hygSub = btn.getAttribute('data-hyg');
        detailsState.releveOffset = 0;
        refreshDetailsPanel();
      });
    });

    const body = panel.querySelector('#hygBody');
    const stamp = new Date().toISOString().slice(0, 10);
    const exportBtn = panel.querySelector('#hygExport');

    if (sub === 'frigos') {
      const frigos = truckDb.frigos();
      body.innerHTML = `
        <div class="table-wrap plain">
          <table class="data-table">
            <thead><tr><th>Nom</th><th>Type</th><th>Min</th><th>Max</th><th>Actif</th><th>Maj</th></tr></thead>
            <tbody>
              ${
                frigos
                  .map(
                    (f) => `<tr>
                    <td>${escapeHtml(f.nom)}</td>
                    <td>${escapeHtml(f.type)}</td>
                    <td class="num">${f.min} °C</td>
                    <td class="num">${f.max} °C</td>
                    <td>${f.active ? 'Oui' : 'Non'}</td>
                    <td>${escapeHtml(fmtMs(f.updatedMs))}</td>
                  </tr>`,
                  )
                  .join('') || '<tr><td colspan="6" class="meta">Aucun frigo.</td></tr>'
              }
            </tbody>
          </table>
        </div>`;
      exportBtn.addEventListener('click', () => {
        TruckDb.downloadCsv(
          `${safeFilePart(truckName)}_frigos_${stamp}.csv`,
          ['nom', 'type', 'min_c', 'max_c', 'actif', 'maj'],
          frigos.map((f) => [
            f.nom,
            f.type,
            f.min,
            f.max,
            f.active ? 'oui' : 'non',
            fmtMs(f.updatedMs),
          ]),
        );
      });
      return;
    }

    if (sub === 'etiquettes') {
      const labels = truckDb.etiquettes();
      body.innerHTML = `
        <div class="photo-grid">
          ${
            labels
              .map((l) => {
                const img = l.thumbUrl || l.fullUrl;
                return `<a class="photo-card" href="${img || '#'}" target="_blank" rel="noopener">
                  ${img ? `<img src="${img}" alt="" loading="lazy" />` : '<div class="photo-missing">Pas d’image</div>'}
                  <div class="photo-meta">
                    <strong>${escapeHtml(l.category)}</strong>
                    <span>${escapeHtml(TruckDb.fmtDay(l.ms))}</span>
                  </div>
                </a>`;
              })
              .join('') || '<p class="sub">Aucune étiquette.</p>'
          }
        </div>`;
      exportBtn.addEventListener('click', () => {
        TruckDb.downloadCsv(
          `${safeFilePart(truckName)}_etiquettes_${stamp}.csv`,
          ['date', 'categorie'],
          labels.map((l) => [TruckDb.fmtDay(l.ms), l.category]),
        );
      });
      return;
    }

    // relevés
    const frigos = truckDb.frigos();
    const data = truckDb.releves({
      frigoId: detailsState.releveFrigo,
      month: detailsState.releveMonth,
      offset: detailsState.releveOffset,
    });
    const frigoOpts = [
      `<option value="">Tous les frigos</option>`,
      ...frigos.map(
        (f) =>
          `<option value="${f.id}"${String(f.id) === String(detailsState.releveFrigo) ? ' selected' : ''}>${escapeHtml(f.nom)}</option>`,
      ),
    ].join('');
    const monthOpts = [
      `<option value="">Tous les mois</option>`,
      ...data.months.map(
        (m) =>
          `<option value="${escapeHtml(m)}"${m === detailsState.releveMonth ? ' selected' : ''}>${escapeHtml(m)}</option>`,
      ),
    ].join('');

    body.innerHTML = `
      <div class="toolbar tight">
        <select id="relFrigo">${frigoOpts}</select>
        <select id="relMonth">${monthOpts}</select>
        <span class="sub">${data.totalCount} relevé(s)</span>
      </div>
      <div class="table-wrap plain">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Frigo</th><th>Temp.</th><th>Plage</th><th>Note</th></tr></thead>
          <tbody>
            ${
              data.rows
                .map(
                  (r) => `<tr class="${r.horsPlage ? 'row-warn' : ''}">
                  <td>${escapeHtml(TruckDb.fmtDay(r.ms))}</td>
                  <td>${escapeHtml(r.frigo)}</td>
                  <td class="num">${r.temp} °C</td>
                  <td class="meta">${r.min ?? '—'} → ${r.max ?? '—'} °C</td>
                  <td>${escapeHtml(r.note || '')}</td>
                </tr>`,
                )
                .join('') || '<tr><td colspan="5" class="meta">Aucun relevé.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      ${pagerHtml(data.offset, data.limit, data.totalCount, 'rel')}`;

    body.querySelector('#relFrigo').addEventListener('change', (ev) => {
      detailsState.releveFrigo = ev.target.value;
      detailsState.releveOffset = 0;
      refreshDetailsPanel();
    });
    body.querySelector('#relMonth').addEventListener('change', (ev) => {
      detailsState.releveMonth = ev.target.value;
      detailsState.releveOffset = 0;
      refreshDetailsPanel();
    });
    bindPager(body, 'rel', data, (next) => {
      detailsState.releveOffset = next;
      refreshDetailsPanel();
    });
    exportBtn.addEventListener('click', () => {
      const all = truckDb.releves({
        frigoId: detailsState.releveFrigo,
        month: detailsState.releveMonth,
        offset: 0,
        limit: 100000,
      });
      TruckDb.downloadCsv(
        `${safeFilePart(truckName)}_releves_${stamp}.csv`,
        ['date', 'frigo', 'temperature_c', 'min_c', 'max_c', 'hors_plage', 'note'],
        all.rows.map((r) => [
          TruckDb.fmtDay(r.ms),
          r.frigo,
          String(r.temp).replace('.', ','),
          r.min,
          r.max,
          r.horsPlage ? 'oui' : 'non',
          r.note,
        ]),
      );
    });
  }

  function pagerHtml(offset, limit, total, prefix) {
    if (total <= limit) return '';
    const page = Math.floor(offset / limit) + 1;
    const pages = Math.ceil(total / limit);
    return `
      <div class="pager">
        <button type="button" class="secondary" id="${prefix}Prev" ${offset <= 0 ? 'disabled' : ''}>← Préc.</button>
        <span class="sub">Page ${page} / ${pages}</span>
        <button type="button" class="secondary" id="${prefix}Next" ${offset + limit >= total ? 'disabled' : ''}>Suiv. →</button>
      </div>`;
  }

  function bindPager(root, prefix, data, onChange) {
    const prev = root.querySelector(`#${prefix}Prev`);
    const next = root.querySelector(`#${prefix}Next`);
    if (prev)
      prev.addEventListener('click', () =>
        onChange(Math.max(0, data.offset - data.limit)),
      );
    if (next)
      next.addEventListener('click', () => onChange(data.offset + data.limit));
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
    TruckDb.clearAll();
    btnLogout.classList.add('hidden');
    showOnly(loginView);
  });

  btnRefresh.addEventListener('click', () => {
    TruckDb.clearAll();
    loadTrucks();
  });
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
