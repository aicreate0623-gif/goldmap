'use strict';
const MINES=[
  // ── 既存 ──
  {lat:39.08,lng:140.75,name:'砂子沢金山跡',note:'東北地方・歴史的採掘地'},
  {lat:39.47,lng:141.20,name:'土畑鉱山跡',note:'岩手県・明治期操業'},
  {lat:38.95,lng:140.88,name:'成瀬川支流',note:'秋田県・砂金産地'},
  {lat:36.78,lng:137.65,name:'神通川上流',note:'富山県・古来採金地'},
  {lat:35.35,lng:136.72,name:'長良川支流',note:'岐阜県・砂金採取実績あり'},
  {lat:43.72,lng:143.00,name:'足寄川流域',note:'北海道・砂金体験地'},
  {lat:44.00,lng:143.50,name:'置戸金山跡',note:'北海道・大正期採掘'},
  {lat:33.62,lng:130.55,name:'遠賀川流域',note:'福岡県・砂金採取記録'},

  // ── 北海道（確度◎：現在も採取可能な公式体験地・歴史的産出確認地）──
  {lat:44.975,lng:142.383,name:'ウソタンナイ川（浜頓別）',note:'北海道浜頓別町。明治31年に砂金発見、5年で推定2t以上産出。現在も公式体験施設あり（ウソタンナイ砂金採掘公園）。日本最大級の砂金採取地。出典：浜頓別町公式・なんぼや'},
  {lat:44.867,lng:142.283,name:'ペーチャン川（中頓別）',note:'北海道中頓別町。明治期ゴールドラッシュの中心地。現在も砂金採取体験可能。岩盤近く・大岩の下が採取ポイント。出典：なかとんべつ観光まちづくりビューロー'},
  {lat:44.933,lng:142.583,name:'ナイ川・パンケナイ川（枝幸）',note:'北海道枝幸町。1900年（明治33年）に769gの大ナゲット発見。「北見枝幸ゴールドラッシュ」の震源地。1125gの金塊発見の記録も。出典：なんぼや・各種文献'},
  {lat:42.733,lng:143.300,name:'歴舟川（大樹）',note:'北海道大樹町。江戸時代より砂金採取。明治期は100人近くの砂金掘師が活動し最盛期は1日100g産出。現在も公式体験（カムイコタン公園キャンプ場付近）。環境省水質調査1位の清流。出典：大樹町公式HP'},
  {lat:43.550,lng:141.817,name:'徳富川（新十津川）',note:'北海道新十津川町。砂金採り愛好家の間で著名な産地。約15年前から砂金採りが行われており毎春の雪解け水で供給継続。出典：note「砂金を掘る」（山本竜也、2024）'},
  {lat:42.133,lng:143.017,name:'様似川（様似）',note:'北海道様似町。北海道砂金産地リストに記載。日高山脈系の砂金産地。出典：北海道砂金採りスポット一覧（得北）'},
  {lat:42.533,lng:140.067,name:'後志利別川（今金）',note:'北海道今金町。北海道砂金産地リストに記載。出典：北海道砂金採りスポット一覧（得北）'},
  {lat:43.717,lng:142.050,name:'留萌川支流（深川）',note:'北海道深川市。北海道砂金産地リストに記載。出典：北海道砂金採りスポット一覧（得北）'},
  {lat:43.050,lng:141.983,name:'夕張川（夕張）',note:'北海道夕張市。北海道砂金産地リストに記載。出典：北海道砂金採りスポット一覧（得北）'},
  {lat:42.367,lng:143.233,name:'当縁川・紋別川（大樹周辺）',note:'北海道大樹町周辺。明治30年代に砂金掘師が活動した河川群（当縁川・紋別川・アイボシマ川）。出典：大樹町公式HP'},

  // ── 東北 ──
  {lat:38.533,lng:141.017,name:'箟岳山麓（涌谷・天平ロマン館）',note:'宮城県涌谷町。749年（天平21年）に日本初産金地として「続日本紀」に記載。東大寺大仏の鍍金に使われた金の産出地。現在も体験施設あり（天平ロマン館）。出典：川遊びマップ'},
  {lat:38.600,lng:140.433,name:'尾花沢市（丹生川支流）',note:'山形県尾花沢市。砂金採り体験施設あり。出典：全国砂金採りスポット一覧'},
  {lat:37.92,lng:138.4,name:'西三川川（佐渡）',note:'新潟県佐渡市。西三川砂金山は千年の歴史を持つ日本最古級の砂金山。佐渡西三川ゴールドパークの「上級コース」で自然河川（西三川川）での採取可能。出典：西三川ゴールドパーク公式'},

  // ── 関東・中部 ──
  {lat:36.817,lng:140.283,name:'大沢川（栃原金山下流・久慈川支流）',note:'茨城県（久慈川支流）。栃原金山跡（江戸時代発見）の下流。ブログ実績：約2時間で5粒採取。岩盤の割れ目・大岩の下がポイント。出典：うちのアレコレ（2024年実績ブログ）'},
  {lat:35.783,lng:139.250,name:'多摩川上流（青梅市）',note:'東京都青梅市付近。砂金採り名人（大森氏）指導のもとボンボンTVが数粒採取確認（2019年）。河原の岩の隙間・草の根元の砂がポイント。上流鉱山由来。出典：ボンボンTV・デイリーポータルZ（2003年実績）'},
  {lat:36.867,lng:137.650,name:'黒部川上流（富山）',note:'富山県黒部川。立山連峰から流れる清流で砂金が採れることで知られる。出典：ジュエルカフェコラム'},
  {lat:35.517,lng:138.750,name:'湯之奥金山周辺（身延町）',note:'山梨県南巨摩郡身延町。中世・戦国時代から栄えた湯之奥金山の周辺。甲斐黄金村・湯之奥金山博物館で体験可能、初心者でも平均5粒前後採取。出典：板村地質研究所・川遊びマップ'},
  {lat:34.967,lng:138.933,name:'土肥金山周辺（伊豆市）',note:'静岡県伊豆市土肥。足利幕府が採掘開始、昭和40年閉山。佐渡金山に次ぐ全国第2位の産出量を誇った。現在は土肥金山砂金館で体験可能。出典：川遊びマップ・なんぼや'},

  // ── 近畿 ──
  {lat:34.850,lng:134.950,name:'加古川（小野市黍田町）',note:'兵庫県小野市黍田町。JR市場駅より徒歩5分の河川敷。砂金教室が新聞・テレビで複数回取材された著名スポット。基盤岩が多数露出しており砂金採取に適した環境。出典：板村地質研究所（実地確認・動画あり）'},
  {lat:34.267,lng:135.967,name:'天ノ川（天川村）',note:'奈良県吉野郡天川村。砂金採り体験施設あり。出典：全国砂金採りスポット一覧'},

  // ── 中国・四国・九州 ──
  {lat:34.983,lng:132.500,name:'江の川（川本町）',note:'島根県邑智郡川本町。砂金採り体験施設あり、初心者向けプログラムあり。出典：全国砂金採りスポット一覧'},
  {lat:32.567,lng:130.800,name:'球磨川支流（五木村）',note:'熊本県球磨郡五木村。山あいの渓流での砂金採り体験可能。秘境感のある雰囲気も魅力。出典：ジュエルカフェコラム'},
  {lat:31.683,lng:130.283,name:'市来川周辺（串木野）',note:'鹿児島県いちき串木野市。ゴールドパーク串木野にて砂金採り体験可能。出典：川遊びマップ'},

  // ── 追加 2025: 栃木・福島（八溝山系）──
  {lat:36.908,lng:140.154,name:'武茂川（御前岩付近）',note:'栃木県那珂川町。奈良時代から日本最古の産金地の一つ。なかがわ水遊園が毎年砂金採りイベントを開催。新太郎橋付近で採取確認。出典：下野新聞・ブログ複数'},
  {lat:36.914,lng:140.162,name:'武茂川（御前岩物産センター前）',note:'栃木県那珂川町。御前岩脇で粉金複数採取の実績。ブログ複数で確認（2023年）。出典：note・livedoor blog（2023）'},
  {lat:37.001,lng:140.424,name:'茗荷川・矢祭川合流付近',note:'福島県矢祭町。八溝山系。2019年実績ブログで「粉金3粒」採取確認。出典：わかさぎ＆ヒメマス釣行記（2019）'},
  {lat:37.019,lng:140.366,name:'久慈川上流（棚倉町）',note:'福島県棚倉町。棚倉断層帯沿い。「極小板状3粒」採取実績。頁岩クラック掘りで採取。出典：わかさぎ＆ヒメマス釣行記（2019）'},

  // ── 追加 2025: 関東・中部 ──
  {lat:35.894,lng:138.923,name:'荒川上流（道の駅大滝温泉付近）',note:'埼玉県秩父市大滝。道の駅大滝温泉周辺の荒川河川敷。カラデル編集部の体験記で採取確認（2023年）。出典：カラデル（2023）'},
  {lat:35.920,lng:138.901,name:'荒川（秩父大滝・中津川金山下流）',note:'埼玉県秩父市。中津川金山（江戸時代）下流の荒川本流。複数ブログで採取実績あり。岩盤露出部の岩陰がポイント。出典：カラデル・複数ブログ'},
  {lat:35.115,lng:140.105,name:'鴨川海岸（浜砂金）',note:'千葉県鴨川市。海岸の浜砂金産地。蛇紋岩由来。砂鉄濃集部で砂金採取確認。出典：砂金掘り日記（2012）'},

  // ── 追加 2025: 東北（山形・新潟・秋田・青森）──
  {lat:38.876,lng:139.856,name:'北月山荘（月光川）',note:'山形県庄内町。月光川沿いの砂金採り体験施設「北月山荘」あり。出羽三山系の砂金産地。出典：川遊びマップ'},
  {lat:38.512,lng:139.612,name:'鳴海金山跡（荒川支流・三面川系）',note:'新潟県村上市。慶長年間に全国産金量の1/3を産出した歴史的大金山。現在は道路通行止めで施設休業中。出典：村上市公式'},
  {lat:40.553,lng:140.534,name:'黒石川',note:'青森県黒石市。砂金産地として知られる。上流に黒石鉱山系の金鉱脈あり。出典：複数スポット情報'},
  {lat:40.218,lng:140.657,name:'尾去沢鉱山（米代川支流）',note:'秋田県鹿角市。1300年の歴史を持つ古鉱山。体験施設あり、純金砂金採り体験が可能。出典：尾去沢鉱山公式'},

  // ── 追加 2025: 中国・四国・九州 ──
  {lat:34.183,lng:131.967,name:'ムーバレー（錦川）',note:'山口県岩国市。錦川沿いの砂金採り体験施設。出典：全国砂金採りスポット一覧'},
  {lat:33.947,lng:133.315,name:'マイントピア別子（銅山川）',note:'愛媛県新居浜市。別子銅山の観光施設。銅山川での砂金採り体験が可能。出典：川遊びマップ'},
  {lat:33.145,lng:130.916,name:'鯛生金山（津江川）',note:'大分県日田市。東洋一ともいわれる産金量を誇った金山。体験施設あり。出典：Facebook・九州観光'},

  // ── 追加 2025: 石川 ──
  {lat:36.561,lng:136.656,name:'犀川（金沢市）',note:'石川県金沢市。「金洗い沢」伝説に由来する金沢の地名発祥の地。現在も砂金採取愛好家が多く訪れ、水際のポットホールから10〜20粒の採取実績あり。体験ガイドツアーも整備されている。出典：買取むすび・金沢経済新聞'},

  // ── 追加 2025: 岐阜 ──
  {lat:36.033,lng:136.900,name:'六厩川（高山市荘川町）',note:'岐阜県高山市荘川町。御母衣ダムに流れ込む清流で、古くから砂金が採れることで知られる。産総研地質調査所の砂標本にも径〜1.5mmの砂金と砂鉄の混合が記録されている。出典：産総研地質調査所標本データベース'},

  // ── 追加 2025: 東北（岩手・宮城）──
  {lat:39.550,lng:141.183,name:'赤沢川・滝名川（紫波町）',note:'岩手県紫波町。平安時代後期、奥州藤原氏の一族・樋爪藤原氏の産金支配地。滝名川・赤沢川・佐比内川で砂金が採掘され平泉の繁栄を支えた。北上高地の金山群を源流に持つ。出典：紫波町公式文化財'},
  {lat:39.150,lng:141.517,name:'気仙川上流（住田町）',note:'岩手県住田町。気仙川上流域は金山跡が点在する気仙産金群の中心。発見当時国内第三位（22.4g）の金塊が出土した記録あり。現在も砂金採り体験を実施している。出典：三陸ジオパーク公式'},
  {lat:38.987,lng:141.567,name:'大田川支流（平泉町）',note:'岩手県平泉町。中尊寺金色堂近傍の大田川支流で砂金採取の実績が複数確認されている。地元ガイド同行での採取体験が可能。みちのくGOLD浪漫エリア。出典：平泉ガイドの会ブログ（2022）'},
  {lat:38.933,lng:141.617,name:'鹿折川下流（気仙沼市）',note:'宮城県気仙沼市。上流の鹿折金山は明治37年に重さ2.25kg・含有率83%の「モンスターゴールド」を産出した国内十大金山。金山由来の砂金が鹿折川に流下する。出典：三陸ジオパーク・気仙沼観光サイト'},

  // ── 追加 2025: 四国 ──
  {lat:33.983,lng:133.550,name:'銅山川（三好市山城町）',note:'徳島県三好市山城町。吉野川上流支流で古くから砂金採取の史実が残る。別子銅山系の含銅硫化鉄鉱床が起源。板村地質研究所の実地調査で0.2〜1mmの砂金採取を確認。出典：板村地質研究所フィールドワーク調査記録'},

  // ── 追加 2025: 静岡 ──
  {lat:34.767,lng:138.583,name:'那賀川（松崎町）',note:'静岡県賀茂郡松崎町。西伊豆の清流で伊豆金山群に由来する砂金採取スポット。家族向けの自然河川での体験型採取地として複数の情報源に記載あり。出典：ジュエルカフェコラム'},

  // ── 追加 2025: 島根 ──
  {lat:35.100,lng:132.433,name:'石見銀山周辺河川（大田市）',note:'島根県大田市。世界遺産・石見銀山の周辺河川で砂金採取の記録あり。銀山と金は地質的に密接な関係があり、周辺の河川に砂金が流下するエリアとして知られる。出典：ジュエルカフェコラム'},

  // ── 追加 2025: 座標要検証（★）──
  {lat:36.700,lng:137.867,name:'白馬（姫川上流）',note:'長野県白馬村。姫川上流域で砂金採取可との情報あり。【座標要検証：概略値】'},
  {lat:35.900,lng:138.433,name:'清里（川俣川）',note:'山梨県北杜市清里。川俣川のキャンプ場近辺で砂金採取との記載。【座標要検証：概略値】'},
  {lat:32.217,lng:130.767,name:'人吉市（球磨川支流）',note:'熊本県人吉市。球磨川支流での砂金採取情報あり。既存「五木村」エントリーとのエリア重複確認要。【座標要検証：概略値】'},
];
const mineLayer=L.layerGroup({pane:'paneMine'}); let mineV=false;
// ── Googleマップ連携ボタン共通ヘルパー ──────────────────────────
function _gmapBtns(lat, lng) {
  const la = parseFloat(lat).toFixed(6);
  const ln = parseFloat(lng).toFixed(6);
  const url = `https://maps.google.com/?q=${la},${ln}`;
  return `<div style="margin-top:8px;text-align:right;">
    <a href="${url}" target="_blank" rel="noopener"
       onclick="return confirm('Googleマップを開きます')"
       style="font-size:11px;color:#1a73e8;text-decoration:none;font-weight:700;">
      🗺 Googleマップで確認
    </a>
  </div>`;
}

