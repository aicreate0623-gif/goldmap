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
  const GSJ_LEGEND_API  = 'https://gbank.gsj.jp/seamless/v2/api/1.2/legend.json';
  const GSJ_GEO_TTL     = 60 * 60 * 1000; // 地質キャッシュ 1時間
  const OVERPASS_API    = 'https://overpass-api.de/api/interpreter';
  const OVERPASS_RADIUS = 3000;     // 地形・河川・道路評価の半径(m)
  const BEAR_RADIUS_M   = 40000;    // 熊評価の最大参照半径(m)
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
   * wayの最近傍ノードと距離を返す
   * @returns {{ node: {lat,lon}, dist: number }}
   */
  function _nearestNodeOfWay(lat, lng, geometry) {
    let minD = Infinity, nearNode = null;
    for (const pt of geometry) {
      const d = haversine(lat, lng, pt.lat, pt.lon);
      if (d < minD) { minD = d; nearNode = pt; }
    }
    return { node: nearNode, dist: minD };
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
   * wayのポリライン上で評価点Qに最も近いノードを p1(nearIdx) とし、
   * 曲率が続く限り前後にノードを拡張して実形状ポリゴンを生成、
   * レイキャスティング法で内外判定・堆積ゾーンを返す。
   *
   * アルゴリズム:
   *   1. 最近傍ノード nearIdx を特定
   *   2. nearIdx の局所曲がり方向（curvCross）を取得
   *      → S字ガード: sin(bend) < sin(10°) なら不明返却
   *   3. nearIdx を起点に前後へ bend >= 15° が続く間ノードを拡張
   *      → 拡張端が p0(上流端インデックス) / p2(下流端インデックス)
   *      → S字ガード: 拡張中に curvCross と逆符号の外積が出たら拡張停止
   *   4. 実ノード列 geo[p0..p2] + 弦(p2→p0) で閉じたポリゴンを生成
   *   5. レイキャスティング法で Q がポリゴン内か判定
   *   6. 内側確定時: 弦の中点 M と nearIdx ノードを結ぶ対角線でゾーン分割
   *      - Q が p2(下流)側半ポリゴン内 → zone:'large'（堆積核心帯）
   *      - Q が p0(上流)側半ポリゴン内 → zone:'small'（堆積帯）
   *
   * 戻り値: { side: 1=内側|-1=外側|0=不明, zone: 'large'|'small'|null }
   *   zone は side===1 のときのみ意味を持つ
   */
  /**
   * wayのポリライン上でカーブ頂点（最大曲率ノード）を基準に実形状ポリゴンを生成し、
   * レイキャスティング法で内外判定・堆積ゾーンを返す。
   *
   * 改定アルゴリズム概要:
   *
   *   ① カーブ頂点として hintIdx（最大曲率ノード）を使用
   *      旧来の「Qに最近傍のノード」ではなく、_calcCurvatureInfo で
   *      計算済みの maxBendIdx を受け取って使う。
   *      真のカーブ頂点 = 曲率最大点に基づいてゾーン分割するため精度向上。
   *
   *   ② 広域 bend 計算（適応ウィンドウ）による緩やかな大カーブ対策
   *      局所 sinBend < 0.174（bend < 10°）のとき、
   *      way の平均ノード間隔に応じたウィンドウ距離 W で前後のノードを収集し、
   *      前方向・後方向の平均ベクトルで broad_sinBend を計算する。
   *      broad_sinBend >= 0.174 なら通常ルートに合流（sinBend の代替）。
   *
   *      ウィンドウ距離 W の決定（密度適応）:
   *        平均ノード間隔 <= 10m → W = 100m
   *        平均ノード間隔 <= 30m → W = 70m
   *        平均ノード間隔 >  30m → W = 40m
   *        上限: way 全長の 20%
   *
   *   ③ ゾーン分割比率を曲率角度で可変化
   *      堆積核心帯（large）は「カーブを曲がり終えた直後の下流寄り」に偏る。
   *      maxBend が大きいほど核心帯が下流に集中するため、分割比率を変える:
   *        maxBend >= 60° → 下流 3/4 が large
   *        maxBend >= 30° → 下流 2/3 が large
   *        maxBend <  30° → 下流 1/2 が large（緩やか）
   *      分割基準点は p0→p2 間の累積実距離で計算（幾何的中点ではなく距離ベース）。
   *
   *   ④ 大局ベクトル（flowVec）による下流方向補正
   *      OSM way のノード順は上流→下流とは限らない。
   *      p0idx→p2idx の flowVec と surroundElevs 由来の最低標高方向を内積比較し、
   *      逆向きなら large/small の割り当てを反転させる。
   *
   *   ⑤ 外側判定: flowVec 法線ベース
   *      弦クロス判定を flowVec 法線方向に置き換え、斜めカーブでも正確に判定。
   *
   * @param {number}   lat           評価点の緯度
   * @param {number}   lng           評価点の経度
   * @param {Array}    geometry      Overpass way ノード列 [{lat, lon}, ...]
   * @param {Array}    surroundElevs 8方位標高配列（null 混在可）。全 null の場合は④スキップ
   * @param {number}   hintIdx       最大曲率ノードのインデックス（_calcCurvatureInfo の maxBendIdx）
   * @param {number}   wayLenM       way の全長(m)。②のウィンドウ上限計算に使用
   * @returns {{ side: 1|-1|0, zone: 'large'|'small'|null }}
   *   side  1=内側, -1=外側, 0=不明
   *   zone  side===1 のときのみ意味を持つ
   */
  function _isInsideOfCurve(lat, lng, geometry, surroundElevs, hintIdx, wayLenM) {
    const NONE = { side: 0, zone: null };
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

    // レイキャスティング法: ポリゴン頂点列(pts)に対してQが内側かを判定
    function raycast(pts) {
      let inside = false;
      const n = pts.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = pts[i].x, yi = pts[i].y;
        const xj = pts[j].x, yj = pts[j].y;
        const intersect = ((yi > Q.y) !== (yj > Q.y))
          && (Q.x < (xj - xi) * (Q.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    // 2Dベクトル外積
    function cross2d(ax, ay, bx, by) { return ax * by - ay * bx; }

    // ── ① カーブ頂点インデックスの決定 ──────────────────────
    // hintIdx（maxBendIdx）を優先。範囲外なら最近傍ノードにフォールバック。
    let peakIdx;
    if (hintIdx !== undefined && hintIdx >= 1 && hintIdx <= geometry.length - 2) {
      peakIdx = hintIdx;
    } else {
      peakIdx = 1;
      let nearD = Infinity;
      for (let i = 1; i < geometry.length - 1; i++) {
        const m = toM(geometry[i]);
        const dx = Q.x - m.x, dy = Q.y - m.y;
        const d  = dx * dx + dy * dy;
        if (d < nearD) { nearD = d; peakIdx = i; }
      }
    }

    // ── 局所曲がり方向（peakIdx 基準）────────────────────────
    const Pm = toM(geometry[peakIdx]);
    const Pp = toM(geometry[peakIdx - 1]);
    const Pn = toM(geometry[peakIdx + 1]);
    const v01x = Pm.x - Pp.x, v01y = Pm.y - Pp.y;
    const v12x = Pn.x - Pm.x, v12y = Pn.y - Pm.y;
    const curvCross = v01x * v12y - v01y * v12x;

    const magV01 = Math.sqrt(v01x * v01x + v01y * v01y);
    const magV12 = Math.sqrt(v12x * v12x + v12y * v12y);
    if (magV01 < 1e-3 || magV12 < 1e-3) return NONE;
    let sinBend = Math.abs(curvCross) / (magV01 * magV12);

    // ── ② 広域 bend 計算（適応ウィンドウ）───────────────────
    // 局所 sinBend が低い（ほぼ直線に見える）場合、
    // ノード密度に応じたウィンドウ距離 W で前後のノードを収集し
    // 平均ベクトルで broad_sinBend を再計算する。
    // broad_sinBend が閾値以上なら sinBend を上書きして通常ルートへ進む。
    let broadCurvCross = curvCross; // ② で更新される場合がある
    if (sinBend < 0.174) {
      const n       = geometry.length;
      const avgSpan = wayLenM > 0 ? wayLenM / Math.max(n - 1, 1) : 20;
      // 平均ノード間隔によるウィンドウ距離 W（m）
      const wBase = avgSpan <= 10 ? 100 : avgSpan <= 30 ? 70 : 40;
      const wMax  = wayLenM * 0.20; // 全長の20%上限
      const W     = Math.max(Math.min(wBase, wMax), 30); // 最低30mは確保

      // peakIdx から後方（上流方向）へ W m以内のノードを収集 → 前方向ベクトルの基点
      let accumBack = 0;
      let backIdx   = peakIdx;
      for (let i = peakIdx - 1; i >= 0; i--) {
        const seg = haversine(
          geometry[i].lat, geometry[i].lon,
          geometry[i + 1].lat, geometry[i + 1].lon,
        );
        accumBack += seg;
        if (accumBack > W) break;
        backIdx = i;
      }

      // peakIdx から前方（下流方向）へ W m以内のノードを収集 → 後方向ベクトルの基点
      let accumFwd = 0;
      let fwdIdx   = peakIdx;
      for (let i = peakIdx + 1; i < n; i++) {
        const seg = haversine(
          geometry[i - 1].lat, geometry[i - 1].lon,
          geometry[i].lat, geometry[i].lon,
        );
        accumFwd += seg;
        if (accumFwd > W) break;
        fwdIdx = i;
      }

      if (backIdx < peakIdx && fwdIdx > peakIdx) {
        // 前方向ベクトル: backIdx → peakIdx の平均
        const bkM = toM(geometry[backIdx]);
        const pkM = toM(geometry[peakIdx]);
        const fwM = toM(geometry[fwdIdx]);
        const bvx = pkM.x - bkM.x, bvy = pkM.y - bkM.y; // 上流→頂点
        const fvx = fwM.x - pkM.x, fvy = fwM.y - pkM.y; // 頂点→下流
        const mbv = Math.sqrt(bvx * bvx + bvy * bvy);
        const mfv = Math.sqrt(fvx * fvx + fvy * fvy);
        if (mbv > 1e-3 && mfv > 1e-3) {
          broadCurvCross = bvx * fvy - bvy * fvx;
          const broadSin = Math.abs(broadCurvCross) / (mbv * mfv);
          if (broadSin >= 0.174) sinBend = broadSin; // 通常ルートへ合流
        }
      }
    }

    // 広域計算でも bend 不十分 → 不明返却
    if (sinBend < 0.174) return NONE;

    // ② で broadCurvCross を使う場合も考慮した curvSign
    const effectiveCurvCross = Math.abs(broadCurvCross) > Math.abs(curvCross)
      ? broadCurvCross : curvCross;
    const curvSign = Math.sign(effectiveCurvCross); // +1=左カーブ, -1=右カーブ

    // ── 3. 曲率が続く間ノードを前後に拡張 ───────────────────
    const BEND_THR = 15;

    function nodeBend(i) {
      if (i <= 0 || i >= geometry.length - 1) return { bend: 0, sign: 0 };
      const a = toM(geometry[i - 1]), b = toM(geometry[i]), c = toM(geometry[i + 1]);
      const ax = a.x - b.x, ay = a.y - b.y;
      const cx = c.x - b.x, cy = c.y - b.y;
      const dot  = ax * cx + ay * cy;
      const magA = Math.sqrt(ax * ax + ay * ay);
      const magC = Math.sqrt(cx * cx + cy * cy);
      if (magA < 1e-3 || magC < 1e-3) return { bend: 0, sign: 0 };
      const cosA = Math.max(-1, Math.min(1, dot / (magA * magC)));
      const bend = 180 - Math.acos(cosA) * (180 / Math.PI);
      const cr   = cross2d(ax, ay, cx, cy);
      return { bend, sign: -Math.sign(cr) };
    }

    let p0idx = peakIdx;
    for (let i = peakIdx - 1; i >= 1; i--) {
      const { bend, sign } = nodeBend(i);
      if (bend < BEND_THR || (sign !== 0 && sign !== curvSign)) break;
      p0idx = i;
    }
    let p2idx = peakIdx;
    for (let i = peakIdx + 1; i <= geometry.length - 2; i++) {
      const { bend, sign } = nodeBend(i);
      if (bend < BEND_THR || (sign !== 0 && sign !== curvSign)) break;
      p2idx = i;
    }

    const P0m = toM(geometry[p0idx]);
    const P2m = toM(geometry[p2idx]);

    // ── 大局ベクトル（flowVec）────────────────────────────────
    const flowX   = P2m.x - P0m.x;
    const flowY   = P2m.y - P0m.y;
    const flowMag = Math.sqrt(flowX * flowX + flowY * flowY);

    // ── ④ surroundElevs で実下流方向を確認し p2isDownstream を補正 ──
    let p2isDownstream = true;
    if (surroundElevs && surroundElevs.some(e => e !== null) && flowMag > 1e-3) {
      const d = 0.003;
      const offsets = [
        [+d,  0], [+d, +d], [ 0, +d], [-d, +d],
        [-d,  0], [-d, -d], [ 0, -d], [+d, -d],
      ];
      let minElev = Infinity, minElevIdx = -1;
      for (let i = 0; i < surroundElevs.length; i++) {
        if (surroundElevs[i] !== null && surroundElevs[i] < minElev) {
          minElev = surroundElevs[i]; minElevIdx = i;
        }
      }
      if (minElevIdx >= 0) {
        const elevDx = offsets[minElevIdx][1] * cosLat * 111000;
        const elevDy = offsets[minElevIdx][0]           * 111000;
        if (flowX * elevDx + flowY * elevDy < 0) p2isDownstream = false;
      }
    }

    // ── 4. ポリゴン生成 ──────────────────────────────────────
    const polyPts = [];
    for (let i = p0idx; i <= p2idx; i++) polyPts.push(toM(geometry[i]));

    // ── 5. レイキャスティングで内外判定 ─────────────────────
    const isInside = raycast(polyPts);

    if (!isInside) {
      // ── ⑤ 外側判定: flowVec 法線ベース ──────────────────────
      if (flowMag < 1e-3) {
        // 縮退フォールバック: 旧来の弦クロス
        const toQx      = Q.x - P0m.x, toQy = Q.y - P0m.y;
        const chordCross = cross2d(flowX, flowY, toQx, toQy);
        const onRiverSide = (curvSign > 0) ? (chordCross < 0) : (chordCross > 0);
        return onRiverSide ? { side: -1, zone: null } : NONE;
      }
      const toQx      = Q.x - P0m.x;
      const toQy      = Q.y - P0m.y;
      const flowCross = cross2d(flowX, flowY, toQx, toQy);
      const onRiverSide = (curvSign > 0) ? (flowCross < 0) : (flowCross > 0);
      return onRiverSide ? { side: -1, zone: null } : NONE;
    }

    // ── 6. 堆積ゾーン判定 ────────────────────────────────────
    // ③ 曲率角度に応じて分割比率を可変化
    //   急カーブほど堆積核心（large）が下流寄りに集中するため、
    //   large ゾーンの割合を maxBend に応じて広げる。
    //
    //   分割基準点 splitPt は p0idx→p2idx 間の累積距離ベースで決定。
    //   large = splitPt より下流側（全長の後ろ largeFrac 分）
    //   small = splitPt より上流側

    // peakIdx での局所 bend 角（nodeBend は (a-b)×(c-b) 基準なので _calcCurvatureInfo と同値）
    const peakBend = (() => {
      const nb = nodeBend(peakIdx);
      return nb.bend;
    })();

    const largeFrac = peakBend >= 60 ? 3 / 4   // 急カーブ: 下流3/4がlarge
                    : peakBend >= 30 ? 2 / 3   // 標準: 下流2/3がlarge
                    :                  1 / 2;  // 緩やか: 下流1/2がlarge

    // p0idx → p2idx の累積距離を計算し、splitPt を実距離で決定
    const downstreamIdx = p2isDownstream ? p2idx : p0idx;
    const upstreamIdx   = p2isDownstream ? p0idx : p2idx;
    const startIdx      = Math.min(downstreamIdx, upstreamIdx);
    const endIdx        = Math.max(downstreamIdx, upstreamIdx);

    // 上流端→下流端の累積距離配列を構築
    const cumDist = [0];
    for (let i = startIdx + 1; i <= endIdx; i++) {
      cumDist.push(cumDist[cumDist.length - 1] +
        haversine(geometry[i-1].lat, geometry[i-1].lon,
                  geometry[i].lat,   geometry[i].lon));
    }
    const totalLen = cumDist[cumDist.length - 1];

    // large ゾーンは下流端から largeFrac の距離 = 上流端からの距離 (1-largeFrac)*totalLen
    const splitDist = (1 - largeFrac) * totalLen;

    // splitDist に最も近いインデックスを分割点とする
    let splitOffset = 0;
    for (let k = 0; k < cumDist.length - 1; k++) {
      if (cumDist[k] <= splitDist && splitDist <= cumDist[k + 1]) {
        splitOffset = k; break;
      }
      splitOffset = k;
    }
    const splitIdx = startIdx + splitOffset; // 上流端基準の実インデックス

    // peakIdx が含まれるゾーンを決定して small/large ポリゴンを構築
    // large: splitIdx → downstreamIdx（下流側）
    // small: upstreamIdx → splitIdx（上流側）
    // どちらも splitIdx を共有頂点として raycast で判定

    const splitPtM = toM(geometry[splitIdx]);

    const largePoly = [];
    if (p2isDownstream) {
      for (let i = splitIdx; i <= p2idx; i++) largePoly.push(toM(geometry[i]));
    } else {
      for (let i = splitIdx; i >= p2idx; i--) largePoly.push(toM(geometry[i]));
    }
    largePoly.push(splitPtM); // 閉じ（raycast が自動閉じするが明示も問題なし）

    const smallPoly = [];
    if (p2isDownstream) {
      for (let i = p0idx; i <= splitIdx; i++) smallPoly.push(toM(geometry[i]));
    } else {
      for (let i = p0idx; i >= splitIdx; i--) smallPoly.push(toM(geometry[i]));
    }
    smallPoly.push(splitPtM);

    if (raycast(largePoly)) return { side: 1, zone: 'large' };
    if (raycast(smallPoly)) return { side: 1, zone: 'small' };

    return { side: 1, zone: null };
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
      const cosLat = Math.cos(p1.lat * Math.PI / 180);
      const ax = (p0.lon - p1.lon) * cosLat, ay = p0.lat - p1.lat;
      const bx = (p2.lon - p1.lon) * cosLat, by = p2.lat - p1.lat;
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
  const _geoCache      = new Map();
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

  /**
   * GSJ シームレス地質図V2 API で3km範囲の地質情報を取得
   *
   * ① box= で範囲内の全岩種リストを1回取得（多様性・キーワード評価）
   * ② point= で中心＋外周12点を13並列取得（境界ペア数評価）
   *
   * 戻り値:
   *   {
   *     boxItems:      凡例オブジェクト配列（box取得結果）
   *     pointSymbols:  13点のsymbol配列（nullあり）
   *     groups:        ユニークgroup_ja Set
   *     lithologies:   ユニークlithology_ja Set
   *     boundaryCount: 隣接点間でsymbolが異なるペア数
   *   }
   *   取得失敗時は null
   */
  async function _fetchGsjGeology(lat, lng) {
    const k   = _key(lat, lng);
    const now = Date.now();
    const hit = _geoCache.get(k);
    if (hit && now - hit.at < GSJ_GEO_TTL) return hit.data;

    // 約3km = 緯度方向0.027度、経度方向は緯度補正
    const D_LAT = 0.027;
    const D_LNG = 0.027 / Math.cos(lat * Math.PI / 180);

    // ── ① box= 範囲取得 ────────────────────────────────────
    const boxUrl = `${GSJ_LEGEND_API}?box=${(lat - D_LAT).toFixed(5)},${(lng - D_LNG).toFixed(5)},${(lat + D_LAT).toFixed(5)},${(lng + D_LNG).toFixed(5)}`;
    let boxItems = [];
    try {
      const res = await fetch(boxUrl);
      if (res.ok) {
        const json = await res.json();
        boxItems = Array.isArray(json) ? json : (json ? [json] : []);
      }
    } catch { /* boxItems空のまま続行 */ }

    // ── ② point= 13点並列取得 ───────────────────────────────
    // 中心(0,0) + 外周12点（4方位×3距離）
    const D1 = 0.009, D2 = 0.018, D3 = 0.027; // 約1km/2km/3km
    const samplePts = [
      [lat,        lng       ],  // 中心
      [lat + D1,   lng       ], [lat - D1,   lng       ],
      [lat,        lng + D1  ], [lat,        lng - D1  ],
      [lat + D2,   lng       ], [lat - D2,   lng       ],
      [lat,        lng + D2  ], [lat,        lng - D2  ],
      [lat + D3,   lng       ], [lat - D3,   lng       ],
      [lat,        lng + D3  ], [lat,        lng - D3  ],
    ];

    const pointResults = await Promise.all(
      samplePts.map(async ([la, lo]) => {
        try {
          const res = await fetch(`${GSJ_LEGEND_API}?point=${la.toFixed(5)},${lo.toFixed(5)}`);
          if (!res.ok) return null;
          const json = await res.json();
          // point指定は単独オブジェクト or 空オブジェクト返却
          return (json && json.symbol) ? json : null;
        } catch { return null; }
      })
    );

    const pointSymbols = pointResults.map(r => r?.symbol ?? null);

    // ── 集計 ───────────────────────────────────────────────
    const groups      = new Set(boxItems.map(i => i.group_ja).filter(Boolean));
    const lithologies = new Set(boxItems.map(i => i.lithology_ja).filter(Boolean));

    // 隣接ペア判定（中心→外周各点、隣接インデックス間）
    // インデックス順: [0]=中心, [1〜4]=1km4方位, [5〜8]=2km4方位, [9〜12]=3km4方位
    // 隣接ペア: 中心と1km4点、1km各点と対応する2km点、2km各点と対応する3km点
    const adjPairs = [
      [0,1],[0,2],[0,3],[0,4],   // 中心 ↔ 1km
      [1,5],[2,6],[3,7],[4,8],   // 1km ↔ 2km
      [5,9],[6,10],[7,11],[8,12], // 2km ↔ 3km
    ];
    let boundaryCount = 0;
    for (const [a, b] of adjPairs) {
      const sa = pointSymbols[a], sb = pointSymbols[b];
      if (sa && sb && sa !== sb) boundaryCount++;
    }

    const centerItem = pointResults[0] ?? null;

    const data = { boxItems, pointSymbols, pointResults, centerItem, groups, lithologies, boundaryCount };
    _geoCache.set(k, { data, at: now });
    return data;
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
  way["landuse"="forest"](around:${OVERPASS_RADIUS},${lat},${lng});
  way["natural"="wood"](around:${OVERPASS_RADIUS},${lat},${lng});
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
        forests: ways.filter(w => w.tags?.landuse === 'forest' || w.tags?.natural === 'wood'),
      };

      _overpassCache.set(k, { data, at: now });
      return data;
    } catch {
      return { streams: [], rivers: [], roads: [], tracks: [], forests: [] };
    }
  }

  // ─────────────────────────────────────────────────────────
  // context ビルダー
  // ─────────────────────────────────────────────────────────
  async function _buildContext(input) {
    const { lat, lng, zoom = 13 } = input;
    const [elev, surroundElevs, bears, posts, gsjData, overpass, geoData] = await Promise.all([
      _fetchElev(lat, lng),
      _fetchSurroundElev(lat, lng),
      _fetchBears(),
      _fetchPosts(lat, lng),
      (typeof loadGsjMineData === 'function')
        ? loadGsjMineData().catch(() => [])
        : Promise.resolve(window.GSJ_MINE_DATA_CACHED || []),
      _fetchOverpass(lat, lng),
      _fetchGsjGeology(lat, lng),
    ]);
    if (gsjData.length) window.GSJ_MINE_DATA_CACHED = gsjData;
    return {
      lat, lng, zoom,
      terrain:     { elev, surroundElevs },
      geology:     geoData,
      overpass,
      deposits:    (gsjData || []).filter(d => !d.trace),
      prospects:   (gsjData || []).filter(d =>  d.trace),
      auag:        (gsjData || []).filter(d => d.mat === 'Au_Ag'), // Au_Ag専用
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

    // 1. 沢距離（streams専用: canal/ditch含む、riverは含まない）
    {
      id: 'streamDistance', name: '沢距離', weight: 1.4,
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        const streams = overpass.streams || [];
        if (!streams.length) return { score: 1.5, reason: '半径3km以内に沢なし' };

        let minD = Infinity;
        for (const way of streams) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) minD = d;
        }
        if (!isFinite(minD)) return { score: 1.5, reason: '沢データ不完全' };

        ctx.cache.nearestStreamM = minD;
        // 5m刻み・30m超で0点（実採掘対象は川岸30mまで）
        const score = minD <= 10 ? 5.0   // 10m以内（最高）
                    : minD <= 15 ? 4.0   // 15m以内
                    : minD <= 20 ? 3.0   // 20m以内
                    : minD <= 25 ? 2.0   // 25m以内
                    : minD <= 30 ? 1.0   // 30m以内
                    : 0;                 // 30m超
        ctx.cache._scores = ctx.cache._scores || {};
        ctx.cache._scores.streamDistance = score;
        return {
          score,
          reason: `最寄り沢まで約${Math.round(minD)}m`,
          _debug: {
            '最近傍沢距離': `${Math.round(minD)}m`,
            '沢本数':       `${streams.length}本（半径3km）`,
          },
        };
      },
    },

    // 2. 河川距離
    {
      id: 'riverDistance', name: '河川距離', weight: 1.1,
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        const rivers = overpass.rivers || [];
        if (!rivers.length) return { score: 1.5, reason: '半径3km以内に河川なし' };

        let minD = Infinity;
        for (const way of rivers) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) minD = d;
        }
        if (!isFinite(minD)) return { score: 1.5, reason: '河川データ不完全（形状情報なし）' };

        ctx.cache.nearestRiverM = minD;
        // 沢距離と同じ閾値（将来的に河川向けに調整可能）
        const score = minD <= 10 ? 5.0
                    : minD <= 15 ? 4.0
                    : minD <= 20 ? 3.0
                    : minD <= 25 ? 2.0
                    : minD <= 30 ? 1.0
                    : 0;
        ctx.cache._scores = ctx.cache._scores || {};
        ctx.cache._scores.riverDistance = score;
        return {
          score,
          reason: `最寄り河川まで約${Math.round(minD)}m`,
          _debug: {
            '最近傍河川距離': `${Math.round(minD)}m`,
            '河川本数':       `${rivers.length}本（半径3km）`,
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
        if (!allWater.length) return { score: 1.0, reason: '半径3km以内に水系なし' };

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
      id: 'riverCurve', name: '河川湾曲', weight: 1.5,
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        const allWater = [...overpass.streams, ...overpass.rivers];
        if (!allWater.length) return { score: 1.5, reason: '半径3km以内に水系なし' };

        // 最近傍wayを特定（1本のみ対象）
        let minD = Infinity, nearestWay = null;
        for (const way of allWater) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d < minD) { minD = d; nearestWay = way; }
        }
        if (!nearestWay) return { score: 1.5, reason: '河川形状データなし' };

        // 川が遠すぎる場合は湾曲の恩恵なし
        if (minD > 50) {
          return { score: 1.0, reason: `最近傍水系まで約${Math.round(minD)}m（湾曲の恩恵圏外）` };
        }

        // ── 湾曲密度ボーナス（ノード密度非依存）──────────────
        // way全体の実距離(m)を計算し、有意湾曲数(>=15°)を割って密度化
        const geo = nearestWay.geometry;
        let wayLenM = 0;
        for (let i = 1; i < geo.length; i++) {
          wayLenM += haversine(geo[i-1].lat, geo[i-1].lon, geo[i].lat, geo[i].lon);
        }
        const wayLenKm = Math.max(wayLenM / 1000, 0.01);
        const { bendCount, maxBendIdx } = _calcCurvatureInfo(geo); // 閾値15°は_calcCurvatureInfo側で設定済み
        const bendDensity = bendCount / wayLenKm; // 湾曲数/km

        const densityBonus = bendDensity >= 3.0 ? 1.0   // 蛇行（S字複合）
                           : bendDensity >= 1.5 ? 0.5   // 複数湾曲
                           : bendDensity >= 0.5 ? 0.2   // 緩い湾曲あり
                           : 0;
        const densityLabel = bendDensity >= 3.0 ? `・蛇行(${bendDensity.toFixed(1)}/km)`
                           : bendDensity >= 1.5 ? `・複数湾曲(${bendDensity.toFixed(1)}/km)`
                           : bendDensity >= 0.5 ? `・湾曲あり(${bendDensity.toFixed(1)}/km)`
                           : '';

        // ── ① カーブ頂点 = 最大曲率ノード（maxBendIdx）────────
        // nearIdx（Qに最近傍のノード）ではなく、曲率最大点を基準にする。
        const peakIdx = (maxBendIdx >= 1 && maxBendIdx <= geo.length - 2)
          ? maxBendIdx : 1;

        // ── 角度計算（緯度補正付き）────────────────────────────
        // 経度差を cos(lat) × 111000 でメートル換算して正確な角度を算出
        const p0 = geo[peakIdx - 1], p1 = geo[peakIdx], p2 = geo[peakIdx + 1] ?? geo[peakIdx];
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
        let baseScore = localBend >= 50 ? 3.5   // 急カーブ（湾曲強）
                      : localBend >= 30 ? 2.5   // 明確な湾曲
                      : localBend >= 15 ? 1.5   // 緩やか
                      : 1.0;                    // ほぼ直線（足切り）

        const curveLabel = localBend >= 50 ? '急カーブ（内外判定で加点）'
                         : localBend >= 30 ? '明確な湾曲（内外判定で加点）'
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
        let zone       = null; // _debug参照のためif外で宣言

        if (localBend >= 15) {
          const { side, zone: _zone } = _isInsideOfCurve(
            lat, lng, geo, ctx.terrain.surroundElevs, peakIdx, wayLenM,
          );
          zone = _zone;
          const decay = Math.max(0, 1 - minD / SIDE_RANGE); // 距離減衰係数 0〜1

          if (side === 1) {
            // 内側: 最大+2.0、距離に応じて線形減衰
            sideScore = 2.0 * decay;
            if      (decay > 0.75) sideLabel = '・内側至近（堆積最有望）';
            else if (decay > 0.37) sideLabel = '・内側（堆積有望）';
            else if (decay > 0)    sideLabel = '・内側（やや有望）';

            // ゾーン加点:
            //   large（p1〜p2/M寄り＝淀みの核心）→ 最大+0.8
            //   small（M〜p0寄り＝減速途中）      → 最大+0.4
            //   どちらでもない                     → 加点なし
            if (zone === 'large') {
              upstScore = 0.8 * decay;
              upstLabel = '・堆積核心帯（加点大）';
            } else if (zone === 'small') {
              upstScore = 0.4 * decay;
              upstLabel = '・堆積帯（加点小）';
            }
          } else if (side === -1) {
            // 外側: 最大−1.5、距離に応じて線形減衰
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
            'ノードIdx':      `peakIdx=${peakIdx} / ${geo.length - 1}`,
            '最近傍曲率':     `${localBend.toFixed(1)}°（緯度補正済）`,
            '湾曲密度':       `${bendDensity.toFixed(1)}/km (${bendCount}箇所/${wayLenKm.toFixed(1)}km)`,
            '内外判定':       sideScore > 0 ? `内側` : sideScore < 0 ? `外側` : '直線/不明/S字除外',
            '堆積ゾーン':     zone === 'large' ? '核心帯(大)' : zone === 'small' ? '堆積帯(小)' : 'なし',
            '距離減衰':       `${(Math.max(0, 1 - minD / SIDE_RANGE) * 100).toFixed(0)}%`,
            'ベース':         baseScore.toFixed(1),
            '密度ボーナス':   `+${densityBonus.toFixed(1)}`,
            '内外補正':       `${sideScore >= 0 ? '+' : ''}${sideScore.toFixed(2)}`,
            'ゾーン補正':     `+${upstScore.toFixed(2)}`,
          },
        };
      },
    },

    // 5b. Au_Ag密度（鉱物資源DBのAu_Ag件数・scale重み付き）
    {
      id: 'auDensity', name: 'Au/Ag産地密度', weight: 1.4,
      evaluate(ctx) {
        const { lat, lng, auag } = ctx;
        if (!auag || !auag.length) {
          return { score: STUB_SCORE, reason: 'Au/Agデータ読み込み中（準備中）' };
        }

        // scale重み: 精度が高いほど重み大
        const SCALE_WEIGHT = { 50: 1.0, 200: 0.25, 500: 0.1 };
        const RADIUS_M = 30000; // 半径30km

        // 半径30km以内のAu_Agを加重カウント
        let weightedCount = 0;
        let rawCount = 0;
        for (const d of auag) {
          const dist = haversine(lat, lng, d.lat, d.lng);
          if (dist <= RADIUS_M) {
            const w = SCALE_WEIGHT[d.scale] ?? 0.25;
            weightedCount += w;
            rawCount++;
          }
        }

        const score = weightedCount >= 20 ? 5.0
                    : weightedCount >= 10 ? 4.0
                    : weightedCount >= 5  ? 3.0
                    : weightedCount >= 2  ? 2.0
                    : weightedCount >= 1  ? 1.5
                    : 1.0;

        // geology加点をキャッシュ（geology評価側で参照）
        ctx.cache.auDensityScore = score;

        return {
          score,
          reason: `半径30km内Au/Ag産地: 加重${weightedCount.toFixed(1)}件（実${rawCount}件）`,
          _debug: {
            '実件数':   `${rawCount}件（半径30km）`,
            '加重件数': `${weightedCount.toFixed(2)}`,
            'スコア':   score.toFixed(1),
          },
        };
      },
    },

    // 5. 地質（GSJ シームレス地質図V2 API）
    {
      id: 'geology', name: '地質', weight: 1.6,
      evaluate(ctx) {
        const geo = ctx.geology;
        if (!geo) return { score: STUB_SCORE, reason: '地質データ取得待ち（準備中）' };

        const { boxItems, pointResults, centerItem, groups, lithologies, boundaryCount } = geo;

        if (!centerItem) {
          return { score: STUB_SCORE, reason: '地質データなし（海域・未整備区域）' };
        }

        // ── ベーススコア: 評価座標直下（centerItem）の岩種で決定 ──
        const g   = centerItem.group_ja        || '';
        const age = centerItem.formationAge_ja || '';
        const ageShort = age.split(' ')[1] || age;

        let baseScore, bestLabel;

        if (g === '火成岩') {
          if (/白亜紀|古第三紀|新第三紀/.test(age)) {
            baseScore = 3.5; bestLabel = `火成岩（${ageShort}）★`;
          } else {
            baseScore = 2.0; bestLabel = `火成岩（${ageShort}）`;
          }
        } else if (g === '変成岩') {
          if (/白亜紀/.test(age)) {
            baseScore = 3.5; bestLabel = `変成岩（白亜紀）★`;
          } else if (/ジュラ紀|先ジュラ|古生代|カンブリア|オルドビス|シルル|デボン|石炭|二畳|三畳/.test(age)) {
            baseScore = 3.0; bestLabel = `変成岩（古生代〜ジュラ紀）`;
          } else {
            baseScore = 2.0; bestLabel = `変成岩`;
          }
        } else if (g === '堆積岩') {
          if (/第四紀/.test(age)) {
            baseScore = 3.0; bestLabel = `堆積岩（第四紀）★`;
          } else {
            baseScore = 1.5; bestLabel = `堆積岩（${ageShort}）`;
          }
        } else if (g === '付加体') {
          baseScore = 2.0; bestLabel = `付加体`;
        } else {
          baseScore = 1.0; bestLabel = g || '不明';
        }

        // ── lithology_ja 減点（13点割合方式）: ベーススコアに適用 ──
        // 有効ポイント数（nullでないもの）を分母にして割合を計算
        const validPts  = (pointResults || []).filter(r => r !== null);
        const totalPts  = validPts.length || 1; // ゼロ除算防止

        const hitA = validPts.filter(r => /チャート|石灰岩|泥岩|頁岩/.test(r.lithology_ja || '')).length;
        const hitB = validPts.filter(r => /玄武岩|苦鉄質|超苦鉄質/.test(r.lithology_ja || '')).length;

        const ratioA = hitA / totalPts; // 0〜1
        const ratioB = hitB / totalPts; // 0〜1

        // 最大減点: チャート等 −1.0 / 玄武岩等 −0.6
        const penaltyA = ratioA * -1.0;
        const penaltyB = ratioB * -0.6;
        const litPenalty = penaltyA + penaltyB;

        // 減点後ベーススコア（最低0.5にclamp）
        baseScore = Math.max(0.5, baseScore + litPenalty);

        const litPenaltyLabels = [];
        if (hitA > 0) litPenaltyLabels.push(`チャート等${hitA}/${totalPts}点（${penaltyA.toFixed(2)}）`);
        if (hitB > 0) litPenaltyLabels.push(`玄武岩等${hitB}/${totalPts}点（${penaltyB.toFixed(2)}）`);

        // ── 加点ボーナス（box範囲の全岩種から）──
        const litAll = [...lithologies].join(' ');
        let litBonus = 0;
        const litLabels = [];

        if (/花崗岩|花崗閃緑岩|トーナル岩/.test(litAll)) {
          litBonus += 0.5; litLabels.push('花崗岩類');
        }
        if (/蛇紋岩|かんらん岩/.test(litAll)) {
          litBonus += 0.3; litLabels.push('蛇紋岩・かんらん岩');
        }
        if (/石英|熱水/.test(litAll)) {
          litBonus += 0.3; litLabels.push('石英・熱水系');
        }

        // group多様性ボーナス（最大+0.4）
        const groupCount = groups.size;
        const divBonus = groupCount >= 3 ? 0.4
                       : groupCount >= 2 ? 0.2
                       : 0;
        if (divBonus > 0) litLabels.push(`多様性(${groupCount}種)`);

        // ── 境界ペアボーナス（最大+0.8）──
        const boundBonus = boundaryCount >= 5 ? 0.8
                         : boundaryCount >= 3 ? 0.5
                         : boundaryCount >= 1 ? 0.2
                         : 0;

        // ── Au/Ag密度ボーナス（auDensityが先に評価済みの場合のみ適用）──
        const auScore    = ctx.cache.auDensityScore ?? 0;
        const auBonus    = auScore >= 5.0 ? 1.0
                         : auScore >= 4.0 ? 0.7
                         : auScore >= 3.0 ? 0.5
                         : auScore >= 2.0 ? 0.2
                         : 0;

        const total = clamp5(baseScore + litBonus + divBonus + boundBonus + auBonus);

        const reasonParts = [bestLabel];
        if (litPenaltyLabels.length) reasonParts.push(`減点: ${litPenaltyLabels.join('・')}`);
        if (litLabels.length) reasonParts.push(litLabels.join('・'));
        if (boundaryCount > 0) reasonParts.push(`地質境界${boundaryCount}箇所`);
        if (auBonus > 0) reasonParts.push(`Au/Ag密度加点+${auBonus.toFixed(1)}`);

        return {
          score:  total,
          reason: reasonParts.join(' / '),
          _debug: {
            '中心点岩種':           `${g}（${ageShort}）`,
            '中心点岩相':           centerItem.lithology_ja || '—',
            'ベーススコア(減点前)': `${(baseScore - litPenalty).toFixed(2)}（${bestLabel}）`,
            '有効サンプル数':       `${totalPts}/13点`,
            'チャート等ヒット':     `${hitA}点（割合${(ratioA*100).toFixed(0)}% → ${penaltyA.toFixed(2)}）`,
            '玄武岩等ヒット':       `${hitB}点（割合${(ratioB*100).toFixed(0)}% → ${penaltyB.toFixed(2)}）`,
            '減点合計':             `${litPenalty.toFixed(2)}`,
            'ベーススコア(減点後)': `${baseScore.toFixed(2)}`,
            '周辺多様性(box)':      `${groupCount}種・${boxItems.length}件`,
            'litボーナス':          `+${litBonus.toFixed(1)}`,
            '多様性ボーナス':       `+${divBonus.toFixed(1)}`,
            '境界ペア数':           `${boundaryCount}箇所 → +${boundBonus.toFixed(1)}`,
            'Au/Ag密度ボーナス':    `+${auBonus.toFixed(1)}（auDensity=${auScore.toFixed(1)}）`,
            '合計':                 total.toFixed(2),
          },
        };
      },
    },


    // 6. 鉱床距離
    {
      id: 'depositDistance', name: '鉱床距離', weight: 1.2,
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
      id: 'prospectDistance', name: '鉱徴地距離', weight: 1.1,
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
      id: 'riverSlope', name: '川傾斜', weight: 1.3,
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

        // 川が遠すぎる場合は傾斜の恩恵なし
        if (minD > 50) {
          return { score: 1.0, reason: `最近傍河川まで約${Math.round(minD)}m（川傾斜の恩恵圏外）` };
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

        const score = gradient < 5  ? 1.0   // ほぼ平坦（流速不足・堆積しにくい）
                    : gradient < 25 ? 5.0   // 緩〜中勾配（最適帯）
                    : gradient < 50 ? 4.0   // やや急
                    : gradient < 80 ? 3.0   // 急勾配
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
                    : depth < 2.5  ? 1.0   // ほぼ平坦（谷なし）
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
      id: 'roadDistance', name: '道路距離', weight: 0,
      // weight:0 = 集計スコアに影響しない（キャッシュ計算専用）
      // nearestRoadM   → bearActivity / accessDifficulty / accessibility / accessRoad が参照
      // nearestRoadNode → accessDifficulty / accessibility が参照
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        if (!overpass.roads.length) {
          ctx.cache.nearestRoadM    = Infinity;
          ctx.cache.nearestRoadNode = null;
          return {
            score: 0, reason: '半径3km以内に一般道なし（秘境）',
            _debug: {
              '最近傍一般道距離': 'なし',
              '一般道本数':       '0本（半径3km）',
              'キャッシュ用途':   'nearestRoadM → bearActivity / accessDifficulty / accessibility / accessRoad',
            },
          };
        }

        let minD = Infinity, nearRoadNode = null;
        for (const way of overpass.roads) {
          if (!way.geometry?.length) continue;
          const { node, dist } = _nearestNodeOfWay(lat, lng, way.geometry);
          if (dist < minD) { minD = dist; nearRoadNode = node; }
        }
        ctx.cache.nearestRoadM    = minD;
        ctx.cache.nearestRoadNode = nearRoadNode;

        const score = minD <= 100  ? 2.0
                    : minD <= 1000 ? 5.0
                    : minD <= 2000 ? 3.5
                    : 2.0;
        return {
          score,
          reason: `最寄り一般道まで約${Math.round(minD)}m`,
          _debug: {
            '最近傍一般道距離': `${Math.round(minD)}m`,
            '一般道本数':       `${overpass.roads.length}本（半径3km）`,
            'キャッシュ用途':   'nearestRoadM → bearActivity / accessDifficulty / accessibility / accessRoad',
          },
        };
      },
    },

    // 12. 林道距離
    {
      id: 'forestRoadDistance', name: '林道距離', weight: 0,
      // weight:0 = 集計スコアに影響しない（キャッシュ計算専用）
      // nearestTrackNode → accessDifficulty / accessibility / accessRoad が参照
      evaluate(ctx) {
        const { lat, lng, overpass } = ctx;
        if (!overpass.tracks.length) {
          ctx.cache.nearestTrackNode = null;
          return {
            score: 0, reason: '半径3km以内に林道なし',
            _debug: {
              '最近傍林道距離': 'なし',
              '林道本数':       '0本（半径3km）',
              'キャッシュ用途': 'nearestTrackNode → accessDifficulty / accessibility / accessRoad',
            },
          };
        }

        let minD = Infinity, nearTrackNode = null;
        for (const way of overpass.tracks) {
          if (!way.geometry?.length) continue;
          const { node, dist } = _nearestNodeOfWay(lat, lng, way.geometry);
          if (dist < minD) { minD = dist; nearTrackNode = node; }
        }
        ctx.cache.nearestTrackNode = nearTrackNode;

        const score = minD <= 200  ? 5.0
                    : minD <= 800  ? 4.0
                    : minD <= 1500 ? 3.0
                    : 2.0;
        return {
          score,
          reason: `最寄り林道まで約${Math.round(minD)}m`,
          _debug: {
            '最近傍林道距離': `${Math.round(minD)}m`,
            '林道本数':       `${overpass.tracks.length}本（半径3km）`,
            'キャッシュ用途': 'nearestTrackNode → accessDifficulty / accessibility / accessRoad',
          },
        };
      },
    },

    // 12b. 傾斜（地形傾斜 — 周辺8点の最大−最小標高差）
    {
      id: 'slope', name: '傾斜', weight: 0.0,
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

    // 13. 傾斜キャッシュ用（slope側で slopeDiff を ctx.cache に書き込む）
    // accessibility は mergeItems に移動（孤立・遭難リスク・逆スコア型）

    // 14a. 鉱床・鉱徴地との標高差
    {
      id: 'depositElevation', name: '鉱床標高差', weight: 1.4,
      async evaluate(ctx) {
        const { lat, lng, deposits, prospects, mines, terrain } = ctx;

        // 評価地点の標高
        const myElev = terrain.elev;
        if (myElev === null) {
          return { score: STUB_SCORE, reason: '評価地点の標高取得中' };
        }

        // 鉱床＋鉱徴地＋minesを合算
        const allDeps     = [...deposits, ...mines];
        const allTargets  = [...allDeps, ...prospects];
        if (!allTargets.length) {
          return { score: STUB_SCORE, reason: '鉱床・鉱徴地データ読み込み中' };
        }

        // ── 段階的半径拡張で上位5件を収集 ────────────────────────
        // 5km → 10km → 15km と拡張し、1件以上拾えた時点で打ち切り
        const MAX_COUNT = 5;
        let candidates = [];
        for (const radiusM of [5000, 10000, 15000]) {
          candidates = allTargets
            .map(d => ({ d, dist: haversine(lat, lng, d.lat, d.lng) }))
            .filter(({ dist }) => dist <= radiusM)
            .sort((a, b) => a.dist - b.dist)
            .slice(0, MAX_COUNT);
          if (candidates.length > 0) break;
        }

        // 1件も拾えなかった場合
        if (!candidates.length) {
          return { score: 1.0, reason: '半径15km以内に鉱床・鉱徴地なし' };
        }

        // ── 上位N件の標高を並列取得 ──────────────────────────────
        const elevResults = await Promise.all(
          candidates.map(({ d }) => _fetchElev(d.lat, d.lng))
        );

        // 標高取得できた件数のみで平均を計算
        const validElevs = elevResults.filter(e => e !== null);
        if (!validElevs.length) {
          return { score: STUB_SCORE, reason: '鉱床地点の標高取得中' };
        }
        const avgDepElev = validElevs.reduce((a, b) => a + b, 0) / validElevs.length;

        // 標高差: 正 = 評価地点が低い（川下）、負 = 評価地点が高い（川上）
        const diff = avgDepElev - myElev;

        // 最近傍の種別・距離（debug用）
        const nearest     = candidates[0].d;
        const nearestD    = candidates[0].dist;
        const nearestType = allDeps.includes(nearest) ? '鉱床' : '鉱徴地';

        let score, label;
        if (diff >= 100) {
          score = 5.0; label = `平均より${Math.round(diff)}m低い（明確な川下）`;
        } else if (diff >= 10) {
          score = 4.0; label = `平均より${Math.round(diff)}m低い（川下）`;
        } else if (diff >= 0) {
          score = 3.0; label = `平均とほぼ同標高（±${Math.round(Math.abs(diff))}m）`;
        } else if (diff >= -50) {
          score = 2.0; label = `平均より${Math.round(Math.abs(diff))}m高い（わずかに川上）`;
        } else {
          score = 1.0; label = `平均より${Math.round(Math.abs(diff))}m高い（川上側）`;
        }

        return {
          score,
          reason: `近傍鉱床${candidates.length}件平均: ${label}`,
          _debug: {
            '評価地点標高':       `${Math.round(myElev)}m`,
            '鉱床平均標高':       `${Math.round(avgDepElev)}m（${validElevs.length}件平均）`,
            '標高差(正=川下)':    `${Math.round(diff)}m`,
            '参照件数':           `${candidates.length}件（標高取得${validElevs.length}件）`,
            '最近傍':             `${nearestType} ${(nearestD/1000).toFixed(1)}km`,
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

    // 15. 熊遭遇リスク
    // 高スコア = 危険。weight:0 のため集計には影響しない（表示専用）。
    {
      id: 'bearActivity', name: '熊遭遇リスク', weight: 0,
      evaluate(ctx) {
        const { lat, lng, bearData, overpass } = ctx;

        const now          = Date.now();
        const ONE_YEAR     = 365 * 24 * 3600 * 1000;
        const RADIUS_40K   = 40000; // メイン参照半径
        const RADIUS_35K   = 35000; // 段階加算・囲まれ判定
        const RADIUS_10K   = 10000; // 段階加算（近距離）

        // ── 距離・件数カウント ────────────────────────────────
        let nearCount    = 0;
        let closestDistM = Infinity;
        const bears35    = [];
        let count10      = 0;

        if (bearData && bearData.length) {
          for (const b of bearData) {
            if (!b.lat || !b.lng) continue;
            const distM     = haversine(lat, lng, b.lat, b.lng);
            const age       = b.date ? (now - new Date(b.date).getTime()) / ONE_YEAR : 2;
            const ageFactor = Math.max(0.2, 1 - age * 0.5);

            if (distM <= RADIUS_40K) {
              nearCount++;
              const effectiveDist = distM / ageFactor;
              if (effectiveDist < closestDistM) closestDistM = effectiveDist;
            }
            if (distM <= RADIUS_35K) {
              bears35.push({ ...b, distM });
              if (distM <= RADIUS_10K) count10++;
            }
          }
        }

        // ── 距離スコア: 0m→2.0、40km端→0.0（線形減衰）────────
        const bearDistScore = nearCount > 0
          ? 2.0 * Math.max(0, 1 - closestDistM / RADIUS_40K)
          : 0;

        // ── 件数加算: 1件×0.2、上限10件（最大+2.0）──────────
        const countScore = Math.min(10, nearCount) * 0.2;

        // ── 環境リスク（河川・森林500m圏）───────────────────
        const allWater = [...(overpass.streams || []), ...(overpass.rivers || [])];
        const forests  = overpass.forests || [];

        let riverRisk = 0;
        for (const way of allWater) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d <= 500) { riverRisk = 0.5; break; }
        }

        let forestRisk = 0;
        for (const way of forests) {
          if (!way.geometry?.length) continue;
          const d = _nearestDistToWay(lat, lng, way.geometry);
          if (d <= 500) { forestRisk = 0.5; break; }
        }

        const envRisk = riverRisk + forestRisk; // 最大0.6

        // ── 道路距離加算（500m以上+0.5、1500m以上+1.0）────────────────────
        const nearRoadM = ctx.cache.nearestRoadM ?? null;
        const roadBonus = nearRoadM === null ? 0
                        : nearRoadM >= 1500  ? 1.0
                        : nearRoadM >= 500   ? 0.5
                        :                     0;

        // ── 道路・林道 way数ペナルティ（100以下+1.0、300以上-1.5、500以上-2.5、2000以上-3.5、3000以上-4.0、5000以上-4.4）──
        const allRoads    = [...(overpass.roads || []), ...(overpass.tracks || [])];
        const roadCount   = allRoads.length;
        const roadPenalty = roadCount >= 5000 ? -4.4
                          : roadCount >= 3000 ? -4.0
                          : roadCount >= 2000 ? -3.5
                          : roadCount >= 500  ? -2.5
                          : roadCount >= 300  ? -1.5
                          : roadCount <= 100  ?  1.0  // 道路少ない＝秘境＝リスク高
                          :                      0;

        // ── 段階加算 ──────────────────────────────────────────
        let proximityScore = 0;
        if (bears35.length >= 1) proximityScore += 1; // 35km圏内1件以上
        if (count10        >= 1) proximityScore += 1; // 10km圏内1件以上

        // ── 囲まれ加算（35km圏3件以上・最大方位隙間≤180度）─
        let surroundBonus = 0;
        let maxGapDeg     = 360;
        if (bears35.length >= 3) {
          const angles = bears35.map(b => {
            return (Math.atan2(b.lng - lng, b.lat - lat) * 180 / Math.PI + 360) % 360;
          }).sort((a, b) => a - b);

          let gap = 0;
          for (let i = 0; i < angles.length; i++) {
            const diff = i === angles.length - 1
              ? (angles[0] + 360 - angles[i])
              : (angles[i + 1] - angles[i]);
            if (diff > gap) gap = diff;
          }
          maxGapDeg = gap;
          if (maxGapDeg <= 180) surroundBonus = 2;
        }
        proximityScore += surroundBonus;

        // ── 北海道加算（ヒグマ生息域）────────────────────────
        const isHokkaido    = lat >= 41.35 && lat <= 45.55 && lng >= 139.3 && lng <= 145.9;
        const hokkaidoBonus = isHokkaido ? 4.0 : 0;

        // ── 四国九州減点（熊生息域外）────────────────────────
        const isShikokuKyushu    = lat >= 31.0 && lat <= 34.2 && lng >= 129.5 && lng <= 134.8;
        const shikokuKyushuPenalty = isShikokuKyushu ? -2.0 : 0;

        // ── 総合リスクスコア ──────────────────────────────
        const raw   = bearDistScore + countScore + envRisk + roadBonus + proximityScore + roadPenalty + hokkaidoBonus + shikokuKyushuPenalty;
        const score = clamp5(raw);

        const level = score >= 4.0 ? '⚠ 高危険'
                    : score >= 2.5 ? '⚠ 中危険'
                    : score >= 1.0 ? '注意'
                    :                '低危険';

        const reasonParts = [];
        if (nearCount > 0)      reasonParts.push(`40km圏${nearCount}件`);
        if (count10 > 0)        reasonParts.push(`10km圏${count10}件`);
        if (riverRisk > 0)      reasonParts.push('河川あり');
        if (forestRisk > 0)     reasonParts.push('森林あり');
        if (surroundBonus > 0)  reasonParts.push('囲まれ検知');
        if (roadPenalty < 0)    reasonParts.push(`道路多（${roadCount}本）`);
        if (isHokkaido)            reasonParts.push('北海道（ヒグマ）');
        if (isShikokuKyushu)       reasonParts.push('四国九州（熊少）');

        return {
          score,
          reason: `${level}（${reasonParts.length ? reasonParts.join('・') : '出没記録なし'}）`,
          _debug: {
            '参照半径':       `${RADIUS_40K/1000}km`,
            '熊データ総数':   `${bearData?.length ?? 0}件`,
            '40km圏件数':     `${nearCount}件`,
            '35km圏件数':     `${bears35.length}件`,
            '10km圏件数':     `${count10}件`,
            '最近傍有効距離': closestDistM < Infinity ? `${Math.round(closestDistM)}m` : 'なし',
            '距離スコア':     `${bearDistScore.toFixed(2)}`,
            '件数スコア':     `+${countScore.toFixed(1)}`,
            '河川リスク':     `+${riverRisk.toFixed(1)}`,
            '森林リスク':     `+${forestRisk.toFixed(1)}`,
            '道路距離加算':   `${nearRoadM !== null ? Math.round(nearRoadM)+'m' : '未取得'} → +${roadBonus.toFixed(1)}`,
            '道路way数':      `${roadCount}本 → ${roadPenalty}`,
            '段階加算':       `+${proximityScore - surroundBonus}（35km:${bears35.length>=1?1:0}+10km:${count10>=1?1:0}）`,
            '囲まれ加算':     `+${surroundBonus}（最大隙間${bears35.length>=3 ? maxGapDeg.toFixed(1)+'°' : '対象3件未満'}）`,
            '北海道加算':     `+${hokkaidoBonus.toFixed(1)}（${isHokkaido ? '北海道' : '対象外'}）`,
            '四国九州減点':   `${shikokuKyushuPenalty.toFixed(1)}（${isShikokuKyushu ? '対象' : '対象外'}）`,
            '合計(raw)':      raw.toFixed(2),
            '総合スコア':     score.toFixed(2),
            'レベル':         level,
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

    // 15b. 水系距離（沢・河川の統合表示）
    //      沢が30m以内なら沢を優先、それ以外はスコアが高い方を表示
    {
      id: 'waterDistance', name: '水系距離', weight: 0, _mergeOnly: true,
      evaluate(ctx) {
        const s = ctx.cache._scores || {};
        const streamScore = s.streamDistance ?? null;
        const riverScore  = s.riverDistance  ?? null;
        const streamM     = ctx.cache.nearestStreamM ?? Infinity;
        const riverM      = ctx.cache.nearestRiverM  ?? Infinity;

        if (streamScore === null && riverScore === null) {
          return { score: STUB_SCORE, reason: '水系データ取得中' };
        }

        // 沢が30m以内なら沢優先、それ以外はスコアが高い方
        const useStream = streamM <= 30 || (streamScore ?? 0) >= (riverScore ?? 0);
        const score  = useStream ? (streamScore ?? riverScore) : (riverScore ?? streamScore);
        const distM  = useStream ? streamM : riverM;
        const label  = useStream ? '沢' : '河川';

        return {
          score,
          reason: `最寄り${label}まで約${Math.round(distM)}m`,
          _debug: {
            '沢距離':     streamM < Infinity ? `${Math.round(streamM)}m` : 'なし',
            '河川距離':   riverM  < Infinity ? `${Math.round(riverM)}m`  : 'なし',
            '沢スコア':   streamScore !== null ? streamScore.toFixed(1) : 'なし',
            '河川スコア': riverScore  !== null ? riverScore.toFixed(1)  : 'なし',
            '採用':       label,
          },
        };
      },
    },

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

    // 18. アクセス難度
    //     評価地点→林道→一般道の2区間距離＋勾配で徒歩到達障壁を評価
    //     高スコア = 困難・危険（bearActivityと同じ逆スコア型）
    {
      id: 'accessDifficulty', name: '退路・怪我リスク', weight: 0, _mergeOnly: true,
      async evaluate(ctx) {
        const { lat, lng, terrain, overpass } = ctx;
        const myElev        = terrain.elev;
        const nearTrackNode = ctx.cache.nearestTrackNode ?? null;
        const nearRoadNode  = ctx.cache.nearestRoadNode  ?? null;
        const nearRoadM     = ctx.cache.nearestRoadM     ?? null;

        // ── 林道なし: 評価地点→一般道距離のみで評価 ──────────────
        if (!nearTrackNode) {
          if (nearRoadM === null) {
            return { score: STUB_SCORE, reason: 'アクセス経路データ取得中' };
          }
          const score = nearRoadM <= 500  ? 1.0   // 一般道至近
                      : nearRoadM <= 1500 ? 2.0
                      : nearRoadM <= 3000 ? 3.5
                      :                    5.0;   // 一般道が遠い＝高難度
          return {
            score,
            reason: `林道なし・一般道まで約${Math.round(nearRoadM)}m`,
            _debug: {
              '林道':         'なし',
              '一般道距離':   `${Math.round(nearRoadM)}m`,
            },
          };
        }

        // ── 区間① 評価地点 → nearestTrackNode（林道） ─────────────
        const seg1DistM = haversine(lat, lng, nearTrackNode.lat, nearTrackNode.lon);

        // ── 区間② nearestTrackNode → nearestRoadNode（一般道） ────
        const seg2DistM = nearRoadNode
          ? haversine(nearTrackNode.lat, nearTrackNode.lon, nearRoadNode.lat, nearRoadNode.lon)
          : null;

        const totalDistM = seg2DistM !== null
          ? seg1DistM + seg2DistM
          : seg1DistM + (nearRoadM ?? 0);

        // ── 勾配計算（並列fetch） ──────────────────────────────────
        // 区間①: 評価地点標高(myElev) vs 林道ノード標高
        // 区間②: 林道ノード標高 vs 一般道ノード標高
        const [trackElev, roadElev] = await Promise.all([
          _fetchElev(nearTrackNode.lat, nearTrackNode.lon),
          nearRoadNode ? _fetchElev(nearRoadNode.lat, nearRoadNode.lon) : Promise.resolve(null),
        ]);

        // 勾配(%) = 標高差(m) / 水平距離(m) × 100
        const seg1Grad = (myElev !== null && trackElev !== null && seg1DistM > 0)
          ? Math.abs(trackElev - myElev) / seg1DistM * 100
          : null;

        const seg2Grad = (trackElev !== null && roadElev !== null && seg2DistM !== null && seg2DistM > 0)
          ? Math.abs(roadElev - trackElev) / seg2DistM * 100
          : null;

        const maxGrad = Math.max(seg1Grad ?? 0, seg2Grad ?? 0);

        // ── 距離スコア（長いほど高難度） ──────────────────────────
        const distScore = totalDistM <= 300  ? 1.0
                        : totalDistM <= 800  ? 2.0
                        : totalDistM <= 1500 ? 3.0
                        : totalDistM <= 3000 ? 4.0
                        :                     5.0;

        // ── 勾配ペナルティ（林道向けきつめ閾値） ──────────────────
        // 15%未満: 舗装林道レベル → 加点なし
        // 15〜30%: 未舗装林道    → +0.5
        // 30〜50%: 沢沿い・藪こぎ → +1.5
        // 50%〜  : 崖レベル       → +2.5
        const gradBonus = maxGrad >= 50 ? 2.5
                        : maxGrad >= 30 ? 1.5
                        : maxGrad >= 15 ? 0.5
                        :                0.0;

        const score = clamp5(distScore + gradBonus);

        // ラベル生成
        const distLabel = totalDistM >= 1000
          ? `合計${(totalDistM / 1000).toFixed(1)}km`
          : `合計${Math.round(totalDistM)}m`;
        const gradLabel = maxGrad >= 50 ? `勾配${Math.round(maxGrad)}%（崖レベル）`
                        : maxGrad >= 30 ? `勾配${Math.round(maxGrad)}%（急斜面）`
                        : maxGrad >= 15 ? `勾配${Math.round(maxGrad)}%（やや急）`
                        : maxGrad >   0 ? `勾配${Math.round(maxGrad)}%（緩やか）`
                        :                '勾配データなし';

        return {
          score,
          reason: `徒歩退路: ${distLabel} / ${gradLabel}`,
          _debug: {
            '区間①距離(地点→林道)': `${Math.round(seg1DistM)}m`,
            '区間②距離(林道→一般道)': seg2DistM !== null ? `${Math.round(seg2DistM)}m` : '不明',
            '合計距離':               distLabel,
            '区間①勾配':             seg1Grad !== null ? `${Math.round(seg1Grad)}%` : '不明',
            '区間②勾配':             seg2Grad !== null ? `${Math.round(seg2Grad)}%` : '不明',
            '最大勾配':               `${Math.round(maxGrad)}%`,
            '距離スコア':             distScore.toFixed(1),
            '勾配ボーナス':           `+${gradBonus.toFixed(1)}`,
            '最終スコア':             score.toFixed(2),
          },
        };
      },
    },

    // 19. 孤立・遭難リスク（旧: 人到達性を逆スコア型に再設計）
    //     一般道からの遠さ・標高・地形急峻さ・脱出勾配で救助困難度を評価
    //     高スコア = 危険（bearActivityと同じ逆スコア型）
    {
      id: 'accessibility', name: '孤立・遭難リスク', weight: 0, _mergeOnly: true,
      async evaluate(ctx) {
        const { lat, lng, terrain } = ctx;
        const slopeDiff     = ctx.cache.slopeDiff       ?? null;
        const elev          = terrain.elev;
        const nearRoadM     = ctx.cache.nearestRoadM    ?? null;
        const nearRoadNode  = ctx.cache.nearestRoadNode ?? null;
        const nearTrackNode = ctx.cache.nearestTrackNode ?? null;

        // ── ベーススコア（各コンポーネント: 遠い・高い・急峻ほど高リスク） ──
        const components = [];

        // 一般道距離: 遠いほど高リスク
        if (nearRoadM !== null) {
          components.push(
            nearRoadM < 500  ? 1.0
            : nearRoadM < 1000 ? 2.0
            : nearRoadM < 1500 ? 2.5
            : nearRoadM < 2000 ? 3.0
            : nearRoadM < 2500 ? 4.0
            :                   5.0
          );
        }

        // 標高: 高いほど救助困難
        if (elev !== null) {
          components.push(
            elev < 500  ? 1.0
            : elev < 1000 ? 2.5
            : elev < 1500 ? 4.0
            :               5.0
          );
        }

        // 地形急峻さ: 急なほど脱出困難
        if (slopeDiff !== null) {
          components.push(
            slopeDiff < 50  ? 1.0
            : slopeDiff < 150 ? 2.5
            : slopeDiff < 300 ? 4.0
            :                  5.0
          );
        }

        if (!components.length) return { score: STUB_SCORE, reason: '孤立・遭難リスクデータ計算中' };

        const base = Math.max(...components); // 最悪ケースを採用

        // ── 脱出路勾配ボーナス（急なほど高リスク） ────────────────
        // 道路/林道とも存在しない場合は強制 +1.5
        let gradBonus = 0;
        let gradLabel = '';

        if (!nearRoadNode && !nearTrackNode) {
          gradBonus = 1.5;
          gradLabel = '脱出路なし';
        } else {
          async function _calcGrad(node, distM) {
            if (!node || distM <= 0) return null;
            const nElev = await _fetchElev(node.lat, node.lon);
            if (nElev === null || elev === null) return null;
            return Math.abs(nElev - elev) / distM * 100;
          }

          const roadDistM  = ctx.cache.nearestRoadM ?? Infinity;
          const trackDistM = nearTrackNode
            ? haversine(lat, lng, nearTrackNode.lat, nearTrackNode.lon)
            : Infinity;

          const [roadGrad, trackGrad] = await Promise.all([
            _calcGrad(nearRoadNode,  roadDistM),
            _calcGrad(nearTrackNode, trackDistM),
          ]);

          const maxGrad = Math.max(roadGrad ?? -Infinity, trackGrad ?? -Infinity);

          if (maxGrad === -Infinity) {
            gradBonus = 1.5;
            gradLabel = '勾配取得失敗';
          } else {
            gradBonus = maxGrad < 20 ? 0.0    // 緩やか
                      : maxGrad < 40 ? 0.5    // やや急
                      : maxGrad < 60 ? 1.0    // 急斜面
                      :               2.5;    // 崖レベル
            gradLabel = `脱出勾配${Math.round(maxGrad)}%（道路${roadGrad !== null ? Math.round(roadGrad)+'%' : 'なし'} / 林道${trackGrad !== null ? Math.round(trackGrad)+'%' : 'なし'}）`;
          }
        }

        // ── 地形ボーナス ────────────────────────────────────────
        const slopeBonus = slopeDiff === null ? 0
                         : slopeDiff < 150    ? 0
                         : slopeDiff < 300    ? 0.5
                         :                     1.0;

        // ── 森林密度ボーナス ─────────────────────────────────────
        // overpass.forests のwayを1km/3km圏に振り分けてway数で密度を近似
        const forests = ctx.overpass?.forests || [];
        let ways1km = 0, ways3km = 0;
        for (const way of forests) {
          if (!way.geometry?.length) continue;
          // wayの最近傍ノードで距離判定
          let minD = Infinity;
          for (const pt of way.geometry) {
            const d = haversine(lat, lng, pt.lat, pt.lon);
            if (d < minD) minD = d;
          }
          if (minD <= 3000) {
            ways3km++;
            if (minD <= 1000) ways1km++;
          }
        }

        // 1km圏way数ボーナス（最大+1.0）
        const forest1kmBonus = ways1km >= 5 ? 1.0
                             : ways1km >= 3 ? 0.67
                             : ways1km >= 1 ? 0.33
                             :               0;

        // 3km圏way数ボーナス（最大+1.0）
        const forest3kmBonus = ways3km >= 10 ? 1.0
                             : ways3km >=  5 ? 0.5
                             :                0;

        const forestBonus = forest1kmBonus + forest3kmBonus;

        // ── 道路way数減点（人が多い＝遭難リスク低）────────────
        const allRoadsIso  = [...(ctx.overpass?.roads || []), ...(ctx.overpass?.tracks || [])];
        const roadCountIso = allRoadsIso.length;
        const roadWayPenalty = roadCountIso >= 5000 ? -4.0
                             : roadCountIso >= 3000 ? -2.0
                             :                        0;

        const totalBonus = gradBonus + slopeBonus + forestBonus + roadWayPenalty;
        const score = clamp5(base + totalBonus);

        // 一般道距離ラベル
        const roadLabel = nearRoadM !== null
          ? (nearRoadM >= 1000 ? `一般道${(nearRoadM/1000).toFixed(1)}km` : `一般道${Math.round(nearRoadM)}m`)
          : '一般道不明';

        const forestLabel = forestBonus > 0
          ? `森林1km:${ways1km}区画/3km:${ways3km}区画`
          : '';

        return {
          score,
          reason: `孤立・遭難リスク: ${roadLabel} / 標高${elev !== null ? Math.round(elev)+'m' : '不明'}${forestLabel ? ' / ' + forestLabel : ''}${totalBonus > 0 ? ` / 加算+${totalBonus.toFixed(1)}` : ''}`,
          _debug: {
            '一般道距離':      nearRoadM !== null ? `${Math.round(nearRoadM)}m` : '未取得',
            '標高':            elev !== null ? `${Math.round(elev)}m` : '未取得',
            '地形傾斜差':      slopeDiff !== null ? `${Math.round(slopeDiff)}m` : '未取得',
            'ベーススコア':    base.toFixed(1),
            '勾配ボーナス':    `+${gradBonus.toFixed(1)} (${gradLabel})`,
            '地形ボーナス':    `+${slopeBonus.toFixed(1)}`,
            '1km森林way数':    `${ways1km}本 → +${forest1kmBonus.toFixed(2)}`,
            '3km森林way数':    `${ways3km}本 → +${forest3kmBonus.toFixed(1)}`,
            '森林ボーナス':    `+${forestBonus.toFixed(2)}`,
            '道路way減点':     `${roadCountIso}本 → ${roadWayPenalty.toFixed(1)}`,
            '合計ボーナス':    `+${totalBonus.toFixed(1)}`,
            '最終スコア':      score.toFixed(2),
          },
        };
      },
    },

    // 17. アクセスリスク
    //     一般道・林道の実距離から直接リスクスコアを計算
    //     反転ロジック廃止: nearestRoadM / nearestTrackNode を直接参照
    //     高スコア = 危険（遠いほど高リスク）
    {
      id: 'accessRoad', name: 'アクセスリスク', weight: 0, _mergeOnly: true,
      evaluate(ctx) {
        const { lat, lng } = ctx;
        const nearRoadM     = ctx.cache.nearestRoadM    ?? null;
        const nearTrackNode = ctx.cache.nearestTrackNode ?? null;

        if (nearRoadM === null) {
          return { score: STUB_SCORE, reason: 'アクセスリスクデータ準備中' };
        }

        // 一般道距離から直接リスクスコアを計算
        const roadRisk = nearRoadM <= 200  ? 1.0
                       : nearRoadM <= 500  ? 1.5
                       : nearRoadM <= 1000 ? 2.5
                       : nearRoadM <= 2000 ? 3.5
                       :                    5.0;

        // 林道が近くにあればリスクを緩和（-0.5）
        const trackDistM = nearTrackNode
          ? haversine(lat, lng, nearTrackNode.lat, nearTrackNode.lon)
          : Infinity;
        const trackRelief = trackDistM <= 1000 ? -0.5 : 0;

        const score = clamp5(roadRisk + trackRelief);

        const roadLabel  = nearRoadM >= 1000
          ? `一般道${(nearRoadM/1000).toFixed(1)}km`
          : `一般道${Math.round(nearRoadM)}m`;
        const trackLabel = trackDistM < Infinity
          ? `林道${Math.round(trackDistM)}m${trackRelief < 0 ? '（緩和）' : ''}`
          : '林道なし';

        return {
          score,
          reason: `${roadLabel} / ${trackLabel}`,
          _debug: {
            '一般道距離':   `${Math.round(nearRoadM)}m`,
            '一般道リスク': roadRisk.toFixed(1),
            '林道距離':     trackDistM < Infinity ? `${Math.round(trackDistM)}m` : 'なし',
            '林道緩和':     `${trackRelief.toFixed(1)}`,
            '最終スコア':   score.toFixed(2),
          },
        };
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
    // auDensity を先行実行して ctx.cache.auDensityScore をセット
    // geology がそのキャッシュを参照して加点するため
    // 先行実行結果をそのまま流用し、Promise.allSettled 内では auDensity をスキップして2重実行を防ぐ
    const auDensityItem = evaluationItems.find(i => i.id === 'auDensity');
    let auDensitySettled = null;
    if (auDensityItem) {
      try {
        const r = await auDensityItem.evaluate(ctx);
        auDensitySettled = { status: 'fulfilled', value: { item: auDensityItem, r } };
      } catch (_) {}
    }
    const settled1 = await Promise.allSettled(
      evaluationItems
        .filter(item => item.id !== 'auDensity')
        .map(item =>
          Promise.resolve().then(async () => ({ item, r: await item.evaluate(ctx) }))
        )
    );
    // auDensity の結果を元の順序位置（先頭付近）に差し込む
    const allSettled1 = auDensitySettled
      ? [auDensitySettled, ...settled1]
      : settled1;

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

    const items = [...allSettled1, ...settled2].map(_toItem);

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
        ids:   ['geology', 'auDensity', 'mineDistance', 'depositElevation', 'valleyShape'],
      },
      {
        label: '河川環境',
        ids:   ['waterDistance', 'riverCurve', 'riverSlope', 'confluence'],
      },
      {
        label: '環境',
        ids:   ['elevation'],
      },
      {
        label: '安全リスク',
        ids:   ['accessRoad', 'accessDifficulty', 'accessibility', 'bearActivity'],
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
      const riskNote = cat.label === '安全リスク'
        ? '<span style="font-size:0.75em;color:#999;font-weight:normal;margin-left:4px;">（高→危険）</span>'
        : '';
      return `<div class="ev-cat-header">${cat.label}${riskNote}</div>
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

  // ─────────────────────────────────────────────────────────
  // プログレスバー（ポップアップ内ローディング表示）
  // ─────────────────────────────────────────────────────────
  let _progressRaf   = null;
  let _progressStart = 0;
  const _PROGRESS_DURATION = 12000; // 擬似進行: 0%→90% に12秒

  /** ポップアップ内プログレスバーのHTML */
  function _buildProgressHTML() {
    return `<div class="ev-popup ev-popup-loading">
      <div class="ev-title">🔍 砂金探索スコア</div>
      <div class="ev-progress-label">評価中…</div>
      <div class="ev-progress-track">
        <div class="ev-progress-bar" id="ev-progress-bar"></div>
        <div class="ev-progress-shimmer"></div>
      </div>
    </div>`;
  }

  /** プログレスアニメーション開始 */
  function _startProgressAnim() {
    if (_progressRaf) { cancelAnimationFrame(_progressRaf); _progressRaf = null; }
    _progressStart = performance.now();
    function _tick() {
      const bar = document.getElementById('ev-progress-bar');
      if (!bar) return;
      const elapsed = performance.now() - _progressStart;
      const pct = 90 * (1 - Math.exp(-3 * elapsed / _PROGRESS_DURATION));
      bar.style.width = pct.toFixed(1) + '%';
      _progressRaf = requestAnimationFrame(_tick);
    }
    _progressRaf = requestAnimationFrame(_tick);
  }

  /** プログレスを100%にしてアニメ停止 */
  function _finishProgressAnim() {
    if (_progressRaf) { cancelAnimationFrame(_progressRaf); _progressRaf = null; }
    const bar = document.getElementById('ev-progress-bar');
    if (bar) bar.style.width = '100%';
  }

  /** 指定座標の評価ポップアップを開く */
  async function _openEvalPopup(lat, lng) {
    if (_evalPopup) { _evalPopup.remove(); _evalPopup = null; }

    // ポップアップをすぐ開いてプログレスバーを表示
    _evalPopup = L.popup({ maxWidth: 260, className: 'ev-leaflet-popup' })
      .setLatLng([lat, lng])
      .setContent(_buildProgressHTML())
      .openOn(map);

    // DOM反映後にアニメ開始
    requestAnimationFrame(_startProgressAnim);

    try {
      const result = await evaluate({ lat, lng, zoom: map.getZoom() });
      _finishProgressAnim();
      if (_evalPopup && map.hasLayer(_evalPopup)) {
        _evalPopup.setContent(_buildResultHTML(lat, lng, result.items));
        requestAnimationFrame(() => _initMinimap(lat, lng));
      }
    } catch {
      _finishProgressAnim();
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