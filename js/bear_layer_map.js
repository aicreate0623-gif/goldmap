// =============================================================================
// 熊出没レイヤー (bears layer) v3 - ヒートマップ + 直近ピン構成
// map.js の末尾に追記する。
// 依存: map (L.Map インスタンス)、L.heatLayer (leaflet.heat) が存在すること。
// =============================================================================

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const BEARS_HEAT_URL = "data/bears_heat.json"; // 全件・座標のみ [[lat,lng],...]
const BEARS_PINS_URL = "data/bears_pins.json";  // 直近90日・全フィールド

const BEAR_COLOR_FRESH  = "#e53935"; // 30日以内  → 赤
const BEAR_COLOR_RECENT = "#fb8c00"; // 90日以内  → オレンジ

// ヒートマップ設定
const BEAR_HEAT_OPTIONS = {
  radius:    18,
  blur:      22,
  maxZoom:   13,
  max:       1.0,
  pane:      'paneBearHeat',
  gradient:  { 0.2: "#9c27b0", 0.5: "#e91e8c", 0.8: "#f44336", 1.0: "#8b0000" },
};

// KML 対応県マスタ（県セレクタ用）
const BEAR_PREF_LIST = [
  { pref: "北海道",         kml: false },
  { pref: "青森県",         kml: true  },
  { pref: "岩手県",         kml: false },
  { pref: "宮城県",         kml: true  },
  { pref: "秋田県",         kml: false },
  { pref: "山形県",         kml: true  },
  { pref: "福島県",         kml: true  },
  { pref: "茨城県",         kml: false },
  { pref: "栃木県",         kml: true  },
  { pref: "群馬県",         kml: false },
  { pref: "埼玉県",         kml: false },
  { pref: "千葉県",         kml: false },
  { pref: "東京都",         kml: true  },
  { pref: "神奈川県",       kml: false },
  { pref: "新潟県",         kml: false },
  { pref: "富山県",         kml: true  },
  { pref: "石川県",         kml: true  },
  { pref: "福井県",         kml: false },
  { pref: "山梨県",         kml: false },
  { pref: "長野県",         kml: false },
  { pref: "岐阜県",         kml: false },
  { pref: "静岡県",         kml: true  },
  { pref: "愛知県",         kml: false },
  { pref: "三重県",         kml: false },
  { pref: "滋賀県",         kml: true  },
  { pref: "京都府",         kml: false },
  { pref: "大阪府",         kml: false },
  { pref: "兵庫県",         kml: false },
  { pref: "奈良県",         kml: true  },
  { pref: "和歌山県",       kml: false },
  { pref: "島根県・鳥取県", kml: true  },
  { pref: "岡山県",         kml: false },
  { pref: "広島県",         kml: false },
  { pref: "山口県",         kml: false },
  { pref: "徳島県",         kml: false },
  { pref: "香川県",         kml: false },
  { pref: "愛媛県",         kml: false },
  { pref: "高知県",         kml: false },
  { pref: "福岡県",         kml: false },
  { pref: "佐賀県",         kml: false },
  { pref: "長崎県",         kml: false },
  { pref: "熊本県",         kml: false },
  { pref: "大分県",         kml: false },
  { pref: "宮崎県",         kml: false },
  { pref: "鹿児島県",       kml: false },
  { pref: "沖縄県",         kml: false },
];

const BEAR_PREF_ALL_VALUE = "__all__";

// ---------------------------------------------------------------------------
// モジュールスコープ変数
// ---------------------------------------------------------------------------

let bearHeatLayer    = null;             // L.heatLayer インスタンス
let bearPinLayer     = null;              // L.markerClusterGroup（initBearLayer内で初期化）
let bearHeatData     = [];               // [[lat,lng], ...] 全件
let bearPinsData     = [];               // 直近90日・全フィールド
let bearFilteredPref = BEAR_PREF_ALL_VALUE;
let bearVisible      = false;

// ---------------------------------------------------------------------------
// ユーティリティ（プライベート）
// ---------------------------------------------------------------------------

function _bearDaysAgo(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d)) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function _bearColor(daysAgo) {
  if (daysAgo <= 30) return BEAR_COLOR_FRESH;
  return BEAR_COLOR_RECENT;
}