const mIco=()=>L.divIcon({html:'<div class="mpin"></div>',className:'',iconSize:[14,28],iconAnchor:[7,28],popupAnchor:[0,-28]});
const mIcoAlert=()=>L.divIcon({html:'<div class="mpin mpin-alert"></div>',className:'',iconSize:[14,28],iconAnchor:[7,28],popupAnchor:[0,-28]});

// 水位ボタン状態
let waterV=false;
// 警戒中河川名セット（map.jsのfetchFloodAlerts()が更新する）
window.floodAlertNames=new Set();

function _isAlert(m){
  if(!window.floodAlertNames.size) return false;
  // マーカー名・noteに警戒河川名が含まれるか判定
  return [...window.floodAlertNames].some(n=>m.name.includes(n)||m.note.includes(n));
}

function _minePopup(m,withWater){
  const alert=_isAlert(m);
  const alertNote=alert
    ?`<br><span style="color:#e08020;font-size:11px">⚠️ 周辺河川で洪水警戒情報あり</span><br><small style="color:#888;font-size:10px">※気象庁情報との自動照合のため実際の状況は川の防災情報でご確認ください</small>`
    :'';
  const link=withWater||alert
    ?`<br><a href="https://www.river.go.jp" target="_blank" rel="noopener" style="font-size:11px;color:#4af">💧 確認する</a>`
    :'';
  return `<b style="color:#c06030">${m.name}</b><br><small>${m.note}</small>${alertNote}${link}${_gmapBtns(m.lat,m.lng)}`;
}

// マーカー生成（水位ON/OFFで切替）
const _mineMarkers=[];
MINES.forEach(m=>{
  const alert=_isAlert(m);
  const marker=L.marker([m.lat,m.lng],{
    icon: alert ? mIcoAlert() : mIco(),
    pane:'paneMine'
  }).bindPopup(_minePopup(m, waterV||alert));
  marker._mineData=m;
  _mineMarkers.push(marker);
  marker.addTo(mineLayer);
});

// 水位モード切替時にマーカーを再描画
function refreshMineMarkers(){
  _mineMarkers.forEach(marker=>{
    const m=marker._mineData;
    const alert=_isAlert(m);
    marker.setIcon(alert ? mIcoAlert() : mIco());
    marker.setPopupContent(_minePopup(m, waterV||alert));
  });
}

function toggleMine(){
  mineV=!mineV;
  document.getElementById('btn-mine').classList.toggle('active',mineV);
  if(mineV) mineLayer.addTo(map);
  else map.removeLayer(mineLayer);
}

