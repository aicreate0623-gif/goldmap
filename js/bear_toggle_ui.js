// =============================================================================
// 熊レイヤートグル UI v7 - 地方2列グリッド＋都道府県サブダイアログ版
// =============================================================================

const BEAR_REGION_GROUPS = [
  { label: "北海道・東北",
    prefs: ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県"] },
  { label: "関東",
    prefs: ["茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県"] },
  { label: "中部",
    prefs: ["新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県"] },
  { label: "近畿",
    prefs: ["三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県"] },
  { label: "中国・四国",
    prefs: ["島根県・鳥取県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県"] },
  { label: "九州・沖縄",
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

  const availSet  = getBearAvailPrefs();
  const current   = getBearPrefFilter();
  const isAllMode = Array.isArray(current) ? current.includes('__all__') : current === '__all__';
  const checkedSet = isAllMode
    ? new Set(availSet)
    : new Set(Array.isArray(current) ? current : [current]);

  let html = `
    <p class="bear-description">公開データや行政公式マップ等から取得しています。生息域を示すことが基本ベースで、リアルタイムで更新されない地域もあります。</p>

    <div class="bear-filter-header">
      <span id="bear-count-badge" class="bear-count-badge">0件</span>
      <button class="bear-filter-all-btn" onclick="_bearSelectAll(true)">全選択</button>
      <button class="bear-filter-all-btn" onclick="_bearSelectAll(false)">全解除</button>
    </div>

    <div class="bear-region-grid">`;

  BEAR_REGION_GROUPS.forEach((group, gi) => {
    const availCount   = group.prefs.filter(p => availSet.has(p)).length;
    const checkedCount = group.prefs.filter(p => availSet.has(p) && checkedSet.has(p)).length;

    html += `
      <button class="bear-region-btn" onclick="_bearOpenPrefDlg(${gi})">
        <span class="bear-region-btn-label">${group.label}</span>
        <span class="bear-region-btn-badge" id="bear-rcount-${gi}">${checkedCount}/${availCount}</span>
      </button>`;
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

/* ── 都道府県サブダイアログを開く ── */
function _bearOpenPrefDlg(gi) {
  const group    = BEAR_REGION_GROUPS[gi];
  const availSet = getBearAvailPrefs();
  const current  = getBearPrefFilter();
  const isAllMode = Array.isArray(current) ? current.includes('__all__') : current === '__all__';
  const checkedSet = isAllMode
    ? new Set(availSet)
    : new Set(Array.isArray(current) ? current : [current]);

  // タイトル
  document.getElementById('bear-pref-dlg-title').textContent = group.label;

  // 都道府県グリッド生成
  const grid = document.getElementById('bear-pref-dlg-grid');
  grid.innerHTML = '';
  group.prefs.forEach(pref => {
    const hasData = availSet.has(pref);
    const label   = document.createElement('label');
    label.className = hasData ? 'bear-pref-item' : 'bear-pref-item bear-pref-item--disabled';
    label.innerHTML = `
      <input type="checkbox" class="bear-pref-ck" data-pref="${pref}" data-gi="${gi}"
        ${hasData && checkedSet.has(pref) ? 'checked' : ''}
        ${hasData ? '' : 'disabled'}
        onchange="_bearOnCheck()">
      <span class="bear-pref-name">${pref}</span>`;
    grid.appendChild(label);
  });

  // 地方全選択／解除ボタンのgi更新
  document.getElementById('bear-pref-dlg-all').onclick    = () => _bearRegionAll(gi, true);
  document.getElementById('bear-pref-dlg-none').onclick   = () => _bearRegionAll(gi, false);

  // サブダイアログ表示
  document.getElementById('dlg-bear-pref').style.display = 'flex';
}

/* ── サブダイアログを閉じる ── */
function closeBearPrefDlg() {
  document.getElementById('dlg-bear-pref').style.display = 'none';
}

/* ── チェック変更時の処理 ── */
function _bearOnCheck() {
  const allCks  = document.querySelectorAll('.bear-pref-ck:not(:disabled)');
  const checked = Array.from(allCks).filter(ck => ck.checked).map(ck => ck.dataset.pref);

  // 地方ボタンのバッジを更新
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
