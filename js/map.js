'use strict';
const map=L.map('map',{center:[36.5,137.5],zoom:7,zoomControl:true,rotate:true,bearing:0});
map.zoomControl.setPosition('bottomright');
let TILES={}, curBase='photo'; // デフォルト: 航空写真

async function initMap(){
  await openDB().catch(()=>console.warn('IndexedDB unavailable'));

  // ── レイヤー順序用カスタムpane（zIndex大きい順が上）
  // 400: ベースタイル（デフォルト tilePane=200 より上で管理）
  // カスタムpane zIndex設定
  // Leafletデフォルト: tilePane=200, shadowPane=500, overlayPane=400, markerPane=600, popupPane=700
  map.createPane('paneGeo');  // 地質図タイル（ベースの上・マーカーの下）
  map.getPane('paneGeo').style.zIndex = 450;
  map.createPane('paneHeat'); // ヒートマップ（地質図の上・マーカーの下）
  map.getPane('paneHeat').style.zIndex = 460;
  map.createPane('paneGsj');   // 鉱床・鉱徴地マーカー（地質図の上）
  map.getPane('paneGsj').style.zIndex = 610;
  map.createPane('paneWiki');  // Wikidataマーカー
  map.getPane('paneWiki').style.zIndex = 612;
  map.createPane('paneKinno'); // 位置情報DBマーカー
  map.getPane('paneKinno').style.zIndex = 615;
  map.createPane('paneMine');  // 砂金DBピン
  map.getPane('paneMine').style.zIndex = 620;
  map.createPane('paneUser'); // ユーザーピン（最上位）
  map.getPane('paneUser').style.zIndex = 630;
  // ポップアップ・ツールチップを全カスタムpane(最大630)より確実に上に
  map.getPane('tooltipPane').style.zIndex = 850;
  map.getPane('shadowPane').style.zIndex  = 890;
  map.getPane('popupPane').style.zIndex   = 900;

  const mk=key=>{
    const CLS=makeCachedLayer(key);
    return new CLS(SRCS[key].url,{
      attribution:SRCS[key].attr,
      maxNativeZoom:key==='topo'?17:18,
      maxZoom:18,
    });
  };
  TILES={std:mk('std'),photo:mk('photo'),topo:mk('topo')};
  // デフォルト: 航空写真
  TILES.photo.addTo(map);
  curBase='photo';
  document.getElementById('btn-photo').classList.add('base-active','active');
  // 右フロートボタン: デフォルトは全てOFF
  // mineLayerは起動時に追加しない（ボタンもactive付けない）
  document.getElementById('btn-mine').classList.remove('active');
  loadPts();
  updBaseEst();
  refreshCache();
  checkResume();
  // 産総研レイヤー初期化（キャッシュ確認のみ・自動表示はしない）
  initGsjLayer();
  // kinno調査記レイヤー初期化（組み込みデータ・即時）
  initKinnoLayer();
  // Wikidataレイヤー初期化（起動時に自動fetch）
  initWikiLayer();
  // 右フロートボタン位置をシームレスバー分下にオフセット
  // レイアウト確定後に計算するため requestAnimationFrame を使う
  requestAnimationFrame(()=>{ updateRightFloatTop(); });
}

function setBase(k){
  map.removeLayer(TILES[curBase]); TILES[k].addTo(map); curBase=k;
  ['std','photo','topo'].forEach(b=>{
    const btn=document.getElementById('btn-'+b);
    btn.classList.remove('base-active','active');
    if(b===k) btn.classList.add('base-active','active');
  });
}




// ── 右フロートボタン位置をシームレスバー分下にオフセット ──
function updateRightFloatTop(){
  const bar = document.getElementById('float-ctrl');
  if(!bar) return;
  const sbH = parseInt(getComputedStyle(document.documentElement)
                .getPropertyValue('--sb-h')) || 30;
  const barBottom = bar.getBoundingClientRect().bottom;
  const top = barBottom + 8;
  document.getElementById('float-ctrl-right').style.top = top + 'px';
}

// 地質図
let geoL=null,geoOn=false;
function toggleGeo(){
  geoOn=!geoOn;
  const btn=document.getElementById('btn-geo');
  btn.classList.toggle('active',geoOn);
  document.getElementById('geo-row').classList.toggle('show',geoOn);
  if(geoOn){
    if(!geoL) geoL=L.tileLayer('https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png',
      {attribution:'産総研シームレス地質図',maxNativeZoom:13,maxZoom:18,opacity:.5,pane:'paneGeo'});
    geoL.addTo(map);
  } else {
    if(geoL){ map.removeLayer(geoL); }
  }
}
function setGeoOp(v){document.getElementById('geo-opv').textContent=v+'%'; if(geoL)geoL.setOpacity(v/100);}
// ━━━ 水位警戒情報（気象庁XML） ━━━
// 洪水予報XML一覧フィード
const JMA_FLOOD_INDEX = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';

async function fetchFloodAlerts(){
  try {
    // CORSプロキシ経由で気象庁フィードを取得
    const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(JMA_FLOOD_INDEX);
    const res = await fetch(proxyUrl, {signal: AbortSignal.timeout(8000)});
    if(!res.ok) throw new Error('fetch failed');
    const text = await res.text();
    const parser = new DOMParser();
    const feed = parser.parseFromString(text, 'application/xml');
    const entries = [...feed.querySelectorAll('entry')];

    // 洪水予報・氾濫警戒情報のエントリを絞り込み
    const floodEntries = entries.filter(e=>{
      const title = e.querySelector('title')?.textContent || '';
      return /洪水|氾濫/.test(title);
    });

    if(!floodEntries.length){ _showWaterStatus('⚠️ 現在、洪水・氾濫情報はありません'); return; }

    // 各エントリのXMLを取得して河川名を抽出
    const names = new Set();
    await Promise.allSettled(floodEntries.slice(0,10).map(async e=>{
      const link = e.querySelector('link')?.getAttribute('href');
      if(!link) return;
      const xmlRes = await fetch('https://corsproxy.io/?' + encodeURIComponent(link),
        {signal: AbortSignal.timeout(6000)});
      if(!xmlRes.ok) return;
      const xmlText = await xmlRes.text();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      // 河川名はRiverName要素またはObjectName要素
      doc.querySelectorAll('RiverName, ObjectName, Name').forEach(el=>{
        const t = el.textContent.trim();
        if(t) names.add(t);
      });
    }));

    window.floodAlertNames = names;
    if(typeof refreshMineMarkers === 'function') refreshMineMarkers();

    const label = names.size
      ? `🚨 洪水警戒中: ${[...names].slice(0,3).join('・')}${names.size>3?'…':''}`
      : '⚠️ 洪水情報取得済み（河川名抽出なし）';
    _showWaterStatus(label);
  } catch(err){
    console.warn('fetchFloodAlerts:', err);
    _showWaterStatus('⚠️ 水位情報の取得に失敗しました');
  }
}

// 水位ステータストースト表示（3秒）
function _showWaterStatus(msg){
  let el = document.getElementById('water-status-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'water-status-toast';
    el.style.cssText = [
      'position:fixed','bottom:80px','left:50%','transform:translateX(-50%)',
      'background:rgba(0,20,40,0.88)','color:#7df','border:1px solid rgba(100,200,255,0.3)',
      'border-radius:8px','padding:8px 16px','font-size:12px','z-index:9999',
      'pointer-events:none','transition:opacity .4s','backdrop-filter:blur(8px)'
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(()=>{ el.style.opacity='0'; }, 4000);
}