function toggleWaterLevel(){
  // OFFにする場合はゲートなしで即時OFF
  if(waterV){
    waterV = false;
    document.getElementById('btn-water').classList.remove('active');
    if(typeof clearFloodHeatmap === 'function') clearFloodHeatmap();
    return;
  }
  // ONにする場合はプレミアムチェック
  isPremiumUser().then(premium => {
    if(!premium){ showPremiumGate('water_level'); return; }
    waterV = true;
    document.getElementById('btn-water').classList.add('active');
    if(typeof buildFloodHeatmap === 'function') buildFloodHeatmap();
    fetchFloodAlerts().then(()=>{
      if(typeof buildFloodHeatmap === 'function') buildFloodHeatmap();
      if(typeof _checkNearbyFloodAlert === 'function'){
        if(window._userLat && window._userLng){
          _checkNearbyFloodAlert(window._userLat, window._userLng);
        } else {
          navigator.geolocation?.getCurrentPosition(pos=>{
            window._userLat = pos.coords.latitude;
            window._userLng = pos.coords.longitude;
            _checkNearbyFloodAlert(window._userLat, window._userLng);
          }, ()=>{}, {timeout:5000});
        }
      }
    });
  });
}
// ═══════════════════════════════════════════
//  Wikidata 日本鉱山 静的データ（180件）
//  出典: Wikidata (CC0)  https://www.wikidata.org/
//  取得日: 2025年  日本範囲外(lat:20-50, lng:122-154)除外済み
// ═══════════════════════════════════════════
const WIKI_STATIC_DATA = [
  {qid:'Q4571295',  name:'幌内炭鉱',           lat:43.221, lng:141.909},
  {qid:'Q5354434',  name:'八戸鉱山',            lat:40.4529,lng:141.538},
  {qid:'Q6429620',  name:'鴻之舞鉱山',          lat:44.12525,lng:143.352527777},
  {qid:'Q10868515', name:'下川鉱山',            lat:44.215, lng:142.701},
  {qid:'Q11060540', name:'幌別鉱山',            lat:42.470777777,lng:141.035194444},
  {qid:'Q11286851', name:'イトムカ鉱山',        lat:43.64972222,lng:143.23666667},
  {qid:'Q11358530', name:'上北鉱山',            lat:40.74263889,lng:141.01202778},
  {qid:'Q11359927', name:'上田銀山',            lat:37.085055555,lng:139.238083333},
  {qid:'Q11363919', name:'中小坂鉄山',          lat:36.228194,lng:138.768639},
  {qid:'Q11366862', name:'中竜鉱山',            lat:35.88147,lng:136.58409},
  {qid:'Q11367890', name:'串木野鉱山',          lat:31.72861111,lng:130.2745},
  {qid:'Q11368609', name:'丹生鉱山',            lat:34.47141667,lng:136.49052778},
  {qid:'Q11369449', name:'久根鉱山',            lat:35.08744444,lng:137.83494444},
  {qid:'Q11391727', name:'八総鉱山',            lat:37.061138888,lng:139.662388888},
  {qid:'Q11391731', name:'八茎鉱山',            lat:37.164055555,lng:140.917555555},
  {qid:'Q11430982', name:'多田銀山',            lat:34.895469,lng:135.350725},
  {qid:'Q11433496', name:'大和水銀鉱山',        lat:34.47725,lng:135.97366667},
  {qid:'Q11438698', name:'大葛鉱山',            lat:40.13725,lng:140.700666666},
  {qid:'Q11444497', name:'太良鉱山',            lat:40.384638888,lng:140.318833333},
  {qid:'Q11456259', name:'富士金山',            lat:35.40011111,lng:138.55122222},
  {qid:'Q11459448', name:'小坂鉱山',            lat:40.33722222,lng:140.75361111},
  {qid:'Q11459448', name:'小坂鉱山',            lat:40.34554,   lng:140.75407},
  {qid:'Q11465126', name:'尾去沢鉱山',          lat:40.183333333,lng:140.75},
  {qid:'Q11465280', name:'尾平鉱山',            lat:32.857277777,lng:131.388805555},
  {qid:'Q11465827', name:'山ヶ野金山',          lat:31.917388888,lng:130.623694444},
  {qid:'Q11467728', name:'山宝鉱山',            lat:34.788055555,lng:133.478055555},
  {qid:'Q11476115', name:'峰之沢鉱山',          lat:35.00197222,lng:137.84188889},
  {qid:'Q11479990', name:'市之川鉱山',          lat:33.89166667,lng:133.20666667},
  {qid:'Q11492383', name:'恵庭鉱山',            lat:42.816639,lng:141.265889},
  {qid:'Q11492408', name:'恵比寿鉱山',          lat:35.53841667,lng:137.36277778},
  {qid:'Q11510089', name:'日立鉱山',            lat:36.6312,lng:140.5996},
  {qid:'Q11512063', name:'明延鉱山',            lat:35.271944444,lng:134.659444444},
  {qid:'Q11519261', name:'木浦鉱山',            lat:32.827416666,lng:131.550555555},
  {qid:'Q11529711', name:'松尾鉱山',            lat:39.938138888,lng:140.937711111},
  {qid:'Q11534959', name:'柵原鉱山',            lat:34.952,lng:134.062},
  {qid:'Q11542685', name:'横島 (長崎県長崎市)', lat:32.675,lng:129.79611111},
  {qid:'Q11554465', name:'沼尻鉱山',            lat:37.627972,lng:140.258444},
  {qid:'Q11563458', name:'湯之奥金山',          lat:35.40416667,lng:138.53055556},
  {qid:'Q11573299', name:'珊瑠鉱山',            lat:44.385638888,lng:142.642305555},
  {qid:'Q11577242', name:'田老鉱山',            lat:39.76,lng:141.9305},
  {qid:'Q11586877', name:'石狩炭田',            lat:43.221,lng:141.909},
  {qid:'Q11602475', name:'笹ヶ谷鉱山',          lat:34.53561111,lng:131.73627778},
  {qid:'Q11604119', name:'米子鉱山',            lat:36.569111111,lng:138.409611111},
  {qid:'Q11605807', name:'細倉鉱山',            lat:38.80805556,lng:140.89972222},
  {qid:'Q11615333', name:'花岡鉱山',            lat:40.30916667,lng:140.55194444},
  {qid:'Q11618632', name:'荒川鉱山',            lat:39.641472222,lng:140.420916666},
  {qid:'Q11618875', name:'荒金鉱山',            lat:35.523888888,lng:134.365277777},
  {qid:'Q11620166', name:'菱刈鉱山',            lat:32.0125,lng:130.6916},
  {qid:'Q11620166', name:'菱刈鉱山',            lat:32.0125,lng:130.69388889},
  {qid:'Q11621753', name:'蓮華鉱山',            lat:36.807305555,lng:137.799972222},
  {qid:'Q11634209', name:'豊羽鉱山',            lat:42.9792,lng:141.044},
  {qid:'Q11637574', name:'軽井沢銀山',          lat:37.473861,lng:139.740861},
  {qid:'Q11641973', name:'遠ヶ根鉱山',          lat:35.55366667,lng:137.36672222},
  {qid:'Q11645777', name:'野沢鉱山',            lat:43.26669444,lng:142.40269444},
  {qid:'Q11648140', name:'釜石鉱山',            lat:39.285611,lng:141.714389},
  {qid:'Q11657209', name:'阿仁鉱山',            lat:39.98459,lng:140.43342},
  {qid:'Q11671999', name:'高玉金山',            lat:37.488305555,lng:140.303694444},
  {qid:'Q11678266', name:'黒川金山',            lat:35.79,lng:138.84694444},
  {qid:'Q11453004', name:'室岩洞',              lat:34.750657,lng:138.766744},
  {qid:'Q109359187',name:'石切山脈',            lat:36.3749,lng:140.2053},
  {qid:'Q123118346',name:'泉山磁石場',          lat:33.193888888,lng:129.910277777},
  {qid:'Q97445875', name:'藪塚石切場跡',        lat:36.368333333,lng:139.323333333},
  {qid:'Q102387247',name:'Quarry (Iwo Jima)',   lat:24.7715689,lng:141.3231778},
  {qid:'Q49460392', name:'Q49460392',           lat:33.775,lng:130.951388888},
  {qid:'Q16976501', name:'釈迦内鉱山',          lat:40.317222222,lng:140.572666666},
  {qid:'Q16976501', name:'釈迦内鉱山',          lat:40.31831,lng:140.57251},
  {qid:'Q22125314', name:'白滝鉱山',            lat:33.81916667,lng:133.46666667},
  {qid:'Q17226552', name:'奈賀野鉱山',          lat:34.834,lng:133.304555555},
  {qid:'Q17230898', name:'大ヶ生金山',          lat:39.601694444,lng:141.250722222},
  {qid:'Q17996048', name:'大東鉱山',            lat:35.295333333,lng:132.970527777},
  {qid:'Q20043544', name:'乙女鉱山',            lat:35.817777777,lng:138.628888888},
  {qid:'Q21652707', name:'帯江鉱山',            lat:34.61111111,lng:133.80083333},
  {qid:'Q21655005', name:'八谷鉱山',            lat:37.784472222,lng:140.010861111},
  {qid:'Q48764861', name:'小樽松倉鉱山',        lat:43.12688889,lng:140.96372222},
  {qid:'Q49396101', name:'Q49396101',           lat:40.3975,lng:140.715833333},
  {qid:'Q28059736', name:'Takase mine',         lat:35.0,lng:133.333333333},
  {qid:'Q28843373', name:'Akagane mine',        lat:39.166666666,lng:141.333333333},
  {qid:'Q29674025', name:'Johkoku mine',        lat:41.666666666,lng:140.052777777},
  {qid:'Q30931976', name:'東京炭鉱',            lat:35.823083333,lng:139.285777777},
  {qid:'Q23935160', name:'河津鉱山',            lat:34.699444444,lng:138.922222222},
  {qid:'Q23935271', name:'野田玉川鉱山',        lat:40.073333333,lng:141.808333333},
  {qid:'Q23935699', name:'布賀鉱山',            lat:34.766666666,lng:133.433333333},
  {qid:'Q24035685', name:'白丸鉱山',            lat:35.808333333,lng:139.125},
  {qid:'Q24859996', name:'佐々連鉱山',          lat:33.90869444,lng:133.53927778},
  {qid:'Q26205797', name:'地蔵鉱山',            lat:36.872222222,lng:137.901666666},
  {qid:'Q49433130', name:'Q49433130',           lat:33.747777777,lng:130.8775},
  {qid:'Q137925090',name:'Dokatanosawa',        lat:33.73278,lng:135.98278},
  {qid:'Q137925099',name:'Esashi',              lat:44.932,lng:142.582},
  {qid:'Q137925117',name:'Hakkinzahia',         lat:42.982,lng:142.199},
  {qid:'Q137925121',name:'Hassen Deposit',      lat:44.165,lng:142.465},
  {qid:'Q137925133',name:'Kamikawa',            lat:32.782,lng:131.449},
  {qid:'Q137925134',name:'Kembuchi',            lat:44.024,lng:142.382},
  {qid:'Q137925136',name:'Kitano Sawa',         lat:44.165,lng:142.398},
  {qid:'Q137925154',name:'Monomanai',           lat:44.632,lng:142.198},
  {qid:'Q137925159',name:'Nakatombetsu Kakuta', lat:44.979,lng:142.357},
  {qid:'Q137925171',name:'Numata',              lat:43.832,lng:142.032},
  {qid:'Q137925191',name:'Sado Island',         lat:37.999,lng:138.415},
  {qid:'Q137925192',name:'Saganoseki refinery', lat:33.2654,lng:131.8489},
  {qid:'Q137925196',name:'Saru',                lat:42.572,lng:142.287},
  {qid:'Q137925203',name:'Shirukomanaigawa',    lat:45.015,lng:142.232},
  {qid:'Q137925211',name:'Toikambetsu Hoshin',  lat:45.073,lng:142.115},
  {qid:'Q137925212',name:'Toikambetsu Jugosen', lat:44.965,lng:142.115},
  {qid:'Q137925213',name:'Toikambetsu Nobukanai',lat:44.882,lng:142.082},
  {qid:'Q137925214',name:'Tombetsu River',      lat:44.915,lng:142.215},
  {qid:'Q137925225',name:'Utsunaigawa',         lat:45.048,lng:142.248},
  {qid:'Q137925237',name:'Yubari Gawa',         lat:43.015,lng:141.582},
  {qid:'Q137938370',name:'Matsuneshiri',        lat:35.16667,lng:132.48333},
  {qid:'Q137938416',name:'Obirashibe River',    lat:32.842,lng:131.578},
  {qid:'Q137938448',name:'Shosambetsu',         lat:44.532,lng:141.798},
  {qid:'Q55521848', name:'竜昇殿鉱山',          lat:44.31183333,lng:143.32069444},
  {qid:'Q55523351', name:'千野谷黒鉛鉱山',      lat:36.523333333,lng:137.342055555},
  {qid:'Q64979519', name:'勝負銅山',            lat:34.457166666,lng:133.299},
  {qid:'Q66486477', name:'Minamichiyoda',       lat:44.5225,lng:141.780833333},
  {qid:'Q69388358', name:'若松鉱山',            lat:35.092777777,lng:133.208472222},
  {qid:'Q72988253', name:'北沢浮遊選鉱場',      lat:38.036666666,lng:138.241666666},
  {qid:'Q75178770', name:'八森銀山',            lat:40.405305555,lng:139.980444444},
  {qid:'Q83846350', name:'伊佐鉱山',            lat:34.1775,lng:131.224444444},
  {qid:'Q85881940', name:'津具金山',            lat:35.159722222,lng:137.612777777},
  {qid:'Q85884178', name:'鍋山鉱山',            lat:35.270555555,lng:132.828888888},
  {qid:'Q86740300', name:'石見鉱山',            lat:35.1835,lng:132.442972222},
  {qid:'Q101786384',name:'竹野鉱山',            lat:35.617263888,lng:134.739908333},
  {qid:'Q105671778',name:'伊豆珪石鉱山',        lat:34.872972222,lng:138.801805555},
  {qid:'Q105883441',name:'白根金山',            lat:40.247116666,lng:140.73105},
  {qid:'Q107721275',name:'月布鉱山',            lat:38.376444444,lng:140.109027777},
  {qid:'Q111103629',name:'赤石鉱山',            lat:31.310472222,lng:130.379272222},
  {qid:'Q112128000',name:'春日鉱山',            lat:31.269722222,lng:130.258333333},
  {qid:'Q113381946',name:'小串鉱山',            lat:36.603333333,lng:138.457777777},
  {qid:'Q113583083',name:'河守鉱山',            lat:35.458333333,lng:135.140277777},
  {qid:'Q122333023',name:'Kuki Silver Mine',    lat:34.823888888,lng:132.569722222},
  {qid:'Q135005176',name:'茂倉沢鉱山',          lat:36.43972,lng:139.38306},
  {qid:'Q135140134',name:'持倉鉱山',            lat:37.674166666,lng:139.349166666},
  {qid:'Q285468',   name:'端島',               lat:32.627777777,lng:129.738333333},
  {qid:'Q6845423',  name:'三井三池炭鉱',        lat:33.014,lng:130.456},
  {qid:'Q7902576',  name:'宇多良炭坑',          lat:24.2,lng:123.48},
  {qid:'Q11088933', name:'昭和炭鉱',            lat:43.9864,lng:141.9481},
  {qid:'Q11353799', name:'万字炭鉱',            lat:43.133917,lng:141.991167},
  {qid:'Q11481590', name:'常磐炭田',            lat:37.0,lng:140.75},
  {qid:'Q11490835', name:'志免鉱業所',          lat:33.5905,lng:130.48644},
  {qid:'Q11602981', name:'筑豊炭田',            lat:33.66667,lng:130.75},
  {qid:'Q11609164', name:'美流渡炭鉱',          lat:43.141222,lng:141.928917},
  {qid:'Q11659184', name:'雄別炭鉱',            lat:43.2200815,lng:144.0728573},
  {qid:'Q11669662', name:'高島炭鉱',            lat:32.6595,lng:129.751},
  {qid:'Q17996339', name:'高窪炭鉱',            lat:35.316027777,lng:132.859527777},
  {qid:'Q137942968',name:'Taishio Cobalt Mine, Japan',lat:35.165,lng:134.582},
  {qid:'Q138779766',name:'西牧鉱山',            lat:36.241388888,lng:138.658611111},
  {qid:'Q11433700', name:'大坂城残石記念公園',  lat:34.53394444,lng:134.24213889},
  {qid:'Q118129847',name:'吉岡鉱山',            lat:34.865472222,lng:133.457111111},
  {qid:'Q134727299',name:'草倉銅山',            lat:37.728333333,lng:139.468611111},
  {qid:'Q134887711',name:'間瀬銅山',            lat:37.720833333,lng:138.798055555},
  {qid:'Q994193',   name:'別子銅山',            lat:33.865277777,lng:133.328055555},
  {qid:'Q994193',   name:'別子銅山',            lat:33.865277777,lng:133.328055555},
  {qid:'Q2797958',  name:'足尾銅山',            lat:36.63333333,lng:139.43972222},
  {qid:'Q11418228', name:'和銅遺跡',            lat:36.047861111,lng:139.107222222},
  {qid:'Q11436816', name:'大江山鉱山',          lat:35.480916666,lng:135.095055555},
  {qid:'Q11465138', name:'尾小屋鉱山',          lat:36.295778,lng:136.538778},
  {qid:'Q11629056', name:'西浦採銅抗跡',        lat:36.118111111,lng:139.115555555},
  {qid:'Q11647649', name:'金生山',              lat:35.40194444,lng:136.5775},
  {qid:'Q11653520', name:'長登銅山',            lat:34.244944,lng:131.336111},
  {qid:'Q174139',   name:'石見銀山',            lat:35.107222,lng:132.4375},
  {qid:'Q11248197', name:'佐渡金山',            lat:38.0416,lng:138.256},
  {qid:'Q11248197', name:'佐渡金山',            lat:38.0416,lng:138.256},
  {qid:'Q11248197', name:'佐渡金山',            lat:38.0416,lng:138.256},
  {qid:'Q11658109', name:'院内銀山',            lat:39.0495,lng:140.363666666},
  {qid:'Q16664574', name:'生野銀山',            lat:35.171678,lng:134.81965},
  {qid:'Q56871123', name:'延沢銀山',            lat:38.570833333,lng:140.465833333},
  {qid:'Q3314832',  name:'土肥金山',            lat:34.9082,lng:138.793},
  {qid:'Q11432297', name:'大仁鉱山',            lat:34.98705556,lng:138.94255556},
  {qid:'Q11439172', name:'大谷鉱山',            lat:38.81597222,lng:141.52766667},
  {qid:'Q11439172', name:'大谷鉱山',            lat:38.81597222,lng:141.52766667},
  {qid:'Q11679452', name:'龕附天正金鉱',        lat:34.905861,lng:138.790028},
  {qid:'Q28690087', name:'黄金山産金遺跡',      lat:38.55983333,lng:141.13913889},
  {qid:'Q109943676',name:'お猿畠の大切岸',      lat:35.309055555,lng:139.567305555},
  {qid:'Q118342381',name:'西三川砂金山',        lat:37.9125965,lng:138.3246014},
  {qid:'Q11339828', name:'マイントピア別子',    lat:33.901444444,lng:133.3095},
  {qid:'Q11414532', name:'吉野鉱山',            lat:38.163861111,lng:140.181555555},
  {qid:'Q11589583', name:'神岡鉱山',            lat:36.34883333,lng:137.29519444},
  {qid:'Q11609917', name:'群馬鉄山',            lat:36.653083,lng:138.597083},
  {qid:'Q48746036', name:'静狩金山',            lat:42.599638888,lng:140.459694444},
  {qid:'Q120713329',name:'Shebunino coal mine', lat:46.436111111,lng:141.861611111},
  {qid:'Q109362343',name:'北大東島のリン鉱山',  lat:25.953888888,lng:131.2835},
];

