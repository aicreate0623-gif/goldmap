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
  const ELEV_OPT_MIN    = 200;      // 標高最適帯 下限(m)
  const ELEV_OPT_MAX    = 1200;     // 標高最適帯 上限(m)

  // ─────────────────────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────────────────────

  /** Haversine距離(m) */
  function haversine(la1, lo1, la2, lo2) {
    const R = EARTH_R, r = Math.PI / 180;
    const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2
            + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /** 0〜5 クランプ */
  const clamp5 = v => Math.max(0, Math.min(5, v));

  /**
   * 距離(m) → スコア(0〜5) 線形変換
   * dMin以内=5、dMax以上=0
   */
  function distScore(distM, dMin, dMax) {
    if (distM <= dMin) return 5;
    if (distM >= dMax) return 0;
    return clamp5(5 * (1 - (distM - dMin) / (dMax - dMin)));
  }

  /** スコア(0〜5) → ★文字列 */
  function toStars(score) {
    const n = Math.round(clamp5(score));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  // ─────────────────────────────────────────────────────────
  // キャッシュ層
  // ─────────────────────────────────────────────────────────
  const _evalCache = new Map();  // 評価結果全体
  const _topoCache = new Map();  // OpenTopoData高さ
  const _postCache = new Map();  // Firestore posts
  const _bearStore = { data: null, fetchedAt: 0 };

  const EVAL_TTL = 10 * 60 * 1000;
  const BEAR_TTL = 30 * 60 * 1000;
  const POST_TTL =  5 * 60 * 1000;

  /** キャッシュキー（小数4桁=約11m精度） */
  function _key(lat, lng) {
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
  }

  // ─────────────────────────────────────────────────────────
  // データ取得ヘルパー
  // ─────────────────────────────────────────────────────────

  /** OpenTopoData で標高取得（キャッシュ付き） */
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
    } catch {
      return null;  // フォールバック: null → 評価内でスタブ
    }
  }

  /**
   * 周辺8点の標高を取得して傾斜を推定
   * δ = 約300m オフセット
   */
  async function _fetchSurroundElev(lat, lng) {
    const d = 0.003; // ≒300m
    const pts = [
      [lat + d, lng], [lat - d, lng],
      [lat, lng + d], [lat, lng - d],
    ];
    const locStr = pts.map(p => `${p[0]},${p[1]}`).join('|');
    try {
      const res  = await fetch(`${TOPO_API}?locations=${locStr}`);
      if (!res.ok) throw new Error('topo_surr_err');
      const json = await res.json();
      return (json?.results || []).map(r => r.elevation ?? null);
    } catch {
      return [null, null, null, null];
    }
  }

  /** bears_pins.json 取得（キャッシュ付き） */
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
    } catch {
      return [];
    }
  }

  /**
   * Firestore posts コレクションから半径内の投稿を取得
   * キャッシュ付き・API重複防止
   */
  async function _fetchPosts(lat, lng) {
    const k   = _key(lat, lng);
    const now = Date.now();
    const hit = _postCache.get(k);
    if (hit && now - hit.at < POST_TTL) return hit.data;

    try {
      const db = firebase.firestore();
      const snap = await db.collection('posts')
        .where('lat', '>=', lat - POST_RADIUS_DEG)
        .where('lat', '<=', lat + POST_RADIUS_DEG)
        .get();

      // lat絞り込み後にlng側をJS側でフィルタ
      const posts = snap.docs
        .map(d => d.data())
        .filter(p =>
          Math.abs(p.lng - lng) <= POST_RADIUS_DEG
        );

      _postCache.set(k, { data: posts, at: now });
      return posts;
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────
  // context ビルダー
  // 評価実行前に外部データを並列取得してctxに集約する
  // ─────────────────────────────────────────────────────────
  async function _buildContext(input) {
    const { lat, lng, zoom = 13 } = input;

    // 並列取得（API重複防止: 同一Promiseを再利用しない設計で十分）
    const [elev, surroundElevs, bears, posts, gsjData] = await Promise.all([
      _fetchElev(lat, lng),
      _fetchSurroundElev(lat, lng),
      _fetchBears(),
      _fetchPosts(lat, lng),
      // GSJ_MINE_DATA は data.js の loadGsjMineData() 経由
      (typeof loadGsjMineData === 'function')
        ? loadGsjMineData().catch(() => [])
        : Promise.resolve(window.GSJ_MINE_DATA_CACHED || []),
    ]);

    // GSJ側メモリキャッシュも保存しておく（フォールバック用）
    if (gsjData.length) window.GSJ_MINE_DATA_CACHED = gsjData;

    return {
      lat, lng, zoom,
      terrain:   { elev, surroundElevs },  // 標高・周辺標高
      geology:   null,   // TODO: GSJ API差し替え時にここに入れる
      streams:   null,   // TODO: Overpass API差し替え時
      roads:     null,
      forestRoads: null,
      deposits:  (gsjData || []).filter(d => !d.trace),
      prospects: (gsjData || []).filter(d =>  d.trace),
      mines:     typeof MINES !== 'undefined' ? MINES : [],
      bearData:  bears,
      userReports: posts,
      cache:     {},     // 評価項目間の中間結果共有用
    };
  }

  // ─────────────────────────────────────────────────────────
  // 評価項目定義
  // ─────────────────────────────────────────────────────────
  // ルール:
  //   - score: 0〜5 (浮動小数)
  //   - reason: 簡潔な日本語説明
  //   - weight: 総合スコア計算用 (1.0=標準, 1.5=重視, 0.8=軽視)
  //   - ctx.cache を使って他項目との中間値共有可能
  // ─────────────────────────────────────────────────────────
  const evaluationItems = [

    // 1. 沢距離
    {
      id: 'streamDistance',
      name: '沢距離',
      weight: 1.4,
      evaluate(ctx) {
        // TODO: Overpass API (waterway=stream) 接続時にここを差し替え
        const stub = ctx.cache.streamDist ?? STUB_SCORE;
        return {
          score:  stub,
          reason: '沢データ取得待ち（準備中）',
        };
      },
    },

    // 2. 河川規模
    {
      id: 'riverScale',
      name: '河川規模',
      weight: 1.2,
      evaluate(ctx) {
        // TODO: Overpass API (waterway=river/stream) 接続時に差し替え
        return {
          score:  STUB_SCORE,
          reason: '河川規模データ取得待ち（準備中）',
        };
      },
    },

    // 3. 河川合流点
    {
      id: 'confluence',
      name: '河川合流点',
      weight: 1.5,
      evaluate(ctx) {
        // TODO: Overpass API で半径内の合流ノード数を取得
        return {
          score:  STUB_SCORE,
          reason: '合流点データ取得待ち（準備中）',
        };
      },
    },

    // 4. 河川湾曲
    {
      id: 'riverCurve',
      name: '河川湾曲',
      weight: 1.1,
      evaluate(ctx) {
        // TODO: 河川ジオメトリの角度変化量を解析
        return {
          score:  STUB_SCORE,
          reason: '河川湾曲データ取得待ち（準備中）',
        };
      },
    },

    // 5. 地質
    {
      id: 'geology',
      name: '地質',
      weight: 1.6,
      evaluate(ctx) {
        // TODO: GSJ シームレス地質図 WMS/WFS を呼んで判定
        // 付加価値地質（花崗岩・変成岩・熱水変質帯）でスコアを上げる
        return {
          score:  STUB_SCORE,
          reason: '地質データ取得待ち（準備中）',
        };
      },
    },

    // 6. 鉱床距離
    {
      id: 'depositDistance',
      name: '鉱床距離',
      weight: 1.5,
      evaluate(ctx) {
        const { lat, lng, deposits, mines } = ctx;
        // GSJ 鉱床 + MINES 配列の両方を参照
        const allDeps = [
          ...deposits,
          ...mines,
        ];
        if (!allDeps.length) {
          return { score: STUB_SCORE, reason: '鉱床データ読み込み中' };
        }
        const dists = allDeps.map(d => haversine(lat, lng, d.lat, d.lng));
        const minD  = Math.min(...dists);

        // キャッシュに保存（他項目から参照可能）
        ctx.cache.nearestDepositM = minD;

        const score = distScore(minD, 1000, 25000);
        const km    = (minD / 1000).toFixed(1);
        return {
          score,
          reason: `最寄り鉱床まで約${km}km`,
        };
      },
    },

    // 7. 鉱徴地距離
    {
      id: 'prospectDistance',
      name: '鉱徴地距離',
      weight: 1.3,
      evaluate(ctx) {
        const { lat, lng, prospects } = ctx;
        if (!prospects.length) {
          return { score: STUB_SCORE, reason: '鉱徴地データ読み込み中' };
        }
        const dists = prospects.map(d => haversine(lat, lng, d.lat, d.lng));
        const minD  = Math.min(...dists);
        const score = distScore(minD, 500, 15000);
        const km    = (minD / 1000).toFixed(1);
        return {
          score,
          reason: `最寄り鉱徴地まで約${km}km`,
        };
      },
    },

    // 8. 傾斜
    {
      id: 'slope',
      name: '傾斜',
      weight: 1.2,
      evaluate(ctx) {
        const elevs = ctx.terrain.surroundElevs.filter(e => e !== null);
        if (elevs.length < 2) {
          return { score: STUB_SCORE, reason: '傾斜データ取得中' };
        }
        const maxE  = Math.max(...elevs);
        const minE  = Math.min(...elevs);
        const diff  = maxE - minE;  // 300m範囲の標高差(m)

        // 砂金採取に適した傾斜: 適度な急勾配(50〜200m差)が理想
        // 急すぎ(>300m)や平坦(<20m)は低評価
        let score;
        if      (diff < 20)  score = 1.5;
        else if (diff < 50)  score = 3.0;
        else if (diff < 200) score = 5.0;
        else if (diff < 300) score = 3.5;
        else                 score = 2.0;

        ctx.cache.slopeDiff = diff;
        return {
          score,
          reason: `周辺300m範囲の標高差: 約${diff}m`,
        };
      },
    },

    // 9. 谷形状
    {
      id: 'valleyShape',
      name: '谷形状',
      weight: 1.3,
      evaluate(ctx) {
        const { terrain } = ctx;
        const center = terrain.elev;
        const surrounds = terrain.surroundElevs.filter(e => e !== null);
        if (center === null || surrounds.length < 2) {
          return { score: STUB_SCORE, reason: '谷形状データ取得中' };
        }
        // 中心点が周囲より低いほど「谷」= 砂金堆積に有利
        const avgSurr = surrounds.reduce((a, b) => a + b, 0) / surrounds.length;
        const depth   = avgSurr - center;  // 正値 = 中心が低い = 谷

        let score;
        if      (depth > 80)  score = 5.0;
        else if (depth > 40)  score = 4.0;
        else if (depth > 10)  score = 3.0;
        else if (depth > 0)   score = 2.5;
        else                  score = 1.5;  // 丘・尾根地形

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
      id: 'elevation',
      name: '標高',
      weight: 1.0,
      evaluate(ctx) {
        const elev = ctx.terrain.elev;
        if (elev === null) {
          return { score: STUB_SCORE, reason: '標高データ取得中' };
        }
        // 最適帯 200〜1200m (山間部の沢)
        let score;
        if      (elev < 50)   score = 1.5;
        else if (elev < 200)  score = 3.0;
        else if (elev < 700)  score = 5.0;
        else if (elev < 1200) score = 4.0;
        else if (elev < 2000) score = 2.5;
        else                  score = 1.0;  // 高山帯

        return {
          score,
          reason: `標高: 約${Math.round(elev)}m`,
        };
      },
    },

    // 11. 道路距離
    {
      id: 'roadDistance',
      name: '道路距離',
      weight: 0.9,
      evaluate(ctx) {
        // TODO: Overpass API (highway=*) 接続時に差し替え
        return {
          score:  STUB_SCORE,
          reason: '道路データ取得待ち（準備中）',
        };
      },
    },

    // 12. 林道距離
    {
      id: 'forestRoadDistance',
      name: '林道距離',
      weight: 1.0,
      evaluate(ctx) {
        // TODO: Overpass API (highway=track) 接続時に差し替え
        return {
          score:  STUB_SCORE,
          reason: '林道データ取得待ち（準備中）',
        };
      },
    },

    // 13. 人到達性 (道路距離 + 林道 + 傾斜 + 標高の複合)
    {
      id: 'accessibility',
      name: '人到達性',
      weight: 1.1,
      evaluate(ctx) {
        // ctx.cache に蓄積された他項目の中間結果を利用
        const slopeDiff  = ctx.cache.slopeDiff   ?? null;
        const elev       = ctx.terrain.elev;

        // スタブ値混在の場合でも部分計算
        let components = [];

        if (elev !== null) {
          // 標高が高いほど到達困難
          const elevPenalty = elev < 500  ? 5.0
                            : elev < 1000 ? 3.5
                            : elev < 1500 ? 2.0
                            :               1.0;
          components.push(elevPenalty);
        }
        if (slopeDiff !== null) {
          // 傾斜が急なほど到達困難
          const slopePenalty = slopeDiff < 50  ? 5.0
                             : slopeDiff < 150 ? 3.5
                             : slopeDiff < 300 ? 2.5
                             :                   1.5;
          components.push(slopePenalty);
        }

        if (!components.length) {
          return { score: STUB_SCORE, reason: '到達性データ計算中' };
        }
        const score = clamp5(
          components.reduce((a, b) => a + b, 0) / components.length
        );
        return {
          score,
          reason: '標高・傾斜から推定した到達しやすさ',
        };
      },
    },

    // 14. 過去ユーザー実績
    {
      id: 'userRecords',
      name: 'ユーザー実績',
      weight: 1.4,
      evaluate(ctx) {
        const posts = ctx.userReports;
        if (!posts || !posts.length) {
          return { score: 1.5, reason: 'この周辺の投稿記録なし' };
        }
        // 投稿数 + badCount(低評価)補正
        const good = posts.filter(p => (p.badCount || 0) < 3).length;
        const score = clamp5(1.5 + good * 0.7);
        return {
          score,
          reason: `半径5km以内に${good}件の実績投稿`,
        };
      },
    },

    // 15. 熊注目度 (距離 × 件数 × 新しさ)
    {
      id: 'bearActivity',
      name: '熊注目度',
      weight: 0.8,
      evaluate(ctx) {
        const { lat, lng, bearData } = ctx;
        if (!bearData || !bearData.length) {
          return { score: 3.0, reason: '熊データなし（安全かも）' };
        }

        const now      = Date.now();
        const ONE_YEAR = 365 * 24 * 3600 * 1000;

        // BEAR_RADIUS_M 以内の熊データを抽出・スコアリング
        let threat = 0;
        for (const b of bearData) {
          if (!b.lat || !b.lng) continue;
          const distM    = haversine(lat, lng, b.lat, b.lng);
          if (distM > BEAR_RADIUS_M) continue;

          // 距離係数: 近いほど高い (0〜1)
          const distFactor = 1 - distM / BEAR_RADIUS_M;

          // 新しさ係数: 1年以内=1.0、古いほど0.2まで減衰
          const reportedAt = b.date ? new Date(b.date).getTime() : 0;
          const age        = reportedAt ? (now - reportedAt) / ONE_YEAR : 2;
          const ageFactor  = Math.max(0.2, 1 - age * 0.5);

          threat += distFactor * ageFactor;
        }

        // threat が大きいほど「熊が多い = 探索には不利」なので逆転
        // threat=0→5点(安全), threat>3→1点(危険)
        const score = clamp5(5 - Math.min(threat * 1.5, 4));
        const level = score >= 4 ? '低' : score >= 2.5 ? '中' : '高';
        return {
          score,
          reason: `周辺${BEAR_RADIUS_M / 1000}km以内の熊活動: ${level}`,
        };
      },
    },

  ];

  // ─────────────────────────────────────────────────────────
  // メイン評価関数
  // ─────────────────────────────────────────────────────────

  /**
   * @param {{ lat: number, lng: number, zoom?: number }} input
   * @returns {Promise<{ items: Array<{id,name,stars,reason}> }>}
   */
  async function evaluate(input) {
    const { lat, lng } = input;
    const k   = _key(lat, lng);
    const now = Date.now();

    // 同一座標キャッシュヒット
    const cached = _evalCache.get(k);
    if (cached && now - cached.at < EVAL_TTL) {
      return cached.result;
    }

    // context 構築（外部データ並列取得）
    const ctx = await _buildContext(input);

    // 全評価項目を並列実行
    const settled = await Promise.allSettled(
      evaluationItems.map(item =>
        Promise.resolve().then(() => {
          const r = item.evaluate(ctx);
          return { item, r };
        })
      )
    );

    // 結果整形
    const items = settled.map(s => {
      if (s.status === 'rejected') {
        // 個別評価が例外を投げても全体を止めない
        return {
          id:     'unknown',
          name:   'エラー',
          stars:  '☆☆☆☆☆',
          reason: '評価中にエラーが発生しました',
        };
      }
      const { item, r } = s.value;
      return {
        id:     item.id,
        name:   item.name,
        stars:  toStars(r.score),
        reason: r.reason,
        // ※ score は外部非公開（表示せず内部保持）
        _score:  clamp5(r.score),
        _weight: item.weight,
      };
    });

    const result = { items };
    _evalCache.set(k, { result, at: now });
    return result;
  }

  // ─────────────────────────────────────────────────────────
  // UI注入（地図クリック → ポップアップに評価ボタンを追加）
  // ─────────────────────────────────────────────────────────

  /** 評価結果をポップアップHTMLに変換 */
  function _buildResultHTML(items) {
    const rows = items.map(it =>
      `<tr>
        <td class="ev-stars">${it.stars}</td>
        <td class="ev-name">${it.name}</td>
      </tr>`
    ).join('');
    return `
      <div class="ev-popup">
        <div class="ev-title">🔍 砂金探索スコア</div>
        <table class="ev-table">${rows}</table>
        <div class="ev-note">※スコアは参考値です。現地確認を推奨します。</div>
      </div>`;
  }

  /** 評価ポップアップを開く（map.js の popup とは別インスタンス） */
  let _evalPopup = null;

  async function _openEvalPopup(lat, lng) {
    // 既存ポップアップを閉じる
    if (_evalPopup) { _evalPopup.remove(); _evalPopup = null; }

    // ローディング表示
    _evalPopup = L.popup({ maxWidth: 280, className: 'ev-leaflet-popup' })
      .setLatLng([lat, lng])
      .setContent('<div class="ev-loading">評価中…</div>')
      .openOn(map);

    try {
      const result = await evaluate({ lat, lng, zoom: map.getZoom() });
      if (_evalPopup) {
        _evalPopup.setContent(_buildResultHTML(result.items));
      }
    } catch (e) {
      if (_evalPopup) {
        _evalPopup.setContent('<div class="ev-error">評価に失敗しました</div>');
      }
    }
  }

  /** 地図クリックイベントにフックして評価ボタンを注入 */
  function _hookMapClick() {
    if (typeof map === 'undefined') return;

    map.on('click', e => {
      const { lat, lng } = e.latlng;

      // 既存の評価ポップアップが開いていれば閉じる
      if (_evalPopup) { _evalPopup.remove(); _evalPopup = null; }

      // ミニボタン popup を表示（既存の地図クリック処理と共存）
      const btnPopup = L.popup({ maxWidth: 180, className: 'ev-trigger-popup' })
        .setLatLng([lat, lng])
        .setContent(
          `<div style="text-align:center;padding:2px 0;">
            <button class="ev-btn" id="ev-trigger-btn">🔍 この場所を評価</button>
          </div>`
        )
        .openOn(map);

      // ボタンのクリックイベントをDOMに追加（Leaflet popupopenで発火）
      map.once('popupopen', () => {
        const btn = document.getElementById('ev-trigger-btn');
        if (btn) {
          btn.addEventListener('click', () => {
            btnPopup.remove();
            _openEvalPopup(lat, lng);
          });
        }
      });
    });
  }

  // DOMロード後にフック（map.js の initMap より後に実行される）
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
    evaluationItems,  // 外部から push() で項目追加可能
  };

})();

window.GoldEvaluator = GoldEvaluator;
