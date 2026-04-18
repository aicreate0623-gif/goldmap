// =============================================================================
// 熊レイヤートグル UI v2 - 県フィルタセレクタ対応版
// ui.js の Settings タブ初期化処理に組み込む差分コード。
//
// 組み込み方法:
//   1. Settings タブパネルに以下を追加:
//      <div class="settings-section" id="bear-settings-section"></div>
//   2. Settings タブの表示イベントまたは initSettings() 内で呼ぶ:
//      initBearToggle();
// =============================================================================

/**
 * Settings タブの熊セクションを初期化する。
 * ・ON/OFF トグル
 * ・県セレクタ（KML 対応県のみ選択可能、非対応はグレーアウト）
 * ・凡例 + 件数バッジ
 */
function initBearToggle() {
  const section = document.getElementById("bear-settings-section");
  if (!section) {
    console.warn("[bear-ui] #bear-settings-section が見つかりません");
    return;
  }

  const initialChecked = isBearLayerVisible();

  // ------- セレクタ HTML を構築 -------
  const prefList    = getBearPrefList();           // bear_layer_map.js の公開 API
  const currentPref = getBearPrefFilter();

  // <option> を生成
  // 先頭: 全 KML 対応県（__all__）
  let optionsHtml = `
    <option value="__all__" ${currentPref === "__all__" ? "selected" : ""}>
      ✅ 全 KML 対応県（11県）
    </option>`;

  prefList.forEach(({ pref, kml }) => {
    if (kml) {
      // KML 対応 → 選択可能、✅ バッジ付き
      optionsHtml += `
        <option value="${pref}" ${currentPref === pref ? "selected" : ""}>
          ✅ ${pref}
        </option>`;
    } else {
      // KML 非対応 → disabled + グレーアウト
      optionsHtml += `
        <option value="${pref}" disabled>
          ${pref}（データなし）
        </option>`;
    }
  });

  // ------- セクション全体の HTML -------
  section.innerHTML = `
    <!-- ON/OFF トグル行 -->
    <div class="settings-row bear-toggle-row">
      <div class="settings-row__label">
        <span class="settings-row__icon">🐻</span>
        <div class="settings-row__text">
          <div class="settings-row__title">
            熊出没情報
            <span class="bear-kml-chip">✅ KMLデータ</span>
          </div>
          <div class="settings-row__sub">生息域ヒートマップ＋直近90日ピン</div>
        </div>
      </div>
      <label class="toggle-switch" aria-label="熊出没情報の表示">
        <input type="checkbox" id="bear-layer-toggle"
               ${initialChecked ? "checked" : ""} />
        <span class="toggle-switch__track"></span>
      </label>
    </div>

    <!-- 展開パネル（トグル ON 時のみ表示） -->
    <div id="bear-detail-panel" style="display:${initialChecked ? "block" : "none"}">

      <!-- 県セレクタ -->
      <div class="bear-pref-selector-wrap">
        <label class="bear-pref-label" for="bear-pref-select">
          表示する県
          <span class="bear-count-wrap">
            <span id="bear-count-badge" class="bear-count-badge">0件</span>
          </span>
        </label>
        <select id="bear-pref-select" class="bear-pref-select">
          ${optionsHtml}
        </select>
        <p class="bear-pref-note">
          ✅ マークはKML公開データ対応県です。
          対応県のデータは行政の公式マップから取得しています。
        </p>
      </div>

      <!-- 凡例 -->
      <div class="bear-toggle-legend">
        <span class="bear-legend-heat"></span><span>生息域ヒートマップ（全件）</span>
        <span class="bear-legend-dot bear-legend-dot--fresh"></span><span>30日以内ピン</span>
        <span class="bear-legend-dot bear-legend-dot--recent"></span><span>90日以内ピン</span>
      </div>

    </div>`;

  // ------- イベントリスナー -------
  const checkbox   = document.getElementById("bear-layer-toggle");
  const panel      = document.getElementById("bear-detail-panel");
  const prefSelect = document.getElementById("bear-pref-select");

  // トグル ON/OFF
  checkbox.addEventListener("change", () => {
    const checked = checkbox.checked;
    setBearLayerVisible(checked);
    panel.style.display = checked ? "block" : "none";
  });

  // 県セレクタ変更 → フィルタ適用
  prefSelect.addEventListener("change", () => {
    setBearPrefFilter(prefSelect.value);
  });

  // 初期カウント表示（bears.json ロード済みなら即時反映）
  // ロード前の場合は initBearLayer() 完了後に _renderBearMarkers() が更新する
  setBearPrefFilter(currentPref);
}
