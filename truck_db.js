(() => {
  const ZIP_NAME = 'pc_master_latest.zip';
  const SQLITE_NAME = 'pizza_truck_compta.sqlite';
  const PAGE = 50;
  const REQUIRED_INV = ['laboratoire', 'camion', 'boissons'];
  const SYNC_ALERT_MS = 72 * 3600 * 1000;
  const INV_DUE_DAY = 15;

  /** Mois contrôlé = mois précédent (échéance au 15 du mois courant). */
  function inventoryTargetPeriod(now = new Date()) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function inventoryStatusFromDb(db, year, month) {
    const target =
      year != null && month != null
        ? { year, month }
        : inventoryTargetPeriod();
    const rows = queryAll(
      db,
      `SELECT section_inventaire, est_enregistre FROM monthly_inventories WHERE annee = ? AND mois = ?`,
      [target.year, target.month],
    );
    const recorded = [
      ...new Set(
        rows
          .filter((r) => Number(r.est_enregistre) === 1)
          .map((r) => String(r.section_inventaire || '').trim())
          .filter(Boolean),
      ),
    ].sort();
    const missing = REQUIRED_INV.filter((s) => !recorded.includes(s));
    const dueDayReached = new Date().getDate() >= INV_DUE_DAY;
    return {
      year: target.year,
      month: target.month,
      required: REQUIRED_INV,
      recorded,
      missing,
      dueDayReached,
      alertMissing: dueDayReached && missing.length > 0,
    };
  }

  function inventoryStatusFromStats(stats) {
    const fallback = inventoryTargetPeriod();
    const year = Number(stats?.invAlertYear) || fallback.year;
    const month = Number(stats?.invAlertMonth) || fallback.month;
    if (stats && typeof stats.invAlertMissing === 'boolean') {
      return {
        year,
        month,
        required: stats.invRequiredSections || REQUIRED_INV,
        recorded: stats.invRecordedSections || [],
        missing: stats.invMissingSections || [],
        dueDayReached: !!stats.invDueDayReached,
        alertMissing: !!stats.invAlertMissing,
      };
    }
    const dueDayReached = new Date().getDate() >= INV_DUE_DAY;
    return {
      year,
      month,
      required: REQUIRED_INV,
      recorded: [],
      missing: REQUIRED_INV,
      dueDayReached,
      alertMissing: dueDayReached,
    };
  }

  function computeAlerts(manifest, liveInvStatus = null) {
    const updatedAtMs = Number(manifest?.updatedAtMs) || 0;
    const syncStale =
      !updatedAtMs || Date.now() - updatedAtMs > SYNC_ALERT_MS;
    const syncAgeH = updatedAtMs
      ? Math.floor((Date.now() - updatedAtMs) / 3600000)
      : null;
    const inv = liveInvStatus || inventoryStatusFromStats(manifest?.financeStats);
    return {
      syncStale,
      syncAgeH,
      inv,
      hasAny: syncStale || inv.alertMissing,
    };
  }

  const TYPE_ENCAISSEMENT = {
    0: 'CB',
    1: 'CB EMV',
    2: 'Ticket resto',
    3: 'Espèces',
    4: 'Carte ticket resto',
    5: 'Amex',
  };

  const CAT_DEPENSE = {
    achats: 'Achats',
    energie: 'Énergie',
    materiel: 'Matériel',
    divers: 'Divers',
    pret: 'Prêt',
    cotisations_sociales: 'Cotisations sociales',
    cotisation_formation: 'Cotisation formation',
    commissions_bancaires: 'Commissions bancaires',
    assurance: 'Assurance',
    publicite: 'Publicité',
    tva: 'TVA',
  };

  const LABEL_CAT = {
    laitier: 'Laitier',
    charcuterie: 'Charcuterie',
    autre: 'Autre',
  };

  /** @type {Promise<any>|null} */
  let sqlReady = null;
  /** @type {Map<string, TruckDb>} */
  const cache = new Map();

  function toMs(raw) {
    if (raw == null) return 0;
    let n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    // Drift DateTime = seconds ; imports parfois en ms ; parfois ms lus comme s (année ~58xxx)
    let guard = 0;
    while (n > 1e13 && guard < 6) {
      n = Math.floor(n / 1000);
      guard += 1;
    }
    if (n < 1e11) n *= 1000;
    // Si encore une date absurde (ex. année 58xxx), redescendre.
    guard = 0;
    while (guard < 6) {
      const y = new Date(n).getFullYear();
      if (y >= 1990 && y <= 2100) break;
      n = Math.floor(n / 1000);
      guard += 1;
    }
    return n;
  }

  function fmtMs(ms) {
    if (!ms) return '—';
    const n = toMs(ms);
    if (!n) return '—';
    try {
      return new Date(n).toLocaleString('fr-FR');
    } catch (_) {
      return String(ms);
    }
  }

  function fmtDay(ms) {
    if (!ms) return '—';
    const n = toMs(ms);
    if (!n) return '—';
    try {
      return new Date(n).toLocaleDateString('fr-FR');
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

  function ymKey(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function ensureSql() {
    if (!sqlReady) {
      if (typeof initSqlJs !== 'function') {
        return Promise.reject(new Error('sql.js non chargé'));
      }
      sqlReady = initSqlJs({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/${file}`,
      });
    }
    return sqlReady;
  }

  function queryAll(db, sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  class TruckDb {
    /**
     * @param {string} userId
     * @param {any} db sql.js Database
     * @param {import('jszip').JSZip} zip
     * @param {Map<string, string>} photoUrls
     */
    constructor(userId, db, zip, photoUrls) {
      this.userId = userId;
      this.db = db;
      this.zip = zip;
      this.photoUrls = photoUrls;
      this._revoked = false;
    }

    dispose() {
      if (this._revoked) return;
      this._revoked = true;
      for (const url of this.photoUrls.values()) URL.revokeObjectURL(url);
      this.photoUrls.clear();
      try {
        this.db.close();
      } catch (_) {}
    }

    photoUrl(relPath) {
      if (!relPath) return null;
      const p = String(relPath).replace(/\\/g, '/');
      return this.photoUrls.get(p) || this.photoUrls.get(p.replace(/^\.\//, '')) || null;
    }

    counts() {
      const one = (sql) => {
        const r = queryAll(this.db, sql);
        return r[0] ? Number(Object.values(r[0])[0]) : 0;
      };
      return {
        recettes: one('SELECT COUNT(*) AS c FROM compta_recettes'),
        depenses: one('SELECT COUNT(*) AS c FROM compta_depenses'),
        inventaires: one('SELECT COUNT(*) AS c FROM monthly_inventories'),
        lignesInv: one('SELECT COUNT(*) AS c FROM inventory_lines'),
        frigos: one('SELECT COUNT(*) AS c FROM frigos'),
        releves: one('SELECT COUNT(*) AS c FROM frigo_releves'),
        etiquettes: one('SELECT COUNT(*) AS c FROM label_photos'),
        notes: one('SELECT COUNT(*) AS c FROM post_it_notes'),
      };
    }

    recettes({ month = '', q = '', offset = 0, limit = PAGE } = {}) {
      return this._financeRows('recette', { month, q, offset, limit });
    }

    depenses({ month = '', q = '', offset = 0, limit = PAGE } = {}) {
      return this._financeRows('depense', { month, q, offset, limit });
    }

    _financeRows(kind, { month, q, offset, limit }) {
      const table = kind === 'recette' ? 'compta_recettes' : 'compta_depenses';
      const rows = queryAll(this.db, `SELECT * FROM ${table}`);
      const mapped = rows
        .map((r) => {
          const ms = toMs(r.date);
          return {
            id: r.id,
            ms,
            ym: ymKey(ms),
            montant: Number(r.montant) || 0,
            libelle: (r.libelle || '').trim(),
            note: (r.note || '').trim(),
            tva: r.tva_pourcent,
            type:
              kind === 'recette'
                ? TYPE_ENCAISSEMENT[r.type_encaissement] ||
                  String(r.type_encaissement ?? '')
                : CAT_DEPENSE[r.categorie_key] ||
                  r.categorie_key ||
                  '—',
            typeKey:
              kind === 'recette'
                ? r.type_encaissement
                : r.categorie_key,
          };
        })
        .sort((a, b) => b.ms - a.ms);

      const months = [...new Set(mapped.map((x) => x.ym).filter(Boolean))].sort().reverse();
      let filtered = mapped;
      if (month) filtered = filtered.filter((x) => x.ym === month);
      if (q) {
        const needle = q.toLowerCase();
        filtered = filtered.filter(
          (x) =>
            x.libelle.toLowerCase().includes(needle) ||
            x.note.toLowerCase().includes(needle) ||
            String(x.type).toLowerCase().includes(needle),
        );
      }
      const total = filtered.reduce((s, x) => s + x.montant, 0);
      const page = filtered.slice(offset, offset + limit);
      return {
        rows: page,
        totalCount: filtered.length,
        totalAmount: total,
        months,
        offset,
        limit,
      };
    }

    inventaires() {
      const rows = queryAll(
        this.db,
        `SELECT id, period_key, section_inventaire, annee, mois, date_creation, notes, est_enregistre
         FROM monthly_inventories ORDER BY annee DESC, mois DESC, section_inventaire ASC`,
      );
      return rows.map((r) => ({
        id: r.id,
        periodKey: r.period_key,
        section: r.section_inventaire || '—',
        annee: r.annee,
        mois: r.mois,
        createdMs: toMs(r.date_creation),
        notes: (r.notes || '').trim(),
        enregistre: !!r.est_enregistre,
      }));
    }

    inventaireLignes(inventoryId) {
      const rows = queryAll(
        this.db,
        `SELECT l.id, l.quantite_comptee, l.prix_unitaire_ht, i.nom AS ingredient, i.unite
         FROM inventory_lines l
         LEFT JOIN ingredients i ON i.id = l.ingredient_id
         WHERE l.inventory_id = ?
         ORDER BY i.nom COLLATE NOCASE`,
        [inventoryId],
      );
      return rows.map((r) => ({
        id: r.id,
        ingredient: r.ingredient || `Ingrédient #${r.id}`,
        unite: r.unite,
        qty: Number(r.quantite_comptee) || 0,
        prixHt: Number(r.prix_unitaire_ht) || 0,
        valeur: (Number(r.quantite_comptee) || 0) * (Number(r.prix_unitaire_ht) || 0),
      }));
    }

    frigos() {
      return queryAll(
        this.db,
        `SELECT * FROM frigos ORDER BY sort_order ASC, nom COLLATE NOCASE`,
      ).map((r) => ({
        id: r.id,
        nom: r.nom,
        type: r.type_key === 'negatif' ? 'Négatif' : 'Positif',
        min: r.temp_min_c,
        max: r.temp_max_c,
        active: !!r.is_active,
        updatedMs: toMs(r.updated_at),
      }));
    }

    releves({ frigoId = '', month = '', offset = 0, limit = PAGE } = {}) {
      const rows = queryAll(
        this.db,
        `SELECT r.*, f.nom AS frigo_nom, f.temp_min_c, f.temp_max_c
         FROM frigo_releves r
         LEFT JOIN frigos f ON f.id = r.frigo_id`,
      )
        .map((r) => {
          const ms = toMs(r.recorded_at);
          return {
            id: r.id,
            frigoId: r.frigo_id,
            frigo: r.frigo_nom || `#${r.frigo_id}`,
            temp: Number(r.temperature_c),
            min: r.temp_min_c,
            max: r.temp_max_c,
            note: (r.note || '').trim(),
            ms,
            ym: ymKey(ms),
            horsPlage:
              Number.isFinite(Number(r.temperature_c)) &&
              ((r.temp_min_c != null && r.temperature_c < r.temp_min_c) ||
                (r.temp_max_c != null && r.temperature_c > r.temp_max_c)),
          };
        })
        .sort((a, b) => b.ms - a.ms);

      const months = [...new Set(rows.map((x) => x.ym).filter(Boolean))].sort().reverse();
      let filtered = rows;
      if (frigoId) filtered = filtered.filter((x) => String(x.frigoId) === String(frigoId));
      if (month) filtered = filtered.filter((x) => x.ym === month);
      return {
        rows: filtered.slice(offset, offset + limit),
        totalCount: filtered.length,
        months,
        offset,
        limit,
      };
    }

    etiquettes() {
      return queryAll(
        this.db,
        `SELECT * FROM label_photos ORDER BY recorded_at DESC, id DESC`,
      ).map((r) => {
        const path = (r.thumb_path || r.file_path || '').replace(/\\/g, '/');
        const full = (r.file_path || '').replace(/\\/g, '/');
        return {
          id: r.id,
          category: LABEL_CAT[r.category_key] || r.category_key || '—',
          categoryKey: r.category_key,
          ms: toMs(r.recorded_at),
          thumbUrl: this.photoUrl(path) || this.photoUrl(full),
          fullUrl: this.photoUrl(full) || this.photoUrl(path),
        };
      });
    }

    inventoryStatus(year, month) {
      return inventoryStatusFromDb(this.db, year, month);
    }
  }

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadCsv(filename, headers, rows) {
    const lines = [
      headers.join(';'),
      ...rows.map((row) => row.map(csvEscape).join(';')),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} client
   * @param {string} bucket
   * @param {string} userId
   * @param {(msg:string)=>void} [onProgress]
   */
  async function loadTruckDb(client, bucket, userId, onProgress) {
    if (cache.has(userId)) return cache.get(userId);

    onProgress?.('Téléchargement du backup camion…');
    const { data: blob, error } = await client.storage
      .from(bucket)
      .download(`${userId}/${ZIP_NAME}`);
    if (error) throw error;

    onProgress?.('Lecture de l’archive…');
    if (typeof JSZip === 'undefined') throw new Error('JSZip non chargé');
    const zip = await JSZip.loadAsync(blob);
    const sqliteFile = zip.file(SQLITE_NAME);
    if (!sqliteFile) throw new Error(`Fichier ${SQLITE_NAME} absent du ZIP`);

    onProgress?.('Ouverture de la base…');
    const SQL = await ensureSql();
    const u8 = await sqliteFile.async('uint8array');
    const db = new SQL.Database(u8);

    onProgress?.('Préparation des photos…');
    const photoUrls = new Map();
    const photoFiles = Object.keys(zip.files).filter(
      (n) => n.startsWith('label_photos/') && !zip.files[n].dir,
    );
    await Promise.all(
      photoFiles.map(async (name) => {
        const bytes = await zip.file(name).async('blob');
        const type = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        photoUrls.set(name, URL.createObjectURL(new Blob([bytes], { type })));
      }),
    );

    const truckDb = new TruckDb(userId, db, zip, photoUrls);
    cache.set(userId, truckDb);
    return truckDb;
  }

  function evict(userId) {
    const t = cache.get(userId);
    if (t) {
      t.dispose();
      cache.delete(userId);
    }
  }

  function clearAll() {
    for (const id of [...cache.keys()]) evict(id);
  }

  window.BPG_TruckDb = {
    loadTruckDb,
    evict,
    clearAll,
    toMs,
    fmtMs,
    fmtDay,
    fmtMoney,
    ymKey,
    TYPE_ENCAISSEMENT,
    CAT_DEPENSE,
    PAGE,
    SYNC_ALERT_MS,
    INV_DUE_DAY,
    REQUIRED_INV,
    computeAlerts,
    inventoryStatusFromStats,
    downloadCsv,
  };
})();
