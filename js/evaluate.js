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

  const GSI_ELEV_API    = 'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php';
  const OVERPASS_API    = 'https://overpass-api.de/api/interpreter';
  const OVERPASS_RADIUS = 3000;     // 地形・河川・道路評価の半径(m)
  const BEAR_RADIUS_M   = 8000;     // 熊評価の最大参照半径(m)
  const POST_RADIUS_DEG = 0.05;     // Firestoreポスト検索半径(度 ≒5km)
  const OVERPASS_TTL    = 30 * 60 * 1000; // Overpassキャッシュ 30分

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

  /**
   * wayのノード列から最近傍点までの距離(m)を返す
   * geom付きway（geometry配列）に対して使用
   */
  function _nearestDistToWay(lat, lng, geometry) {
    let minD = Infinity;
    for (const pt of geometry) {
      const d = haversine(lat, lng, pt.lat, pt.lon);
      if (d < minD) minD = d;
    }
    return minD;
  }

  /**
   * 傾斜ベクトルから「下流方向」を推定し、
   * 指定座標が合流点より川下側かどうかを判定する
   * surroundElevs: 8点配列（順序は _fetchSurroundElev と同じ）
   * confluencePt: { lat, lon } 合流点座標
   * 戻り値: 1=川下側, -1=川上側, 0=不明
   */
  function _isDownstreamOfConfluence(lat, lng, surroundElevs, confluencePt) {
    // 8点の順序: N, NE, E, SE, S, SW, W, NW
    const d = 0.003;
    const offsets = [
      [+d,  0], [+d, +d], [ 0, +d], [-d, +d],
      [-d,  0], [-d, -d], [ 0, -d], [+d, -d],
    ];
    // 有効な標高点から最低標高方向（=下流方向）を特定
    let minElev = Infinity, minIdx = -1;
    for (let i = 0; i < surroundElevs.length; i++) {
      if (surroundElevs[i] !== null && surroundElevs[i] < minElev) {
        minElev = surroundElevs[i];
        minIdx  = i;
      }
    }
    if (minIdx < 0) return 0;

    // 下流方向ベクトル
    const flowVec = { dlat: offsets[minIdx][0], dlng: offsets[minIdx][1] };

    // 合流点→現在地ベクトル
    const toPoint = { dlat: lat - confluencePt.lat, dlng: lng - confluencePt.lon };

    // 内積が正 → 現在地は下流方向にある
    const dot = flowVec.dlat * toPoint.dlat + flowVec.dlng * toPoint.dlng;
    return dot > 0 ? 1 : dot < 0 ? -1 : 0;
  }

  /**
   * wayのポリライン上で評価点Qに最も近いノードを p1 とし、
   * 前後ノード p0（上流）・p2（下流）の3点で湾曲内外を判定する。
   *
   * アルゴリズム:
   *   1. 最近傍ノード p1 を特定（両端ノードは除外）
   *   2. p0→p1→p2 の外積で局所曲がり方向を取得（curvSign）
   *   3. S字チェック: p1 の曲率が低い（< 10°）場合は不明返却
   *   4. △p0-p1-p2 の各辺について外積の符号を確認し、
   *      Q が三角形の内側かどうかを判定
   *   5. S字ガード: 内側判定の符号が curvSign と一致しない場合は不明返却
   *   6. 内側の場合、弦中点 M=(p0+p2)/2 と p1 を結ぶ線で三角形を2分割し、
   *      Q が上流側（p0 側）の半三角形内にあれば upstream=true を返す
   *
   * 戻り値: { side: 1=内側|-1=外側|0=不明, upstream: boolean }
   *   upstream は side===1 のときのみ意味を持つ
   */
  function _isInsideOfCurve(lat, lng, geometry) {
    const NONE = { side: 0, upstream: false };
    if (!geometry || geometry.length < 3) return NONE;

    const cosLat = Math.cos(lat * Math.PI / 180);

    // メートル換算ヘルパー（緯度補正済み）
    function toM(node) {
      return {
        x: node.lon * cosLat * 111000,
        y: node.lat * 111000,
      };
    }
    const Q = { x: lng * cosLat * 111000, y: lat * 111000 };

    // ── 1. 最近傍ノードを p1 として特定（両端除外）──────────
    let nearIdx = 1;
    let nearD   = Infinity;
    for (let i = 1; i < geometry.length - 1; i++) {
      const m = toM(geometry[i]);
      const dx = Q.x - m.x, dy = Q.y - m.y;
      const d  = dx * dx + dy * dy;
      if (d < nearD) { nearD = d; nearIdx = i; }
    }

    const P0 = toM(geometry[nearIdx - 1]); // 上流ノード
    const P1 = toM(geometry[nearIdx]);      // 最近傍（カーブ頂点候補）
    const P2 = toM(geometry[nearIdx + 1]); // 下流ノード

    // ── 2. 局所曲がり方向（p0→p1→p2 の外積）────────────────
    // cross > 0: 左カーブ（内側は右）、cross < 0: 右カーブ（内側は左）
    const v01x = P1.x - P0.x, v01y = P1.y - P0.y;
    const v12x = P2.x - P1.x, v12y = P2.y - P1.y;
    const curvCross = v01x * v12y - v01y * v12x;

    // ── 3. S字ガード: 曲率が低すぎる場合は不明──────────────
    // 外積の大きさ（≒ sin(bend) × |v01| × |v12|）で曲率を間接評価
    // ベクトル長を正規化して sin値を取得し、bend角を復元
    const magV01 = Math.sqrt(v01x * v01x + v01y * v01y);
    const magV12 = Math.sqrt(v12x * v12x + v12y * v12y);
    if (magV01 < 1e-3 || magV12 < 1e-3) return NONE;
    const sinBend = Math.abs(curvCross) / (magV01 * magV12);
    // sinBend < sin(10°) ≈ 0.174 はほぼ直線 → 不明
    if (sinBend < 0.174) return NONE;

    // ── 4. 三角形内外判定（バリセントリック座標法）───────────
    // △P0-P1-P2 に対して Q の位置を外積の符号で判定
    // 3辺すべて同符号 → 内側
    function cross2d(ax, ay, bx, by) { return ax * by - ay * bx; }

    const d0 = cross2d(P1.x - P0.x, P1.y - P0.y, Q.x - P0.x, Q.y - P0.y);
    const d1 = cross2d(P2.x - P1.x, P2.y - P1.y, Q.x - P1.x, Q.y - P1.y);
    const d2 = cross2d(P0.x - P2.x, P0.y - P2.y, Q.x - P2.x, Q.y - P2.y);

    const hasNeg = (d0 < 0) || (d1 < 0) || (d2 < 0);
    const hasPos = (d0 > 0) || (d1 > 0) || (d2 > 0);
    const isInsideTri = !(hasNeg && hasPos); // 全同符号なら内側

    // ── 5. S字ガード: 内側判定と曲がり方向の符号チェック────
    // 内側なら Q は curvCross の符号と反対側にいるはず
    // （左カーブ=curvCross>0 のとき内側は右=d0<0 など）
    // 三角形重心に対する curvCross 符号との整合チェック
    if (isInsideTri) {
      // d0の符号が curvCross と同じなら内側判定が curvSign と矛盾
      // → S字変曲点付近の誤判定と見なして不明返却
      const signOk = (curvCross > 0) ? (d0 < 0) : (d0 > 0);
      if (!signOk) return NONE;
    }

    if (!isInsideTri) {
      // 外側判定（符号チェック不要）
      return { side: -1, upstream: false };
    }

    // ── 6. 上流側半三角形チェック（内側確定時のみ）──────────
    // 弦の中点 M = (P0 + P2) / 2
    // △P0-M-P1 が上流側半三角形
    // Q がこの半三角形内にあれば upstream = true
    const M = { x: (P0.x + P2.x) / 2, y: (P0.y + P2.y) / 2 };

    const u0 = cross2d(M.x  - P0.x, M.y  - P0.y, Q.x - P0.x, Q.y - P0.y);
    const u1 = cross2d(P1.x - M.x,  P1.y - M.y,  Q.x - M.x,  Q.y - M.y);
    const u2 = cross2d(P0.x - P1.x, P0.y - P1.y, Q.x - P1.x, Q.y - P1.y);

    const uHasNeg = (u0 < 0) || (u1 < 0) || (u2 < 0);
    const uHasPos = (u0 > 0) || (u1 > 0) || (u2 > 0);
    const upstream = !(uHasNeg && uHasPos);

    return { side: 1, upstream };
  }

  /**
   * wayのノード列から湾曲情報を計算
   * 戻り値: { maxBend, bendCount, maxBendIdx }
   *   maxBend    : 最大曲がり角度（度）。大きいほど急カーブ
   *   bendCount  : 有意な湾曲の数（bend >= 10度のノード数）。S字等で増える
   *   maxBendIdx : 最大曲率のノードインデックス（内外判定に使用）
   */
  function _calcCurvatureInfo(geometry) {
    if (!geometry || geometry.length < 3) return { maxBend: 0, bendCount: 0, maxBendIdx: 1 };
    let maxBend = 0, bendCount = 0, maxBendIdx = 1;
    for (let i = 1; i < geometry.length - 1; i++) {
      const p0 = geometry[i - 1], p1 = geometry[i], p2 = geometry[i + 1];
      const ax = p0.lon - p1.lon, ay = p0.lat - p1.lat;
      const bx = p2.lon - p1.lon, by = p2.lat - p1.lat;
      const dot  = ax * bx + ay * by;
      const magA = Math.sqrt(ax * ax + ay * ay);
      const magB = Math.sqrt(bx * bx + by * by);
      if (magA < 1e-10 || magB < 1e-10) continue;
      const cos  = Math.max(-1, Math.min(1, dot / (magA * magB)));
      const bend = 180 - Math.acos(cos) * (180 / Math.PI);
      if (bend >= 15) bendCount++;
      if (bend > maxBend) { maxBend = bend; maxBendIdx = i; }
    }
    return { maxBend, bendCount, maxBendIdx };
  }

  // ─────────────────────────────────────────────────────────
  // キャッシュ層
  // ─────────────────────────────────────────────────────────
  const _evalCache     = new Map();
  const _topoCache     = new Map();
  const _postCache     = new Map();
  const _overpassCache = new Map();
  const _bearStore     = { data: null, fetchedAt: 0 };

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
      const url  = `${GSI_ELEV_API}?lon=${lng}&lat=${lat}&outtype=JSON`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error('gsi_err');
      const json = await res.json();
      // GSI レスポンス: { elevation: "123.45", hsrc: "5m" } or "-----" (海・データなし)
      const raw  = json?.elevation;
      const elev = (raw && raw !== '-----') ? parseFloat(raw) : null;
      _topoCache.set(k, elev);
      return elev;
    } catch { return null; }
  }

  async function _fetchSurroundElev(lat, lng) {
    const d = 0.003; // 約300m
    const pts = [
      [lat+d, lng  ], [lat+d, lng+d], [lat,   lng+d],
      [lat-d, lng+d], [lat-d, lng  ], [lat-d, lng-d],
      [lat,   lng-d], [lat+d, lng-d],
    ];
    // GSIは1点ずつのAPIなので Promise.all で並列取得
    const results = await Promise.all(
      pts.map(async ([la, lo]) => {
        try {
          const url  = `${GSI_ELEV_API}?lon=${lo}&lat=${la}&outtype=JSON`;
          const res  = await fetch(url);
          if (!res.ok) return null;
          const json = await res.json();
          const raw  = json?.elevation;
          return (raw && raw !== '-----') ? parseFloat(raw) : null;
        } catch { return null; }
      })
    );
    return results;
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

  /**
   * Overpass API: 指定座標の半径3km以内の河川・道路データを一括取得
   * キャッシュTTL: 30分
   * 返却: { streams: Way[], rivers: Way[], roads: Way[], tracks: Way[] }
   *   Way = { id, tags, geometry: [{lat, lon}] }
   */
  async function _fetchOverpass(lat, lng) {
    const k   = _key(lat, lng);
    const now = Date.now();
    const hit = _overpassCache.get(k);
    if (hit && now - hit.at < OVERPASS_TTL) return hit.data;

    const query = `
[out:json][timeout:15];
(
  way["waterway"~"^(stream|river|canal|ditch)$"](around:${OVERPASS_RADIUS},${lat},${lng});
  way["highway"~"^(primary|secondary|tertiary|unclassified|residential|service)$"](around:${OVERPASS_RADIUS},${lat},${lng});
  way["highway"="track"](around:${OVERPASS_RADIUS},${lat},${lng});
);
out geom;
`.trim();

    try {
      const res = await fetch(OVERPASS_API, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error('overpass_err');
      const json = await res.json();
      const ways = json.elements || [];

      const data = {
        streams: ways.filter(w => ['stream','canal','ditch'].includes(w.tags?.waterway)),
        rivers:  ways.filter(w => w.tags?.waterway === 'river'),
        roads:   ways.filter(w => w.tags?.highway && w.tags.highway !== 'track'),
        tracks:  ways.filter(w => w.tags?.highway === 'track'),
      };

      _overpassCache.set(k, { data, at: now });
      return data;
    } catch {
      return { streams: [], rivers: [], roads: [], tracks: [] };
    }
  }

  // ─────────────────────────────────────────────────────────
  // context ビルダー
  // ─────────────────────────────────────────────────────────
  async function _buildContext(input) {
    const { lat, lng, zoom = 13 } = input;
    const [elev, surroundElevs, bears, posts, gsjData, overpass] = await Promise.all([
      _fetchElev(lat, lng),
      _fetchSurroundElev(lat, lng),
      _fetchBears(),
      _fetchPosts(lat, lng),
      (typeof loadGsjMineData === 'function')
        ? loadGsjMineData().catch(() => [])
        : Promise.resolve(window.GSJ_MINE_DATA_CACHED || []),
      _fetchOverpass(lat, lng),
    ]);
    if (gsjData.length) window.GSJ_MINE_DATA_CACHED = gsjData;
    return {
      lat, lng, zoom,
      terrain:     { elev, surroundElevs },
      geology:     null,
      overpass,                                         // ← 追加
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
        const { lat, lng, overpass } = ctx;
        const allWater = [...(overpass.streams || []), ...(overpass.rivers || [])];
        if (!allWater.length) return { score: 1.5, reason: '半径3km以内に河川なし' };

        let minD = Infinity;
        for (const way of allWater) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) minD = d;
        }
        if (!isFinite(minD)) return { score: 1.5, reason: '河川データ不完全' };

        ctx.cache.nearestStreamM = minD;
        // 5m刻み・35m超で0点
        const score = minD <= 15 ? 5.0   // 15m以内（最高）
                    : minD <= 20 ? 4.0   // 20m以内
                    : minD <= 25 ? 3.0   // 25m以内
                    : minD <= 30 ? 2.0   // 30m以内
                    : minD <= 35 ? 1.0   // 35m以内
                    : 0;                 // 35m超
        return {
          score,
          reason: `最寄り河川・沢まで約${Math.round(minD)}m`,
          _debug: {
            '最近傍河川距離': `${Math.round(minD)}m`,
            '河川/沢本数':    `${allWater.length}本（半径3km）`,
          },
        };
      },
    },

    // 3. 河川合流点
    {
      id: 'confluence', name: '河川合流点', weight: 1.5,
      evaluate(ctx) {
        const { lat, lng, overpass, terrain } = ctx;
        const allWater = [...overpass.streams, ...overpass.rivers];
        if (!allWater.length) return { score: 1.0, reason: '半径3km以内に河川なし' };

        // 半径500m以内のway本数で基本スコアを算出
        const CONF_R = 500;
        let count = 0;
        let nearestConfPt = null;
        let nearestConfD  = Infinity;
        for (const way of allWater) {
          if (!way.geometry?.length) continue;
          // 最近傍ノードを合流点代表座標として使用
          for (const pt of way.geometry) {
            const d = haversine(lat, lng, pt.lat, pt.lon);
            if (d <= CONF_R) {
              count++;
              if (d < nearestConfD) { nearestConfD = d; nearestConfPt = pt; }
              break;
            }
          }
        }

        let baseScore = count >= 3 ? 5.0
                      : count === 2 ? 4.0
                      : count === 1 ? 2.5 : 1.0;

        // 川下±補正: 合流点より下流側なら+1.0、上流側なら-1.0
        let posLabel = '';
        if (nearestConfPt && terrain.surroundElevs.some(e => e !== null)) {
          const dir = _isDownstreamOfConfluence(lat, lng, terrain.surroundElevs, nearestConfPt);
          if (dir === 1)  { baseScore += 1.0; posLabel = '（合流点の川下）'; }
          if (dir === -1) { baseScore -= 1.0; posLabel = '（合流点の川上）'; }
        }

        return {
          score: clamp5(baseScore),
          reason: count >= 2
            ? `半径500m以内に${count}本の河川${posLabel}`
            : count === 1
            ? `半径500m以内に1本の河川${posLabel}`
            : '半径500m以内に河川なし',
          _debug: {
            '半径500m内河川数': `${count}本`,
            '最近傍合流点距離': nearestConfD < Infinity ? `${Math.round(nearestConfD)}m` : 'なし',
            '川下/川上判定':    posLabel || '判定不能（標高データなし）',
            'ベーススコア':     baseScore.toFixed(1),
          },
        };
      },
    },

    // 4. 河川湾曲
    {
      id: 'riverCurve', name: '河川湾曲', weight: 1.3,
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        const allWater = [...overpass.streams, ...overpass.rivers];
        if (!allWater.length) return { score: 1.5, reason: '半径3km以内に河川なし' };

        // 最近傍wayを特定（1本のみ対象）
        let minD = Infinity, nearestWay = null;
        for (const way of allWater) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) { minD = d; nearestWay = way; }
        }
        if (!nearestWay) return { score: 1.5, reason: '河川形状データなし' };

        // 川が遠すぎる場合は湾曲の恩恵なし
        const streamM = ctx.cache.nearestStreamM ?? minD;
        if (streamM > 50) {
          return { score: 1.0, reason: `最近傍河川まで約${Math.round(streamM)}m（湾曲の恩恵圏外）` };
        }

        // ── 湾曲密度ボーナス（ノード密度非依存）──────────────
        // way全体の実距離(m)を計算し、有意湾曲数(>=15°)を割って密度化
        const geo = nearestWay.geometry;
        let wayLenM = 0;
        for (let i = 1; i < geo.length; i++) {
          wayLenM += haversine(geo[i-1].lat, geo[i-1].lon, geo[i].lat, geo[i].lon);
        }
        const wayLenKm = Math.max(wayLenM / 1000, 0.01);
        const { bendCount } = _calcCurvatureInfo(geo); // 閾値15°は_calcCurvatureInfo側で設定済み
        const bendDensity = bendCount / wayLenKm; // 湾曲数/km

        const densityBonus = bendDensity >= 3.0 ? 1.0   // 蛇行（S字複合）
                           : bendDensity >= 1.5 ? 0.5   // 複数湾曲
                           : bendDensity >= 0.5 ? 0.2   // 緩い湾曲あり
                           : 0;
        const densityLabel = bendDensity >= 3.0 ? `・蛇行(${bendDensity.toFixed(1)}/km)`
                           : bendDensity >= 1.5 ? `・複数湾曲(${bendDensity.toFixed(1)}/km)`
                           : bendDensity >= 0.5 ? `・湾曲あり(${bendDensity.toFixed(1)}/km)`
                           : '';

        // ── 最近傍ノード特定 ──────────────────────────────────
        let nearIdx = 1;
        { let nearD = Infinity;
          for (let i = 1; i < geo.length - 1; i++) {
            const d = haversine(lat, lng, geo[i].lat, geo[i].lon);
            if (d < nearD) { nearD = d; nearIdx = i; }
          }
        }

        // ── 角度計算（緯度補正付き）────────────────────────────
        // 経度差を cos(lat) × 111000 でメートル換算して正確な角度を算出
        const p0 = geo[nearIdx - 1], p1 = geo[nearIdx], p2 = geo[nearIdx + 1] ?? geo[nearIdx];
        const cosLat = Math.cos(p1.lat * Math.PI / 180);
        const ax = (p0.lon - p1.lon) * cosLat * 111000;
        const ay = (p0.lat - p1.lat) * 111000;
        const bx = (p2.lon - p1.lon) * cosLat * 111000;
        const by = (p2.lat - p1.lat) * 111000;
        const magA = Math.sqrt(ax * ax + ay * ay);
        const magB = Math.sqrt(bx * bx + by * by);
        const localBend = (magA < 1e-3 || magB < 1e-3) ? 0
          : 180 - Math.acos(Math.max(-1, Math.min(1, (ax*bx + ay*by) / (magA * magB)))) * (180 / Math.PI);

        // ── ベーススコア（改定閾値）──────────────────────────
        // 足切り: 15°未満はほぼ直線扱い
        // 50°以上で最高評価（急すぎても堆積は変わらない）
        let baseScore = localBend >= 50 ? 5.0   // 急カーブ（堆積最有望）
                      : localBend >= 30 ? 4.0   // 明確な湾曲（有望）
                      : localBend >= 15 ? 2.5   // 緩やか（わずかに有望）
                      : 1.0;                    // ほぼ直線（足切り）

        const curveLabel = localBend >= 50 ? '急カーブ'
                         : localBend >= 30 ? '明確な湾曲'
                         : localBend >= 15 ? '緩やかな湾曲'
                         : 'ほぼ直線';

        // ── 内外判定 + 上流加点（距離連動・連続減衰）────────────
        // 砂金堆積メカニズム:
        //   内側: 流速が遅く砂金が沈降・堆積しやすい
        //   外側: 流速が速く侵食が進む（堆積しにくい）
        //   内側かつ上流側: 堆積の滞留時間が長くさらに有望
        //   距離が遠いほど湾曲の影響は弱まるため40mで効果ゼロ
        const SIDE_RANGE = 40; // 内外補正が有効な最大距離(m)
        let sideScore  = 0;
        let upstScore  = 0;
        let sideLabel  = '';
        let upstLabel  = '';

        if (localBend >= 15) {
          const { side, upstream } = _isInsideOfCurve(lat, lng, geo);
          const decay = Math.max(0, 1 - minD / SIDE_RANGE); // 距離減衰係数 0〜1

          if (side === 1) {
            // 内側: 最大+2.0、距離に応じて線形減衰
            sideScore = 2.0 * decay;
            if      (decay > 0.75) sideLabel = '・内側至近（堆積最有望）';
            else if (decay > 0.37) sideLabel = '・内側（堆積有望）';
            else if (decay > 0)    sideLabel = '・内側（やや有望）';

            // 上流側加点: 内側かつ上流三角形内 → 最大+0.5、距離減衰あり
            if (upstream) {
              upstScore = 0.5 * decay;
              upstLabel = '・上流側（滞留帯）';
            }
          } else if (side === -1) {
            // 外側: 最大−1.5、距離に応じて線形減衰
            // 外側でも遠ければ影響小（川に近い外側が最も不利）
            sideScore = -1.5 * decay;
            if      (decay > 0.75) sideLabel = '・外側至近（堆積不利）';
            else if (decay > 0.37) sideLabel = '・外側（やや不利）';
            else if (decay > 0)    sideLabel = '・外側（影響小）';
          }
        }

        const finalScore = clamp5(baseScore + densityBonus + sideScore + upstScore);
        return {
          score:  finalScore,
          reason: `最近傍河川: ${curveLabel}${densityLabel}${sideLabel}${upstLabel}`,
          _debug: {
            '川までの距離':   `${Math.round(minD)}m`,
            'ノードIdx':      `${nearIdx} / ${geo.length - 1}`,
            '最近傍曲率':     `${localBend.toFixed(1)}°（緯度補正済）`,
            '湾曲密度':       `${bendDensity.toFixed(1)}/km (${bendCount}箇所/${wayLenKm.toFixed(1)}km)`,
            '内外判定':       sideScore > 0 ? `内側` : sideScore < 0 ? `外側` : '直線/不明/S字除外',
            '上流判定':       upstScore > 0 ? `上流側（加点）` : '下流側または対象外',
            '距離減衰':       `${(Math.max(0, 1 - minD / SIDE_RANGE) * 100).toFixed(0)}%`,
            'ベース':         baseScore.toFixed(1),
            '密度ボーナス':   `+${densityBonus.toFixed(1)}`,
            '内外補正':       `${sideScore >= 0 ? '+' : ''}${sideScore.toFixed(2)}`,
            '上流補正':       `+${upstScore.toFixed(2)}`,
          },
        };
      },
    },

    // 5. 地質（GSJ WMS/WFS 接続待ち）
    {
      id: 'geology', name: '地質', weight: 1.6,
      evaluate(ctx) {
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
        ctx.cache._scores = ctx.cache._scores || {};
        ctx.cache._scores.depositDistance = score;
        return {
          score,
          reason: `最寄り鉱床まで約${(minD/1000).toFixed(1)}km`,
          _debug: {
            '最近傍鉱床距離': `${(minD/1000).toFixed(1)}km`,
            '鉱床総数':       `${allDeps.length}件`,
          },
        };
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
        ctx.cache._scores = ctx.cache._scores || {};
        ctx.cache._scores.prospectDistance = score;
        return {
          score,
          reason: `最寄り鉱徴地まで約${(minD/1000).toFixed(1)}km`,
          _debug: {
            '最近傍鉱徴地距離': `${(minD/1000).toFixed(1)}km`,
            '鉱徴地総数':       `${prospects.length}件`,
          },
        };
      },
    },

    // 8. 川傾斜（川の上下流勾配）
    {
      id: 'riverSlope', name: '川傾斜', weight: 1.2,
      async evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        const allWater = [...(overpass.streams || []), ...(overpass.rivers || [])];
        if (!allWater.length) return { score: 0, reason: '付近に河川なし（評価不能）' };

        // 最近傍wayを特定
        let minD = Infinity, nearestWay = null;
        for (const way of allWater) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) { minD = d; nearestWay = way; }
        }
        if (!nearestWay || nearestWay.geometry.length < 2) {
          return { score: 0, reason: '河川形状データなし（評価不能）' };
        }

        // 先頭・末尾ノードの標高を取得
        const g    = nearestWay.geometry;
        const head = g[0];
        const tail = g[g.length - 1];
        const [elevHead, elevTail] = await Promise.all([
          _fetchElev(head.lat, head.lon),
          _fetchElev(tail.lat, tail.lon),
        ]);
        if (elevHead === null || elevTail === null) {
          return { score: 0, reason: '標高取得失敗（評価不能）' };
        }

        // 勾配 = 標高差(m) / 水平距離(km)
        const elevDiff = Math.abs(elevHead - elevTail);
        const distKm   = haversine(head.lat, head.lon, tail.lat, tail.lon) / 1000;
        if (distKm < 0.01) return { score: 0, reason: '河川区間が短すぎ（評価不能）' };
        const gradient = elevDiff / distKm; // m/km

        const score = gradient < 5  ? 2.0   // ほぼ平坦（流速不足）
                    : gradient < 15 ? 5.0   // 緩やか（最適）
                    : gradient < 40 ? 4.0   // 中勾配
                    : gradient < 80 ? 3.0   // やや急
                    : 2.0;                  // 急流（堆積しにくい）
        return {
          score,
          reason: `川の勾配: 約${Math.round(gradient)}m/km`,
          _debug: {
            '上流端標高':   `${Math.round(elevHead)}m`,
            '下流端標高':   `${Math.round(elevTail)}m`,
            '標高差':       `${Math.round(elevDiff)}m`,
            '区間距離':     `${distKm.toFixed(2)}km`,
            '勾配':         `${Math.round(gradient)}m/km`,
            '最近傍川距離': `${Math.round(minD)}m`,
          },
        };
      },
    },

    // 9. 谷形状
    {
      id: 'valleyShape', name: '谷形状', weight: 1.3,
      evaluate(ctx) {
        const center    = ctx.terrain.elev;
        const surrounds = ctx.terrain.surroundElevs.filter(e => e !== null);
        if (center === null || surrounds.length < 4) {
          return { score: STUB_SCORE, reason: '谷形状データ取得中' };
        }
        const avg   = surrounds.reduce((a,b) => a+b, 0) / surrounds.length;
        const depth = avg - center;
        // 周囲8点（約300m）との標高差で谷の深さを評価（閾値は元の半分）
        const score = depth < 0    ? 1.0   // 尾根・台地
                    : depth < 2.5  ? 2.0   // ほぼ平坦
                    : depth < 10   ? 3.0   // 浅い谷・小沢
                    : depth < 25   ? 4.0   // 明瞭な谷（有望）
                    : 5.0;                 // V字谷・深谷（砂金堆積の典型地形）
        ctx.cache.valleyDepth = depth;
        return {
          score,
          reason: depth >= 0
            ? `周囲8点より約${Math.round(depth)}m低い谷地形`
            : '谷地形ではない（尾根・台地）',
          _debug: {
            '評価地点標高':   `${Math.round(ctx.terrain.elev)}m`,
            '周囲8点平均':    `${Math.round(avg)}m`,
            '谷の深さ':       `${depth.toFixed(1)}m`,
            '有効計測点数':   `${surrounds.length}/8点`,
          },
        };
      },
    },

    // 10. 標高
    {
      id: 'elevation', name: '標高', weight: 1.0,
      evaluate(ctx) {
        const elev = ctx.terrain.elev;
        if (elev === null) return { score: STUB_SCORE, reason: '標高データ取得中' };
        // 全国対応: 日本の主要砂金産地（北海道・東北・中国山地）の標高分布から設定
        const score = elev < 50   ? 2.0   // 平野部（堆積済み・競合多）
                    : elev < 150  ? 3.0   // 低丘陵
                    : elev < 500  ? 5.0   // 最適帯（全国産地の主戦場）
                    : elev < 1000 ? 4.0   // 山間部（有望）
                    : elev < 1500 ? 3.0   // 高山帯
                    : 2.0;               // 積雪・アクセス困難
        return {
          score,
          reason: `標高: 約${Math.round(elev)}m`,
          _debug: {
            '標高': `${Math.round(elev)}m`,
          },
        };
      },
    },

    // 11. 道路距離
    {
      id: 'roadDistance', name: '道路距離', weight: 0.9,
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        if (!overpass.roads.length) {
          ctx.cache._scores = ctx.cache._scores || {};
          ctx.cache._scores.roadDistance = 3.0;
          return { score: 3.0, reason: '半径3km以内に一般道なし（秘境）' };
        }

        let minD = Infinity;
        for (const way of overpass.roads) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) minD = d;
        }
        ctx.cache.nearestRoadM = minD;

        const score = minD <= 100  ? 2.0
                    : minD <= 1000 ? 5.0
                    : minD <= 2000 ? 3.5
                    : 2.0;
        ctx.cache._scores = ctx.cache._scores || {};
        ctx.cache._scores.roadDistance = score;
        return {
          score,
          reason: `最寄り一般道まで約${Math.round(minD)}m`,
          _debug: {
            '最近傍一般道距離': `${Math.round(minD)}m`,
            '一般道本数':       `${overpass.roads.length}本（半径3km）`,
          },
        };
      },
    },

    // 12. 林道距離
    {
      id: 'forestRoadDistance', name: '林道距離', weight: 1.0,
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        if (!overpass.tracks.length) {
          ctx.cache._scores = ctx.cache._scores || {};
          ctx.cache._scores.forestRoadDistance = 2.0;
          return { score: 2.0, reason: '半径3km以内に林道なし' };
        }

        let minD = Infinity;
        for (const way of overpass.tracks) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) minD = d;
        }

        const score = minD <= 200  ? 5.0
                    : minD <= 800  ? 4.0
                    : minD <= 1500 ? 3.0
                    : 2.0;
        ctx.cache._scores = ctx.cache._scores || {};
        ctx.cache._scores.forestRoadDistance = score;
        return {
          score,
          reason: `最寄り林道まで約${Math.round(minD)}m`,
          _debug: {
            '最近傍林道距離': `${Math.round(minD)}m`,
            '林道本数':       `${overpass.tracks.length}本（半径3km）`,
          },
        };
      },
    },

    // 12b. 傾斜（地形傾斜 — 周辺8点の最大−最小標高差）
    {
      id: 'slope', name: '傾斜', weight: 1.2,
      evaluate(ctx) {
        const surrounds = ctx.terrain.surroundElevs.filter(e => e !== null);
        if (surrounds.length < 2) {
          return { score: STUB_SCORE, reason: '地形傾斜データ取得中' };
        }
        const diff = Math.max(...surrounds) - Math.min(...surrounds);
        ctx.cache.slopeDiff = diff; // 13番(accessibility)が参照
        const score = diff < 50  ? 5.0   // 平坦（歩きやすい）
                    : diff < 150 ? 3.5   // やや起伏あり
                    : diff < 300 ? 2.5   // 急峻
                    : 1.5;               // 険しい地形
        return {
          score,
          reason: `周辺地形の標高差: 約${Math.round(diff)}m`,
          _debug: {
            '周辺最高標高': `${Math.round(Math.max(...surrounds))}m`,
            '周辺最低標高': `${Math.round(Math.min(...surrounds))}m`,
            '標高差':       `${Math.round(diff)}m`,
            '有効計測点数': `${surrounds.length}/8点`,
          },
        };
      },
    },

    // 13. 人到達性
    {
      id: 'accessibility', name: '人到達性', weight: 1.1,
      evaluate(ctx) {
        const slopeDiff   = ctx.cache.slopeDiff    ?? null;
        const elev        = ctx.terrain.elev;
        const nearRoadM   = ctx.cache.nearestRoadM ?? null;
        const components  = [];

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
        if (nearRoadM !== null) {
          components.push(
            nearRoadM < 500  ? 5.0 : nearRoadM < 1500 ? 3.5
            : nearRoadM < 3000 ? 2.5 : 1.5
          );
        }
        if (!components.length) return { score: STUB_SCORE, reason: '到達性データ計算中' };
        const score = clamp5(components.reduce((a,b) => a+b, 0) / components.length);
        return {
          score,
          reason: '標高・地形傾斜・道路距離から推定した到達しやすさ',
          _debug: {
            '標高':         ctx.terrain.elev !== null ? `${Math.round(ctx.terrain.elev)}m` : '未取得',
            '地形傾斜差':   slopeDiff !== null ? `${Math.round(slopeDiff)}m` : '未取得',
            '最近傍道路':   nearRoadM !== null ? `${Math.round(nearRoadM)}m` : '未取得',
            '平均スコア':   score.toFixed(2),
          },
        };
      },
    },

    // 14a. 鉱床・鉱徴地との標高差
    {
      id: 'depositElevation', name: '鉱床標高差', weight: 1.2,
      async evaluate(ctx) {
        const { lat, lng, deposits, prospects, mines, terrain } = ctx;

        // 評価地点の標高
        const myElev = terrain.elev;
        if (myElev === null) {
          return { score: STUB_SCORE, reason: '評価地点の標高取得中' };
        }

        // 鉱床＋鉱徴地＋minesを合算して最近傍を特定
        const allDeps = [...deposits, ...mines];
        const allProspects = [...prospects];
        const allTargets = [...allDeps, ...allProspects];
        if (!allTargets.length) {
          return { score: STUB_SCORE, reason: '鉱床・鉱徴地データ読み込み中' };
        }

        // 最近傍ターゲットを距離で選ぶ
        let nearest = null, nearestD = Infinity;
        for (const d of allTargets) {
          const dist = haversine(lat, lng, d.lat, d.lng);
          if (dist < nearestD) { nearestD = dist; nearest = d; }
        }
        if (!nearest) {
          return { score: STUB_SCORE, reason: '鉱床・鉱徴地データ読み込み中' };
        }

        // 最近傍の標高を取得
        const depElev = await _fetchElev(nearest.lat, nearest.lng);
        if (depElev === null) {
          return { score: STUB_SCORE, reason: '鉱床地点の標高取得中' };
        }

        // 標高差: 正 = 評価地点が低い（川下）、負 = 評価地点が高い（川上）
        const diff = depElev - myElev; // 正なら川下側
        const distKmLabel = (nearestD / 1000).toFixed(1);
        const typeLabel = allDeps.includes(nearest) ? '鉱床' : '鉱徴地';

        let score, label;
        if (diff >= 100) {
          score = 5.0;
          label = `${typeLabel}より${Math.round(diff)}m低い（明確な川下）`;
        } else if (diff >= 10) {
          score = 4.0;
          label = `${typeLabel}より${Math.round(diff)}m低い（川下）`;
        } else if (diff >= 0) {
          score = 3.0;
          label = `${typeLabel}とほぼ同標高（±${Math.round(Math.abs(diff))}m）`;
        } else {
          score = 1.0;
          label = `${typeLabel}より${Math.round(Math.abs(diff))}m高い（川上側）`;
        }

        return {
          score,
          reason: `最寄り${typeLabel}(${distKmLabel}km): ${label}`,
          _debug: {
            '評価地点標高':     `${Math.round(myElev)}m`,
            '最近傍鉱床/鉱徴地標高': `${Math.round(depElev)}m（${typeLabel}）`,
            '標高差(正=川下)':  `${Math.round(diff)}m`,
            '距離':             `${distKmLabel}km`,
            '種別':             typeLabel,
          },
        };
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
        return {
          score,
          reason: `半径5km以内に${good}件の実績投稿`,
          _debug: {
            '総投稿数':       `${posts.length}件`,
            '有効投稿数':     `${good}件（badCount<3）`,
            '除外投稿数':     `${posts.length - good}件`,
          },
        };
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
        return {
          score,
          reason: `周辺${BEAR_RADIUS_M/1000}km以内の熊活動: ${level}`,
          _debug: {
            '参照半径':       `${BEAR_RADIUS_M/1000}km`,
            '熊データ総数':   `${bearData.length}件`,
            '脅威スコア合計': `${threat.toFixed(2)}`,
            '危険度':         level,
          },
        };
      },
    },

  ]; // ← ここに push() するだけで項目追加

  // ─────────────────────────────────────────────────────────
  // 統合表示項目（パス2専用: 旧項目スコアを加重合算して表示）
  //   weight: 0 のためヒートマップ等の集計には影響しない
  //   _mergeOnly: true でパス1からは除外される
  // ─────────────────────────────────────────────────────────
  const mergeItems = [

    // 16. 鉱床・鉱徴地距離（統合表示）
    //     どちらか高いほうを採用
    {
      id: 'mineDistance', name: '鉱床・鉱徴地距離', weight: 0, _mergeOnly: true,
      evaluate(ctx) {
        const s = ctx.cache._scores || {};
        const dep = s.depositDistance  ?? STUB_SCORE;
        const pro = s.prospectDistance ?? STUB_SCORE;
        const score = clamp5(Math.max(dep, pro));
        const depLabel = dep === STUB_SCORE ? '鉱床データ準備中' : `鉱床 ${dep.toFixed(1)}pt`;
        const proLabel = pro === STUB_SCORE ? '鉱徴地データ準備中' : `鉱徴地 ${pro.toFixed(1)}pt`;
        return { score, reason: `${depLabel} / ${proLabel}` };
      },
    },

    // 17. 道路・林道距離（統合表示）
    //     roadDistance × 3/5 + forestRoadDistance × 2/5
    {
      id: 'accessRoad', name: '道路・林道距離', weight: 0, _mergeOnly: true,
      evaluate(ctx) {
        const s = ctx.cache._scores || {};
        const road  = s.roadDistance        ?? STUB_SCORE;
        const track = s.forestRoadDistance  ?? STUB_SCORE;
        const score = clamp5(road * (3 / 5) + track * (2 / 5));
        const roadLabel  = road  === STUB_SCORE ? '道路データ準備中' : `一般道 ${road.toFixed(1)}pt`;
        const trackLabel = track === STUB_SCORE ? '林道データ準備中' : `林道 ${track.toFixed(1)}pt`;
        return { score, reason: `${roadLabel} / ${trackLabel}` };
      },
    },

  ];

  // ─────────────────────────────────────────────────────────
  // メイン評価関数（2パス実行）
  //   パス1: evaluationItems（通常項目）を実行 → ctx.cache._scores に書き込み
  //   パス2: mergeItems（統合表示項目）を実行 → cache._scores を参照して加重合算
  // ─────────────────────────────────────────────────────────
  async function evaluate(input) {
    const { lat, lng } = input;
    const k   = _key(lat, lng);
    const now = Date.now();

    const cached = _evalCache.get(k);
    if (cached && now - cached.at < EVAL_TTL) return cached.result;

    const ctx = await _buildContext(input);

    // ── パス1: 通常項目 ──────────────────────────────────
    const settled1 = await Promise.allSettled(
      evaluationItems.map(item =>
        Promise.resolve().then(async () => ({ item, r: await item.evaluate(ctx) }))
      )
    );

    // ── パス2: 統合表示項目（パス1完了後に実行） ──────────
    const settled2 = await Promise.allSettled(
      mergeItems.map(item =>
        Promise.resolve().then(async () => ({ item, r: await item.evaluate(ctx) }))
      )
    );

    const _toItem = s => {
      if (s.status === 'rejected') {
        return { id: 'unknown', name: 'エラー', stars: '☆☆☆☆☆', reason: '評価中にエラー', stub: false };
      }
      const { item, r } = s.value;
      return {
        id:      item.id,
        name:    item.name,
        stars:   toStars(r.score),
        reason:  r.reason,
        stub:    (r.score === STUB_SCORE && r.reason.includes('準備中')) || r.reason.includes('評価不能'),
        _score:  clamp5(r.score),
        _weight: item.weight,
        _debug:  r._debug || null,
      };
    };

    const items = [...settled1, ...settled2].map(_toItem);

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

    // カテゴリー定義（表示するIDを列挙）
    const CATEGORIES = [
      {
        label: '含有率',
        ids:   ['geology', 'mineDistance', 'depositElevation', 'valleyShape'],
      },
      {
        label: '河川環境',
        ids:   ['streamDistance', 'riverCurve', 'confluence', 'riverSlope'],
      },
      {
        label: '環境',
        ids:   ['elevation'],
      },
      {
        label: '危険度',
        ids:   ['accessRoad', 'accessibility', 'bearActivity'],
      },
    ];
    // 欄外: 点線区切り・ヘッダーなし
    const OUTSIDE_IDS = ['userRecords'];

    // id → item マップ
    const itemMap = {};
    for (const it of items) itemMap[it.id] = it;

    function _rowHTML(it) {
      if (!it) return '';
      const isUnavail = it.stub && it.reason.includes('評価不能');
      const stubBadge = it.stub
        ? `<span class="ev-stub-badge">${isUnavail ? '評価不能' : '準備中'}</span>`
        : '';
      const starsCell = it.stub
        ? `<span class="ev-stars ev-stars-stub">－－－－－</span>`
        : `<span class="ev-stars">${it.stars}</span>`;
      return `<tr>
        <td class="ev-stars-cell">${starsCell}</td>
        <td class="ev-name-cell">${it.name}${stubBadge}</td>
      </tr>`;
    }

    // カテゴリーブロック
    const catHTML = CATEGORIES.map(cat => {
      const rows = cat.ids.map(id => _rowHTML(itemMap[id])).join('');
      return `<div class="ev-cat-header">${cat.label}</div>
        <table class="ev-table">${rows}</table>`;
    }).join('');

    // 欄外: 点線のみ・ヘッダーなし
    const outsideRows = OUTSIDE_IDS.map(id => _rowHTML(itemMap[id])).join('');
    const outsideHTML = outsideRows
      ? `<div class="ev-outside-divider"></div>
         <table class="ev-table ev-table-outside">${outsideRows}</table>`
      : '';

    // ── [DEV DEBUG START] ── 削除時はこのブロックごと消す ──
    const _devDebugHTML = (() => {
      const rows = items.map(it => {
        const scoreBar = '█'.repeat(Math.round(it._score)) + '░'.repeat(5 - Math.round(it._score));
        const extraRows = it._debug
          ? Object.entries(it._debug).map(([k, v]) =>
              `<tr><td class="ev-debug-key ev-debug-sub">　${k}</td><td class="ev-debug-val ev-debug-sub">${v}</td></tr>`
            ).join('')
          : '';
        return `<tr>
          <td class="ev-debug-key">${it.name}</td>
          <td class="ev-debug-val">${scoreBar} ${it._score.toFixed(1)}</td>
        </tr>${extraRows}`;
      }).join('');
      return `<div class="ev-debug-wrap">
        <button class="ev-debug-toggle"
          onclick="const b=this.nextElementSibling;const open=b.style.display!=='none';b.style.display=open?'none':'block';this.textContent=open?'▶ 🔧 DEBUGを開く':'▼ 🔧 DEBUGを閉じる'">
          ▶ 🔧 DEBUGを開く
        </button>
        <div class="ev-debug-body" style="display:none">
          <table class="ev-debug-table">${rows}</table>
        </div>
      </div>`;
    })();
    // ── [DEV DEBUG END] ────────────────────────────────────

    return `
      <div class="ev-popup">
        <div class="ev-title">🔍 砂金探索スコア</div>
        <div class="ev-minimap" data-lat="${lat}" data-lng="${lng}"></div>
        ${catHTML}
        ${outsideHTML}
        <!-- [DEV DEBUG START] -->${_devDebugHTML}<!-- [DEV DEBUG END] -->
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
        // DOM反映後にミニマップを初期化
        requestAnimationFrame(() => _initMinimap(lat, lng));
      }
    } catch {
      if (_evalPopup && map.hasLayer(_evalPopup)) {
        _evalPopup.setContent('<div class="ev-error">⚠ 評価に失敗しました</div>');
      }
    }
  }

  /**
   * ポップアップ内の .ev-minimap 要素にLeafletミニマップを初期化
   * 操作不可・固定表示
   */
  function _initMinimap(lat, lng) {
    const el = document.querySelector('.ev-minimap');
    if (!el || el._minimapInit) return;
    el._minimapInit = true;

    const mini = L.map(el, {
      center:             [lat, lng],
      zoom:               14,
      zoomControl:        false,
      attributionControl: false,
      dragging:           false,
      touchZoom:          false,
      scrollWheelZoom:    false,
      doubleClickZoom:    false,
      boxZoom:            false,
      keyboard:           false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(mini);

    // 中心に赤丸マーカー（CircleMarker）
    L.circleMarker([lat, lng], {
      radius:      6,
      color:       '#fff',
      weight:      2,
      fillColor:   '#e03030',
      fillOpacity: 1,
    }).addTo(mini);

    // ポップアップが閉じたらミニマップを破棄（メモリリーク防止）
    if (_evalPopup) {
      _evalPopup.once('remove', () => { try { mini.remove(); } catch (_) {} });
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
    mergeItems,         // 統合表示項目（外部から push() で追加可能）
    toggleEvalMode,     // index.html の onclick から呼ぶ
  };

})();

// グローバル公開（index.html の onclick="toggleEvalMode()" から直接呼べるように）
window.GoldEvaluator  = GoldEvaluator;
window.toggleEvalMode = GoldEvaluator.toggleEvalMode;