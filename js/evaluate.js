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
   * 最近傍wayのカーブに対して、指定座標が内側か外側かを判定
   * 内側 = 川が曲がる方向の内側（砂金が堆積しやすい）
   * 戻り値: 1=内側, -1=外側, 0=直線/不明
   */
  function _isInsideOfCurve(lat, lng, geometry) {
    if (!geometry || geometry.length < 3) return 0;

    // 最近傍ノードを探す
    let minD = Infinity, nearIdx = 1;
    for (let i = 1; i < geometry.length - 1; i++) {
      const d = haversine(lat, lng, geometry[i].lat, geometry[i].lon);
      if (d < minD) { minD = d; nearIdx = i; }
    }

    const p0 = geometry[nearIdx - 1];
    const p1 = geometry[nearIdx];
    const p2 = geometry[nearIdx + 1] ?? geometry[nearIdx];

    // p1における方向ベクトル
    const v1 = { dlat: p1.lat - p0.lat, dlng: p1.lon - p0.lon };
    const v2 = { dlat: p2.lat - p1.lat, dlng: p2.lon - p1.lon };

    // 外積のZ成分（2D）: 正=左カーブ、負=右カーブ
    const cross = v1.dlng * v2.dlat - v1.dlat * v2.dlng;
    if (Math.abs(cross) < 1e-12) return 0; // ほぼ直線

    // p1→現在地ベクトルとv1の外積で内外を判定
    const toPoint = { dlat: lat - p1.lat, dlng: lng - p1.lon };
    const side    = v1.dlng * toPoint.dlat - v1.dlat * toPoint.dlng;

    // 左カーブ(cross>0)の内側=右側(side<0)、右カーブ(cross<0)の内側=左側(side>0)
    if (cross > 0) return side < 0 ? 1 : -1;
    else           return side > 0 ? 1 : -1;
  }

  /**
   * wayのノード列から曲率スコアを計算
   * 前後ノード間の角度差の最大値を返す（度）
   */
  function _calcMaxCurvature(geometry) {
    if (!geometry || geometry.length < 3) return 0;
    let maxAngle = 0;
    for (let i = 1; i < geometry.length - 1; i++) {
      const p0 = geometry[i - 1], p1 = geometry[i], p2 = geometry[i + 1];
      const ax = p0.lon - p1.lon, ay = p0.lat - p1.lat;
      const bx = p2.lon - p1.lon, by = p2.lat - p1.lat;
      const dot  = ax * bx + ay * by;
      const magA = Math.sqrt(ax * ax + ay * ay);
      const magB = Math.sqrt(bx * bx + by * by);
      if (magA < 1e-10 || magB < 1e-10) continue;
      const cos   = Math.max(-1, Math.min(1, dot / (magA * magB)));
      const angle = Math.acos(cos) * (180 / Math.PI); // 直線=180°、直角=90°
      const bend  = 180 - angle; // 曲がり角度（大きいほど急カーブ）
      if (bend > maxAngle) maxAngle = bend;
    }
    return maxAngle;
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
        return { score, reason: `最寄り河川・沢まで約${Math.round(minD)}m` };
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
        };
      },
    },

    // 4. 河川湾曲
    {
      id: 'riverCurve', name: '河川湾曲', weight: 1.1,
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        const allWater = [...overpass.streams, ...overpass.rivers];
        if (!allWater.length) return { score: 1.5, reason: '半径3km以内に河川なし' };

        // 最近傍wayの曲率を評価
        let minD = Infinity, nearestWay = null;
        for (const way of allWater) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) { minD = d; nearestWay = way; }
        }
        if (!nearestWay) return { score: 1.5, reason: '河川形状データなし' };

        const maxBend = _calcMaxCurvature(nearestWay.geometry);
        let baseScore = maxBend >= 60 ? 5.0   // 急カーブ
                      : maxBend >= 30 ? 4.0   // 中カーブ
                      : maxBend >= 10 ? 3.0   // 緩やか
                      : 1.5;                  // ほぼ直線
        const curveLabel = maxBend >= 60 ? '急カーブ'
                         : maxBend >= 30 ? '緩やかな湾曲'
                         : '概ね直線';

        // 内側±補正: 20m以内なら+2.0、20m以上なら+1.0、外側-1.0
        let sideLabel = '';
        if (maxBend >= 10) {
          const side = _isInsideOfCurve(lat, lng, nearestWay.geometry);
          if (side === 1) {
            if (minD <= 20) { baseScore += 2.0; sideLabel = '・内側至近（堆積最有望）'; }
            else            { baseScore += 1.0; sideLabel = '・内側（堆積有望）'; }
          }
          if (side === -1) { baseScore -= 1.0; sideLabel = '・外側（堆積不利）'; }
        }

        return {
          score:  clamp5(baseScore),
          reason: `最近傍河川: ${curveLabel}${sideLabel}`,
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
        ctx.cache._scores = ctx.cache._scores || {};
        ctx.cache._scores.prospectDistance = score;
        return { score, reason: `最寄り鉱徴地まで約${(minD/1000).toFixed(1)}km` };
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
        return { score, reason: `川の勾配: 約${Math.round(gradient)}m/km` };
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
        return { score, reason: `標高: 約${Math.round(elev)}m` };
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
        return { score, reason: `最寄り一般道まで約${Math.round(minD)}m` };
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
        return { score, reason: `最寄り林道まで約${Math.round(minD)}m` };
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
        return { score, reason: `周辺地形の標高差: 約${Math.round(diff)}m` };
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
        return { score, reason: '標高・地形傾斜・道路距離から推定した到達しやすさ' };
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

    return `
      <div class="ev-popup">
        <div class="ev-title">🔍 砂金探索スコア</div>
        ${catHTML}
        ${outsideHTML}
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
    mergeItems,         // 統合表示項目（外部から push() で追加可能）
    toggleEvalMode,     // index.html の onclick から呼ぶ
  };

})();

// グローバル公開（index.html の onclick="toggleEvalMode()" から直接呼べるように）
window.GoldEvaluator  = GoldEvaluator;
window.toggleEvalMode = GoldEvaluator.toggleEvalMode;