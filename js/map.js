'use strict';
const map=L.map('map',{center:[36.5,137.5],zoom:7,zoomControl:true,rotate:true,bearing:0});
map.zoomControl.setPosition('bottomright');
let TILES={}, curBase='std';

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

  const mk=key=>{
    const CLS=makeCachedLayer(key);
    return new CLS(SRCS[key].url,{
      attribution:SRCS[key].attr,
      maxNativeZoom:key==='topo'?17:18,
      maxZoom:18,
    });
  };
  TILES={std:mk('std'),photo:mk('photo'),topo:mk('topo')};
  TILES.std.addTo(map);
  mineLayer.addTo(map);
  document.getElementById('btn-mine').classList.toggle('active', mineV);
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
}

function setBase(k){
  map.removeLayer(TILES[curBase]); TILES[k].addTo(map); curBase=k;
  ['std','photo','topo'].forEach(b=>{
    const btn=document.getElementById('btn-'+b);
    btn.classList.remove('base-active','active');
    if(b===k) btn.classList.add('base-active','active');
  });
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