let wikiLayer   = null;
let wikiVisible = false;

// ── マーカー生成
function makeWikiMarker(d){
  const wikiUrl = `https://www.wikidata.org/wiki/${d.qid}`;
  const sz = 12;
  // 紫系六角形（divで擬似表現：回転した正方形＋角丸）
  const html = `<div style="
    width:${sz}px;height:${sz}px;
    background:#9b59b6;
    border:1.5px solid rgba(255,255,255,0.7);
    border-radius:3px;
    transform:rotate(45deg);
    box-shadow:0 1px 4px rgba(0,0,0,0.55);
  "></div>`;

  const popup = `
    <div style="font-size:12px;min-width:190px;">
      <div style="background:#5b2c8d;color:#fff;padding:5px 8px;margin:-10px -12px 8px;font-weight:bold;border-radius:4px 4px 0 0;">
        🌐 Wikidata鉱山
      </div>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="color:#555;padding:2px 4px;white-space:nowrap;">名称</td>
            <td style="padding:2px 4px;font-weight:bold;">${d.name}</td></tr>
        <tr><td style="color:#555;padding:2px 4px;">Wikidata</td>
            <td style="padding:2px 4px;">
              <a href="${wikiUrl}" target="_blank" style="color:#7b2fbe;">${d.qid}</a>
            </td></tr>
      </table>
      <div style="font-size:10px;color:#888;margin-top:6px;text-align:right;">
        出典: Wikidata (CC0)
      </div>
      ${_gmapBtns(d.lat,d.lng)}
    </div>`;

  return L.marker([d.lat, d.lng], {
    icon: L.divIcon({ html, className:'', iconSize:[sz+4,sz+4], iconAnchor:[(sz+4)/2,(sz+4)/2], popupAnchor:[0,-((sz+4)/2+8)] }),
    pane: 'paneWiki'
  }).bindPopup(popup, {maxWidth: 270});
}

// ── レイヤー構築
function buildWikiLayer(data){
  if(wikiLayer){ map.removeLayer(wikiLayer); wikiLayer = null; }
  wikiLayer = L.layerGroup({pane:'paneWiki'});
  data.forEach(d => makeWikiMarker(d).addTo(wikiLayer));
}

// ── ステータス表示ユーティリティ
function setWikiStatus(msg, color=''){
  const el = document.getElementById('wiki-status');
  if(el){ el.textContent = msg; el.style.color = color || ''; }
}

// ── 起動時初期化（静的データで即構築）
function initWikiLayer(){
  buildWikiLayer(WIKI_STATIC_DATA);
  wikiVisible = false;
  setWikiStatus(`✅ 組み込み ${WIKI_STATIC_DATA.length}件`, '#40c870');
}

// ── ON/OFFトグル
function toggleWikiLayer(){
  wikiVisible = !wikiVisible;
  document.getElementById('btn-wiki').classList.toggle('active', wikiVisible);
  if(wikiVisible) wikiLayer.addTo(map);
  else map.removeLayer(wikiLayer);
}

// ═══════════════════════════════════════════
//  kinno調査記レイヤー（鉱山調査地・組み込みデータ）
//  出典: kinno lab.（金野実）
//  https://kinno-homepage.sakura.ne.jp/kinno_mineral.html
// ═══════════════════════════════════════════

