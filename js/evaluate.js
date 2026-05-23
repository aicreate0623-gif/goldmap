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
      const W     = Math.min(wBase, Math.max(wMax, 30)); // 最低30mは確保

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