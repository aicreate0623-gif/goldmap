'use strict';
const map=L.map('map',{center:[36.5,137.5],zoom:7,zoomControl:true});
map.zoomControl.setPosition('bottomright');
L.control.scale({imperial:false, position:'bottomleft'}).addTo(map);

// ズーム値バッジ更新
function _updZoomBadge(){
  const el = document.getElementById('zoom-level-val');
  if(el) el.textContent = map.getZoom();
}
map.on('zoomend', _updZoomBadge);
_updZoomBadge();
let TILES={}, curBase='photo'; // デフォルト: 航空写真

async function initMap(){
  await openDB().catch(()=>console.warn('IndexedDB unavailable'));

  // ── レイヤー順序用カスタムpane（zIndex大きい順が上）
  // 400: ベースタイル（デフォルト tilePane=200 より上で管理）
  // カスタムpane zIndex設定
  // Leafletデフォルト: tilePane=200, shadowPane=500, overlayPane=400, markerPane=600, popupPane=700
  map.createPane('paneRelief'); // 色別標高図（ベースの上・陰影の下）
  map.getPane('paneRelief').style.zIndex = 440;
  map.createPane('paneHill'); // 陰影起伏図（色別標高の上・地質図の下）
  map.getPane('paneHill').style.zIndex = 445;
  map.createPane('paneGeo');  // 地質図タイル（ベースの上・マーカーの下）
  map.getPane('paneGeo').style.zIndex = 450;
  map.createPane('paneBearHeat'); // 熊ヒートマップ（地質図の上・砂金の下）
  map.getPane('paneBearHeat').style.zIndex = 459;
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

  const _nativeZooms={std:18,photo:18,topo:17,hill:16,relief:15};
  const mk=(key,extraOpts={})=>{
    const CLS=makeCachedLayer(key);
    return new CLS(SRCS[key].url,{
      attribution:SRCS[key].attr,
      maxNativeZoom:_nativeZooms[key]??18,
      maxZoom:18,
      ...extraOpts,
    });
  };
  TILES={
    std:    mk('std'),
    photo:  mk('photo'),
    topo:   mk('topo'),
    hill:   mk('hill',   {pane:'paneHill',   opacity:0.5}),
    relief: mk('relief', {pane:'paneRelief', opacity:0.5}),
  };
  // デフォルト: 航空写真
  TILES.photo.addTo(map);
  curBase='photo';
  document.getElementById('btn-photo').classList.add('base-active','active');
  // 右フロートボタン: デフォルトは全てOFF
  // mineLayerは起動時に追加しない（ボタンもactive付けない）
  document.getElementById('btn-mine').classList.remove('active');
  loadPts();
  refreshCache();
  checkResume();
  // 産総研レイヤー初期化（キャッシュ確認のみ・自動表示はしない）
  initGsjLayer();
  loadMineData(); // 起動時にバックグラウンドで描画準備
  // kinno調査記レイヤー初期化（組み込みデータ・即時）
  initKinnoLayer();
  // Wikidataレイヤー初期化（起動時に自動fetch）
  initWikiLayer();
  // マイMAPレイヤー初期化（IndexedDBからロード）
  initCustomLayer();
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

// ── 透過値のlocalStorage保存・復元ユーティリティ ──
function _loadOp(key){ return parseFloat(localStorage.getItem(key) ?? '50'); }
function _saveOp(key, v){ localStorage.setItem(key, v); }
function _applySlider(idSlider, idLabel, v){
  const el = document.getElementById(idSlider);
  if(el) el.value = v;
  const lb = document.getElementById(idLabel);
  if(lb) lb.textContent = v + '%';
}

// 色別標高図
let reliefL=null,reliefState=0;
function toggleRelief(){
  reliefState=(reliefState+1)%3;
  const btn=document.getElementById('btn-relief');
  btn.classList.toggle('active', reliefState>0);
  document.getElementById('relief-row').classList.toggle('show', reliefState===1);
  if(reliefState===1){
    const op = _loadOp('gm_op_relief');
    _applySlider('relief-op','relief-opv', op);
    if(!reliefL){ reliefL=TILES.relief; reliefL.setOpacity(op/100); }
    else { reliefL.setOpacity(op/100); }
    reliefL.addTo(map);
  } else if(reliefState===2){
    // スライダーを閉じるだけ・レイヤーはそのまま
  } else {
    if(reliefL){ map.removeLayer(reliefL); }
  }
}
function setReliefOp(v){
  _applySlider('relief-op','relief-opv', v);
  _saveOp('gm_op_relief', v);
  if(reliefL) reliefL.setOpacity(v/100);
}

// 陰影起伏図
let hillL=null,hillState=0;
function toggleHill(){
  hillState=(hillState+1)%3;
  const btn=document.getElementById('btn-hill');
  btn.classList.toggle('active', hillState>0);
  document.getElementById('hill-row').classList.toggle('show', hillState===1);
  if(hillState===1){
    const op = _loadOp('gm_op_hill');
    _applySlider('hill-op','hill-opv', op);
    if(!hillL){ hillL=TILES.hill; hillL.setOpacity(op/100); }
    else { hillL.setOpacity(op/100); }
    hillL.addTo(map);
  } else if(hillState===2){
    // スライダーを閉じるだけ・レイヤーはそのまま
  } else {
    if(hillL){ map.removeLayer(hillL); }
  }
}
function setHillOp(v){
  _applySlider('hill-op','hill-opv', v);
  _saveOp('gm_op_hill', v);
  if(hillL) hillL.setOpacity(v/100);
}

// 地質図
let geoL=null,geoState=0;
function toggleGeo(){
  geoState=(geoState+1)%3;
  const btn=document.getElementById('btn-geo');
  btn.classList.toggle('active', geoState>0);
  document.getElementById('geo-row').classList.toggle('show', geoState===1);
  if(geoState===1){
    const op = _loadOp('gm_op_geo');
    _applySlider('geo-op','geo-opv', op);
    if(!geoL) geoL=L.tileLayer('https://gbank.gsj.jp/seamless/v2/api/1.2/tiles/{z}/{y}/{x}.png',
      {attribution:'産総研シームレス地質図',maxNativeZoom:13,maxZoom:18,opacity:op/100,pane:'paneGeo'});
    else geoL.setOpacity(op/100);
    geoL.addTo(map);
  } else if(geoState===2){
    // スライダーを閉じるだけ・レイヤーはそのまま
  } else {
    if(geoL){ map.removeLayer(geoL); }
  }
}
function setGeoOp(v){
  _applySlider('geo-op','geo-opv', v);
  _saveOp('gm_op_geo', v);
  if(geoL) geoL.setOpacity(v/100);
}
// ━━━ 水位警戒情報（気象庁XML） ━━━
// 洪水予報XML一覧フィード
const JMA_FLOOD_INDEX = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';

async function fetchFloodAlerts(){
  try {
    const proxy = 'https://corsproxy.io/?';
    const parser = new DOMParser();

    // ── フィードから河川名を直接抽出するヘルパー ──
    // 「○○川氾濫注意情報」「○○川洪水警報」などのタイトルから河川名を取り出す
    function _extractRiverFromTitle(title){
      // 「指定河川洪水予報」タイトル例: "小貝川洪水警報" "神通川氾濫注意情報"
      const m = title.match(/^(.+?)(洪水|氾濫)/);
      return m ? m[1].trim() : null;
    }

    // ── ① extra.xml（高頻度随時）を取得 ──
    const res = await fetch(proxy + encodeURIComponent(JMA_FLOOD_INDEX),
      {signal: AbortSignal.timeout(8000)});
    if(!res.ok) throw new Error('fetch failed');
    const feed = parser.parseFromString(await res.text(), 'application/xml');
    const entries = [...feed.querySelectorAll('entry')];

    // ── ② 洪水・氾濫関連エントリを絞り込み ──
    // 優先: 「指定河川洪水予報」タイトル / フォールバック: 洪水|氾濫を含むもの
    const floodEntries = entries.filter(e=>{
      const t = e.querySelector('title')?.textContent || '';
      return /指定河川洪水予報|洪水|氾濫/.test(t);
    });

    if(!floodEntries.length){
      _showWaterStatus('⚠️ 現在、洪水・氾濫情報はありません');
      return;
    }

    const names = new Set();

    // ── ③ フィードのtitleから直接河川名を抽出（高速・追加リクエスト不要） ──
    floodEntries.forEach(e=>{
      const title = e.querySelector('title')?.textContent || '';
      const river = _extractRiverFromTitle(title);
      if(river) names.add(river);
    });

    // ── ④ 個別XMLも取得して精度補完（フォールバック） ──
    await Promise.allSettled(floodEntries.slice(0,8).map(async e=>{
      const link = e.querySelector('link')?.getAttribute('href');
      if(!link) return;
      try {
        const xmlRes = await fetch(proxy + encodeURIComponent(link),
          {signal: AbortSignal.timeout(6000)});
        if(!xmlRes.ok) return;
        const doc = parser.parseFromString(await xmlRes.text(), 'application/xml');
        // RiverName > ObjectName > Titleの順で河川名を取得
        doc.querySelectorAll('RiverName, ObjectName').forEach(el=>{
          const t = el.textContent.trim();
          if(t && t.length <= 20) names.add(t);
        });
        // TitleタグのテキストからもMAJOR_RIVERSと照合できる名前を抽出
        doc.querySelectorAll('Title').forEach(el=>{
          const river = _extractRiverFromTitle(el.textContent.trim());
          if(river) names.add(river);
        });
      } catch(e){ /* 個別取得失敗は無視 */ }
    }));

    window.floodAlertNames = names;
    if(typeof refreshMineMarkers === 'function') refreshMineMarkers();

    const link = `<a href="https://www.river.go.jp" target="_blank" rel="noopener"
      style="color:#ffcc44;text-decoration:underline;">💧 詳細を確認する</a>`;
    if(names.size){
      const riverText = [...names].slice(0,3).join('・')+(names.size>3?'…':'');
      _showWaterStatus(
        `🚨 <b style="color:#ff6644">洪水警戒中</b>: ${riverText}<br>${link}`,
        {html:true, autoClose:false}
      );
    } else {
      _showWaterStatus('⚠️ 洪水情報取得済み（河川名抽出なし）');
    }
    console.log('[floodAlerts] 取得河川名:', [...names]);
  } catch(err){
    console.warn('fetchFloodAlerts:', err);
    _showWaterStatus('⚠️ 水位情報の取得に失敗しました');
  }
}

// ━━━ 一級河川本川リスト（109水系） ━━━
const MAJOR_RIVERS = [
  {name:'石狩川',lat:43.55,lng:141.90},{name:'天塩川',lat:44.80,lng:142.05},
  {name:'渚滑川',lat:44.05,lng:143.60},{name:'湧別川',lat:43.95,lng:143.55},
  {name:'常呂川',lat:43.80,lng:143.80},{name:'網走川',lat:43.90,lng:144.10},
  {name:'釧路川',lat:43.40,lng:144.40},{name:'十勝川',lat:42.95,lng:143.30},
  {name:'沙流川',lat:42.55,lng:142.40},{name:'鵡川',lat:42.70,lng:141.95},
  {name:'尻別川',lat:42.85,lng:140.80},{name:'後志利別川',lat:42.55,lng:140.05},
  {name:'天の川',lat:41.85,lng:140.35},{name:'厚田川',lat:43.30,lng:141.45},
  {name:'米代川',lat:40.20,lng:140.55},{name:'雄物川',lat:39.70,lng:140.50},
  {name:'子吉川',lat:39.35,lng:140.35},{name:'最上川',lat:38.85,lng:140.05},
  {name:'赤川',lat:38.85,lng:139.85},{name:'馬淵川',lat:40.30,lng:141.30},
  {name:'北上川',lat:39.40,lng:141.20},{name:'鳴瀬川',lat:38.45,lng:141.10},
  {name:'名取川',lat:38.20,lng:140.75},{name:'阿武隈川',lat:37.70,lng:140.60},
  {name:'久慈川',lat:36.95,lng:140.45},{name:'那珂川',lat:36.80,lng:140.10},
  {name:'利根川',lat:36.20,lng:139.80},{name:'荒川',lat:35.95,lng:139.45},
  {name:'多摩川',lat:35.65,lng:139.35},{name:'鶴見川',lat:35.50,lng:139.55},
  {name:'相模川',lat:35.45,lng:139.25},{name:'酒匂川',lat:35.35,lng:139.10},
  {name:'信濃川',lat:37.10,lng:138.70},{name:'関川',lat:37.95,lng:139.00},
  {name:'姫川',lat:36.90,lng:137.85},{name:'黒部川',lat:36.85,lng:137.60},
  {name:'常願寺川',lat:36.75,lng:137.35},{name:'神通川',lat:36.65,lng:137.20},
  {name:'庄川',lat:36.55,lng:136.90},{name:'小矢部川',lat:36.65,lng:136.80},
  {name:'手取川',lat:36.45,lng:136.65},{name:'梯川',lat:36.35,lng:136.45},
  {name:'九頭竜川',lat:36.10,lng:136.50},{name:'北川',lat:35.65,lng:136.20},
  {name:'天竜川',lat:35.35,lng:137.95},{name:'大井川',lat:34.95,lng:138.25},
  {name:'安倍川',lat:34.95,lng:138.40},{name:'菊川',lat:34.75,lng:138.10},
  {name:'豊川',lat:34.80,lng:137.45},{name:'矢作川',lat:34.90,lng:137.15},
  {name:'庄内川',lat:35.20,lng:136.95},{name:'木曽川',lat:35.30,lng:136.80},
  {name:'長良川',lat:35.50,lng:136.75},{name:'揖斐川',lat:35.40,lng:136.60},
  {name:'鈴鹿川',lat:34.90,lng:136.55},{name:'雲出川',lat:34.70,lng:136.50},
  {name:'宮川',lat:34.45,lng:136.60},{name:'熊野川',lat:33.95,lng:135.80},
  {name:'日高川',lat:33.95,lng:135.35},{name:'有田川',lat:34.05,lng:135.35},
  {name:'紀の川',lat:34.25,lng:135.55},{name:'大和川',lat:34.55,lng:135.65},
  {name:'淀川',lat:34.80,lng:135.60},{name:'由良川',lat:35.45,lng:135.15},
  {name:'円山川',lat:35.55,lng:134.85},{name:'加古川',lat:34.85,lng:134.95},
  {name:'市川',lat:34.95,lng:134.75},{name:'夢前川',lat:34.95,lng:134.65},
  {name:'揖保川',lat:34.80,lng:134.55},{name:'千種川',lat:34.80,lng:134.35},
  {name:'天神川',lat:35.50,lng:133.85},{name:'日野川',lat:35.40,lng:133.55},
  {name:'斐伊川',lat:35.25,lng:132.85},{name:'江の川',lat:34.85,lng:132.55},
  {name:'高津川',lat:34.65,lng:131.95},{name:'益田川',lat:34.65,lng:131.80},
  {name:'吉井川',lat:34.85,lng:134.05},{name:'旭川',lat:34.75,lng:133.85},
  {name:'高梁川',lat:34.65,lng:133.55},{name:'芦田川',lat:34.55,lng:133.15},
  {name:'太田川',lat:34.40,lng:132.45},{name:'小瀬川',lat:34.20,lng:132.00},
  {name:'佐波川',lat:34.15,lng:131.55},{name:'吉野川',lat:34.05,lng:133.85},
  {name:'那賀川',lat:33.85,lng:134.35},{name:'土器川',lat:34.25,lng:133.90},
  {name:'重信川',lat:33.85,lng:132.95},{name:'肱川',lat:33.65,lng:132.65},
  {name:'四万十川',lat:33.25,lng:132.90},{name:'仁淀川',lat:33.55,lng:133.25},
  {name:'物部川',lat:33.65,lng:133.65},{name:'遠賀川',lat:33.75,lng:130.70},
  {name:'嘉瀬川',lat:33.35,lng:130.20},{name:'六角川',lat:33.25,lng:130.05},
  {name:'松浦川',lat:33.35,lng:129.90},{name:'菊池川',lat:32.95,lng:130.75},
  {name:'白川',lat:32.80,lng:130.90},{name:'緑川',lat:32.70,lng:130.70},
  {name:'球磨川',lat:32.35,lng:130.80},{name:'川内川',lat:31.85,lng:130.45},
  {name:'肝属川',lat:31.35,lng:131.00},{name:'大淀川',lat:31.85,lng:131.15},
  {name:'小丸川',lat:32.10,lng:131.55},{name:'一ツ瀬川',lat:32.15,lng:131.60},
  {name:'五ヶ瀬川',lat:32.55,lng:131.55},{name:'大野川',lat:33.05,lng:131.65},
  {name:'大分川',lat:33.20,lng:131.55},{name:'筑後川',lat:33.25,lng:130.60},
  {name:'山国川',lat:33.55,lng:131.15},{name:'本明川',lat:32.85,lng:130.35},
];

// 河川名から座標を検索（部分一致）
function getRiverCoord(name){
  return MAJOR_RIVERS.find(r => name.includes(r.name) || r.name.includes(name)) || null;
}

// ━━━ 一級河川ピン＋洪水警戒ヒートマップ ━━━
let floodHeatLayer  = null;
let floodPinLayer   = null;

// ━━━ 一級河川ピン＋洪水警戒ヒートマップ ━━━

// 河川ピン＋警戒時ヒートマップを構築（全109本・フィルターなし）
function buildFloodHeatmap(){
  if(floodPinLayer) { map.removeLayer(floodPinLayer);  floodPinLayer  = null; }
  if(floodHeatLayer){ map.removeLayer(floodHeatLayer); floodHeatLayer = null; }

  const alertNames = window.floodAlertNames || new Set();
  const pinLayer = L.layerGroup({pane:'paneKinno'});
  const alertPoints = [];

  MAJOR_RIVERS.forEach(r => {
    const isAlert = [...alertNames].some(n => n.includes(r.name) || r.name.includes(n));
    const color = isAlert ? '#ff4400' : '#1a90ff';
    const fill  = isAlert ? '#ff6600' : '#44b3ff';
    const riverLink = `<a href="https://www.river.go.jp" target="_blank" rel="noopener"
      style="color:#4af;font-size:11px;">💧 詳細を確認</a>`;
    const popup = isAlert
      ? `<b style="color:#ff4400">🚨 洪水警戒中</b><br><b>${r.name}</b><br>${riverLink}`
      : `<b style="color:#1a90ff">💧 ${r.name}</b><br>${riverLink}`;

    L.circleMarker([r.lat, r.lng], {
      radius: isAlert ? 9 : 6,
      color, fillColor: fill,
      fillOpacity: isAlert ? 0.9 : 0.7,
      weight: isAlert ? 2 : 1,
      pane: 'paneKinno'
    }).bindPopup(popup).addTo(pinLayer);

    if(isAlert) alertPoints.push([r.lat, r.lng, 1.0]);
  });

  floodPinLayer = pinLayer;
  floodPinLayer.addTo(map);

  // 警戒河川がある場合のみヒートマップ表示（約30km半径）
  if(alertPoints.length && typeof L.heatLayer !== 'undefined'){
    floodHeatLayer = L.heatLayer(alertPoints, {
      radius:   80,
      blur:     70,
      maxZoom:  10,
      max:      1.0,
      gradient: {0.0:'blue', 0.3:'cyan', 0.6:'yellow', 1.0:'red'},
      pane:     'paneHeat'
    });
    floodHeatLayer.addTo(map);
  }

  console.log(`[riverPins] 109本 / 警戒:${alertPoints.length}本`);
}

function clearFloodHeatmap(){
  if(floodPinLayer) { map.removeLayer(floodPinLayer);  floodPinLayer  = null; }
  if(floodHeatLayer){ map.removeLayer(floodHeatLayer); floodHeatLayer = null; }
}

// 水位ステータストースト表示
// html=true でHTML挿入、手動クローズのみ
function _showWaterStatus(msg, {html=false}={}){
  let el = document.getElementById('water-status-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'water-status-toast';
    el.style.cssText = [
      'position:fixed','top:50%','left:50%','transform:translate(-50%,-50%)',
      'background:rgba(0,20,40,0.96)','color:#7df','border:2px solid rgba(100,200,255,0.45)',
      'border-radius:14px','padding:22px 44px 22px 22px','font-size:14px','z-index:9999',
      'pointer-events:auto','transition:opacity .4s','backdrop-filter:blur(12px)',
      'max-width:320px','width:calc(100vw - 80px)','line-height:1.9','box-shadow:0 8px 40px rgba(0,0,0,0.7)',
      'display:none'
    ].join(';');
    document.body.appendChild(el);
  }
  const detailLink = `<a href="https://www.river.go.jp" target="_blank" rel="noopener" style="color:#ffcc44;text-decoration:underline;">💧 詳細を確認する</a>`;
  const closeBtn = `<span onclick="(function(){var e=document.getElementById('water-status-toast');e.style.opacity='0';setTimeout(function(){e.style.display='none';},420);})()" style="position:absolute;top:10px;right:14px;cursor:pointer;font-size:18px;color:#aaa;line-height:1;">✕</span>`;
  if(html){
    el.innerHTML = closeBtn + msg;
  } else {
    el.innerHTML = closeBtn + `<span>${msg}</span><br>` + detailLink;
  }
  el.style.display = 'block';
  el.style.opacity = '1';
  clearTimeout(el._timer);
}

// 50km以内に警戒河川があるか判定してアラートトーストを表示
function _checkNearbyFloodAlert(userLat, userLng){
  const alertNames = window.floodAlertNames;
  if(!alertNames || !alertNames.size) return;
  function _dist(la1,lo1,la2,lo2){
    const R=6371, dLa=(la2-la1)*Math.PI/180, dLo=(lo2-lo1)*Math.PI/180;
    const a=Math.sin(dLa/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
    return R*2*Math.asin(Math.sqrt(a));
  }
  const nearby = [];
  MAJOR_RIVERS.forEach(r => {
    const isAlert = [...alertNames].some(n => n.includes(r.name) || r.name.includes(n));
    if(!isAlert) return;
    const d = _dist(userLat, userLng, r.lat, r.lng);
    if(d <= 50) nearby.push({name: r.name, dist: Math.round(d)});
  });
  if(!nearby.length) return;
  nearby.sort((a,b) => a.dist - b.dist);
  const riverList = nearby.map(r=>`${r.name}(約${r.dist}km)`).join('・');
  const link = `<a href="https://www.river.go.jp" target="_blank" rel="noopener"
    style="color:#ffcc44;text-decoration:underline;">💧 詳細を確認する</a>`;
  _showWaterStatus(
    `📍 <b style="color:#ff6644">50km以内に洪水警戒河川</b><br>${riverList}<br>${link}`,
    {html:true, autoClose:false}
  );
}