function _bearIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div class="bear-pin" style="--bear-color:${color}"><span class="bear-pin__emoji">🐻</span></div>`,
    iconSize:    [32, 32],
    iconAnchor:  [16, 32],
    popupAnchor: [0, -34],
  });
}

function _bearPopupHtml(r) {
  const dateLabel  = r.date  || "日時不明";
  const placeLabel = r.place || "場所不明";
  const detailHtml = r.detail
    ? `<p class="bear-popup__detail">${_escHtml(r.detail)}</p>` : "";
  return `
    <div class="bear-popup">
      <div class="bear-popup__header">
        <span class="bear-popup__emoji">🐻</span>
        <span class="bear-popup__pref">${_escHtml(r.pref)}</span>
        <span class="bear-popup__kml-badge">✅ KMLデータ</span>
      </div>
      <div class="bear-popup__date">${_escHtml(dateLabel)}</div>
      <div class="bear-popup__place">${_escHtml(placeLabel)}</div>
      ${detailHtml}
    </div>`;
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _kmlPrefSet() {
  return new Set(BEAR_PREF_LIST.filter(p => p.kml).map(p => p.pref));
}

// ---------------------------------------------------------------------------
// レイヤー描画
// ---------------------------------------------------------------------------

/** ヒートマップを再描画する */
function _renderBearHeat() {
  if (bearHeatLayer) {
    map.removeLayer(bearHeatLayer);
    bearHeatLayer = null;
  }
  if (!bearVisible) return;

  const kmlSet = _kmlPrefSet();

  // 県フィルタ：heat は座標のみなのでフィルタなし（全件表示）
  // ただし将来的に県フィルタに対応する場合は pins データと突合が必要
  const points = bearHeatData.map(([lat, lng]) => [lat, lng, 1]);
  if (points.length === 0) return;

  bearHeatLayer = L.heatLayer(points, BEAR_HEAT_OPTIONS).addTo(map);
}

/** ピンレイヤーを再描画する */
function _renderBearPins() {
  bearPinLayer.clearLayers();
  if (!bearVisible) return;

  const kmlSet = _kmlPrefSet();
  let records = bearPinsData;

  // 県フィルタ適用
  if (bearFilteredPref === BEAR_PREF_ALL_VALUE) {
    records = records.filter(r => kmlSet.has(r.pref));
  } else {
    records = records.filter(r => r.pref === bearFilteredPref);
  }

  records.forEach(r => {
    const daysAgo = _bearDaysAgo(r.date);
    const color   = _bearColor(daysAgo);
    const icon    = _bearIcon(color);
    L.marker([r.lat, r.lng], { icon })
      .bindPopup(_bearPopupHtml(r), { maxWidth: 280, className: "bear-popup-wrapper" })
      .addTo(bearPinLayer);
  });

  // カウンターバッジ更新
  const counter = document.getElementById("bear-count-badge");
  if (counter) counter.textContent = `直近${records.length}件`;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/** bears_heat.json と bears_pins.json を並行fetchして初期化する */
async function initBearLayer() {
  // markerClusterGroup を初期化（L.markercluster が読み込まれてから実行）
  bearPinLayer = L.markerClusterGroup({
    maxClusterRadius: 60,       // クラスター半径（px）
    disableClusteringAtZoom: 14, // Z14以上で個別ピン表示
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: (cluster) => {
      const count = cluster.getChildCount();
      const size  = count < 10 ? 32 : count < 50 ? 40 : 48;
      return L.divIcon({
        html: `<div class="bear-cluster"><span>🐻</span><b>${count}</b></div>`,
        className: "",
        iconSize: [size, size],
      });
    },
  });

  try {
    const [heatResp, pinsResp] = await Promise.all([
      fetch(BEARS_HEAT_URL),
      fetch(BEARS_PINS_URL),
    ]);
    if (heatResp.ok) bearHeatData = await heatResp.json();
    if (pinsResp.ok) bearPinsData = await pinsResp.json();

    console.log(`[bears] heat:${bearHeatData.length}件 pins:${bearPinsData.length}件 ロード完了`);
  } catch (err) {
    console.warn("[bears] データ取得失敗:", err);
  }
}

/** 熊レイヤー（ヒートマップ＋ピン）の表示/非表示を切り替える */
function setBearLayerVisible(visible) {
  bearVisible = visible;
  _renderBearHeat();

  if (visible) {
    if (!map.hasLayer(bearPinLayer)) bearPinLayer.addTo(map);
  } else {
    if (map.hasLayer(bearPinLayer)) map.removeLayer(bearPinLayer);
  }
  _renderBearPins();

  // フロートボタンの active クラスを同期
  const btn = document.getElementById("btn-bear");
  if (btn) btn.classList.toggle("active", visible);
  // 設定タブのチェックボックスも同期
  const chk = document.getElementById("bear-layer-toggle");
  if (chk) chk.checked = visible;
}

/** 熊レイヤーのON/OFFをトグルする（フロートボタン用） */
function toggleBearLayer() {
  // OFFにする場合はゲートなし
  if(bearVisible){ setBearLayerVisible(false); return; }
  // ONにする場合はプレミアムチェック
  isPremiumUser().then(premium => {
    if(!premium){ showPremiumGate('bear_layer'); return; }
    setBearLayerVisible(true);
  });
}

/** 現在の表示状態を返す */
function isBearLayerVisible() {
  return bearVisible;
}

/** 県フィルタを変更してピンを再描画する（ヒートマップは全県固定） */
function setBearPrefFilter(prefValue) {
  bearFilteredPref = prefValue;

  // bearVisible に関わらずカウントバッジだけは常に更新する
  const kmlSet = _kmlPrefSet();
  let records = bearPinsData;
  if (prefValue === BEAR_PREF_ALL_VALUE) {
    records = records.filter(r => kmlSet.has(r.pref));
  } else {
    records = records.filter(r => r.pref === prefValue);
  }
  const counter = document.getElementById('bear-count-badge');
  if (counter) counter.textContent = `直近${records.length}件`;

  // 表示中のときのみピンを再描画
  if (bearVisible) _renderBearPins();
}

function getBearPrefFilter()  { return bearFilteredPref; }
function getBearPrefList()    { return BEAR_PREF_LIST; }