// =============================================================================
// 熊レイヤートグル UI v6 - 動的データ有無判定版
// kmlフラグ廃止 → getBearAvailPrefs() でデータ実在県を動的取得
// =============================================================================

const BEAR_REGION_GROUPS = [
  { label: "北海道・東北", icon: "🌲",
    prefs: ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県"] },
  { label: "関東", icon: "🗼",
    prefs: ["茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県"] },
  { label: "中部", icon: "🏔",
    prefs: ["新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県"] },
  { label: "近畿", icon: "⛩",
    prefs: ["三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県"] },
  { label: "中国・四国", icon: "🌊",
    prefs: ["島根県・鳥取県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県"] },
  { label: "九州・沖縄", icon: "🌺",
    prefs: ["福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"] },
];

function initBearToggle() {
  const body = document.getElementById("dlg-cfg-bear-body");
  if (!body) {
    console.warn("[bear-ui] #dlg-cfg-bear-body が見つかりません");
    return;
  }

  const menuItem = document.getElementById("bear-cfg-menu-item");
  if (menuItem) menuItem.style.display = '';

  // データ実在県をpinsから動的取得（kmlフラグ不要）
  const availSet = getBearAvailPrefs();

  const current   = getBearPrefFilter();
  const isAllMode = Array.isArray(current) ? current.includes('__all__') : current === '__all__';
  const checkedSet = isAllMode
    ? new Set(availSet)  // 全データ対応県をチェック済みにする
    : new Set(Array.isArray(current) ? current : [current]);

  let html = `
    <p class="bear-description">公開データや行政公式マップ等から取得しています。生息域を示すことが基本ベースで、リアルタイムで更新されない地域もあります。</p>

    <div class="bear-filter-header">
      <span id="bear-count-badge" class="bear-count-badge">0件</span>
      <button class="bear-filter-all-btn" onclick="_bearSelectAll(true)">全選択</button>
      <button class="bear-filter-all-btn" onclick="_bearSelectAll(false)">全解除</button>
    </div>

    <div class="bear-region-list">`;

  BEAR_REGION_GROUPS.forEach((group, gi) => {
    // データが実在する県のみカウント
    const availCount   = group.prefs.filter(p => availSet.has(p)).length;
    const checkedCount = group.prefs.filter(p => availSet.has(p) && checkedSet.has(p)).length;
    const regionId = `bear-region-${gi}`;

    html += `
      <div class="bear-region-block">
        <div class="bear-region-header" onclick="_bearToggleRegion(${gi})">
          <span class="bear-region-icon">${group.icon}</span>
          <span class="bear-region-label">${group.label}</span>
          <span class="bear-region-count" id="bear-rcount-${gi}">${checkedCount}/${availCount}</span>
          <span class="bear-region-arrow" id="bear-rarrow-${gi}">▶</span>
        </div>
        <div class="bear-region-body" id="${regionId}" style="display:none">
          <div class="bear-pref-grid">`;

    group.prefs.forEach(pref => {
      // データが実在する県のみ有効、それ以外はdisabled
      const hasData  = availSet.has(pref);
      const checked  = hasData && checkedSet.has(pref) ? 'checked' : '';
      const disabled = hasData ? '' : 'disabled';
      const cls      = hasData ? 'bear-pref-item' : 'bear-pref-item bear-pref-item--disabled';
      html += `
            <label class="${cls}">
              <input type="checkbox" class="bear-pref-ck" data-pref="${pref}" data-gi="${gi}"
                ${checked} ${disabled} onchange="_bearOnCheck()">
              <span class="bear-pref-name">${pref}</span>
            </label>`;
    });

    html += `
          </div>
          <div class="bear-region-btns">
            <button class="bear-region-toggle-btn" onclick="_bearRegionAll(${gi}, true)">地方全選択</button>
            <button class="bear-region-toggle-btn" onclick="_bearRegionAll(${gi}, false)">地方解除</button>
          </div>
        </div>
      </div>`;
  });

  html += `
    </div>

    <div class="bear-toggle-legend">
      <span class="bear-legend-heat"></span><span>生息域ヒートマップ</span>
      <span class="bear-legend-dot bear-legend-dot--fresh"></span><span>30日以内</span>
      <span class="bear-legend-dot bear-legend-dot--recent"></span><span>90日以内</span>
    </div>`;

  body.innerHTML = html;
  _bearOnCheck();
}

function _bearToggleRegion(gi) {
  const body  = document.getElementById(`bear-region-${gi}`);
  const arrow = document.getElementById(`bear-rarrow-${gi}`);
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  if (arrow) arrow.textContent = open ? '▼' : '▶';
}

function _bearOnCheck() {
  const allCks  = document.querySelectorAll('.bear-pref-ck:not(:disabled)');
  const checked = Array.from(allCks).filter(ck => ck.checked).map(ck => ck.dataset.pref);

  // 地方ごとのカウント表示を更新
  const availSet = getBearAvailPrefs();
  BEAR_REGION_GROUPS.forEach((group, gi) => {
    const availCount   = group.prefs.filter(p => availSet.has(p)).length;
    const checkedCount = group.prefs.filter(p => availSet.has(p) && checked.includes(p)).length;
    const el = document.getElementById(`bear-rcount-${gi}`);
    if (el) el.textContent = `${checkedCount}/${availCount}`;
  });

  const filterVal = checked.length > 0 ? checked : ['__all__'];
  setBearPrefFilter(filterVal);
  _updateBearMenuSub(filterVal);
}

function _bearSelectAll(select) {
  document.querySelectorAll('.bear-pref-ck:not(:disabled)').forEach(ck => {
    ck.checked = select;
  });
  _bearOnCheck();
}

function _bearRegionAll(gi, select) {
  const group = BEAR_REGION_GROUPS[gi];
  group.prefs.forEach(pref => {
    const ck = document.querySelector(`.bear-pref-ck[data-pref="${pref}"]`);
    if (ck && !ck.disabled) ck.checked = select;
  });
  _bearOnCheck();
}

function _updateBearMenuSub(filterVal) {
  const sub = document.getElementById('bear-cfg-menu-sub');
  if (!sub) return;
  if (!filterVal || filterVal.includes('__all__')) {
    sub.textContent = '全データ対応県表示中';
  } else if (filterVal.length === 1) {
    sub.textContent = `${filterVal[0]}表示中`;
  } else {
    sub.textContent = `${filterVal.length}県選択中`;
  }
}
