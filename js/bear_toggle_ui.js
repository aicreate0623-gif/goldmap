// =============================================================================
// 熊レイヤートグル UI v8 - 地方2列グリッド＋都道府県サブダイアログ版
// （地方をまたいだ選択保持のため、選択状態はグローバルSetで一元管理する）
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

// 選択中の都道府県を地方をまたいで保持するグローバル状態。
// サブダイアログはその時開いている地方の県しかDOMに存在しないため、
// ここで一元管理してDOM状態・実フィルター状態と同期する。
let _bearCheckedPrefs = new Set();

function initBearToggle() {
  const body = document.getElementById("dlg-cfg-bear-body");
  if (!body) {
    console.warn("[bear-ui] #dlg-cfg-bear-body が見つかりません");
    return;
  }

  const menuItem = document.getElementById("bear-cfg-menu-item");
  if (menuItem) menuItem.style.display = '';

  const availSet = getBearAvailPrefs();
  const current  = getBearPrefFilter();
  const isAllMode = Array.isArray(current) ? current.includes('__all__') : current === '__all__';
  _bearCheckedPrefs = isAllMode
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
    const checkedCount = group.prefs.filter(p => availSet.has(p) && _bearCheckedPrefs.has(p)).length;

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
  _bearRefreshBadgesAndFilter();
}

/* ── 都道府県サブダイアログを開く ── */
function _bearOpenPrefDlg(gi) {
  const group    = BEAR_REGION_GROUPS[gi];
  const availSet = getBearAvailPrefs();

  // タイトル
  document.getElementById('bear-pref-dlg-title').textContent = group.label;

  // 都道府県グリッド生成（表示は常にグローバル状態 _bearCheckedPrefs を反映）
  const grid = document.getElementById('bear-pref-dlg-grid');
  grid.innerHTML = '';
  group.prefs.forEach(pref => {
    const hasData = availSet.has(pref);
    const label   = document.createElement('label');
    label.className = hasData ? 'bear-pref-item' : 'bear-pref-item bear-pref-item--disabled';
    label.innerHTML = `
      <input type="checkbox" class="bear-pref-ck" data-pref="${pref}" data-gi="${gi}"
        ${hasData && _bearCheckedPrefs.has(pref) ? 'checked' : ''}
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

/* ── チェック変更時の処理 ──
   現在開いているサブダイアログ（＝今DOMに存在する地方分）のチェック状態だけを
   グローバル状態 _bearCheckedPrefs に反映する。他地方の選択は保持されたまま。 */
function _bearOnCheck() {
  document.querySelectorAll('.bear-pref-ck').forEach(ck => {
    if (ck.disabled) return;
    const pref = ck.dataset.pref;
    if (ck.checked) _bearCheckedPrefs.add(pref);
    else _bearCheckedPrefs.delete(pref);
  });

  _bearRefreshBadgesAndFilter();
}

/* ── 全地方のバッジ表示・実フィルターを _bearCheckedPrefs から再計算して反映 ── */
function _bearRefreshBadgesAndFilter() {
  const availSet = getBearAvailPrefs();

  BEAR_REGION_GROUPS.forEach((group, gi) => {
    const availCount   = group.prefs.filter(p => availSet.has(p)).length;
    const checkedCount = group.prefs.filter(p => availSet.has(p) && _bearCheckedPrefs.has(p)).length;
    const el = document.getElementById(`bear-rcount-${gi}`);
    if (el) el.textContent = `${checkedCount}/${availCount}`;
  });

  // 選択0件は「全非表示」として扱う（'__all__'へのフォールバックはしない）
  const filterVal = Array.from(_bearCheckedPrefs).filter(p => availSet.has(p));
  setBearPrefFilter(filterVal);
  _updateBearMenuSub(filterVal);
}

function _bearSelectAll(select) {
  const availSet = getBearAvailPrefs();
  _bearCheckedPrefs = select ? new Set(availSet) : new Set();

  // 現在サブダイアログが開いていれば、表示中のチェックボックスにも反映
  document.querySelectorAll('.bear-pref-ck').forEach(ck => {
    if (!ck.disabled) ck.checked = _bearCheckedPrefs.has(ck.dataset.pref);
  });

  _bearRefreshBadgesAndFilter();
}

function _bearRegionAll(gi, select) {
  const group    = BEAR_REGION_GROUPS[gi];
  const availSet = getBearAvailPrefs();
  group.prefs.forEach(pref => {
    if (!availSet.has(pref)) return;
    if (select) _bearCheckedPrefs.add(pref);
    else _bearCheckedPrefs.delete(pref);
    const ck = document.querySelector(`.bear-pref-ck[data-pref="${pref}"]`);
    if (ck && !ck.disabled) ck.checked = select;
  });
  _bearRefreshBadgesAndFilter();
}

function _updateBearMenuSub(filterVal) {
  const sub = document.getElementById('bear-cfg-menu-sub');
  if (!sub) return;
  if (!filterVal || filterVal.includes('__all__')) {
    sub.textContent = '全データ対応県表示中';
  } else if (filterVal.length === 0) {
    sub.textContent = '非表示（未選択）';
  } else if (filterVal.length === 1) {
    sub.textContent = `${filterVal[0]}表示中`;
  } else {
    sub.textContent = `${filterVal.length}県選択中`;
  }
}
