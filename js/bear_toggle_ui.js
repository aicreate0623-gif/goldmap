// =============================================================================
// 熊レイヤートグル UI v4 - ダイアログ形式・6地方セレクタ対応版
// =============================================================================

function initBearToggle() {
  // ダイアログ内のbodyに描画
  const body = document.getElementById("dlg-cfg-bear-body");
  if (!body) {
    console.warn("[bear-ui] #dlg-cfg-bear-body が見つかりません");
    return;
  }

  // 設定タブのcfg-menu-itemを表示（プレミアム時のみ表示する場合は呼び出し元で制御）
  const menuItem = document.getElementById("bear-cfg-menu-item");
  if (menuItem) menuItem.style.display = '';

  const currentPref = getBearPrefFilter();

  // ------- 6地方グループ定義 -------
  const REGION_GROUPS = [
    {
      label: "北海道・東北",
      prefs: ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県"],
    },
    {
      label: "関東",
      prefs: ["茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県"],
    },
    {
      label: "中部",
      prefs: ["新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県"],
    },
    {
      label: "近畿",
      prefs: ["三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県"],
    },
    {
      label: "中国・四国",
      prefs: ["島根県・鳥取県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県"],
    },
    {
      label: "九州・沖縄",
      prefs: ["福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"],
    },
  ];

  // prefList をマップ化
  const prefList = getBearPrefList();
  const prefMap  = {};
  prefList.forEach(p => { prefMap[p.pref] = p.kml; });

  // ------- optgroup HTML 構築 -------
  let optionsHtml = `
    <option value="__all__" ${currentPref === "__all__" ? "selected" : ""}>
      ✅ 全 KML 対応県
    </option>`;

  REGION_GROUPS.forEach(({ label, prefs }) => {
    optionsHtml += `<optgroup label="${label}">`;
    prefs.forEach(pref => {
      const kml = prefMap[pref] || false;
      if (kml) {
        optionsHtml += `
          <option value="${pref}" ${currentPref === pref ? "selected" : ""}>
            ✅ ${pref}
          </option>`;
      } else {
        optionsHtml += `
          <option value="${pref}" disabled>
            ${pref}（データなし）
          </option>`;
      }
    });
    optionsHtml += `</optgroup>`;
  });

  // ------- ダイアログ内HTML -------
  body.innerHTML = `
    <p class="bear-description">公開データや行政公式マップ等から取得しています。生息域を示すことが基本ベースで、リアルタイムで更新されない地域もあります。</p>

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
        ✅ マークはKML公開データ対応県です。<br>
        対応県のデータは行政の公式マップから取得しています。<br>
        未対応県はkumamap等の全国データを表示します。
      </p>
    </div>

    <!-- 凡例 -->
    <div class="bear-toggle-legend">
      <span class="bear-legend-heat"></span><span>生息域ヒートマップ（全件）</span>
      <span class="bear-legend-dot bear-legend-dot--fresh"></span><span>30日以内ピン</span>
      <span class="bear-legend-dot bear-legend-dot--recent"></span><span>90日以内ピン</span>
    </div>`;

  // ------- イベントリスナー -------
  const prefSelect = document.getElementById("bear-pref-select");
  prefSelect.addEventListener("change", () => {
    setBearPrefFilter(prefSelect.value);
    _updateBearMenuSub(prefSelect.value);
  });

  // 初期カウント・サブテキスト更新
  setBearPrefFilter(currentPref);
  _updateBearMenuSub(currentPref);
}

/** 設定メニューのサブテキストを選択県に合わせて更新 */
function _updateBearMenuSub(prefValue) {
  const sub = document.getElementById('bear-cfg-menu-sub');
  if (!sub) return;
  sub.textContent = prefValue === '__all__' ? '全KML対応県表示中' : `${prefValue}表示中`;
}