// ── 組み込みデータ（all-map.geojsonより生成 / 215地点）
// Icon(赤丸)→最近傍DivIcon(番号)でペアリング
// PDF URL: https://kinno-homepage.sakura.ne.jp/mineral/<filename>.pdf
const KINNO_DATA = [
  {no:  1, lat:36.506187, lng:140.290389, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/suzukoya.pdf'},
  {no:  1, lat:36.507153, lng:140.295324, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/suzukoya.pdf'},
  {no:  1, lat:36.508291, lng:140.287642, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/suzukoya.pdf'},
  {no:  2, lat:36.634230, lng:139.661508, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/itaga.pdf'},
  {no:  3, lat:36.629167, lng:139.637904, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oowasi.pdf'},
  {no:  4, lat:36.702937, lng:139.627476, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/okorogawa.pdf'},
  {no:  5, lat:36.656818, lng:139.672322, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/karasawa.pdf'},
  {no:  5, lat:36.658539, lng:139.671507, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/karasawa.pdf'},
  {no:  6, lat:36.790900, lng:139.722619, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takatoku.pdf'},
  {no:  6, lat:36.791003, lng:139.725666, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takatoku.pdf'},
  {no:  6, lat:36.794371, lng:139.719830, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takatoku.pdf'},
  {no:  7, lat:36.795986, lng:139.632969, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/ooisawa.pdf'},
  {no:  9, lat:36.690309, lng:139.835701, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tentyo.pdf'},
  {no:  9, lat:36.695746, lng:139.830422, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tentyo.pdf'},
  {no:  9, lat:36.777771, lng:139.814587, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tentyo.pdf'},
  {no:  9, lat:36.780005, lng:139.815316, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tentyo.pdf'},
  {no: 10, lat:36.761820, lng:139.821324, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nikkou.pdf'},
  {no: 11, lat:36.603229, lng:139.681377, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hikita.pdf'},
  {no: 11, lat:36.610602, lng:139.677429, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hikita.pdf'},
  {no: 12, lat:36.986409, lng:139.590311, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/doukura.pdf'},
  {no: 13, lat:36.842881, lng:139.447660, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nisizawa.pdf'},
  {no: 14, lat:37.089418, lng:139.479675, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hotaru2+3.pdf'},
  {no: 14, lat:37.093971, lng:139.480534, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hotaru2+3.pdf'},
  {no: 14, lat:37.096538, lng:139.481177, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hotaru2+3.pdf'},
  {no: 15, lat:37.052917, lng:139.714894, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kosiji.pdf'},
  {no: 16, lat:36.457085, lng:139.484525, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kawazura.pdf'},
  {no: 17, lat:37.052403, lng:139.898872, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/rouseki.pdf'},
  {no: 18, lat:36.601024, lng:139.623742, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kaso.pdf'},
  {no: 19, lat:36.572320, lng:139.342175, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hagidaira.pdf'},
  {no: 20, lat:37.071101, lng:139.553275, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/magome.pdf'},
  {no: 21, lat:36.624276, lng:139.458175, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kyurazawa.pdf'},
  {no: 22, lat:36.803787, lng:139.777937, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/yasyuu.pdf'},
  {no: 22, lat:36.805299, lng:139.775147, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/yasyuu.pdf'},
  {no: 22, lat:36.808460, lng:139.777980, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/yasyuu.pdf'},
  {no: 23, lat:36.645800, lng:139.422383, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/asio.pdf'},
  {no: 23, lat:36.660364, lng:139.433670, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/asio.pdf'},
  {no: 26, lat:36.545536, lng:139.359727, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hara.pdf'},
  {no: 27, lat:36.726365, lng:140.315666, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/totihara.pdf'},
  {no: 28, lat:37.510951, lng:140.286999, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takatama.pdf'},
  {no: 29, lat:39.108518, lng:141.756334, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/imadeyama.pdf'},
  {no: 29, lat:39.108518, lng:141.768436, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/imadeyama.pdf'},
  {no: 30, lat:36.671689, lng:140.395789, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kitatomita.pdf'},
  {no: 30, lat:36.675510, lng:140.413041, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kitatomita.pdf'},
  {no: 31, lat:39.065781, lng:141.629477, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tamayama.pdf'},
  {no: 32, lat:39.351290, lng:141.797705, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/motitetu.pdf'},
  {no: 32, lat:39.357396, lng:141.802940, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/motitetu.pdf'},
  {no: 33, lat:38.948596, lng:141.638961, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/dairisekikaigan.pdf'},
  {no: 34, lat:39.104888, lng:141.856756, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/sakihama.pdf'},
  {no: 35, lat:37.629392, lng:140.262151, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/adatara.pdf'},
  {no: 36, lat:36.870111, lng:139.327755, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nebazawa.pdf'},
  {no: 36, lat:36.871587, lng:139.328184, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nebazawa.pdf'},
  {no: 36, lat:36.871725, lng:139.321876, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nebazawa.pdf'},
  {no: 37, lat:37.924329, lng:140.551658, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/amatukasan.pdf'},
  {no: 41, lat:37.783537, lng:139.447875, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/mikawa.pdf'},
  {no: 41, lat:37.786352, lng:139.453540, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/mikawa.pdf'},
  {no: 44, lat:37.807682, lng:139.487829, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/akatani.pdf'},
  {no: 44, lat:37.821311, lng:139.444013, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/akatani.pdf'},
  {no: 45, lat:37.124191, lng:139.960155, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tyausudake.pdf'},
  {no: 45, lat:37.129426, lng:139.961786, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tyausudake.pdf'},
  {no: 46, lat:36.910475, lng:139.815359, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takaharayama.pdf'},
  {no: 46, lat:36.912019, lng:139.806347, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takaharayama.pdf'},
  {no: 47, lat:36.507498, lng:140.274510, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/taisyou+iwatani.pdf'},
  {no: 47, lat:36.507739, lng:140.270777, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/taisyou+iwatani.pdf'},
  {no: 48, lat:36.330788, lng:140.250049, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kagata.pdf'},
  {no: 50, lat:36.810006, lng:139.814930, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/terasima.pdf'},
  {no: 51, lat:36.860395, lng:139.792399, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tatemuro.pdf'},
  {no: 51, lat:36.861562, lng:139.780512, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tatemuro.pdf'},
  {no: 51, lat:36.864412, lng:139.783387, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tatemuro.pdf'},
  {no: 52, lat:36.794543, lng:139.827933, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/manju.pdf'},
  {no: 52, lat:36.796811, lng:139.825444, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/manju.pdf'},
  {no: 53, lat:36.841851, lng:139.801583, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tenjouzawa.pdf'},
  {no: 54, lat:36.852016, lng:139.828920, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takayama.pdf'},
  {no: 54, lat:36.852840, lng:139.824972, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takayama.pdf'},
  {no: 55, lat:36.842915, lng:139.837546, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/maruyama.pdf'},
  {no: 56, lat:36.826119, lng:139.820552, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/daimyouzawa.pdf'},
  {no: 56, lat:36.829623, lng:139.816732, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/daimyouzawa.pdf'},
  {no: 57, lat:36.813957, lng:139.812570, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kamanosawa.pdf'},
  {no: 58, lat:36.804096, lng:139.818878, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/sirogane.pdf'},
  {no: 59, lat:36.798220, lng:139.694295, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kidogazawa.pdf'},
  {no: 60, lat:36.797876, lng:139.709229, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/minamisawa.pdf'},
  {no: 61, lat:36.779111, lng:139.671507, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/obyaku.pdf'},
  {no: 61, lat:36.780830, lng:139.673266, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/obyaku.pdf'},
  {no: 62, lat:39.040986, lng:141.550856, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/taisi.pdf'},
  {no: 63, lat:37.060520, lng:139.658203, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hatisou.pdf'},
  {no: 64, lat:39.167934, lng:141.358252, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/akagane.pdf'},
  {no: 65, lat:37.012560, lng:139.634857, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/serizawa.pdf'},
  {no: 66, lat:36.913014, lng:139.604602, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hinata.pdf'},
  {no: 68, lat:37.473802, lng:139.739699, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/karuizawa.pdf'},
  {no: 69, lat:37.018145, lng:139.517698, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/mizuhiki.pdf'},
  {no: 71, lat:37.150876, lng:139.469976, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/iminami.pdf'},
  {no: 72, lat:36.626515, lng:139.191070, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/akagine.pdf'},
  {no: 73, lat:36.500357, lng:140.228119, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/motegi.pdf'},
  {no: 73, lat:36.513637, lng:140.241852, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/motegi.pdf'},
  {no: 73, lat:36.519052, lng:140.232410, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/motegi.pdf'},
  {no: 74, lat:36.758931, lng:139.841194, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/sekisonsan.pdf'},
  {no: 77, lat:36.585416, lng:139.514093, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takanosu.pdf'},
  {no: 77, lat:36.588276, lng:139.509759, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takanosu.pdf'},
  {no: 78, lat:36.546604, lng:139.634600, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/matuzaka.pdf'},
  {no: 79, lat:36.507704, lng:139.556365, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nagano.pdf'},
  {no: 80, lat:36.603333, lng:139.621425, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takahira.pdf'},
  {no: 81, lat:36.576731, lng:139.511604, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hokkougi.pdf'},
  {no: 82, lat:36.570493, lng:139.510446, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oobyakukawa.pdf'},
  {no: 83, lat:36.732865, lng:139.120688, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kousekiyama.pdf'},
  {no: 84, lat:36.566426, lng:140.568395, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hase.pdf'},
  {no: 85, lat:36.681085, lng:138.879762, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/daidou.pdf'},
  {no: 86, lat:36.750301, lng:138.994689, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tennuma.pdf'},
  {no: 86, lat:36.754909, lng:138.998251, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tennuma.pdf'},
  {no: 87, lat:36.150836, lng:138.683424, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oomizusawa.pdf'},
  {no: 88, lat:36.242854, lng:138.658576, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nisinomaki.pdf'},
  {no: 89, lat:36.241366, lng:138.674626, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nakamaru.pdf'},
  {no: 90, lat:37.363131, lng:140.209064, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takahata.pdf'},
  {no: 90, lat:37.365280, lng:140.205975, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takahata.pdf'},
  {no: 90, lat:37.370430, lng:140.196447, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takahata.pdf'},
  {no: 91, lat:37.400608, lng:140.171771, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/asaka.pdf'},
  {no: 92, lat:37.385572, lng:140.190611, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/hiyama-new.pdf'},
  {no: 93, lat:37.539881, lng:139.652324, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/akabane.pdf'},
  {no: 94, lat:36.852325, lng:139.720173, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kamitaki.pdf'},
  {no: 95, lat:36.680776, lng:139.054213, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tokamiyama.pdf'},
  {no: 96, lat:39.306376, lng:141.682692, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oomine.pdf'},
  {no: 96, lat:39.312220, lng:141.673551, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oomine.pdf'},
  {no: 97, lat:39.296679, lng:141.769381, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/houzou.pdf'},
  {no: 98, lat:39.305679, lng:140.888929, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/wagasen-nin.pdf'},
  {no: 99, lat:39.283427, lng:140.808249, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tutihata.pdf'},
  {no: 99, lat:39.293856, lng:140.777049, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tutihata.pdf'},
  {no:101, lat:36.701285, lng:139.869905, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kanpaku.pdf'},
  {no:102, lat:36.203663, lng:138.655529, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/arahune-add.pdf'},
  {no:103, lat:37.164044, lng:140.917125, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/yakuki.pdf'},
  {no:103, lat:37.173791, lng:140.904937, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/yakuki.pdf'},
  {no:104, lat:36.665906, lng:139.658418, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/keimei.pdf'},
  {no:104, lat:36.669933, lng:139.665112, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/keimei.pdf'},
  {no:105, lat:36.652342, lng:139.642797, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oohara.pdf'},
  {no:105, lat:36.659847, lng:139.649534, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oohara.pdf'},
  {no:107, lat:39.116943, lng:141.577721, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tanokami.pdf'},
  {no:109, lat:36.801244, lng:139.647517, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kouhoku.pdf'},
  {no:110, lat:36.453944, lng:139.485211, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/yoshida.pdf'},
  {no:111, lat:36.619144, lng:139.570956, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/yoriguri.pdf'},
  {no:112, lat:36.609568, lng:139.700303, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kikuzawa.pdf'},
  {no:113, lat:37.008379, lng:139.710431, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/ojika.pdf'},
  {no:113, lat:37.014102, lng:139.709916, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/ojika.pdf'},
  {no:114, lat:36.578937, lng:139.617949, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kaso-sakamoto.pdf'},
  {no:115, lat:36.608707, lng:139.602671, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/ozaku.pdf'},
  {no:117, lat:36.483106, lng:139.670219, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/manago.pdf'},
  {no:117, lat:36.485970, lng:139.665627, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/manago.pdf'},
  {no:118, lat:36.954144, lng:139.749055, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/akagawa.pdf'},
  {no:119, lat:37.410187, lng:140.192842, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/onigajo_tomariyama.pdf'},
  {no:119, lat:37.411244, lng:140.195804, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/onigajo_tomariyama.pdf'},
  {no:120, lat:36.068562, lng:138.865256, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/futagoyama.pdf'},
  {no:121, lat:36.985517, lng:139.819136, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/siobara-1.pdf'},
  {no:122, lat:37.013656, lng:139.801326, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/siobara-3.pdf'},
  {no:125, lat:36.953493, lng:139.730172, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oosiozawa.pdf'},
  {no:125, lat:36.955413, lng:139.721375, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oosiozawa.pdf'},
  {no:125, lat:36.959048, lng:139.716053, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/oosiozawa.pdf'},
  {no:126, lat:36.430122, lng:139.391527, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kurokawa.pdf'},
  {no:126, lat:36.433092, lng:139.392943, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kurokawa.pdf'},
  {no:126, lat:36.434438, lng:139.390326, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kurokawa.pdf'},
  {no:127, lat:36.428361, lng:139.408565, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/iwagiri.pdf'},
  {no:128, lat:36.437546, lng:139.395432, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/asahizawa.pdf'},
  {no:128, lat:36.439306, lng:139.400926, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/asahizawa.pdf'},
  {no:128, lat:36.440687, lng:139.396935, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/asahizawa.pdf'},
  {no:129, lat:36.504289, lng:139.470406, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nomine.pdf'},
  {no:130, lat:39.218257, lng:141.540856, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/matumori.pdf'},
  {no:131, lat:36.604228, lng:139.642239, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/higasikaso.pdf'},
  {no:132, lat:36.633748, lng:139.605074, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kanoiri.pdf'},
  {no:133, lat:36.892424, lng:139.713521, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kawaji.pdf'},
  {no:134, lat:36.807704, lng:139.289432, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/akazawa.pdf'},
  {no:135, lat:36.673444, lng:139.160943, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/sirasawa.pdf'},
  {no:136, lat:36.511326, lng:139.421997, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/umeda.pdf'},
  {no:137, lat:39.278477, lng:140.904980, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/mizusawa.pdf'},
  {no:137, lat:39.279607, lng:140.916781, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/mizusawa.pdf'},
  {no:138, lat:38.994940, lng:141.618297, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kesen-innseki.pdf'},
  {no:139, lat:36.710369, lng:139.845400, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tosho-seikyo.pdf'},
  {no:139, lat:36.719795, lng:139.836602, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tosho-seikyo.pdf'},
  {no:140, lat:36.774264, lng:139.669447, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takigasira-toyooka.pdf'},
  {no:140, lat:36.777427, lng:139.663997, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/takigasira-toyooka.pdf'},
  {no:141, lat:36.673307, lng:139.563961, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/fukidaira-fudou-ootaki.pdf'},
  {no:141, lat:36.675647, lng:139.559283, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/fukidaira-fudou-ootaki.pdf'},
  {no:142, lat:37.024792, lng:139.686956, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nakanozawa2.pdf'},
  {no:143, lat:37.352829, lng:139.327669, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kurosawa.pdf'},
  {no:144, lat:36.756112, lng:138.923922, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/anougawa.pdf'},
  {no:144, lat:36.756353, lng:138.930831, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/anougawa.pdf'},
  {no:145, lat:36.989391, lng:139.710474, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nakamiyori.pdf'},
  {no:145, lat:36.992853, lng:139.711246, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nakamiyori.pdf'},
  {no:146, lat:37.132095, lng:139.919128, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/santogoya.pdf'},
  {no:146, lat:37.133053, lng:139.921103, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/santogoya.pdf'},
  {no:147, lat:36.870592, lng:139.471393, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kadomorizawa.pdf'},
  {no:148, lat:36.887275, lng:139.458818, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kuriyama.pdf'},
  {no:149, lat:36.996418, lng:139.899774, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/mori-takabayasi.pdf'},
  {no:150, lat:36.804818, lng:139.808106, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tamafune.pdf'},
  {no:151, lat:38.975325, lng:141.559610, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/sisiori-new.pdf'},
  {no:151, lat:38.985700, lng:141.562743, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/sisiori-new.pdf'},
  {no:151, lat:38.987301, lng:141.560469, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/sisiori-new.pdf'},
  {no:151, lat:38.988669, lng:141.560512, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/sisiori-new.pdf'},
  {no:152, lat:36.830962, lng:139.610567, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/asada-cu.pdf'},
  {no:154, lat:36.693887, lng:139.664555, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/togawa.pdf'},
  {no:155, lat:37.026540, lng:139.663954, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/toiri.pdf'},
  {no:156, lat:36.894346, lng:138.842812, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/iriyama.pdf'},
  {no:157, lat:36.785367, lng:139.645414, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tutitaru.pdf'},
  {no:158, lat:37.138185, lng:139.924579, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tousyou2.pdf'},
  {no:159, lat:36.825363, lng:139.619193, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/santogoya-ginzan.pdf'},
  {no:159, lat:36.825432, lng:139.615932, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/santogoya-ginzan.pdf'},
  {no:160, lat:37.410358, lng:140.162158, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/asada-mo.pdf'},
  {no:161, lat:40.170413, lng:141.724405, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kanayamazawa.pdf'},
  {no:162, lat:40.083128, lng:141.817360, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kohaku.pdf'},
  {no:163, lat:39.912468, lng:141.910701, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nodatamagawa.pdf'},
  {no:163, lat:39.917537, lng:141.905766, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nodatamagawa.pdf'},
  {no:164, lat:36.699599, lng:139.876513, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tanohata.pdf'},
  {no:164, lat:36.700838, lng:139.874711, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tanohata.pdf'},
  {no:164, lat:36.703797, lng:139.875097, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/tanohata.pdf'},
  {no:165, lat:36.230947, lng:138.768911, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/imazato.pdf'},
  {no:166, lat:36.836939, lng:139.790726, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nakaosaka.pdf'},
  {no:166, lat:36.840958, lng:139.788795, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/nakaosaka.pdf'},
  {no:167, lat:36.616320, lng:139.714723, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/namariyama.pdf'},
  {no:168, lat:36.617491, lng:139.452295, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kamituga.pdf'},
  {no:168, lat:36.625172, lng:139.463410, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kamituga.pdf'},
  {no:168, lat:36.626687, lng:139.461265, pdf:'https://kinno-homepage.sakura.ne.jp/mineral/kamituga.pdf'},
];

// レイヤー・表示フラグ
const kinnoLayer = L.layerGroup({pane:'paneKinno'});
let kinnoV = false;

// マーカーアイコン（金色の星★）
function kinnoIcon(){
  return L.divIcon({
    html: '<div style="font-size:14px;line-height:1;color:#f0c000;text-shadow:0 1px 3px rgba(0,0,0,.7),-1px 0 2px rgba(0,0,0,.5),1px 0 2px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;">★</div>',
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -14]
  });
}

// PDF名マップ（ファイル名 → 鉱山名）
const KINNO_PDF_NAME = {
  'adatara': '安達太良山鉱山',
  'akabane': '赤羽鉱山',
  'akagane': '赤金鉱山',
  'akagawa': '赤川鉱山',
  'akagine': '赤城根鉱山',
  'akatani': '赤谷鉱山',
  'akazawa': '赤沢鉱山',
  'amatukasan': '天束山鉱山',
  'anougawa': '穴生川鉱山',
  'arahune-add': '荒船鉱山',
  'asada-cu': '浅田銅鉱山',
  'asada-mo': '浅田Mo鉱山',
  'asahizawa': '朝日沢鉱山',
  'asaka': '安積鉱山',
  'asio': '足尾鉱山',
  'daidou': '大道鉱山',
  'daimyouzawa': '大名沢鉱山',
  'dairisekikaigan': '大理石海岸',
  'doukura': '堂倉鉱山',
  'fukidaira-fudou-ootaki': '吹平ほか鉱山',
  'futagoyama': '二子山鉱山',
  'hagidaira': '萩平鉱山',
  'hara': '原鉱山',
  'hase': '長谷鉱山',
  'hatisou': '蜂巣鉱山',
  'higasikaso': '東加蘇鉱山',
  'hikita': '引田鉱山',
  'hinata': '日向鉱山',
  'hiyama-new': '日山鉱山',
  'hokkougi': '北光義鉱山',
  'hotaru2+3': '蛍鉱山',
  'houzou': '宝蔵鉱山',
  'imadeyama': '今出山鉱山',
  'imazato': '今里鉱山',
  'iminami': '今市南鉱山',
  'iriyama': '入山鉱山',
  'itaga': '板荷鉱山',
  'iwagiri': '岩切鉱山',
  'kadomorizawa': '角守沢鉱山',
  'kagata': '鏡田鉱山',
  'kamanosawa': '釜ノ沢鉱山',
  'kamitaki': '上滝鉱山',
  'kamituga': '上都賀鉱山',
  'kanayamazawa': '金山沢鉱山',
  'kanoiri': '鹿ノ入鉱山',
  'kanpaku': '関白鉱山',
  'karasawa': '唐沢鉱山',
  'karuizawa': '軽井沢鉱山',
  'kaso': '加蘇鉱山',
  'kaso-sakamoto': '加蘇坂本鉱山',
  'kawaji': '川治鉱山',
  'kawazura': '川面鉱山',
  'keimei': '鶏鳴鉱山',
  'kesen-innseki': '気仙隕石',
  'kidogazawa': '木戸ヶ沢鉱山',
  'kikuzawa': '菊沢鉱山',
  'kitatomita': '北富田鉱山',
  'kohaku': '琥珀産地',
  'kosiji': '越路鉱山',
  'kouhoku': '江北鉱山',
  'kousekiyama': '鉱石山鉱山',
  'kuriyama': '栗山鉱山',
  'kurokawa': '黒川鉱山',
  'kurosawa': '黒沢鉱山',
  'kyurazawa': '久良沢鉱山',
  'magome': '真米鉱山',
  'manago': '真名子鉱山',
  'manju': '万寿鉱山',
  'maruyama': '丸山鉱山',
  'matumori': '松森鉱山',
  'matuzaka': '松坂鉱山',
  'mikawa': '三川鉱山',
  'minamisawa': '南沢鉱山',
  'mizuhiki': '水引鉱山',
  'mizusawa': '水沢鉱山',
  'mori-takabayasi': '森・高林鉱山',
  'motegi': '茂木鉱山',
  'motitetu': '持鉄鉱山',
  'nagano': '長野鉱山',
  'nakamaru': '中丸鉱山',
  'nakamiyori': '中間鉱山',
  'nakanozawa2': '中ノ沢鉱山',
  'nakaosaka': '中大坂鉱山',
  'namariyama': '鉛山鉱山',
  'nebazawa': '根場沢鉱山',
  'nikkou': '日光鉱山',
  'nisinomaki': '西ノ牧鉱山',
  'nisizawa': '西沢鉱山',
  'nodatamagawa': '野田玉川鉱山',
  'nomine': '野峰鉱山',
  'obyaku': '小百鉱山',
  'ojika': '男鹿鉱山',
  'okorogawa': '男鹿川鉱山',
  'onigajo_tomariyama': '鬼城・泊山鉱山',
  'oobyakukawa': '大百川鉱山',
  'oohara': '大原鉱山',
  'ooisawa': '大井沢鉱山',
  'oomine': '大峰鉱山',
  'oomizusawa': '大水沢鉱山',
  'oosiozawa': '大塩沢鉱山',
  'oowasi': '大鷲鉱山',
  'ozaku': '小作鉱山',
  'rouseki': '蝋石鉱山',
  'sakihama': '崎浜電気石',
  'santogoya': '三斗小屋鉱山',
  'santogoya-ginzan': '三斗小屋銀山',
  'sekisonsan': '石尊山鉱山',
  'serizawa': '芹沢鉱山',
  'siobara-1': '塩原第1鉱山',
  'siobara-3': '塩原第3鉱山',
  'sirasawa': '白沢鉱山',
  'sirogane': '白銀鉱山',
  'sisiori-new': '獅子折鉱山',
  'suzukoya': '鈴子屋鉱山',
  'taisi': '大子鉱山',
  'taisyou+iwatani': '大正・岩谷鉱山',
  'takaharayama': '高原山鉱山',
  'takahata': '高畑鉱山',
  'takahira': '高平鉱山',
  'takanosu': '鷹ノ巣鉱山',
  'takatama': '高玉鉱山',
  'takatoku': '高徳鉱山',
  'takayama': '高山鉱山',
  'takigasira-toyooka': '滝頭・豊岡鉱山',
  'tamafune': '玉船鉱山',
  'tamayama': '玉山金山',
  'tanohata': '田野畑鉱山',
  'tanokami': '田ノ神鉱山',
  'tatemuro': '立室鉱山',
  'tenjouzawa': '天上沢鉱山',
  'tennuma': '天沼鉱山',
  'tentyo': '天頂鉱山',
  'terasima': '寺島鉱山',
  'togawa': '都賀川鉱山',
  'toiri': '戸入鉱山',
  'tokamiyama': '戸神山鉱山',
  'tosho-seikyo': '東照・清鏡鉱山',
  'totihara': '栃原鉱山',
  'tousyou2': '東照鉱山',
  'tutihata': '土畑鉱山',
  'tutitaru': '土垂鉱山',
  'tyausudake': '茶臼岳鉱山',
  'umeda': '梅田鉱山',
  'wagasen-nin': '和賀川鉱山',
  'yakuki': '薬木鉱山',
  'yasyuu': '野州鉱山',
  'yoriguri': '拠栗鉱山',
  'yoshida': '吉田鉱山',
};

// ポップアップHTML生成
function kinnoPopupHtml(d){
  const fname = d.pdf ? d.pdf.replace(/.*\//, '').replace(/\.pdf$/, '') : '';
  const mineName = KINNO_PDF_NAME[fname] || fname;
  const pdfLink = d.pdf
    ? `<div style="margin-top:7px;"><a href="${d.pdf}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;color:#fff;background:#c06020;padding:4px 9px;border-radius:4px;font-size:11px;text-decoration:none;font-weight:bold;">📄 ${mineName}</a></div>`
    : '';
  return `<div style="font-size:12px;min-width:160px;">
    <div style="background:#6a3a10;color:#ffe080;padding:5px 8px;margin:-10px -12px 8px;font-weight:bold;border-radius:4px 4px 0 0;font-size:11px;">
      ⛏ kinno鉱山調査記
    </div>
    <div style="font-size:12px;font-weight:700;color:#222;margin-bottom:2px;">${mineName}</div>
    <div><span style="color:#555;font-size:10px;">No.</span> <b style="font-size:12px;color:#444;">${d.no}</b></div>
    <div style="margin-top:4px;font-size:10px;color:#777;">
      ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}
    </div>
    ${pdfLink}
    <div style="font-size:10px;color:#999;margin-top:6px;text-align:right;">
      出典: kinno lab.
    </div>
    ${_gmapBtns(d.lat,d.lng)}
  </div>`;
}

// 起動時にマーカーを構築（組み込みなので即時）
function initKinnoLayer(){
  kinnoLayer.clearLayers();
  KINNO_DATA.forEach(d => {
    L.marker([d.lat, d.lng], {icon: kinnoIcon(), pane: 'paneKinno'})
      .bindPopup(kinnoPopupHtml(d), {maxWidth: 220})
      .addTo(kinnoLayer);
  });
}

// ON/OFFトグル
function toggleKinnoLayer(){
  kinnoV = !kinnoV;
  document.getElementById('btn-kinno').classList.toggle('active', kinnoV);
  if(kinnoV) kinnoLayer.addTo(map);
  else map.removeLayer(kinnoLayer);
}

// ═══════════════════════════════════════════
//  産総研 鉱床・鉱徴地レイヤー
// ═══════════════════════════════════════════

// 鉱種カラー定義（地質図Naviに準拠）
const MINE_STYLE={
  // 金属鉱物 → 円
  'Sn_W':   {cat:'metal',color:'#e8320a',shape:'dot',label:'錫、タングステン'},
  'Cu_Mo':  {cat:'metal',color:'#f07820',shape:'dot',label:'銅、モリブデン'},
  'Au_Ag':  {cat:'metal',color:'#f0d020',shape:'dot',label:'金、銀、硫化鉄'},
  'U':      {cat:'metal',color:'#50c858',shape:'dot',label:'ウラン'},
  'Cr_Ni':  {cat:'metal',color:'#189020',shape:'dot',label:'クロム、ニッケル'},
  'Sb':     {cat:'metal',color:'#4890e8',shape:'dot',label:'アンチモン'},
  'Pb_Zn':  {cat:'metal',color:'#183090',shape:'dot',label:'鉛、亜鉛'},
  'As_Hg':  {cat:'metal',color:'#f8a8b8',shape:'dot',label:'ヒ素、水銀'},
  'Mn':     {cat:'metal',color:'#906030',shape:'dot',label:'マンガン'},
  'Fe_Ti':  {cat:'metal',color:'#90c8d8',shape:'dot',label:'鉄、チタン'},
  // 非金属鉱物 → 四角
  'SiO2':   {cat:'nonmetal',color:'#f07820',shape:'sq',label:'けい石、長石、珪藻土'},
  'S':      {cat:'nonmetal',color:'#f0d020',shape:'sq',label:'硫黄'},
  'Bent':   {cat:'nonmetal',color:'#60d890',shape:'sq',label:'ベントナイト、酸性白土、石膏'},
  'Talc':   {cat:'nonmetal',color:'#189020',shape:'sq',label:'滑石、アスベスト'},
  'CaCO3':  {cat:'nonmetal',color:'#4890e8',shape:'sq',label:'石灰石、ドロマイト'},
  'Fl':     {cat:'nonmetal',color:'#183090',shape:'sq',label:'蛍石'},
  'Clay2':  {cat:'nonmetal',color:'#f8a8b8',shape:'sq',label:'陶石、ろう石、セリサイト、重晶石'},
  'Clay1':  {cat:'nonmetal',color:'#906030',shape:'sq',label:'粘土、カオリン'},
  'Graph':  {cat:'nonmetal',color:'#90c8d8',shape:'sq',label:'黒鉛、ゼオライト'},
  // 燃料鉱物 → ×
  'Oil':    {cat:'fuel',color:'#183090',shape:'x',label:'石油'},
  'Gas':    {cat:'fuel',color:'#e85030',shape:'x',label:'天然ガス'},
  'Coal':   {cat:'fuel',color:'#303030',shape:'x',label:'石炭、亜炭'},
};

// WFSエンドポイント
const GSJ_WFS='https://gbank.gsj.jp/seamless/wfs';


// ═══════════════════════════════════════════
//  産総研 鉱床・鉱徴地データ（外部JSONファイル版）
//  出典: 産総研地質調査総合センター シームレス地質図 鉱床・鉱徴地データ
// ═══════════════════════════════════════════
let GSJ_MINE_DATA = null; // メモリキャッシュ

async function loadGsjMineData() {
  // 1. メモリキャッシュがあれば即返す
  if (GSJ_MINE_DATA) return GSJ_MINE_DATA;

  // 2. IndexedDBに保存済みなら読み込む
  try {
    const cached = await dbGetMine('gsj_mine_data');
    if (cached) {
      GSJ_MINE_DATA = cached;
      return GSJ_MINE_DATA;
    }
  } catch(e) { /* DB未初期化などは無視してfetchへ */ }

  // 3. fetchしてIndexedDBに保存
  const res = await fetch('data/gsj_mine_data_full.json');
  GSJ_MINE_DATA = await res.json();
  try { await dbPutMine('gsj_mine_data', GSJ_MINE_DATA); } catch(e) {}
  return GSJ_MINE_DATA;
}


let gsjLayer = null;
let gsjVisible = false;

// ── 鉱種スタイルから色・形を取得
function getMineStyle(mat){
  const S={
    Au_Ag: {cat:'metal',  color:'#f0d020',shape:'dot'},
    Cu_Mo: {cat:'metal',  color:'#f07820',shape:'dot'},
    Sn_W:  {cat:'metal',  color:'#e8320a',shape:'dot'},
    Pb_Zn: {cat:'metal',  color:'#183090',shape:'dot'},
    Fe_Ti: {cat:'metal',  color:'#90c8d8',shape:'dot'},
    Mn:    {cat:'metal',  color:'#906030',shape:'dot'},
    Cr_Ni: {cat:'metal',  color:'#189020',shape:'dot'},
    U:     {cat:'metal',  color:'#50c858',shape:'dot'},
    Sb:    {cat:'metal',  color:'#4890e8',shape:'dot'},
    As_Hg: {cat:'metal',  color:'#f8a8b8',shape:'dot'},
    S:     {cat:'nonmetal',color:'#f0d020',shape:'sq'},
    SiO2:  {cat:'nonmetal',color:'#f07820',shape:'sq'},
    CaCO3: {cat:'nonmetal',color:'#4890e8',shape:'sq'},
    Bent:  {cat:'nonmetal',color:'#60d890',shape:'sq'},
    Talc:  {cat:'nonmetal',color:'#189020',shape:'sq'},
    Fl:    {cat:'nonmetal',color:'#183090',shape:'sq'},
    Clay1: {cat:'nonmetal',color:'#906030',shape:'sq'},
    Clay2: {cat:'nonmetal',color:'#f8a8b8',shape:'sq'},
    Graph: {cat:'nonmetal',color:'#90c8d8',shape:'sq'},
    Oil:   {cat:'fuel',   color:'#183090',shape:'x'},
    Gas:   {cat:'fuel',   color:'#e85030',shape:'x'},
    Coal:  {cat:'fuel',   color:'#404040',shape:'x'},
  };
  return S[mat] || S['Au_Ag'];
}

function makeMineMarker(d){
  const st=getMineStyle(d.mat);
  const sz=d.trace?9:15;
  let html;
  if(st.shape==='dot'){
    html=`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${st.color};border:1.5px solid rgba(0,0,0,.45);box-shadow:0 1px 4px rgba(0,0,0,.5);"></div>`;
  }else if(st.shape==='sq'){
    html=`<div style="width:${sz}px;height:${sz}px;background:${st.color};border:1.5px solid rgba(0,0,0,.45);box-shadow:0 1px 4px rgba(0,0,0,.5);"></div>`;
  }else{
    html=`<div style="width:${sz+4}px;height:${sz+4}px;color:${st.color};font-size:${sz+2}px;font-weight:900;line-height:1;display:flex;align-items:center;justify-content:center;text-shadow:0 1px 3px rgba(0,0,0,.6);">✕</div>`;
  }
  const catLabel={metal:'金属鉱物',nonmetal:'非金属鉱物',fuel:'燃料鉱物'}[st.cat]||'';
  const traceLabel = d.trace ? '鉱徴地' : '鉱床';
  const matLabel = {
    Au_Ag:'金 (Au)・銀 (Ag)', Cu_Mo:'銅 (Cu)・モリブデン (Mo)',
    Sn_W:'錫 (Sn)・タングステン (W)', Pb_Zn:'鉛 (Pb)・亜鉛 (Zn)',
    Fe_Ti:'鉄 (Fe)・チタン (Ti)', Mn:'マンガン (Mn)',
    Cr_Ni:'クロム (Cr)・ニッケル (Ni)', U:'ウラン (U)',
    Sb:'アンチモン (Sb)', As_Hg:'砒素 (As)・水銀 (Hg)',
    S:'硫黄 (S)', SiO2:'けい石・長石・珪藻土',
    CaCO3:'石灰石・ドロマイト', Bent:'ベントナイト・石膏',
    Talc:'滑石・アスベスト', Fl:'蛍石',
    Clay1:'粘土・カオリン', Clay2:'陶石・ろう石',
    Graph:'黒鉛・ゼオライト', Oil:'石油', Gas:'天然ガス', Coal:'石炭・亜炭'
  }[d.mat] || d.mat;
  const popup = `
    <div style="font-size:12px;min-width:180px;">
      <div style="background:#1a3a6a;color:#fff;padding:5px 8px;margin:-10px -12px 8px;font-weight:bold;border-radius:4px 4px 0 0;">
        鉱床・鉱徴地
      </div>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="color:#555;padding:2px 4px;white-space:nowrap;">鉱種</td>
            <td style="padding:2px 4px;font-weight:bold;">${matLabel}</td></tr>
        <tr style="background:#f5f5f5;"><td style="color:#555;padding:2px 4px;">区分</td>
            <td style="padding:2px 4px;">${catLabel}</td></tr>
        <tr><td style="color:#555;padding:2px 4px;">記載図幅</td>
            <td style="padding:2px 4px;">${d.mapsheet||'—'}</td></tr>
        <tr style="background:#f5f5f5;"><td style="color:#555;padding:2px 4px;">図幅凡例</td>
            <td style="padding:2px 4px;">${d.legend||'—'}</td></tr>
        <tr><td style="color:#555;padding:2px 4px;">種別</td>
            <td style="padding:2px 4px;">${traceLabel}</td></tr>
      </table>
      ${d.note ? `<div style="font-size:11px;color:#444;margin-top:7px;padding:5px 6px;background:#f0f4ff;border-left:3px solid #4a8ee8;border-radius:0 3px 3px 0;line-height:1.5;">${d.note}</div>` : ''}
      <div style="font-size:10px;color:#888;margin-top:6px;text-align:right;">
        出典: 産総研地質調査総合センター・各種資料
      </div>
    </div>`;
  if(!d.lat || !d.lng) return null;
  return L.marker([d.lat,d.lng],{
    icon:L.divIcon({html,className:'',iconSize:[sz+4,sz+4],iconAnchor:[(sz+4)/2,(sz+4)/2],popupAnchor:[0,-((sz+4)/2+8)]}),
    pane:'paneGsj',
    zIndexOffset:d.trace?0:10
  }).bindPopup(popup, {maxWidth:260});
}

function buildGsjLayer(){
  // 既存クラスターを地図から除去
  if(gsjLayer){ map.removeLayer(gsjLayer); gsjLayer=null; }
  gsjLayer=L.layerGroup({pane:'paneGsj'});

  const fMetal   =document.getElementById('mf-metal').checked;
  const fNonmetal=document.getElementById('mf-nonmetal').checked;
  const fFuel    =document.getElementById('mf-fuel').checked;
  const fTrace   =document.getElementById('mf-trace').checked;
  const fWide    =document.getElementById('mf-wide').checked;
  const fActive  =document.getElementById('mf-active').checked;
  const fClosed  =document.getElementById('mf-closed').checked;
  const fGold    =document.getElementById('mf-gold').checked;

  if(!GSJ_MINE_DATA) return;
  GSJ_MINE_DATA.forEach(d=>{
    const st=getMineStyle(d.mat);
    if(!fWide && (d.scale===200 || d.scale===500)) return;
    if(!fActive  && d.status==='active')  return;
    if(!fClosed  && d.status==='closed')  return;
    if(fGold && d.mat!=='Au_Ag') return;
    if(d.trace && !fTrace) return;
    if(!d.trace){
      if(st.cat==='metal'    && !fMetal)    return;
      if(st.cat==='nonmetal' && !fNonmetal) return;
      if(st.cat==='fuel'     && !fFuel)     return;
    }
    const marker = makeMineMarker(d);
    if(marker) marker.addTo(gsjLayer);
  });
}

function initGsjLayer(){
  // 起動時は何もしない（loadMineData()が自動で呼ばれる）
}

// ── 取得ボタン: バッチ処理でプログレス表示しながらレイヤー構築


async function loadMineData(fromButton=false){
  // フィルター状態を復元（初回のみ有効・既にチェックされていれば上書きしない）
  _restoreMineFilter();
  const progWrap = document.getElementById('mine-prog-wrap');
  const progBar  = document.getElementById('mine-prog-bar');
  const progPct  = document.getElementById('mine-prog-pct');
  progWrap.style.display = 'block';

  await loadGsjMineData();
  let data = [...GSJ_MINE_DATA];

  // 古いクラスターを削除
  if(gsjLayer){ map.removeLayer(gsjLayer); gsjLayer=null; }
  gsjLayer=L.layerGroup({pane:'paneGsj'});

  // フィルター状態取得
  const fMetal    = document.getElementById('mf-metal').checked;
  const fNonmetal = document.getElementById('mf-nonmetal').checked;
  const fFuel     = document.getElementById('mf-fuel').checked;
  const fTrace    = document.getElementById('mf-trace').checked;
  const fWide     = document.getElementById('mf-wide').checked;
  const fActive   = document.getElementById('mf-active').checked;
  const fClosed   = document.getElementById('mf-closed').checked;
  const fGold     = document.getElementById('mf-gold').checked;

  const total = data.length;
  const BATCH = 50;
  let done = 0;

  const processBatch = () => new Promise(resolve => {
    const end = Math.min(done + BATCH, total);
    for(let i=done; i<end; i++){
      const d = data[i];
      const st = getMineStyle(d.mat);
      if(!fWide && (d.scale===200 || d.scale===500)){ done++; continue; }
      if(!fActive  && d.status==='active') { done++; continue; }
      if(!fClosed  && d.status==='closed') { done++; continue; }
      if(fGold && d.mat!=='Au_Ag')         { done++; continue; }
      if(d.trace && !fTrace){ done++; continue; }
      if(!d.trace){
        if(st.cat==='metal'     && !fMetal)    { done++; continue; }
        if(st.cat==='nonmetal'  && !fNonmetal) { done++; continue; }
        if(st.cat==='fuel'      && !fFuel)     { done++; continue; }
      }
      const marker = makeMineMarker(d);
      if(marker) marker.addTo(gsjLayer);
      done++;
    }
    const pct = Math.round(done/total*100);
    progBar.style.width = pct+'%';
    progPct.textContent = pct+'%';
    setTimeout(resolve, 0);
  });

  while(done < total){
    await processBatch();
  }

  if(gsjVisible) gsjLayer.addTo(map);

  progWrap.style.display = 'none';
}

function applyMineFilter(){
  // フィルター状態をlocalStorageに保存
  const state = {
    metal:    document.getElementById('mf-metal').checked,
    nonmetal: document.getElementById('mf-nonmetal').checked,
    fuel:     document.getElementById('mf-fuel').checked,
    trace:    document.getElementById('mf-trace').checked,
    wide:     document.getElementById('mf-wide').checked,
    active:   document.getElementById('mf-active').checked,
    closed:   document.getElementById('mf-closed').checked,
    gold:     document.getElementById('mf-gold').checked,
  };
  localStorage.setItem('gm_mine_filter', JSON.stringify(state));
  // 表示中のときのみ再構築（非表示中は次回表示時に反映される）
  if(gsjVisible) loadMineData();
}

// デフォルトフィルター状態（スクショ確定仕様）
const MINE_FILTER_DEFAULT = {
  metal:    true,
  nonmetal: false,
  fuel:     false,
  trace:    true,
  active:   true,
  closed:   true,
  wide:     false,
  gold:     true,
};

function _restoreMineFilter(){
  try {
    const s = JSON.parse(localStorage.getItem('gm_mine_filter'));
    if(!s) return;
    const el = id => document.getElementById(id);
    if(el('mf-metal'))    el('mf-metal').checked    = s.metal    ?? MINE_FILTER_DEFAULT.metal;
    if(el('mf-nonmetal')) el('mf-nonmetal').checked = s.nonmetal ?? MINE_FILTER_DEFAULT.nonmetal;
    if(el('mf-fuel'))     el('mf-fuel').checked     = s.fuel     ?? MINE_FILTER_DEFAULT.fuel;
    if(el('mf-trace'))    el('mf-trace').checked    = s.trace    ?? MINE_FILTER_DEFAULT.trace;
    if(el('mf-wide'))     el('mf-wide').checked     = s.wide     ?? MINE_FILTER_DEFAULT.wide;
    if(el('mf-active'))   el('mf-active').checked   = s.active   ?? MINE_FILTER_DEFAULT.active;
    if(el('mf-closed'))   el('mf-closed').checked   = s.closed   ?? MINE_FILTER_DEFAULT.closed;
    if(el('mf-gold'))     el('mf-gold').checked     = s.gold     ?? MINE_FILTER_DEFAULT.gold;
  } catch(e){}
}

function resetMineFilter(){
  const el = id => document.getElementById(id);
  Object.entries(MINE_FILTER_DEFAULT).forEach(([key, val]) => {
    if(el('mf-'+key)) el('mf-'+key).checked = val;
  });
  localStorage.removeItem('gm_mine_filter');
  if(gsjVisible) loadMineData();
}

function toggleGsjLayer(){
  gsjVisible = !gsjVisible;
  const btn = document.getElementById('btn-gsj');
  btn.classList.toggle('active', gsjVisible);
  if(gsjVisible){
    if(gsjLayer){
      gsjLayer.addTo(map);
    } else {
      loadMineData();
    }
  } else {
    if(gsjLayer) map.removeLayer(gsjLayer);
  }
  if(typeof updateLegendHandles==='function') updateLegendHandles();
}



// ─── 凡例モーダル ───
// 凡例画像は images/legend/deposit.png を参照
function openMineLegend(){
  const img=document.getElementById('mine-legend-img');
  if(!img.getAttribute('data-loaded')){
    img.src='images/legend/deposit.png';
    img.setAttribute('data-loaded','1');
  }
  document.getElementById('mine-legend-overlay').classList.add('open');
}
function closeMineLegend(){
  document.getElementById('mine-legend-overlay').classList.remove('open');
}

// ═══════════════════════════════════════════