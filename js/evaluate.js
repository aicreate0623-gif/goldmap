/**
 * evaluate.js  ―  座標評価エンジン（鉱物・砂金探索向け）
 *
 * 公開API:
 *   const result = await GoldEvaluator.evaluate({ lat, lng, zoom });
 *   // result.items[i] → { id, name, stars, reason }
 *
 * 評価項目の追加方法:
 *   GoldEvaluator.evaluationItems.push({ id, name, weight, evaluate(ctx){} });
 *   それだけで次回から自動実行される。switch/if地獄は不要。
 */
'use strict';

const GoldEvaluator = (() => {

  // ─────────────────────────────────────────────────────────
  // 定数
  // ─────────────────────────────────────────────────────────
  const EARTH_R         = 6371000;  // 地球半径(m)
  const STUB_SCORE      = 2.5;      // 外部API未接続時のフォールバック

  const TOPO_API        = 'https://api.opentopodata.org/v1/srtm30m';
  const BEAR_RADIUS_M   = 8000;     // 熊評価の最大参照半径(m)
  const POST_RADIUS_DEG = 0.05;     // Firestoreポスト検索半径(度 ≒5km)

  // ─────────────────────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────────────────────

  function haversine(la1, lo1, la2, lo2) {
    const R = EARTH_R, r = Math.PI / 180;
    const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2
            + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  const clamp5 = v => Math.max(0, Math.min(5, v));

  function distScore(distM, dMin, dMax) {
    if (distM <= dMin) return 5;
    if (distM >= dMax) return 0;
    return clamp5(5 * (1 - (distM - dMin) / (dMax - dMin)));
  }

  function toStars(score) {
    const n = Math.round(clamp5(score));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  // ─────────────────────────────────────────────────────────
  // キャッシュ層
  // ─────────────────────────────────────────────────────────
  const _evalCache = new Map();
  const _topoCache = new Map();
  const _postCache = new Map();
  const _bearStore = { data: null, fetchedAt: 0 };

  const EVAL_TTL = 10 * 60 * 1000;
  const BEAR_TTL = 30 * 60 * 1000;
  const POST_TTL =  5 * 60 * 1000;

  function _key(lat, lng) {
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
  }

  // ─────────────────────────────────────────────────────────
  // データ取得ヘルパー
  // ─────────────────────────────────────────────────────────

  async function _fetchElev(lat, lng) {
    const k = _key(lat, lng);
    if (_topoCache.has(k)) return _topoCache.get(k);
    try {
      const res  = await fetch(`${TOPO_API}?locations=${lat},${lng}`);
      if (!res.ok) throw new Error('topo_err');
      const json = await res.json();
      const elev = json?.results?.[0]?.elevation ?? null;
      _topoCache.set(k, elev);
      return elev;
    } catch { return null; }
  }

  async function _fetchSurroundElev(lat, lng) {
    const d = 0.003;
    const pts = [[lat+d,lng],[lat-d,lng],[lat,lng+d],[lat,lng-d]];
    const locStr = pts.map(p => `${p[0]},${p[1]}`).join('|');
    try {
      const res  = await fetch(`${TOPO_API}?locations=${locStr}`);
      if (!res.ok) throw new Error('topo_surr_err');
      const json = await res.json();
      return (json?.results || []).map(r => r.elevation ?? null);
    } catch { return [null, null, null, null]; }
  }

  async function _fetchBears() {
    const now = Date.now();
    if (_bearStore.data && now - _bearStore.fetchedAt < BEAR_TTL) {
      return _bearStore.data;
    }
    try {
      const res  = await fetch('data/bears_pins.json');
      if (!res.ok) throw new Error('bears_err');
      const json = await res.json();
      _bearStore.data      = json;
      _bearStore.fetchedAt = now;
      return json;
    } catch { return []; }
  }

  async function _fetchPosts(lat, lng) {
    const k   = _key(lat, lng);
    const now = Date.now();
    const hit = _postCache.get(k);
    if (hit && now - hit.at < POST_TTL) return hit.data;
    try {
      const db   = firebase.firestore();
      const snap = await db.collection('posts')
        .where('lat', '>=', lat - POST_RADIUS_DEG)
        .where('lat', '<=', lat + POST_RADIUS_DEG)
        .get();
      const posts = snap.docs
        .map(d => d.data())
        .filter(p => Math.abs(p.lng - lng) <= POST_RADIUS_DEG);
      _postCache.set(k, { data: posts, at: now });
      return posts;
    } catch { return []; }
  }

  // ─────────────────────────────────────────────────────────
  // context ビルダー
  // ─────────────────────────────────────────────────────────
  async function _buildContext(input) {
    const { lat, lng, zoom = 13 } = input;
    const [elev, surroundElevs, bears, posts, gsjData] = await Promise.all([
      _fetchElev(lat, lng),
      _fetchSurroundElev(lat, lng),
      _fetchBears(),
      _fetchPosts(lat, lng),
      (typeof loadGsjMineData === 'function')
        ? loadGsjMineData().catch(() => [])
        : Promise.resolve(window.GSJ_MINE_DATA_CACHED || []),
    ]);
    if (gsjData.length) window.GSJ_MINE_DATA_CACHED = gsjData;
    return {
      lat, lng, zoom,
      terrain:     { elev, surroundElevs },
      geology:     null,
      streams:     null,
      roads:       null,
      forestRoads: null,
      deposits:    (gsjData || []).filter(d => !d.trace),
      prospects:   (gsjData || []).filter(d =>  d.trace),
      mines:       typeof MINES !== 'undefined' ? MINES : [],
      bearData:    bears,
      userReports: posts,
      cache:       {},
    };
  }

  // ─────────────────────────────────────────────────────────
  // 評価項目定義
  // ─────────────────────────────────────────────────────────
  const evaluationItems = [

    // 1. 沢距離
    {
      id: 'streamDistance', name: '沢距離', weight: 1.4,
      evaluate(ctx) {
        // TODO: Overpass API (waterway=stream) 接続時に差し替え
        return { score: STUB_SCORE, reason: '沢データ取得待ち（準備中）' };
      },
    },

    // 2. 河川規模
    {
      id: 'riverScale', name: '河川規模', weight: 1.2,
      evaluate(ctx) {
        return { score: STUB_SCORE, reason: '河川規模データ取得待ち（準備中）' };
      },
    },

    // 3. 河川合流点
    {
      id: 'confluence', name: '河川合流点', weight: 1.5,
      evaluate(ctx) {
        return { score: STUB_SCORE, reason: '合流点データ取得待ち（準備中）' };
      },
    },

    // 4. 河川湾曲
    {
      id: 'riverCurve', name: '河川湾曲', weight: 1.1,
      evaluate(ctx) {
        return { score: STUB_SCORE, reason: '河川湾曲データ取得待ち（準備中）' };
      },
    },

    // 5. 地質
    {
      id: 'geology', name: '地質', weight: 1.6,
      evaluate(ctx) {
        // TODO: GSJ シームレス地質図 WMS/WFS 差し替え予定
        return { score: STUB_SCORE, reason: '地質データ取得待ち（準備中）' };
      },
    },

    // 6. 鉱床距離
    {
      id: 'depositDistance', name: '鉱床距離', weight: 1.5,
      evaluate(ctx) {
        const { lat, lng, deposits, mines } = ctx;
        const allDeps = [...deposits, ...mines];
        if (!allDeps.length) return { score: STUB_SCORE, reason: '鉱床データ読み込み中' };
        const dists = allDeps.map(d => haversine(lat, lng, d.lat, d.lng));
        const minD  = Math.min(...dists);
        ctx.cache.nearestDepositM = minD;
        const score = distScore(minD, 1000, 25000);
        return { score, reason: `最寄り鉱床まで約${(minD/1000).toFixed(1)}km` };
      },
    },

    // 7. 鉱徴地距離
    {
      id: 'prospectDistance', name: '鉱徴地距離', weight: 1.3,
      evaluate(ctx) {
        const { lat, lng, prospects } = ctx;
        if (!prospects.length) return { score: STUB_SCORE, reason: '鉱徴地データ読み込み中' };
        const dists = prospects.map(d => haversine(lat, lng, d.lat, d.lng));
        const minD  = Math.min(...dists);
        const score = distScore(minD, 500, 15000);
        return { score, reason: `最寄り鉱徴地まで約${(minD/1000).toFixed(1)}km` };
      },
    },

    // 8. 傾斜
    {
      id: 'slope', name: '傾斜', weight: 1.2,
      evaluate(ctx) {
        const elevs = ctx.terrain.surroundElevs.filter(e => e !== null);
        if (elevs.length < 2) return { score: STUB_SCORE, reason: '傾斜データ取得中' };
        const diff = Math.max(...elevs) - Math.min(...elevs);
        const score = diff < 20  ? 1.5
                    : diff < 50  ? 3.0
                    : diff < 200 ? 5.0
                    : diff < 300 ? 3.5 : 2.0;
        ctx.cache.slopeDiff = diff;
        return { score, reason: `周辺300m範囲の標高差: 約${diff}m` };
      },
    },

    // 9. 谷形状
    {
      id: 'valleyShape', name: '谷形状', weight: 1.3,
      evaluate(ctx) {
        const center   = ctx.terrain.elev;
        const surrounds = ctx.terrain.surroundElevs.filter(e => e !== null);
        if (center === null || surrounds.length < 2) {
          return { score: STUB_SCORE, reason: '谷形状データ取得中' };
        }
        const avg   = surrounds.reduce((a,b) => a+b, 0) / surrounds.length;
        const depth = avg - center;
        const score = depth > 80 ? 5.0 : depth > 40 ? 4.0
                    : depth > 10 ? 3.0 : depth > 0  ? 2.5 : 1.5;
        ctx.cache.valleyDepth = depth;
        return {
          score,
          reason: depth > 0
            ? `周囲より約${Math.round(depth)}m低い谷地形`
            : '谷地形ではない',
        };
      },
    },

    // 10. 標高
    {
      id: 'elevation', name: '標高', weight: 1.0,
      evaluate(ctx) {
        const elev = ctx.terrain.elev;
        if (elev === null) return { score: STUB_SCORE, reason: '標高データ取得中' };
        const score = elev < 50   ? 1.5
                    : elev < 200  ? 3.0
                    : elev < 700  ? 5.0
                    : elev < 1200 ? 4.0
                    : elev < 2000 ? 2.5 : 1.0;
        return { score, reason: `標高: 約${Math.round(elev)}m` };
      },
    },

    // 11. 道路距離
    {
      id: 'roadDistance', name: '道路距離', weight: 0.9,
      evaluate(ctx) {
        return { score: STUB_SCORE, reason: '道路データ取得待ち（準備中）' };
      },
    },

    // 12. 林道距離
    {
      id: 'forestRoadDistance', name: '林道距離', weight: 1.0,
      evaluate(ctx) {
        return { score: STUB_SCORE, reason: '林道データ取得待ち（準備中）' };
      },
    },

    // 13. 人到達性
    {
      id: 'accessibility', name: '人到達性', weight: 1.1,
      evaluate(ctx) {
        const slopeDiff = ctx.cache.slopeDiff ?? null;
        const elev      = ctx.terrain.elev;
        const components = [];
        if (elev !== null) {
          components.push(
            elev < 500  ? 5.0 : elev < 1000 ? 3.5 : elev < 1500 ? 2.0 : 1.0
          );
        }
        if (slopeDiff !== null) {
          components.push(
            slopeDiff < 50  ? 5.0 : slopeDiff < 150 ? 3.5
            : slopeDiff < 300 ? 2.5 : 1.5
          );
        }
        if (!components.length) return { score: STUB_SCORE, reason: '到達性データ計算中' };
        const score = clamp5(components.reduce((a,b) => a+b, 0) / components.length);
        return { score, reason: '標高・傾斜から推定した到達しやすさ' };
      },
    },

    // 14. 過去ユーザー実績
    {
      id: 'userRecords', name: 'ユーザー実績', weight: 1.4,
      evaluate(ctx) {
        const posts = ctx.userReports;
        if (!posts || !posts.length) return { score: 1.5, reason: 'この周辺の投稿記録なし' };
        const good  = posts.filter(p => (p.badCount || 0) < 3).length;
        const score = clamp5(1.5 + good * 0.7);
        return { score, reason: `半径5km以内に${good}件の実績投稿` };
      },
    },

    // 15. 熊注目度
    {
      id: 'bearActivity', name: '熊注目度', weight: 0.8,
      evaluate(ctx) {
        const { lat, lng, bearData } = ctx;
        if (!bearData || !bearData.length) {
          return { score: 3.0, reason: '熊データなし（安全かも）' };
        }
        const now = Date.now(), ONE_YEAR = 365 * 24 * 3600 * 1000;
        let threat = 0;
        for (const b of bearData) {
          if (!b.lat || !b.lng) continue;
          const distM = haversine(lat, lng, b.lat, b.lng);
          if (distM > BEAR_RADIUS_M) continue;
          const distFactor = 1 - distM / BEAR_RADIUS_M;
          const age        = b.date ? (now - new Date(b.date).getTime()) / ONE_YEAR : 2;
          const ageFactor  = Math.max(0.2, 1 - age * 0.5);
          threat += distFactor * ageFactor;
        }
        const score = clamp5(5 - Math.min(threat * 1.5, 4));
        const level = score >= 4 ? '低' : score >= 2.5 ? '中' : '高';
        return { score, reason: `周辺${BEAR_RADIUS_M/1000}km以内の熊活動: ${level}` };
      },
    },

  ]; // ← ここに push() するだけで項目追加

  // ─────────────────────────────────────────────────────────
  // メイン評価関数
  // ─────────────────────────────────────────────────────────
  async function evaluate(input) {
    const { lat, lng } = input;
    const k   = _key(lat, lng);
    const now = Date.now();

    const cached = _evalCache.get(k);
    if (cached && now - cached.at < EVAL_TTL) return cached.result;

    const ctx = await _buildContext(input);

    const settled = await Promise.allSettled(
      evaluationItems.map(item =>
        Promise.resolve().then(() => ({ item, r: item.evaluate(ctx) }))
      )
    );

    const items = settled.map(s => {
      if (s.status === 'rejected') {
        return { id:'unknown', name:'エラー', stars:'☆☆☆☆☆', reason:'評価中にエラー', stub: false };
      }
      const { item, r } = s.value;
      return {
        id:      item.id,
        name:    item.name,
        stars:   toStars(r.score),
        reason:  r.reason,
        stub:    r.score === STUB_SCORE && r.reason.includes('準備中'),
        _score:  clamp5(r.score),   // 内部保持のみ・表示しない
        _weight: item.weight,
      };
    });

    const result = { items };
    _evalCache.set(k, { result, at: now });
    return result;
  }

  // ─────────────────────────────────────────────────────────
  // UI — 評価モード管理
  // ─────────────────────────────────────────────────────────
  let _evalMode   = false;
  let _evalPopup  = null;

  /** フロートボタン「評価」のON/OFF切り替え */
  function toggleEvalMode() {
    _evalMode = !_evalMode;
    const btn = document.getElementById('btn-eval');
    if (btn) btn.classList.toggle('active', _evalMode);
    document.body.classList.toggle('eval-mode', _evalMode);

    // 評価モードOFF時: 表示中のポップアップも閉じる
    if (!_evalMode && _evalPopup) {
      _evalPopup.remove();
      _evalPopup = null;
    }
  }

  /** 評価結果HTMLを組み立て */
  function _buildResultHTML(lat, lng, items) {
    const rows = items.map(it => {
      const stubBadge = it.stub
        ? `<span class="ev-stub-badge">準備中</span>`
        : '';
      const starsCell = it.stub
        ? `<span class="ev-stars ev-stars-stub">－－－－－</span>`
        : `<span class="ev-stars">${it.stars}</span>`;
      return `<tr>
        <td class="ev-stars-cell">${starsCell}</td>
        <td class="ev-name-cell">${it.name}${stubBadge}</td>
      </tr>`;
    }).join('');
    return `
      <div class="ev-popup">
        <div class="ev-title">🔍 砂金探索スコア</div>
        <table class="ev-table">${rows}</table>
        <div class="ev-note">※スコアは参考値です。現地確認を推奨します。</div>
      </div>`;
  }

  /** 指定座標の評価ポップアップを開く */
  async function _openEvalPopup(lat, lng) {
    if (_evalPopup) { _evalPopup.remove(); _evalPopup = null; }

    _evalPopup = L.popup({ maxWidth: 260, className: 'ev-leaflet-popup' })
      .setLatLng([lat, lng])
      .setContent('<div class="ev-loading">⏳ 評価中…</div>')
      .openOn(map);

    try {
      const result = await evaluate({ lat, lng, zoom: map.getZoom() });
      // ポップアップが途中で閉じられていなければ内容を更新
      if (_evalPopup && map.hasLayer(_evalPopup)) {
        _evalPopup.setContent(_buildResultHTML(lat, lng, result.items));
      }
    } catch {
      if (_evalPopup && map.hasLayer(_evalPopup)) {
        _evalPopup.setContent('<div class="ev-error">⚠ 評価に失敗しました</div>');
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // 地図クリックへのフック（評価モード中のみ反応）
  // ─────────────────────────────────────────────────────────
  function _hookMapClick() {
    if (typeof map === 'undefined') return;
    map.on('click', e => {
      if (!_evalMode) return;          // 評価モードOFF時は無視
      const { lat, lng } = e.latlng;
      _openEvalPopup(lat, lng);
    });
  }

  // map.js の initMap (window load) より後に実行される
  if (document.readyState === 'complete') {
    _hookMapClick();
  } else {
    window.addEventListener('load', _hookMapClick);
  }

  // ─────────────────────────────────────────────────────────
  // 公開API
  // ─────────────────────────────────────────────────────────
  return {
    evaluate,
    evaluationItems,    // 外部から push() で項目追加可能
    toggleEvalMode,     // index.html の onclick から呼ぶ
  };

})();

// グローバル公開（index.html の onclick="toggleEvalMode()" から直接呼べるように）
window.GoldEvaluator  = GoldEvaluator;
window.toggleEvalMode = GoldEvaluator.toggleEvalMode;
