'use strict';
initMap();

// ── Firebase初期化 + heatmap.json反映 ──────────────────
(async () => {
  try {
    await initFirebase();
    await fetchHeatPoints();
  } catch (e) {
    // 認証失敗・オフライン時もマップ本体には影響しない
    console.warn('[app.js] Firebase init / fetchHeatPoints 失敗', e);
  }
})();

// ═══════════════════════════════════════════
//  地質図凡例マトリックス生成
//  出典: 産総研 シームレス地質図 V2 簡略版
//  色は公式タイルの実測値に準拠
// ═══════════════════════════════════════════
function buildGeoLegend(){
  // [時代ラベル, 時代コード]
  const AGES = [
    ['第四紀',       'Q',  '（約260万年前〜現在）'],
    ['新第三紀',     'N',  '（約2300万〜260万年前）'],
    ['古第三紀',     'Pg', '（約6600万〜2300万年前）'],
    ['白亜紀',       'K',  '（約1億4500万〜6600万年前）'],
    ['ジュラ紀',     'J',  '（約2億100万〜1億4500万年前）'],
    ['三畳紀〜古生代','Pz', '（約5億4100万〜2億年前）'],
  ];

  // [岩石種コード, 堆積岩色, 付加体色, 火成岩色, 変成岩色]
  const COLORS = {
    'Q':  ['#f5e678',    null,         '#f0a0c8',    null       ],
    'N':  ['#f5d830',    '#d4c87a',    '#78c878',    '#d8a0c8'  ],
    'Pg': ['#f0c050',    '#c8b860',    '#50b878',    '#c890b8'  ],
    'K':  ['#d4b878',    '#c0a050',    '#5898c8',    '#a868a8'  ],
    'J':  ['#c8a860',    '#b09040',    '#4878a8',    '#985898'  ],
    'Pz': ['#b89060',    '#a08030',    '#387898',    '#784878'  ],
  };

  const GOLD_FLAG = {
    'Q':  [true,  false, false, false],
    'N':  [false, false, true,  false],
    'Pg': [false, false, true,  false],
    'K':  [false, false, true,  true ],
    'J':  [false, false, true,  true ],
    'Pz': [false, false, false, true ],
  };

  const ROCK_DESC = [
    '砂・泥・礫などが固まった岩石\n河川・海底堆積物',
    '海洋プレートが沈み込む際に\n形成された複合岩体',
    'マグマが冷えて固まった岩石\n火山岩・深成岩など',
    '既存の岩石が熱・圧力で\n変化した岩石',
  ];

  const tbody = document.getElementById('geo-legend-body');
  if(!tbody) return;

  AGES.forEach(([label, code, period])=>{
    const cols = COLORS[code];
    const flags = GOLD_FLAG[code];
    const tr = document.createElement('tr');

    const tdAge = document.createElement('td');
    tdAge.style.cssText = `
      padding:6px 5px;
      border:1px solid rgba(255,255,255,0.1);
      color:var(--txt);font-size:10px;font-weight:700;
      white-space:nowrap;vertical-align:middle;
      background:rgba(0,0,0,0.25);
    `;
    tdAge.innerHTML = `<div>${label}</div><div style="font-size:8px;color:var(--txt-dim);font-weight:400;margin-top:1px;">${code}</div>`;
    tr.appendChild(tdAge);

    cols.forEach((color, i)=>{
      const td = document.createElement('td');
      td.style.cssText = `
        padding:0;
        border:1px solid rgba(255,255,255,0.1);
        text-align:center;vertical-align:middle;
        min-width:54px;
      `;
      if(color){
        const isGold = flags[i];
        td.innerHTML = `
          <div title="${ROCK_DESC[i]}" style="
            background:${color};
            height:34px;width:100%;
            display:flex;align-items:center;justify-content:center;
            font-size:${isGold?'13px':'9px'};
            color:rgba(0,0,0,0.65);font-weight:700;
            position:relative;cursor:default;
          ">
            ${isGold ? '★' : ''}
          </div>`;
      } else {
        td.innerHTML = `<div style="height:34px;background:rgba(255,255,255,0.03);"></div>`;
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  const trOther = document.createElement('tr');
  const extraItems = [
    {color:'#e85858', label:'活火山・\n火山岩'},
    {color:'#c8d8e8', label:'人工改変地\n・市街地'},
    {color:'#e0e8f0', label:'水域\n・海底'},
  ];
  const tdOtherHead = document.createElement('td');
  tdOtherHead.colSpan = 1;
  tdOtherHead.style.cssText=`padding:5px;border:1px solid rgba(255,255,255,0.1);
    color:var(--txt-sub);font-size:9px;background:rgba(0,0,0,0.25);vertical-align:middle;`;
  tdOtherHead.textContent='その他';
  trOther.appendChild(tdOtherHead);

  const tdOtherVal = document.createElement('td');
  tdOtherVal.colSpan = 4;
  tdOtherVal.style.cssText=`padding:5px 6px;border:1px solid rgba(255,255,255,0.1);`;
  tdOtherVal.innerHTML = extraItems.map(({color,label})=>`
    <span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:9px;color:var(--txt-sub);">
      <span style="display:inline-block;width:16px;height:16px;background:${color};
             border-radius:2px;border:1px solid rgba(0,0,0,0.2);flex-shrink:0;"></span>
      ${label.replace('\n','<br>')}
    </span>`).join('');
  trOther.appendChild(tdOtherVal);
  tbody.appendChild(trOther);
}

// DOMContentLoaded後に実行（確実にtbodyを取得するため）
document.addEventListener('DOMContentLoaded', buildGeoLegend);

// ── クマ出没レイヤーの初期化（追記箇所） ──────────────────
initBearLayer().then(() => {
  // 設定セクションが存在すればUIを初期化
  if (document.getElementById("bear-settings-section")) {
    initBearToggle();
  }
});