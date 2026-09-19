'use strict';
// ═══════════════════════════════════════════════════════════════
//  mypage_store.js  マイページ（探索記録）データ層
//
//  ■ 役割
//    探索記録・候補（採取方法/道具/処理方法/探索目的）の保持、保存、統計計算、
//    書出し/読込を担当する。画面(DOM)には一切触れない。UIは mypage.js。
//
//  ■ 保存先の差し替え設計（将来: 有料会員のFirebase引き継ぎ）
//    保存処理は「バックエンド(adapter)」に分離している。今は端末内(localStorage)。
//    将来は同じインターフェースの MpgCloudBackend を作り、
//      MpgStore.setBackend(MpgCloudBackend)  で差し替えるだけでよい。
//    バックエンドのインターフェース（全てasync）:
//      load()              → { logs:[], cands:[]|null }
//      putLog(log)         → 1件を保存（追加/上書き）
//      removeLog(uid)      → 1件を削除
//      putCands(cands)     → 候補リスト全体を保存
//    端末内データ→クラウド移行は MpgStore.migrate(from, to)（updatedAtが新しい方を採用）。
//
//  ■ 引き継ぎ可能なデータ形式（書出しJSONもこの形式）
//    ・全エンティティに安定ID(uid)と updatedAt を持つ（同期の突き合わせ用）
//    ・schemaVersion を持つ（将来の形式変更に備える）
//    ・明細はポイントのuid(pointUid)で参照し、名前・座標のコピーも持つ
//      （ポイント削除後も履歴が残る／別端末で座標一致による再リンクが可能）
//    ・Firestore想定パス: users/{firebase uid}/mypage_logs/{log.uid}
//                         users/{firebase uid}/mypage_cands/{cand.id}
//      ※公開データ(coords)とは別領域。セキュリティルールは Firestore対応時に設計する
//        （本人のみ読み書き／有料フラグ users/{uid}.premium の確認／lat,lng は number のみ）
//
//  ■ データ構造
//    log   : { uid, schemaVersion, date:'YYYY-MM-DD', memo, entries:[entry], createdAt, updatedAt }
//    entry : { uid, pointUid|null, pointName, lat|null, lng|null,
//              weightG|null, grains|null, durationMin|null,
//              methodIds:[], toolIds:[], processIds:[], purposeId:'' }
//    cand  : { id, cat:'method'|'tool'|'process'|'purpose', name, group, visible, builtin, order, updatedAt }
// ═══════════════════════════════════════════════════════════════
const MpgStore = (function () {

  const SCHEMA_VERSION = 1;
  const FREE_LOG_LIMIT = 3;            // 無料ユーザーの探索記録 保存上限（件）
  const LS_LOGS   = 'gm_mpg_logs';
  const LS_CANDS  = 'gm_mpg_cands';
  const USER_GROUP = 'マイ候補';
  const MAX_NAME  = 30;
  const MAX_MEMO  = 500;

  // ── カテゴリ定義 ─────────────────────────────
  const CATS = [
    { key: 'method',  label: '採取方法', icon: '🥇', multi: true  },
    { key: 'tool',    label: '道具',     icon: '🛠', multi: true  },
    { key: 'process', label: '処理方法', icon: '🧪', multi: true  },
    { key: 'purpose', label: '探索目的', icon: '🎯', multi: false },
  ];
  const CAT_KEYS = CATS.map(c => c.key);
  const ID_KEY = { method: 'methodIds', tool: 'toolIds', process: 'processIds' };

  // ── 初期候補 ─────────────────────────────────
  //  ※ IDは「prefix＋出現順の連番」で決まる。並び替え・途中挿入・削除は禁止。
  //    追加する場合は各カテゴリの末尾にだけ足すこと（保存済みの記録がIDで参照しているため）。
  const DEFAULTS = {
    method: { prefix: 'mth', groups: [
      ['川・河床', ['パンニング', '草根引き', 'クレバシング（岩盤の割れ目）', 'スナイピング（水中を覗いて探す）',
                   'モス採取', '河床掘り', 'バンク掘り', '堆積物採取']],
      ['水を利用した大量処理', ['スルーシング', 'ロッカーボックス', 'ハイバンキング', 'ドレッジング', 'サクション採取']],
      ['水中', ['メガネ探索', '水中スナイピング', '水中クレバシング', '吸引採取']],
      ['水を使わない方法', ['ドライウォッシング', '乾式選別', '金属探知']],
      ['持ち帰り・後処理', ['現地採取→持ち帰りパンニング', '濃縮→自宅選別', 'サンプル採取']],
    ]},
    tool: { prefix: 'tol', groups: [
      ['基本・選別', ['パンニング皿', 'スルースBOX', 'ロッカーボックス', 'ふるい', 'バケツ', 'シャベル', 'スコップ',
                    'ツルハシ', '熊手', 'ピンセット', 'スポイト', '瓶・保管容器', 'ルーペ']],
      ['水中探索', ['メガネ', 'シュノーケル', '水中ゴーグル', 'ウェーダー', '長靴', '水中ライト', '水中カメラ']],
      ['ポンプ・吸引', ['水中ポンプ', '吸引ポンプ', 'サクションホース', 'サクションチューブ', 'ドレッジ', 'ハイバンカー']],
      ['掘削・処理', ['バール', 'ハンマー', 'タガネ', '掘削スコップ', '土砂袋', 'コンテナ']],
      ['調査・記録', ['金属探知機', 'GPS', 'スマホ', 'カメラ', '方位磁針', '地質ハンマー']],
    ]},
    process: { prefix: 'prc', groups: [
      ['', ['現地パンニング', '持ち帰りパンニング', 'スルース', 'ロッカーボックス', '濃縮→自宅選別', '乾式選別',
            'サンプル持ち帰り（未処理）']],
    ]},
    purpose: { prefix: 'prp', groups: [
      ['', ['初回調査', '試掘', '本採取', '再調査', '増水後調査', '地質調査', '金脈探索', 'ナゲット探索']],
    ]},
  };

  function buildDefaults() {
    const out = [];
    CAT_KEYS.forEach(cat => {
      const d = DEFAULTS[cat];
      let n = 0;
      d.groups.forEach(g => {
        g[1].forEach(name => {
          n++;
          out.push({ id: d.prefix + String(n).padStart(2, '0'), cat, name, group: g[0],
                     visible: true, builtin: true, order: n, updatedAt: 0 });
        });
      });
    });
    return out;
  }
  const DEFAULT_CANDS = buildDefaults();
  const DEFAULT_MAP   = new Map(DEFAULT_CANDS.map(c => [c.id, c]));

  // ── 汎用ヘルパー ─────────────────────────────
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  function uid(prefix) {
    let r;
    try { r = crypto.randomUUID().replace(/-/g, '').slice(0, 20); }
    catch (e) { r = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
    return prefix + '_' + r;
  }
  function idOr(v, prefix) { return (typeof v === 'string' && ID_RE.test(v)) ? v : uid(prefix); }
  function str(v, max) { return (typeof v === 'string') ? v.slice(0, max) : ''; }
  function num(v, min, max, dec) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    let x = Math.min(max, Math.max(min, n));
    if (dec !== undefined) { const f = Math.pow(10, dec); x = Math.round(x * f) / f; }
    return x;
  }
  function idList(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    v.forEach(x => { if (typeof x === 'string' && ID_RE.test(x) && out.indexOf(x) < 0) out.push(x); });
    return out.slice(0, 100);
  }
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return s === y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ── サニタイズ（読込・インポート・将来のクラウド受信データを共通で検証）──
  function sanitizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    return {
      uid:         idOr(e.uid, 'en'),
      pointUid:    (typeof e.pointUid === 'string' && ID_RE.test(e.pointUid)) ? e.pointUid : null,
      pointName:   str(e.pointName, 60),
      lat:         num(e.lat, -90, 90),
      lng:         num(e.lng, -180, 180),
      weightG:     num(e.weightG, 0, 1000000, 2),
      grains:      num(e.grains, 0, 1000000000, 0),
      durationMin: num(e.durationMin, 0, 1000000, 0),
      methodIds:   idList(e.methodIds),
      toolIds:     idList(e.toolIds),
      processIds:  idList(e.processIds),
      purposeId:   (typeof e.purposeId === 'string' && ID_RE.test(e.purposeId)) ? e.purposeId : '',
    };
  }
  function sanitizeLog(l) {
    if (!l || typeof l !== 'object') return null;
    if (!validDate(l.date)) return null;
    const entries = (Array.isArray(l.entries) ? l.entries : []).slice(0, 200).map(sanitizeEntry).filter(Boolean);
    const created = num(l.createdAt, 0, 8.64e15, 0) || Date.now();
    return {
      uid: idOr(l.uid, 'lg'),
      schemaVersion: SCHEMA_VERSION,
      date: l.date,
      memo: str(l.memo, MAX_MEMO),
      entries: entries,
      createdAt: created,
      updatedAt: num(l.updatedAt, 0, 8.64e15, 0) || created,
    };
  }
  function sanitizeCand(c) {
    if (!c || typeof c !== 'object') return null;
    if (CAT_KEYS.indexOf(c.cat) < 0) return null;
    if (typeof c.id !== 'string' || !ID_RE.test(c.id)) return null;
    const name = str(c.name, MAX_NAME).trim();
    if (!name) return null;
    return {
      id: c.id, cat: c.cat, name: name,
      group: str(c.group, 20),
      visible: c.visible !== false,
      builtin: DEFAULT_MAP.has(c.id),
      order: num(c.order, 0, 1e9, 0) || 0,
      updatedAt: num(c.updatedAt, 0, 8.64e15, 0) || 0,
    };
  }

  // 保存済み候補＋初期候補をマージ（初期候補が増えた場合は自動で追加される）
  function mergeCands(stored) {
    const map = new Map();
    (Array.isArray(stored) ? stored : []).map(sanitizeCand).filter(Boolean).forEach(c => map.set(c.id, c));
    DEFAULT_CANDS.forEach(d => {
      const cur = map.get(d.id);
      if (!cur) { map.set(d.id, Object.assign({}, d)); return; }
      cur.builtin = true;
      cur.group   = d.group;   // グループ・並び順は初期定義に従う（名前とON/OFFだけユーザー変更可）
      cur.order   = d.order;
    });
    const arr = Array.from(map.values());
    arr.sort((a, b) => (CAT_KEYS.indexOf(a.cat) - CAT_KEYS.indexOf(b.cat)) || (a.order - b.order));
    return arr;
  }

  // ── 保存バックエンド: 端末内(localStorage) ────
  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    localStorage.setItem(key, JSON.stringify(val));   // 容量超過などは例外を呼び出し側へ
  }
  const LocalBackend = {
    kind: 'local',
    async load() {
      return { logs: readJson(LS_LOGS, []), cands: readJson(LS_CANDS, null) };
    },
    async putLog(log) {
      const arr = readJson(LS_LOGS, []);
      const i = arr.findIndex(l => l && l.uid === log.uid);
      if (i >= 0) arr[i] = log; else arr.push(log);
      writeJson(LS_LOGS, arr);
    },
    async removeLog(logUid) {
      const arr = readJson(LS_LOGS, []).filter(l => l && l.uid !== logUid);
      writeJson(LS_LOGS, arr);
    },
    async putCands(list) { writeJson(LS_CANDS, list); },
  };
  let backend = LocalBackend;
  function setBackend(b) { backend = b || LocalBackend; }
  function getBackendKind() { return backend.kind; }

  // ── 状態 ─────────────────────────────────────
  const state = { logs: [], cands: [], loaded: false };

  async function load() {
    const d = await backend.load();
    state.logs  = (Array.isArray(d.logs) ? d.logs : []).map(sanitizeLog).filter(Boolean);
    state.cands = mergeCands(d.cands);
    state.loaded = true;
  }
  function isLoaded() { return state.loaded; }

  // ── 記録 ─────────────────────────────────────
  function getLogs() { return state.logs; }
  function getLog(logUid) { return state.logs.find(l => l.uid === logUid) || null; }
  function newLogId()   { return uid('lg'); }
  function newEntryId() { return uid('en'); }

  async function saveLog(input) {
    const log = sanitizeLog(Object.assign({}, input, { updatedAt: Date.now() }));
    if (!log) throw new Error('invalid log');
    const i = state.logs.findIndex(l => l.uid === log.uid);
    if (i >= 0) { log.createdAt = state.logs[i].createdAt; state.logs[i] = log; }
    else state.logs.push(log);
    try { await backend.putLog(log); }
    catch (e) {
      // 保存失敗時はメモリ上の変更も戻す
      if (i >= 0) { /* 既存はそのまま（旧データは失われないよう再ロードで復元） */ await load(); }
      else state.logs = state.logs.filter(l => l.uid !== log.uid);
      throw e;
    }
    return log;
  }
  async function removeLog(logUid) {
    const prev = state.logs;
    state.logs = state.logs.filter(l => l.uid !== logUid);
    try { await backend.removeLog(logUid); }
    catch (e) { state.logs = prev; throw e; }
  }

  // ── ポイント参照の維持 ───────────────────────
  //   ポイントの名前変更・移動を明細のコピーへ反映する。
  //   uid不一致（別端末へGeoJSON経由で移行した等）の場合は座標一致で再リンクする。
  //   ポイントが見つからない明細は何も変更しない（＝削除済みとして履歴に残る）。
  async function refreshPointCopies(points) {
    if (!state.loaded || !Array.isArray(points) || points.length === 0) return 0;
    const byUid = new Map();
    points.forEach(p => { if (p && p.uid) byUid.set(p.uid, p); });
    let changedLogs = 0;
    for (const log of state.logs) {
      let changed = false;
      log.entries.forEach(e => {
        if (!e.pointUid) return;
        let p = byUid.get(e.pointUid) || null;
        if (!p && e.lat !== null && e.lng !== null) {
          p = points.find(q => q && q.uid &&
                Math.abs(q.lat - e.lat) < 1e-6 && Math.abs(q.lng - e.lng) < 1e-6) || null;
        }
        if (!p) return;
        const name = str(p.name || '', 60);
        if (e.pointUid !== p.uid || e.pointName !== name || e.lat !== p.lat || e.lng !== p.lng) {
          e.pointUid = p.uid; e.pointName = name; e.lat = p.lat; e.lng = p.lng;
          changed = true;
        }
      });
      if (changed) {
        log.updatedAt = Date.now();
        try { await backend.putLog(log); changedLogs++; }
        catch (e) { console.warn('[mypage_store] refreshPointCopies 保存失敗', e); }
      }
    }
    return changedLogs;
  }

  // ── 候補 ─────────────────────────────────────
  function getCands(cat) { return cat ? state.cands.filter(c => c.cat === cat) : state.cands; }
  function getCand(id) { return state.cands.find(c => c.id === id) || null; }
  async function persistCands() { await backend.putCands(state.cands); }

  async function addCand(cat, name) {
    if (CAT_KEYS.indexOf(cat) < 0) throw new Error('bad cat');
    name = str(name, MAX_NAME).trim();
    if (!name) return null;
    const dup = state.cands.find(c => c.cat === cat && c.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      if (!dup.visible) { dup.visible = true; dup.updatedAt = Date.now(); await persistCands(); }
      return dup;
    }
    const maxOrder = state.cands.filter(c => c.cat === cat).reduce((m, c) => Math.max(m, c.order), 0);
    const c = { id: uid('u'), cat, name, group: USER_GROUP, visible: true, builtin: false,
                order: maxOrder + 1, updatedAt: Date.now() };
    state.cands.push(c);
    state.cands.sort((a, b) => (CAT_KEYS.indexOf(a.cat) - CAT_KEYS.indexOf(b.cat)) || (a.order - b.order));
    await persistCands();
    return c;
  }
  async function renameCand(id, name) {
    const c = getCand(id);
    name = str(name, MAX_NAME).trim();
    if (!c || !name) return false;
    c.name = name; c.updatedAt = Date.now();
    await persistCands();
    return true;
  }
  async function setCandVisible(id, visible) {
    const c = getCand(id);
    if (!c) return;
    c.visible = !!visible; c.updatedAt = Date.now();
    await persistCands();
  }
  async function setGroupVisible(cat, group, visible) {
    const now = Date.now();
    state.cands.forEach(c => { if (c.cat === cat && c.group === group) { c.visible = !!visible; c.updatedAt = now; } });
    await persistCands();
  }

  // 直近に使った候補ID（新しい記録から順に、重複なし。表示ONのもののみ）
  function recentIds(cat, limit) {
    limit = limit || 6;
    const logs = state.logs.slice().sort((a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (b.updatedAt - a.updatedAt));
    const seen = [];
    for (const l of logs) {
      for (let i = l.entries.length - 1; i >= 0; i--) {
        const e = l.entries[i];
        const ids = cat === 'purpose' ? (e.purposeId ? [e.purposeId] : []) : e[ID_KEY[cat]];
        for (const id of ids) {
          const c = getCand(id);
          if (c && c.visible && seen.indexOf(id) < 0) seen.push(id);
          if (seen.length >= limit) return seen;
        }
      }
    }
    return seen;
  }
  // 直近の明細（「直前の明細をコピー」用）
  function latestEntry() {
    const logs = state.logs.slice().sort((a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (b.updatedAt - a.updatedAt));
    for (const l of logs) if (l.entries.length) return l.entries[l.entries.length - 1];
    return null;
  }

  // ── 統計（純粋関数）──────────────────────────
  //  ・「回数」= その候補が付いた明細の件数
  //  ・複数選択された候補には、重量・時間を全量加算する（候補別の合計は全体合計と一致しない）
  //  ・1時間あたりg = 所要時間が入力された明細の 重量合計 ÷ 時間合計
  function summary(logs) {
    let w = 0, g = 0, m = 0, n = 0, wt = 0, mt = 0;
    logs.forEach(l => l.entries.forEach(e => {
      n++;
      if (e.weightG !== null) w += e.weightG;
      if (e.grains !== null) g += e.grains;
      if (e.durationMin !== null) m += e.durationMin;
      if (e.weightG !== null && e.durationMin > 0) { wt += e.weightG; mt += e.durationMin; }
    }));
    return { logCount: logs.length, entryCount: n, weightG: w, grains: g, minutes: m,
             gPerHour: mt > 0 ? wt / (mt / 60) : null };
  }

  // 月別（metric: 'weight' | 'grains' | 'count'）。現在月（または最新記録月）までの直近months件
  function monthly(logs, metric, months, now) {
    months = months || 12;
    now = now || new Date();
    const key = (y, m0) => y + '-' + String(m0 + 1).padStart(2, '0');
    let endY = now.getFullYear(), endM = now.getMonth();
    logs.forEach(l => {
      const y = +l.date.slice(0, 4), m0 = +l.date.slice(5, 7) - 1;
      if (y > endY || (y === endY && m0 > endM)) { endY = y; endM = m0; }
    });
    const keys = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(endY, endM - i, 1);
      keys.push(key(d.getFullYear(), d.getMonth()));
    }
    const map = new Map(keys.map(k => [k, 0]));
    logs.forEach(l => {
      const k = l.date.slice(0, 7);
      if (!map.has(k)) return;
      let v = 0;
      if (metric === 'count') v = 1;
      else l.entries.forEach(e => { v += (metric === 'grains' ? e.grains : e.weightG) || 0; });
      map.set(k, map.get(k) + v);
    });
    return keys.map(k => ({ key: k, value: map.get(k) }));
  }

  function byPoint(logs) {
    const map = new Map();
    logs.forEach(l => l.entries.forEach(e => {
      const k = e.pointUid || '__none__';
      let g = map.get(k);
      if (!g) { g = { key: k, pointUid: e.pointUid, name: e.pointName, lat: e.lat, lng: e.lng,
                      entryCount: 0, weightG: 0, grains: 0, minutes: 0, lastDate: '' }; map.set(k, g); }
      g.entryCount++;
      g.weightG += e.weightG || 0;
      g.grains  += e.grains  || 0;
      g.minutes += e.durationMin || 0;
      if (l.date > g.lastDate) { g.lastDate = l.date; g.name = e.pointName; }
    }));
    return Array.from(map.values());
  }

  function byCand(logs, cat) {
    const map = new Map();
    function add(id, e) {
      let r = map.get(id);
      if (!r) { r = { id, count: 0, weightG: 0, grains: 0, minutes: 0, wt: 0, mt: 0 }; map.set(id, r); }
      r.count++;
      r.weightG += e.weightG || 0;
      r.grains  += e.grains  || 0;
      r.minutes += e.durationMin || 0;
      if (e.weightG !== null && e.durationMin > 0) { r.wt += e.weightG; r.mt += e.durationMin; }
    }
    logs.forEach(l => l.entries.forEach(e => {
      if (cat === 'purpose') { if (e.purposeId) add(e.purposeId, e); }
      else e[ID_KEY[cat]].forEach(id => add(id, e));
    }));
    return Array.from(map.values()).map(r => Object.assign(r, { gPerHour: r.mt > 0 ? r.wt / (r.mt / 60) : null }));
  }

  // ── 書出し / 読込 ────────────────────────────
  function buildExport() {
    return {
      app: 'goldmap-mypage',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      logs: state.logs,
      candidates: state.cands,
    };
  }

  // 読込: uidが同じ記録は updatedAt が新しい方を採用。無料ユーザーは上限超過なら gate:true で中止
  async function importData(obj, premium) {
    if (!obj || obj.app !== 'goldmap-mypage' || !Array.isArray(obj.logs)) {
      return { ok: false, error: 'マイページの書出しファイルではありません' };
    }
    if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > SCHEMA_VERSION) {
      return { ok: false, error: '新しいバージョンのファイルです。アプリを更新してください' };
    }
    const uniq = new Map();
    obj.logs.slice(0, 5000).map(sanitizeLog).filter(Boolean).forEach(l => {
      const p = uniq.get(l.uid);
      if (!p || l.updatedAt > p.updatedAt) uniq.set(l.uid, l);
    });
    const inLogs = Array.from(uniq.values());
    const inCands = (Array.isArray(obj.candidates) ? obj.candidates : []).slice(0, 2000)
      .map(sanitizeCand).filter(Boolean);

    const localMap = new Map(state.logs.map(l => [l.uid, l]));
    const toAdd = inLogs.filter(l => !localMap.has(l.uid));
    if (!premium && state.logs.length + toAdd.length > FREE_LOG_LIMIT) return { ok: false, gate: true };

    let added = 0, updated = 0, skipped = 0;
    for (const l of inLogs) {
      const cur = localMap.get(l.uid);
      if (!cur) { state.logs.push(l); await backend.putLog(l); added++; }
      else if (l.updatedAt > cur.updatedAt) {
        state.logs[state.logs.findIndex(x => x.uid === l.uid)] = l;
        await backend.putLog(l); updated++;
      } else skipped++;
    }

    let candAdded = 0, candUpdated = 0;
    inCands.forEach(c => {
      const cur = getCand(c.id);
      if (!cur) {
        if (c.builtin) return;   // 初期候補はマージ済みのため到達しない
        const maxOrder = state.cands.filter(x => x.cat === c.cat).reduce((m, x) => Math.max(m, x.order), 0);
        state.cands.push(Object.assign({}, c, { order: maxOrder + 1 }));
        candAdded++;
      } else if (c.updatedAt > cur.updatedAt) {
        cur.name = c.name; cur.visible = c.visible; cur.updatedAt = c.updatedAt;
        candUpdated++;
      }
    });
    state.cands.sort((a, b) => (CAT_KEYS.indexOf(a.cat) - CAT_KEYS.indexOf(b.cat)) || (a.order - b.order));
    if (candAdded || candUpdated) await persistCands();
    return { ok: true, added, updated, skipped, candAdded, candUpdated };
  }

  // ── バックエンド間の移行（将来: 端末内 → Firebase）──
  //   updatedAt が新しい方を採用。from/to は上記バックエンドのインターフェースを満たすこと。
  async function migrate(from, to) {
    const src = await from.load();
    const dst = await to.load();
    const dstMap = new Map((dst.logs || []).map(l => [l && l.uid, l]));
    let sent = 0;
    for (const raw of (src.logs || [])) {
      const l = sanitizeLog(raw);
      if (!l) continue;
      const cur = dstMap.get(l.uid);
      if (!cur || l.updatedAt > (cur.updatedAt || 0)) { await to.putLog(l); sent++; }
    }
    const merged = new Map();
    mergeCands(dst.cands).forEach(c => merged.set(c.id, c));
    mergeCands(src.cands).forEach(c => {
      const cur = merged.get(c.id);
      if (!cur || c.updatedAt > cur.updatedAt) merged.set(c.id, c);
    });
    await to.putCands(Array.from(merged.values()));
    return { sent };
  }

  return {
    SCHEMA_VERSION, FREE_LOG_LIMIT, CATS, ID_KEY, USER_GROUP,
    todayStr, validDate,
    setBackend, getBackendKind, LocalBackend,
    load, isLoaded,
    getLogs, getLog, newLogId, newEntryId, saveLog, removeLog,
    refreshPointCopies,
    getCands, getCand, addCand, renameCand, setCandVisible, setGroupVisible,
    recentIds, latestEntry,
    summary, monthly, byPoint, byCand,
    buildExport, importData, migrate,
    // テスト・将来のクラウド受信データ検証用
    sanitizeLog, sanitizeEntry, sanitizeCand,
  };
})();
