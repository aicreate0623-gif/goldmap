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
  return `<b style="color:#c06030">${m.name}</b><br><small>${m.note}</small>${alertNote}${link}`;
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
//  産総研 鉱床・鉱徴地データ（組み込み版）
//  出典: 産総研地質調査総合センター シームレス地質図 鉱床・鉱徴地データ
// ═══════════════════════════════════════════
const GSJ_MINE_DATA = [
  {lat:44.133,lng:143.367,name:'鴻之舞鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万白滝',legend:'金銀鉱床'},
  {lat:44.000,lng:143.500,name:'置戸鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万置戸',legend:'金銀鉱床'},
  {lat:43.917,lng:144.183,name:'斜里鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万斜里',legend:'金銀鉱徴地'},
  {lat:43.650,lng:144.767,name:'羅臼鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万羅臼',legend:'金銀鉱徴地'},
  {lat:42.989,lng:141.115,name:'豊羽鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万札幌',legend:'鉛亜鉛鉱床'},
  {lat:43.383,lng:141.85,name:'然別鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万岩見沢',legend:'金銀鉱徴地'},
  {lat:43.483,lng:141.984,name:'上砂川炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万岩見沢',legend:'石炭鉱床'},
  {lat:43.057,lng:141.974,name:'夕張炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万夕張',legend:'石炭鉱床'},
  {lat:43.518,lng:142.189,name:'芦別炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万芦別',legend:'石炭鉱床'},
  {lat:44.383,lng:141.633,name:'羽幌炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万羽幌',legend:'石炭鉱床'},
  {lat:43.492,lng:141.901,name:'歌志内炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万赤平',legend:'石炭鉱床'},
  {lat:43.246,lng:141.874,name:'三笠炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万岩見沢',legend:'石炭鉱床'},
  {lat:42.767,lng:142.067,name:'日高ペリドタイト',cat:'metal',mat:'Cr_Ni',trace:false,mapsheet:'20万浦河',legend:'クロム鉄鉱鉱床'},
  {lat:42.400,lng:141.883,name:'静内クロム',cat:'metal',mat:'Cr_Ni',trace:true,mapsheet:'20万静内',legend:'クロム鉄鉱鉱徴地'},
  {lat:43.371,lng:141.514,name:'当別鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万札幌',legend:'金銀鉱床'},
  {lat:42.983,lng:140.683,name:'寿都硫黄',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万寿都',legend:'硫黄鉱床'},
  {lat:42.700,lng:140.300,name:'乙部マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万江差',legend:'マンガン鉱徴地'},
  {lat:42.217,lng:140.167,name:'松前金鉱',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万松前',legend:'金銀鉱徴地'},
  {lat:43.247,lng:141.385,name:'石狩油田',cat:'fuel',mat:'Oil',trace:false,mapsheet:'20万石狩',legend:'石油鉱床'},
  {lat:44.733,lng:141.683,name:'天塩石炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万天塩',legend:'石炭鉱徴地'},
  {lat:45.417,lng:141.683,name:'稚内珪藻土',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万稚内',legend:'けい藻土鉱床'},
  {lat:44.017,lng:145.333,name:'標津鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万標津',legend:'金銀鉱徴地'},
  {lat:43.483,lng:145.117,name:'弟子屈硫黄',cat:'nonmetal',mat:'S',trace:true,mapsheet:'20万弟子屈',legend:'硫黄鉱徴地'},
  {lat:42.933,lng:144.383,name:'釧路炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万釧路',legend:'石炭鉱床'},
  {lat:42.050,lng:143.183,name:'池田天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万帯広',legend:'天然ガス鉱床'},
  {lat:42.634,lng:141.606,name:'苫小牧珪砂',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万苫小牧',legend:'けい砂鉱床'},
  {lat:43.100,lng:143.950,name:'足寄石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万足寄',legend:'石灰石鉱床'},
  {lat:44.246,lng:142.672,name:'下川鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万名寄',legend:'銅鉱床'},
  {lat:44.339,lng:142.221,name:'朱鞠内石炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万名寄',legend:'石炭鉱徴地'},
  {lat:43.783,lng:143.983,name:'北見石炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万北見',legend:'石炭鉱徴地'},
  {lat:42.212,lng:140.389,name:'長万部マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万長万部',legend:'マンガン鉱徴地'},
  {lat:42.767,lng:142.067,name:'日高クロム',cat:'metal',mat:'Cr_Ni',trace:false,mapsheet:'20万浦河',legend:'クロム鉄鉱鉱床'},
  {lat:42.333,lng:140.967,name:'伊達石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万室蘭',legend:'石灰石鉱床'},
  {lat:44.483,lng:142.567,name:'士別石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万名寄',legend:'石灰石鉱床'},
  {lat:43.983,lng:144.383,name:'津別石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万北見',legend:'石灰石鉱床'},
  {lat:42.983,lng:143.600,name:'十勝石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万帯広',legend:'石灰石鉱床'},
  {lat:43.350,lng:141.450,name:'三笠石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岩見沢',legend:'石灰石鉱床'},
  {lat:40.364,lng:140.568,name:'小坂鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万大館',legend:'銅鉱床'},
  {lat:40.185,lng:140.548,name:'尾去沢鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万大館',legend:'銅鉱床'},
  {lat:40.27,lng:140.605,name:'花岡鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万大館',legend:'鉛亜鉛鉱床'},
  {lat:40.289,lng:140.566,name:'釈迦内鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万大館',legend:'鉛亜鉛鉱床'},
  {lat:40.15,lng:140.65,name:'大葛金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万大館',legend:'金銀鉱床'},
  {lat:40.217,lng:140.567,name:'鹿角金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万花輪',legend:'金銀鉱床'},
  {lat:40.462,lng:140.024,name:'八森鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万能代',legend:'銅鉱床'},
  {lat:39.967,lng:141.217,name:'山形銅鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万盛岡',legend:'銅鉱床'},
  {lat:39.25,lng:140.25,name:'荒川鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万秋田',legend:'金銀鉱床'},
  {lat:39.967,lng:141.083,name:'松尾硫黄',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万盛岡',legend:'硫黄鉱床'},
  {lat:39.45,lng:140.7,name:'土畑鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万盛岡',legend:'金銀鉱床'},
  {lat:39.383,lng:141.433,name:'遠野鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万盛岡',legend:'銅鉱床'},
  {lat:39.317,lng:140.703,name:'院内銀山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万秋田',legend:'金銀鉱床'},
  {lat:38.967,lng:139.883,name:'庄内油田',cat:'fuel',mat:'Oil',trace:false,mapsheet:'20万酒田',legend:'石油鉱床'},
  {lat:38.867,lng:139.783,name:'酒田天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万酒田',legend:'天然ガス鉱床'},
  {lat:38.783,lng:141.167,name:'細倉鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万一関',legend:'鉛亜鉛鉱床'},
  {lat:38.433,lng:140.367,name:'白石鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万白石',legend:'金銀鉱床'},
  {lat:38.483,lng:140.300,name:'白鷹山鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万米沢',legend:'金銀鉱徴地'},
  {lat:38.267,lng:140.867,name:'宮城鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万仙台',legend:'金銀鉱徴地'},
  {lat:39.300,lng:140.500,name:'真木鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万秋田',legend:'金銀鉱床'},
  {lat:40.267,lng:140.567,name:'砂子沢鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万大館',legend:'金銀鉱床'},
  {lat:40.283,lng:140.567,name:'大館鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万大館',legend:'金銀鉱徴地'},
  {lat:41.500,lng:140.983,name:'大畑マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万大畑',legend:'マンガン鉱徴地'},
  {lat:40.917,lng:140.467,name:'能代鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万能代',legend:'金銀鉱徴地'},
  {lat:39.733,lng:141.550,name:'岩手北部鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万盛岡',legend:'銅鉱徴地'},
  {lat:39.350,lng:141.100,name:'宮古鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万宮古',legend:'銅鉱徴地'},
  {lat:38.633,lng:141.283,name:'気仙沼鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万一関',legend:'金銀鉱徴地'},
  {lat:39.483,lng:141.017,name:'盛岡石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万盛岡',legend:'石灰石鉱床'},
  {lat:38.917,lng:141.133,name:'一関石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万一関',legend:'石灰石鉱床'},
  {lat:40.917,lng:141.200,name:'青森石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万大畑',legend:'石灰石鉱床'},
  {lat:39.317,lng:140.533,name:'横手石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万秋田',legend:'石灰石鉱床'},
  {lat:37.900,lng:139.083,name:'新津油田',cat:'fuel',mat:'Oil',trace:false,mapsheet:'20万新潟',legend:'石油鉱床'},
  {lat:37.817,lng:138.900,name:'西山油田',cat:'fuel',mat:'Oil',trace:false,mapsheet:'20万長岡',legend:'石油鉱床'},
  {lat:37.483,lng:138.283,name:'高柳天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万高田',legend:'天然ガス鉱床'},
  {lat:38.05,lng:138.233,name:'佐渡鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万佐渡',legend:'金銀鉱床'},
  {lat:37.533,lng:138.983,name:'大峰鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万新潟',legend:'金銀鉱徴地'},
  {lat:37.917,lng:139.050,name:'新潟石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万新潟',legend:'石灰石鉱床'},
  {lat:36.6,lng:140.65,name:'日立鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万水戸',legend:'銅鉱床'},
  {lat:37.05,lng:140.883,name:'常磐炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万平',legend:'石炭鉱床'},
  {lat:36.65,lng:139.45,name:'足尾銅山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万宇都宮',legend:'銅鉱床'},
  {lat:35.983,lng:139.083,name:'秩父鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万甲府',legend:'金銀鉱床'},
  {lat:36.583,lng:138.85,name:'中之条鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万甲府',legend:'金銀鉱徴地'},
  {lat:35.617,lng:139.133,name:'多摩川鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万八王子',legend:'金銀鉱徴地'},
  {lat:36.617,lng:138.533,name:'草津硫黄',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万長野',legend:'硫黄鉱床'},
  {lat:36.317,lng:139.883,name:'栃木石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万宇都宮',legend:'石灰石鉱床'},
  {lat:35.983,lng:139.083,name:'秩父石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万甲府',legend:'石灰石鉱床'},
  {lat:36.133,lng:138.317,name:'群馬石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万前橋',legend:'石灰石鉱床'},
  {lat:36.783,lng:139.133,name:'日光鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万宇都宮',legend:'金銀鉱徴地'},
  {lat:36.450,lng:140.333,name:'筑波珪石',cat:'nonmetal',mat:'SiO2',trace:true,mapsheet:'20万水戸',legend:'けい石鉱徴地'},
  {lat:37.383,lng:140.383,name:'郡山石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万郡山',legend:'石灰石鉱床'},
  {lat:37.700,lng:140.467,name:'福島北部鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万福島',legend:'銅鉱徴地'},
  {lat:37.783,lng:140.667,name:'半田山鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万福島',legend:'鉛亜鉛鉱床'},
  {lat:38.250,lng:140.367,name:'仙台北部鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万仙台',legend:'金銀鉱徴地'},
  {lat:37.950,lng:140.250,name:'山形鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万山形',legend:'金銀鉱徴地'},
  {lat:38.367,lng:140.133,name:'金山鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万山形',legend:'金銀鉱徴地'},
  {lat:37.567,lng:140.233,name:'三春鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万郡山',legend:'銅鉱床'},
  {lat:35.517,lng:137.617,name:'神坂鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万飯田',legend:'銅鉱床'},
  {lat:36.333,lng:137.283,name:'神岡鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万高山',legend:'鉛亜鉛鉱床'},
  {lat:35.367,lng:137.183,name:'東濃ウラン',cat:'metal',mat:'U',trace:false,mapsheet:'20万岐阜',legend:'ウラン鉱床'},
  {lat:36.517,lng:137.383,name:'神通川鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万富山',legend:'金銀鉱徴地'},
  {lat:36.6,lng:137.133,name:'八尾鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万富山',legend:'鉛亜鉛鉱床'},
  {lat:36.817,lng:137.167,name:'富山石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万富山',legend:'石灰石鉱床'},
  {lat:36.367,lng:137.500,name:'飛騨石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万高山',legend:'石灰石鉱床'},
  {lat:35.700,lng:137.283,name:'恵那石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岐阜',legend:'石灰石鉱床'},
  {lat:35.317,lng:136.717,name:'揖斐石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岐阜',legend:'石灰石鉱床'},
  {lat:35.550,lng:136.867,name:'三重石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岐阜',legend:'石灰石鉱床'},
  {lat:35.167,lng:136.933,name:'苗木珪石',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万名古屋',legend:'けい石鉱床'},
  {lat:35.383,lng:137.500,name:'美濃石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万名古屋',legend:'石灰石鉱床'},
  {lat:35.367,lng:137.45,name:'串原鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万名古屋',legend:'銅鉱床'},
  {lat:35.300,lng:138.567,name:'富士川鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万甲府',legend:'金銀鉱徴地'},
  {lat:35.483,lng:138.333,name:'巨摩山地鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万甲府',legend:'金銀鉱徴地'},
  {lat:34.883,lng:138.767,name:'土肥金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万下田',legend:'金銀鉱床'},
  {lat:35.067,lng:138.683,name:'縄地金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万下田',legend:'金銀鉱床'},
  {lat:35.150,lng:139.117,name:'箱根硫黄',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万横浜',legend:'硫黄鉱床'},
  {lat:35.233,lng:139.117,name:'丹沢鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万横浜',legend:'銅鉱床'},
  {lat:36.267,lng:138.183,name:'和田峠黒曜石',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万松本',legend:'黒曜石鉱床'},
  {lat:36.100,lng:138.033,name:'富士見鉱床',cat:'metal',mat:'Fe_Ti',trace:false,mapsheet:'20万松本',legend:'鉄鉱床'},
  {lat:35.717,lng:138.567,name:'山梨石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万甲府',legend:'石灰石鉱床'},
  {lat:36.500,lng:138.333,name:'中之条銅鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万前橋',legend:'銅鉱床'},
  {lat:36.383,lng:138.000,name:'上田鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万長野',legend:'金銀鉱徴地'},
  {lat:36.950,lng:138.700,name:'長野北部鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万長野',legend:'銅鉱徴地'},
  {lat:37.033,lng:136.633,name:'金沢石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万金沢',legend:'石灰石鉱床'},
  {lat:36.567,lng:136.117,name:'福井石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万福井',legend:'石灰石鉱床'},
  {lat:35.683,lng:136.167,name:'越前石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万福井',legend:'石灰石鉱床'},
  {lat:35.867,lng:136.183,name:'若狭珪石',cat:'nonmetal',mat:'SiO2',trace:true,mapsheet:'20万福井',legend:'けい石鉱徴地'},
  {lat:36.350,lng:136.683,name:'白山鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万金沢',legend:'銅鉱床'},
  {lat:36.583,lng:136.633,name:'金沢鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万金沢',legend:'金銀鉱徴地'},
  {lat:35.483,lng:135.833,name:'京丹後鉱床',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万宮津',legend:'マンガン鉱床'},
  {lat:35.483,lng:135.833,name:'丹後マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万宮津',legend:'マンガン鉱徴地'},
  {lat:35.033,lng:135.767,name:'滋賀石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万京都',legend:'石灰石鉱床'},
  {lat:34.750,lng:136.533,name:'鈴鹿石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万津',legend:'石灰石鉱床'},
  {lat:34.500,lng:135.917,name:'奈良石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万吉野',legend:'石灰石鉱床'},
  {lat:34.333,lng:136.533,name:'松阪珪石',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万津',legend:'けい石鉱床'},
  {lat:34.667,lng:136.167,name:'伊賀石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万津',legend:'石灰石鉱床'},
  {lat:35.100,lng:134.850,name:'生野銀山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万豊岡',legend:'金銀鉱床'},
  {lat:35.4,lng:134.683,name:'明延鉱床',cat:'metal',mat:'Sn_W',trace:false,mapsheet:'20万豊岡',legend:'錫タングステン鉱床'},
  {lat:35.233,lng:134.733,name:'神子畑鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万豊岡',legend:'鉛亜鉛鉱床'},
  {lat:35.467,lng:134.767,name:'但馬鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万豊岡',legend:'金銀鉱徴地'},
  {lat:35.483,lng:134.383,name:'佐用石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万豊岡',legend:'石灰石鉱床'},
  {lat:35.217,lng:134.350,name:'朝来鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万豊岡',legend:'金銀鉱徴地'},
  {lat:34.817,lng:135.017,name:'淡路石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万神戸',legend:'石灰石鉱床'},
  {lat:34.583,lng:135.433,name:'能勢鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万大阪',legend:'銅鉱床'},
  {lat:34.633,lng:135.500,name:'宝塚鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万大阪',legend:'金銀鉱徴地'},
  {lat:34.933,lng:135.933,name:'宇陀石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万吉野',legend:'石灰石鉱床'},
  {lat:34.283,lng:135.133,name:'有田石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万和歌山',legend:'石灰石鉱床'},
  {lat:34.583,lng:135.950,name:'吉野石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万吉野',legend:'石灰石鉱床'},
  {lat:34.017,lng:135.367,name:'田辺石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万田辺',legend:'石灰石鉱床'},
  {lat:35.1,lng:132.433,name:'石見銀山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万浜田',legend:'金銀鉱床'},
  {lat:35.367,lng:132.567,name:'仁多鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万松江',legend:'銅鉱床'},
  {lat:35.133,lng:132.633,name:'吉田鉱床',cat:'metal',mat:'Fe_Ti',trace:false,mapsheet:'20万松江',legend:'鉄鉱床'},
  {lat:35.267,lng:133.267,name:'日野鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万米子',legend:'鉛亜鉛鉱床'},
  {lat:35.200,lng:133.500,name:'日南マンガン',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万米子',legend:'マンガン鉱床'},
  {lat:35.567,lng:133.333,name:'日野川金鉱',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万米子',legend:'金銀鉱徴地'},
  {lat:35.100,lng:133.367,name:'出雲石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万松江',legend:'石灰石鉱床'},
  {lat:34.967,lng:134.067,name:'柵原鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万岡山',legend:'鉛亜鉛鉱床'},
  {lat:34.983,lng:132.767,name:'庄原鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万三次',legend:'銅鉱床'},
  {lat:34.550,lng:133.233,name:'成羽鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万岡山',legend:'銅鉱床'},
  {lat:34.767,lng:132.450,name:'帝釈石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万三次',legend:'石灰石鉱床'},
  {lat:34.833,lng:133.983,name:'布賀石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岡山',legend:'石灰石鉱床'},
  {lat:34.583,lng:133.683,name:'新見石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岡山',legend:'石灰石鉱床'},
  {lat:34.367,lng:132.500,name:'広島花崗岩',cat:'nonmetal',mat:'SiO2',trace:true,mapsheet:'20万広島',legend:'けい石鉱徴地'},
  {lat:34.500,lng:133.500,name:'笠岡粘土',cat:'nonmetal',mat:'Clay1',trace:false,mapsheet:'20万岡山',legend:'粘土鉱床'},
  {lat:34.917,lng:132.017,name:'岩国石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万広島',legend:'石灰石鉱床'},
  {lat:34.167,lng:131.467,name:'美祢石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万萩',legend:'石灰石鉱床'},
  {lat:34.017,lng:131.383,name:'秋吉台石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万山口',legend:'石灰石鉱床'},
  {lat:34.117,lng:131.817,name:'宇部石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万山口',legend:'石灰石鉱床'},
  {lat:33.93,lng:133.28,name:'別子銅山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万高知',legend:'銅鉱床'},
  {lat:33.967,lng:133.383,name:'土佐鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万高知',legend:'銅鉱床'},
  {lat:34.133,lng:133.117,name:'讃岐石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万高松',legend:'石灰石鉱床'},
  {lat:33.767,lng:133.983,name:'馬路マンガン',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万高知',legend:'マンガン鉱床'},
  {lat:34.067,lng:134.033,name:'那賀鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万徳島',legend:'鉛亜鉛鉱床'},
  {lat:33.917,lng:134.600,name:'阿南鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万徳島',legend:'銅鉱床'},
  {lat:32.730,lng:132.970,name:'足摺鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万宿毛',legend:'金銀鉱徴地'},
  {lat:33.617,lng:133.017,name:'高知石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万高知',legend:'石灰石鉱床'},
  {lat:33.983,lng:133.750,name:'物部川石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万高知',legend:'石灰石鉱床'},
  {lat:34.267,lng:134.017,name:'阿波石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万徳島',legend:'石灰石鉱床'},
  {lat:33.883,lng:130.950,name:'飯塚炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万飯塚',legend:'石炭鉱床'},
  {lat:33.767,lng:130.717,name:'嘉穂炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万飯塚',legend:'石炭鉱床'},
  {lat:33.067,lng:130.750,name:'荒尾炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万熊本',legend:'石炭鉱床'},
  {lat:32.833,lng:130.533,name:'三池炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万熊本',legend:'石炭鉱床'},
  {lat:32.917,lng:130.367,name:'松浦炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万佐世保',legend:'石炭鉱床'},
  {lat:33.450,lng:129.867,name:'佐世保炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万佐世保',legend:'石炭鉱床'},
  {lat:33.950,lng:130.933,name:'北九州石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万福岡',legend:'石灰石鉱床'},
  {lat:33.783,lng:130.917,name:'直方炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万飯塚',legend:'石炭鉱床'},
  {lat:33.333,lng:130.467,name:'唐津炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万唐津',legend:'石炭鉱床'},
  {lat:33.617,lng:130.550,name:'遠賀川鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万飯塚',legend:'金銀鉱徴地'},
  {lat:34.200,lng:129.300,name:'対馬金鉱',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万対馬',legend:'金銀鉱徴地'},
  {lat:33.383,lng:131.017,name:'中津天然ガス',cat:'fuel',mat:'Gas',trace:true,mapsheet:'20万大分',legend:'天然ガス鉱徴地'},
  {lat:33.550,lng:130.983,name:'柳川天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万大牟田',legend:'天然ガス鉱床'},
  {lat:33.25,lng:131.883,name:'佐賀関銅山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万大分',legend:'銅鉱床'},
  {lat:33.233,lng:131.633,name:'別府硫黄',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万大分',legend:'硫黄鉱床'},
  {lat:33.083,lng:131.100,name:'久住鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万大分',legend:'銅鉱床'},
  {lat:32.917,lng:131.433,name:'大分石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万大分',legend:'石灰石鉱床'},
  {lat:32.533,lng:131.317,name:'阿蘇石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万熊本',legend:'石灰石鉱床'},
  {lat:32.617,lng:130.383,name:'長崎石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万長崎',legend:'石灰石鉱床'},
  {lat:32.750,lng:130.367,name:'西彼杵石炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万長崎',legend:'石炭鉱徴地'},
  {lat:32.083,lng:130.950,name:'熊本石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万熊本',legend:'石灰石鉱床'},
  {lat:32.217,lng:130.383,name:'水俣鉱床',cat:'metal',mat:'As_Hg',trace:false,mapsheet:'20万人吉',legend:'砒素水銀鉱床'},
  {lat:32.833,lng:131.017,name:'高千穂マンガン',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万延岡',legend:'マンガン鉱床'},
  {lat:32.683,lng:131.3,name:'土呂久鉱床',cat:'metal',mat:'As_Hg',trace:false,mapsheet:'20万延岡',legend:'砒素水銀鉱床'},
  {lat:32.917,lng:131.083,name:'竹田鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万延岡',legend:'銅鉱床'},
  {lat:32.317,lng:131.483,name:'九州中部鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万宮崎',legend:'銅鉱徴地'},
  {lat:32.033,lng:131.417,name:'日向マンガン',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万宮崎',legend:'マンガン鉱床'},
  {lat:31.667,lng:131.067,name:'都城マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万都城',legend:'マンガン鉱徴地'},
  {lat:31.717,lng:130.283,name:'串木野金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万鹿児島',legend:'金銀鉱床'},
  {lat:32.05,lng:130.633,name:'菱刈金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万鹿児島',legend:'金銀鉱床'},
  {lat:31.933,lng:130.617,name:'知覧鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万鹿児島',legend:'金銀鉱徴地'},
  {lat:31.533,lng:130.550,name:'薩摩鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万鹿児島',legend:'金銀鉱徴地'},
  {lat:27.750,lng:128.950,name:'徳之島石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万徳之島',legend:'石灰石鉱床'},
  {lat:26.633,lng:128.017,name:'沖縄北部石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万名護',legend:'石灰石鉱床'},
  {lat:26.183,lng:127.683,name:'読谷石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万那覇',legend:'石灰石鉱床'},
  {lat:24.400,lng:124.150,name:'西表炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万石垣',legend:'石炭鉱床'},
  {lat:43.803,lng:143.895,name:'北見鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万北見',legend:'金銀鉱床'},
  {lat:44.356,lng:142.463,name:'名寄鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万名寄',legend:'金銀鉱徴地'},
  {lat:43.847,lng:142.771,name:'上川鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万旭川',legend:'銅鉱床'},
  {lat:43.767,lng:142.383,name:'旭川周辺',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万旭川',legend:'金銀鉱徴地'},
  {lat:44.733,lng:142.467,name:'士幌天然ガス',cat:'fuel',mat:'Gas',trace:true,mapsheet:'20万名寄',legend:'天然ガス鉱徴地'},
  {lat:43.317,lng:144.567,name:'厚岸炭田',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万釧路',legend:'石炭鉱徴地'},
  {lat:42.667,lng:143.567,name:'幕別石炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万帯広',legend:'石炭鉱徴地'},
  {lat:43.633,lng:143.371,name:'置戸珪石',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万北見',legend:'けい石鉱床'},
  {lat:44.433,lng:143.033,name:'雄武マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万紋別',legend:'マンガン鉱徴地'},
  {lat:43.550,lng:143.317,name:'北見マンガン',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万北見',legend:'マンガン鉱床'},
  {lat:43.100,lng:141.817,name:'夕張硫黄',cat:'nonmetal',mat:'S',trace:true,mapsheet:'20万夕張',legend:'硫黄鉱徴地'},
  {lat:43.247,lng:141.4,name:'石狩天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万岩見沢',legend:'天然ガス鉱床'},
  {lat:42.033,lng:140.983,name:'室蘭鉱床',cat:'metal',mat:'Fe_Ti',trace:true,mapsheet:'20万室蘭',legend:'鉄チタン鉱徴地'},
  {lat:42.617,lng:141.633,name:'苫小牧石炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万苫小牧',legend:'石炭鉱徴地'},
  {lat:43.800,lng:144.833,name:'斜里珪藻土',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万斜里',legend:'珪藻土鉱床'},
  {lat:45.350,lng:141.567,name:'幌延天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万稚内',legend:'天然ガス鉱床'},
  {lat:44.883,lng:141.900,name:'遠別石炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万天塩',legend:'石炭鉱徴地'},
  {lat:43.851,lng:141.534,name:'増毛金鉱',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万留萌',legend:'金銀鉱床'},
  {lat:43.941,lng:141.637,name:'留萌石炭',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万留萌',legend:'石炭鉱床'},
  {lat:42.601,lng:140.043,name:'北檜山マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万寿都',legend:'マンガン鉱徴地'},
  {lat:42.212,lng:140.389,name:'長万部石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万長万部',legend:'石灰石鉱床'},
  {lat:41.983,lng:140.317,name:'八雲マンガン',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万長万部',legend:'マンガン鉱床'},
  {lat:41.417,lng:140.300,name:'函館石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万函館',legend:'石灰石鉱床'},
  {lat:41.769,lng:140.729,name:'函館金鉱',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万函館',legend:'金銀鉱徴地'},
  {lat:42.451,lng:140.109,name:'今金鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万函館',legend:'金銀鉱床'},
  {lat:42.250,lng:143.317,name:'白糠炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万釧路',legend:'石炭鉱床'},
  {lat:41.050,lng:141.400,name:'大間マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万大畑',legend:'マンガン鉱徴地'},
  {lat:40.650,lng:141.383,name:'下北石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万大畑',legend:'石灰石鉱床'},
  {lat:40.750,lng:140.550,name:'能代珪藻土',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万能代',legend:'珪藻土鉱床'},
  {lat:39.933,lng:139.833,name:'男鹿天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万秋田',legend:'天然ガス鉱床'},
  {lat:39.733,lng:140.100,name:'本荘天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万秋田',legend:'天然ガス鉱床'},
  {lat:39.617,lng:140.267,name:'秋田ガス田',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万秋田',legend:'天然ガス鉱床'},
  {lat:39.617,lng:140.433,name:'阿仁鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万秋田',legend:'銅鉱床'},
  {lat:39.233,lng:140.533,name:'横手ガス田',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万秋田',legend:'天然ガス鉱床'},
  {lat:38.917,lng:140.383,name:'山形鉛亜鉛',cat:'metal',mat:'Pb_Zn',trace:true,mapsheet:'20万山形',legend:'鉛亜鉛鉱徴地'},
  {lat:38.633,lng:140.533,name:'仙台南部',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万仙台',legend:'金銀鉱徴地'},
  {lat:38.483,lng:141.017,name:'気仙沼石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万一関',legend:'石灰石鉱床'},
  {lat:39.167,lng:141.733,name:'大槌鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万宮古',legend:'金銀鉱徴地'},
  {lat:39.967,lng:141.767,name:'岩手北部鉛亜鉛',cat:'metal',mat:'Pb_Zn',trace:true,mapsheet:'20万盛岡',legend:'鉛亜鉛鉱徴地'},
  {lat:40.350,lng:141.617,name:'田野畑マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万盛岡',legend:'マンガン鉱徴地'},
  {lat:38.117,lng:140.917,name:'石巻石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万仙台',legend:'石灰石鉱床'},
  {lat:37.583,lng:140.967,name:'相馬炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万郡山',legend:'石炭鉱床'},
  {lat:37.083,lng:140.167,name:'安積石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万郡山',legend:'石灰石鉱床'},

  // ══════ 福島県南部（棚倉・塙・矢吹・石川・天栄）══════
  {lat:37.003,lng:140.373,name:'棚倉断層帯金徴地',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'5万竹貫',legend:'金銀鉱徴地',note:'棚倉断層帯（NNE-SSW走向）沿いの熱水変質帯。大子地質図幅(2026)に記載。石英脈型Au鉱化の可能性。'},
  {lat:36.890,lng:140.350,name:'矢祭金徴地',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'5万大子',legend:'金銀鉱徴地',note:'棚倉西縁断層付近。久慈川上流域。変成岩・花崗岩境界部の熱水脈。'},
  {lat:36.948,lng:140.411,name:'塙町鉱徴地',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'5万竹貫',legend:'金銀鉱徴地',note:'阿武隈花崗岩中の石英脈。斜灰簾石・灰ばん柘榴石の産地（福島県鉱物誌）。'},
  {lat:37.147,lng:140.453,name:'石川ペグマタイト',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'5万平',legend:'けい石鉱床',note:'日本三大ペグマタイト産地（岐阜苗木・滋賀田ノ上と並ぶ）。花崗岩ペグマタイト中に石英・長石・電気石・ベリル等を産する。砂金の母岩として重要。'},
  {lat:37.270,lng:140.180,name:'鈴倉鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万郡山',legend:'金銀鉱床',note:'岩瀬郡天栄村。徳川時代から金・銀・銅鉱山として稼行。銅品位2〜5%（鉱山DB）。'},
  {lat:37.250,lng:140.160,name:'矢倉竜生鉱山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万郡山',legend:'金銀鉱徴地',note:'岩瀬郡天栄村。元は金鉱山で後に銅鉱山。黄銅鉱・黄鉄鉱・石英を産出（鉱山DB）。'},
  {lat:37.283,lng:140.360,name:'赤取根鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万郡山',legend:'金銀鉱床',note:'須賀川市狸平。宇津峰山塊の花崗岩中の石英脈型金鉱床（Wikipedia）。'},
  {lat:37.417,lng:140.417,name:'郡山玉川含金石英',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万郡山',legend:'金銀鉱徴地',note:'郡山市熱海町玉川。含金石英（白・脈状）が産出（福島県鉱物産地）。砂金可能性高い。'},
  {lat:37.200,lng:140.327,name:'矢吹金徴地',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万郡山',legend:'金銀鉱徴地',note:'矢吹町付近の阿武隈山地西縁。花崗岩と変成岩の境界部に石英脈。阿武隈川水系の砂金賦存域。'},
  {lat:36.770,lng:140.353,name:'久慈川砂金域（大子）',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'5万大子',legend:'金銀鉱徴地',note:'久慈川本流（大子町付近）。棚倉断層帯沿いの岩石から供給される砂金賦存域。大子地質図幅(2026)対象エリア。'},
  {lat:36.733,lng:140.350,name:'久慈川砂金域（山方）',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'5万大子',legend:'金銀鉱徴地',note:'久慈川中流域（常陸大宮市山方）。阿武隈山地の花崗岩・変成岩起源の砂金。久慈川水系で最も砂金賦存可能性が高い区間の一つ。'},
  {lat:36.943,lng:140.378,name:'浅川砂金域',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'5万大子',legend:'金銀鉱徴地',note:'浅川（久慈川支流）。塙町〜棚倉境界付近。棚倉断層帯沿いの熱水金鉱化域から侵食された砂金が堆積。'},
  {lat:37.117,lng:140.433,name:'阿武隈川砂金域',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万郡山',legend:'金銀鉱徴地',note:'阿武隈川（矢吹〜棚倉区間）。西側の花崗岩・変成岩帯から砂金が供給。河床礫層に砂金が集積しやすい地形。'},
  {lat:37.2,lng:139.283,name:'田子倉金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万若松',legend:'金銀鉱床',note:'会津郡只見町。1590年代〜1978年休山。金・銀・銅・鉛・亜鉛・硫化鉄を産出（Wikipedia）。'},

  // ══════ 栃木県 重点データ ══════
  {lat:36.933,lng:139.583,name:'西沢金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万宇都宮',legend:'金銀鉱床',note:'日光市（旧塩谷郡栗山村）。明治29年開山。自然金・輝銀鉱・濃紅銀鉱・方鉛鉱・蛍石・石英等を産出（鉱山DB）。'},
  {lat:36.883,lng:139.550,name:'南沢金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万宇都宮',legend:'金銀鉱床',note:'日光市（旧藤原町）。金品位5g/t・銀15g/t・銅6.2%（鉱山DB）。'},
  {lat:36.817,lng:139.733,name:'豊徳鉱山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万宇都宮',legend:'金銀鉱徴地',note:'日光市（旧藤原町）。金銀鉱・黄銅鉱・閃亜鉛鉱・方鉛鉱を産出（kinno lab）。'},
  {lat:36.883,lng:139.617,name:'大井沢鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万宇都宮',legend:'金銀鉱床',note:'日光市大井沢。金・銀・銅・蒼鉛・タングステン鉱を産出（kinno lab）。複合型熱水鉱床。'},
  {lat:36.617,lng:139.617,name:'小百鉱山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万宇都宮',legend:'金銀鉱徴地',note:'日光市小百（旧河内郡豊岡村）。石英脈に金・黄銅鉱・黄鉄鉱を含む。明治38年発見（日本地方鉱床誌関東）。'},
  {lat:36.600,lng:139.883,name:'篠井金山（富井鉱山）',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万宇都宮',legend:'金銀鉱床',note:'宇都宮市篠井町。戦国時代に佐竹氏が開発したとされる歴史的金山。自然金・黄銅鉱・紫水晶を産出。「篠井の金掘唄」は宇都宮市無形文化財（Wikipedia）。'},
  {lat:36.967,lng:139.967,name:'那須硫黄鉱山',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万宇都宮',legend:'硫黄鉱床',note:'那須町湯本（殺生石周辺）。那須火山帯の噴気帯に関連する硫黄鉱床。硫黄を産出（栃木県鉱物産地）。'},
  {lat:36.900,lng:140.000,name:'那須蝋石鉱山',cat:'nonmetal',mat:'Clay2',trace:false,mapsheet:'20万宇都宮',legend:'陶石鉱床',note:'那須郡那須町。デュモルチ石（dumortierite）の重要産地。低温熱水変質でできたろう石鉱床（kinno lab）。'},
  {lat:36.733,lng:139.967,name:'大田原マンガン',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万宇都宮',legend:'マンガン鉱徴地',note:'那須郡黒羽町（現・大田原市）。付加体チャート層中のマンガン鉱（日本地方鉱床誌関東）。'},
  {lat:36.567,lng:139.633,name:'加蘇鉱山',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万宇都宮',legend:'マンガン鉱床',note:'鹿沼市上久我。栃木最大規模のマンガン鉱山。明治5年発見。深さ160m・10層以上の鉱床。バラ輝石等を産出（鉱山DB）。'},
  {lat:36.450,lng:139.483,name:'鹿沼マンガン帯',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万宇都宮',legend:'マンガン鉱徴地',note:'栃木県南西部（鹿沼市・栃木市・佐野市・足利市）。足尾山地・八溝山地の付加体チャート層中に多数のマンガン鉱床が分布（栃木県資源情報）。'},
  {lat:36.383,lng:139.733,name:'葛生石灰帯',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万宇都宮',legend:'石灰石鉱床',note:'佐野市葛生〜栃木市・鍋山町。馬蹄形に石灰鉱床が約30km分布。推定埋蔵量20億トン超。現在も大規模採掘中（鉱山DB）。'},
  {lat:36.683,lng:139.500,name:'渡良瀬川砂金域',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万宇都宮',legend:'金銀鉱徴地',note:'渡良瀬川中流域（日光市〜みどり市）。足尾銅山周辺の熱水鉱床起源の金が侵食・運搬され砂金として堆積。'},

  // ══════ 群馬県 重点データ ══════
  {lat:36.533,lng:139.267,name:'茂倉沢鉱山',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万前橋',legend:'マンガン鉱床',note:'桐生市菱町。ジュラ紀付加体チャートブロック中の層状マンガン鉱床。鈴木石・長島石の原産地。バナジウム含有鉱物で著名（TrekGEO）。3鉱床あり。'},
  {lat:36.517,lng:139.183,name:'沢入鉱山',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万前橋',legend:'マンガン鉱床',note:'みどり市東町（旧勢多郡東村）。炭マン・バラ輝石・チョコレート鉱等を産出（鉱山DB）。菱マンガン鉱の重要産地。'},
  {lat:36.567,lng:139.183,name:'黒保根マンガン帯',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万前橋',legend:'マンガン鉱床',note:'みどり市（旧黒保根村）。黒保根・田沢・上田沢各鉱山が密集。合計二酸化マンガン1万6,500t超を採掘（鉱山DB）。'},
  {lat:36.483,lng:139.350,name:'梅田鉱山群',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万前橋',legend:'マンガン鉱徴地',note:'桐生市梅田町（旧山田郡梅田村）。バラ輝石・テフロ石・ヤコブス鉱等のマンガン鉱物を産出（群馬県鉱物産地）。'},
  {lat:36.200,lng:138.750,name:'南牧村砥沢金山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万前橋',legend:'金銀鉱徴地',note:'南牧村砥沢。戦国時代に金採掘の言い伝えが残る旧坑。石英閃緑ひん岩の貫入に伴う熱水活動による金鉱化帯（群馬県立自然史博物館研究報告Vol.5）。'},
  {lat:36.233,lng:138.833,name:'下仁田西ノ牧鉱山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万前橋',legend:'金銀鉱徴地',note:'下仁田町西ノ牧。若林鉱の原産地。鶏冠石・石黄・輝安鉱が産出する低温熱水鉱床。自然金も確認（国産鉱物図鑑）。'},
  {lat:36.150,lng:138.967,name:'万場鉱山',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万前橋',legend:'マンガン鉱床',note:'神流町（旧万場町）。菱マンガン鉱・バラ輝石・重晶石・黄鉄鉱・黄銅鉱・斑銅鉱を産出（群馬県鉱物産地・日本菱マンガン鉱産地）。'},
  {lat:36.617,lng:138.533,name:'草津白根山硫黄',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万長野',legend:'硫黄鉱床',note:'草津町。草津白根山の噴気活動に伴う硫黄鉱床。日本有数の硫黄産地（群馬県鉱物産地）。'},
  {lat:36.733,lng:138.533,name:'小串硫黄鉱山',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万長野',legend:'硫黄鉱床',note:'吾妻郡嬬恋村。長野県境近くの廃鉱。大正5年から操業した硫黄鉱山（廃墟検索地図）。'},
  {lat:36.717,lng:138.883,name:'白沢鉱山',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万前橋',legend:'銅鉱徴地',note:'沼田市白沢町（旧利根郡白沢村）。鉄・銅・鉛・亜鉛・モリブデン・タングステン・蛍石を含む複合型鉱床（鉱山DB）。'},
  {lat:36.317,lng:138.917,name:'高崎炭田',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万前橋',legend:'石炭鉱徴地',note:'高崎市周辺の亜炭炭田（鉱山DB）。群馬県内で採掘された石炭・亜炭の産地。'},

  // ══════ 静岡県 重点データ ══════
  {lat:35.19,lng:138.3,name:'梅ヶ島金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万静岡',legend:'金銀鉱床',note:'静岡市葵区梅ヶ島。日影沢金山・関之沢金山等の総称。900年頃に産金記録。中世に今川氏・武田氏が採掘。江戸時代は徳川天領（鉱山DB）。'},
  {lat:34.850,lng:138.883,name:'持越鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万静岡',legend:'金銀鉱床',note:'伊豆市持越。金品位8〜10g/t、富鉱部30〜100g/t。銀品位3,000〜10,000g/t（鉱山DB）。伊豆金山群の中でも高品位鉱床。'},
  {lat:34.817,lng:138.850,name:'大仁鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万静岡',legend:'金銀鉱床',note:'伊豆市瓜生野（旧大仁町）。典型的な熱水鉱床で主要鉱物は自然金。石英・黄鉄鉱・閃亜鉛鉱も産出。坑内から温泉湧出（Wikipedia）。'},
  {lat:34.900,lng:138.933,name:'湯ヶ島鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万静岡',legend:'金銀鉱床',note:'伊豆市湯ヶ島。金品位4〜50g/t、銀3〜600g/t（鉱山DB）。品位変動幅が大きい熱水鉱脈型。'},
  {lat:34.933,lng:138.950,name:'薬師沢鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万静岡',legend:'金銀鉱床',note:'伊豆長岡。慶長年間に開発された古鉱山。金品位5g/t、銀品位400g/t（鉱山DB）。'},
  {lat:35.017,lng:138.917,name:'大平鉱山（伊豆）',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万静岡',legend:'金銀鉱徴地',note:'伊豆（旧中狩野村・下狩野村）。金品位5〜15g/t。閃亜鉛鉱富鉱部は50〜100g/t（鉱山DB）。'},
  {lat:35.133,lng:138.383,name:'安倍川砂金域',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万静岡',legend:'金銀鉱徴地',note:'安倍川（静岡市葵区）。梅ヶ島金山群から侵食・運搬された砂金が堆積。小河内川砂金の実績あり（東京大学電子顕微鏡室）。南部フォッサマグナの急流河川。'},
  {lat:35.183,lng:138.300,name:'梅ヶ島温泉周辺金山群',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万静岡',legend:'金銀鉱徴地',note:'静岡市葵区梅ヶ島温泉周辺。日影沢・関ノ沢・大谷崩周辺の複数金山跡。白亜紀〜古第三紀花崗岩体周辺の熱水金鉱脈。'},
  {lat:34.717,lng:138.950,name:'峰之沢鉱山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万静岡',legend:'銅鉱床',note:'伊豆半島東側。銅・鉛・亜鉛鉱山。伊豆火山帯の熱水型鉱床。静岡県の主要金属鉱山の一つ（鉱山DB）。'},
  {lat:34.667,lng:138.933,name:'河津鉱山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万静岡',legend:'金銀鉱徴地',note:'賀茂郡河津町。伊豆半島内の金銀鉱化帯。温泉と同一起源の熱水変質帯。'},
  {lat:35.000,lng:139.050,name:'菖蒲沢海岸山金',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万静岡',legend:'金銀鉱徴地',note:'伊豆半島東海岸（菖蒲沢海岸）。海岸で自然金が採集できる稀少な産地。分析値Au58-Ag42の銀に富む浅熱水性鉱脈型（東京大学電子顕微鏡室）。'},
  {lat:35.267,lng:138.233,name:'大井川砂金域',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万静岡',legend:'金銀鉱徴地',note:'大井川（静岡県中央部）。赤石山脈〜寸又峡周辺の変成岩・花崗岩起源の砂金が運搬・堆積。川根本町周辺が注目域。'},

  {lat:36.833,lng:140.467,name:'水戸石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万水戸',legend:'石灰石鉱床'},
  {lat:36.300,lng:138.750,name:'妙義鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万前橋',legend:'金銀鉱徴地'},
  {lat:36.333,lng:139.017,name:'高崎石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万前橋',legend:'石灰石鉱床'},
  {lat:36.067,lng:139.533,name:'埼玉石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万東京',legend:'石灰石鉱床'},
  {lat:35.833,lng:139.233,name:'武蔵野珪砂',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万東京',legend:'けい砂鉱床'},
  {lat:35.667,lng:140.117,name:'房総珪砂',cat:'nonmetal',mat:'SiO2',trace:false,mapsheet:'20万千葉',legend:'けい砂鉱床'},
  {lat:35.333,lng:136.117,name:'三方石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万福井',legend:'石灰石鉱床'},
  {lat:36.183,lng:137.317,name:'白川鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万高山',legend:'金銀鉱徴地'},
  {lat:35.483,lng:137.617,name:'中津川鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万名古屋',legend:'金銀鉱徴地'},
  {lat:35.383,lng:136.467,name:'伊吹石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岐阜',legend:'石灰石鉱床'},
  {lat:35.083,lng:136.300,name:'桑名石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万津',legend:'石灰石鉱床'},
  {lat:34.417,lng:136.700,name:'尾鷲石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万田辺',legend:'石灰石鉱床'},
  {lat:34.100,lng:136.133,name:'熊野石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万田辺',legend:'石灰石鉱床'},
  {lat:35.283,lng:138.017,name:'上野原鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万甲府',legend:'金銀鉱徴地'},
  {lat:35.683,lng:138.167,name:'長野鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万長野',legend:'金銀鉱徴地'},
  {lat:36.083,lng:137.700,name:'松本鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万長野',legend:'銅鉱徴地'},
  {lat:35.300,lng:138.850,name:'富士周辺鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万甲府',legend:'金銀鉱徴地'},
  {lat:34.767,lng:136.950,name:'名張石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万吉野',legend:'石灰石鉱床'},
  {lat:34.867,lng:135.800,name:'大和高原石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万吉野',legend:'石灰石鉱床'},
  {lat:35.350,lng:135.067,name:'丹波石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万京都',legend:'石灰石鉱床'},
  {lat:35.033,lng:134.783,name:'丹波鉱床',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万豊岡',legend:'マンガン鉱床'},
  {lat:34.517,lng:134.283,name:'播磨石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万神戸',legend:'石灰石鉱床'},
  {lat:34.350,lng:134.783,name:'三木鉱床',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万徳島',legend:'マンガン鉱徴地'},
  {lat:34.967,lng:133.417,name:'津山鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万岡山',legend:'金銀鉱徴地'},
  {lat:34.717,lng:133.900,name:'久世鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万岡山',legend:'銅鉱徴地'},
  {lat:34.233,lng:132.733,name:'三次鉱床',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万三次',legend:'マンガン鉱徴地'},
  {lat:34.483,lng:132.983,name:'広島鉱床',cat:'metal',mat:'Fe_Ti',trace:true,mapsheet:'20万広島',legend:'鉄チタン鉱徴地'},
  {lat:34.600,lng:131.667,name:'岩国鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万広島',legend:'銅鉱徴地'},
  {lat:35.700,lng:132.817,name:'出雲鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万松江',legend:'金銀鉱徴地'},
  {lat:35.583,lng:133.017,name:'宍道鉱床',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万松江',legend:'マンガン鉱徴地'},
  {lat:34.817,lng:131.983,name:'宇部鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万山口',legend:'銅鉱徴地'},
  {lat:33.967,lng:130.733,name:'若松石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万福岡',legend:'石灰石鉱床'},
  {lat:33.733,lng:130.983,name:'行橋石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万福岡',legend:'石灰石鉱床'},
  {lat:33.533,lng:130.467,name:'伊万里鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万唐津',legend:'金銀鉱徴地'},
  {lat:33.267,lng:130.283,name:'平戸鉱床',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万長崎',legend:'マンガン鉱徴地'},
  {lat:32.750,lng:129.883,name:'生月島鉱床',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万長崎',legend:'マンガン鉱徴地'},
  {lat:33.800,lng:130.783,name:'田川炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万飯塚',legend:'石炭鉱床'},
  {lat:34.117,lng:130.983,name:'苅田石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万福岡',legend:'石灰石鉱床'},
  {lat:32.333,lng:130.817,name:'八代石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万熊本',legend:'石灰石鉱床'},
  {lat:32.083,lng:130.500,name:'松橋石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万熊本',legend:'石灰石鉱床'},
  {lat:32.467,lng:130.617,name:'宇土石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万熊本',legend:'石灰石鉱床'},
  {lat:32.917,lng:130.917,name:'菊池鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万熊本',legend:'金銀鉱徴地'},
  {lat:33.033,lng:130.633,name:'有明天然ガス',cat:'fuel',mat:'Gas',trace:false,mapsheet:'20万熊本',legend:'天然ガス鉱床'},
  {lat:31.833,lng:131.067,name:'人吉石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万人吉',legend:'石灰石鉱床'},
  {lat:31.567,lng:130.933,name:'薩摩石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万鹿児島',legend:'石灰石鉱床'},
  {lat:32.317,lng:130.483,name:'天草石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万長崎',legend:'石灰石鉱床'},
  {lat:33.567,lng:131.350,name:'日田鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万大分',legend:'金銀鉱徴地'},
  {lat:33.417,lng:131.167,name:'玖珠鉱床',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万大分',legend:'マンガン鉱徴地'},
  {lat:33.450,lng:131.633,name:'別府温泉硫黄大分',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万大分',legend:'硫黄鉱床'},
  {lat:33.967,lng:131.633,name:'山口鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万山口',legend:'銅鉱徴地'},
  {lat:32.483,lng:131.317,name:'椎葉鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万宮崎',legend:'銅鉱徴地'},
  {lat:32.650,lng:131.683,name:'延岡鉱床',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万延岡',legend:'マンガン鉱床'},
  {lat:31.950,lng:131.433,name:'小林鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万都城',legend:'金銀鉱徴地'},
  {lat:31.600,lng:130.750,name:'指宿鉱床',cat:'nonmetal',mat:'S',trace:true,mapsheet:'20万鹿児島',legend:'硫黄鉱徴地'},
  {lat:31.400,lng:131.050,name:'志布志石炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万都城',legend:'石炭鉱徴地'},
  {lat:31.383,lng:130.767,name:'笠沙鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万鹿児島',legend:'金銀鉱徴地'},
  {lat:33.733,lng:130.333,name:'唐津鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万唐津',legend:'金銀鉱徴地'},
  {lat:34.333,lng:132.133,name:'岩国石灰2',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万広島',legend:'石灰石鉱床'},
  {lat:33.250,lng:131.617,name:'臼杵石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万大分',legend:'石灰石鉱床'},
  {lat:32.783,lng:131.483,name:'熊本北部鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万延岡',legend:'銅鉱徴地'},
  {lat:34.850,lng:132.783,name:'三次石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万三次',legend:'石灰石鉱床'},
  {lat:34.633,lng:131.933,name:'周南鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万山口',legend:'金銀鉱徴地'},
  {lat:35.000,lng:133.817,name:'津山石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岡山',legend:'石灰石鉱床'},
  {lat:34.467,lng:133.450,name:'赤磐石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万岡山',legend:'石灰石鉱床'},
  {lat:35.233,lng:133.733,name:'奥津鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万岡山',legend:'金銀鉱徴地'},
  {lat:35.017,lng:132.300,name:'浜田鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万浜田',legend:'金銀鉱徴地'},
  {lat:34.583,lng:131.250,name:'防府鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万山口',legend:'金銀鉱徴地'},
  {lat:35.000,lng:132.220,name:'江津マンガン',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万浜田',legend:'マンガン鉱床'},
  {lat:35.700,lng:133.367,name:'米子鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万米子',legend:'銅鉱徴地'},
  {lat:36.833,lng:138.633,name:'沼田鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万前橋',legend:'金銀鉱徴地'},
  {lat:36.367,lng:139.65,name:'渡良瀬鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万宇都宮',legend:'銅鉱床'},
  {lat:36.117,lng:138.617,name:'甲府鉱床',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万甲府',legend:'金銀鉱床'},
  {lat:35.683,lng:139.017,name:'相模鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万東京',legend:'金銀鉱徴地'},
  {lat:35.417,lng:138.767,name:'沼津鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万甲府',legend:'金銀鉱徴地'},
  {lat:35.083,lng:136.967,name:'桑名鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万名古屋',legend:'金銀鉱徴地'},
  {lat:34.650,lng:136.550,name:'伊勢鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万津',legend:'金銀鉱徴地'},
  {lat:35.367,lng:136.050,name:'敦賀鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万福井',legend:'鉛亜鉛鉱床'},
  {lat:36.217,lng:136.350,name:'加賀温泉',cat:'nonmetal',mat:'S',trace:true,mapsheet:'20万金沢',legend:'硫黄鉱徴地'},
  {lat:36.4,lng:136.9,name:'五箇山鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万富山',legend:'銅鉱徴地'},
  {lat:35.7,lng:137.617,name:'木曽鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万飯田',legend:'銅鉱床'},
  {lat:35.567,lng:137.6,name:'南木曽鉱床',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万飯田',legend:'鉛亜鉛鉱床'},
  {lat:34.950,lng:137.383,name:'鳳来石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万豊橋',legend:'石灰石鉱床'},
  {lat:34.667,lng:137.217,name:'新城石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万豊橋',legend:'石灰石鉱床'},
  {lat:34.483,lng:137.017,name:'豊田石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万名古屋',legend:'石灰石鉱床'},
  {lat:34.100,lng:135.617,name:'御坊石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万和歌山',legend:'石灰石鉱床'},
  {lat:33.867,lng:135.350,name:'田辺海底炭',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万田辺',legend:'石炭鉱徴地'},
  {lat:34.417,lng:135.700,name:'吉野鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万吉野',legend:'金銀鉱徴地'},
  {lat:33.483,lng:135.633,name:'熊野鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万田辺',legend:'金銀鉱徴地'},
  {lat:35.617,lng:135.383,name:'舞鶴鉱床',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万宮津',legend:'マンガン鉱床'},
  {lat:35.883,lng:135.683,name:'小浜鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万福井',legend:'金銀鉱徴地'},
  {lat:35.250,lng:135.217,name:'亀岡鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万京都',legend:'銅鉱徴地'},
  {lat:34.900,lng:135.467,name:'奈良鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万吉野',legend:'金銀鉱徴地'},
  {lat:34.683,lng:134.583,name:'姫路石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万神戸',legend:'石灰石鉱床'},
  {lat:35.117,lng:135.300,name:'綾部鉱床',cat:'metal',mat:'Mn',trace:false,mapsheet:'20万宮津',legend:'マンガン鉱床'},
  {lat:34.883,lng:134.917,name:'三田鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万神戸',legend:'金銀鉱徴地'},
  {lat:34.217,lng:134.967,name:'洲本鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万神戸',legend:'金銀鉱徴地'},
  {lat:34.250,lng:135.683,name:'和歌山鉱床',cat:'metal',mat:'Fe_Ti',trace:true,mapsheet:'20万和歌山',legend:'鉄チタン鉱徴地'},
  {lat:34.083,lng:134.833,name:'阿南石灰2',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万徳島',legend:'石灰石鉱床'},
  {lat:33.433,lng:134.100,name:'室戸鉱床',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万高知',legend:'マンガン鉱徴地'},
  {lat:33.267,lng:132.967,name:'宿毛鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万宿毛',legend:'金銀鉱徴地'},
  {lat:33.233,lng:132.550,name:'宇和島鉱床',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万宿毛',legend:'銅鉱徴地'},
  {lat:33.960,lng:133.300,name:'新居浜鉱床',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万高知',legend:'銅鉱床'},
  {lat:33.467,lng:133.583,name:'土佐湾鉱床',cat:'metal',mat:'Mn',trace:true,mapsheet:'20万高知',legend:'マンガン鉱徴地'},
  {lat:34.367,lng:133.733,name:'赤穂鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万岡山',legend:'金銀鉱徴地'},
  {lat:34.600,lng:134.450,name:'龍野鉱床',cat:'metal',mat:'Pb_Zn',trace:true,mapsheet:'20万神戸',legend:'鉛亜鉛鉱徴地'},
  {lat:33.183,lng:130.183,name:'伊万里石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万佐世保',legend:'石灰石鉱床'},
  {lat:32.967,lng:130.150,name:'長崎炭田',cat:'fuel',mat:'Coal',trace:false,mapsheet:'20万長崎',legend:'石炭鉱床'},
  {lat:32.500,lng:129.683,name:'五島炭田',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万長崎',legend:'石炭鉱徴地'},
  {lat:33.117,lng:130.050,name:'平戸炭田',cat:'fuel',mat:'Coal',trace:true,mapsheet:'20万佐世保',legend:'石炭鉱徴地'},
  {lat:32.017,lng:130.283,name:'阿久根鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万鹿児島',legend:'金銀鉱徴地'},
  {lat:31.700,lng:130.283,name:'川内鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万鹿児島',legend:'金銀鉱徴地'},
  {lat:30.750,lng:130.350,name:'屋久島石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万屋久島',legend:'石灰石鉱床'},
  {lat:30.483,lng:130.600,name:'種子島石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万屋久島',legend:'石灰石鉱床'},
  {lat:28.383,lng:129.500,name:'奄美石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万奄美',legend:'石灰石鉱床'},
  {lat:27.350,lng:128.917,name:'沖永良部石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万沖永良部',legend:'石灰石鉱床'},
  {lat:26.833,lng:128.300,name:'沖縄中部石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万那覇',legend:'石灰石鉱床'},
  {lat:25.833,lng:131.233,name:'南大東石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万南大東',legend:'石灰石鉱床'},
  {lat:24.833,lng:125.283,name:'宮古石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万石垣',legend:'石灰石鉱床'},
  {lat:24.350,lng:124.167,name:'石垣石灰',cat:'nonmetal',mat:'CaCO3',trace:false,mapsheet:'20万石垣',legend:'石灰石鉱床'},
{lat:43.767,lng:142.367,name:'神居古潭鉱床',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万旭川',legend:'金銀鉱徴地'},
{lat:42.967,lng:140.533,name:'上国富金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万寿都',legend:'金銀鉱床'},
{lat:42.433,lng:141.100,name:'幌別金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万室蘭',legend:'金銀鉱床'},
{lat:39.533,lng:141.317,name:'澤尻金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万盛岡',legend:'金銀鉱床'},
{lat:38.617,lng:140.4,name:'延沢銀山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万山形',legend:'金銀鉱床'},
{lat:38.383,lng:140.983,name:'関山金山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万仙台',legend:'金銀鉱徴地'},
{lat:39.733,lng:140.333,name:'来満金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万秋田',legend:'金銀鉱床'},
{lat:37.433,lng:140.633,name:'大滝根金山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万郡山',legend:'金銀鉱徴地'},
{lat:35.317,lng:138.383,name:'中川金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万甲府',legend:'金銀鉱床'},
{lat:35.167,lng:138.5,name:'湯之奥金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万甲府',legend:'金銀鉱床'},
{lat:35.733,lng:138.733,name:'黒川金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万甲府',legend:'金銀鉱床'},
{lat:34.683,lng:138.933,name:'下田金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万下田',legend:'金銀鉱床'},
{lat:34.82,lng:138.97,name:'大仁金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万下田',legend:'金銀鉱床'},
{lat:34.917,lng:133.950,name:'吉備金山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万岡山',legend:'金銀鉱徴地'},
{lat:34.900,lng:135.483,name:'多田銀山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万大阪',legend:'金銀鉱床'},
{lat:35.083,lng:134.917,name:'生野周辺鉱徴地',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万豊岡',legend:'金銀鉱徴地'},
{lat:35.100,lng:132.433,name:'大森銀山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万浜田',legend:'金銀鉱床'},
{lat:32.717,lng:131.317,name:'高千穂金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万延岡',legend:'金銀鉱床'},
{lat:31.833,lng:131.417,name:'宮崎金山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万宮崎',legend:'金銀鉱徴地'},
{lat:32.350,lng:130.183,name:'天草金山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万長崎',legend:'金銀鉱徴地'},
{lat:37.367,lng:139.533,name:'中川鉱山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万若松',legend:'銅鉱床'},
{lat:37.383,lng:139.53,name:'館の沢鉱山',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万若松',legend:'鉛亜鉛鉱床'},
{lat:37.353,lng:139.490,name:'田代鉱山',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万若松',legend:'鉛亜鉛鉱床'},
{lat:37.35,lng:139.483,name:'横田鉱山',cat:'metal',mat:'Pb_Zn',trace:false,mapsheet:'20万若松',legend:'鉛亜鉛鉱床'},
{lat:37.400,lng:139.558,name:'風来鉱山',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万若松',legend:'銅鉱徴地'},
{lat:37.200,lng:139.283,name:'田子倉鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万若松',legend:'金銀鉱床'},
{lat:37.633,lng:139.633,name:'赤羽根鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万若松',legend:'金銀鉱床'},
{lat:37.650,lng:139.567,name:'黒男鉱山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万若松',legend:'金銀鉱徴地'},
{lat:37.383,lng:139.467,name:'大石田鉱山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万若松',legend:'銅鉱床'},
{lat:37.500,lng:139.933,name:'石ヶ森鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万若松',legend:'金銀鉱床'},
{lat:37.417,lng:140.017,name:'朝日鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万若松',legend:'金銀鉱床'},
{lat:37.800,lng:139.983,name:'加納鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万若松',legend:'金銀鉱床'},
{lat:37.617,lng:140.100,name:'沼尻鉱山',cat:'nonmetal',mat:'S',trace:false,mapsheet:'20万若松',legend:'硫黄鉱床'},
{lat:37.133,lng:139.717,name:'八総鉱山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万田島',legend:'銅鉱床'},
{lat:37.100,lng:139.583,name:'館岩鉱山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万田島',legend:'銅鉱床'},
{lat:37.233,lng:139.817,name:'田島鉱山',cat:'metal',mat:'Cu_Mo',trace:true,mapsheet:'20万田島',legend:'銅鉱徴地'},
{lat:37.183,lng:139.483,name:'富田鉱山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万田島',legend:'金銀鉱徴地'},
{lat:37.467,lng:140.167,name:'高玉金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万郡山',legend:'金銀鉱床'},
{lat:37.933,lng:140.467,name:'半田銀山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万福島',legend:'金銀鉱床'},
{lat:37.983,lng:140.517,name:'柳沢鉱山',cat:'metal',mat:'Au_Ag',trace:true,mapsheet:'20万福島',legend:'金銀鉱徴地'},
{lat:37.400,lng:140.133,name:'黄金沢鉱山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万郡山',legend:'金銀鉱床'},
{lat:37.817,lng:140.317,name:'松川金山',cat:'metal',mat:'Au_Ag',trace:false,mapsheet:'20万福島',legend:'金銀鉱床'},
{lat:37.1,lng:140.883,name:'八茎鉱山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万平',legend:'銅鉱床'},
{lat:37.050,lng:140.600,name:'沢渡鉱山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万平',legend:'銅鉱床'},
{lat:37.933,lng:140.917,name:'高ノ倉鉱山',cat:'metal',mat:'Cu_Mo',trace:false,mapsheet:'20万福島',legend:'銅鉱床'}
];
let gsjLayer=null, gsjVisible=false;

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
  return L.marker([d.lat,d.lng],{
    icon:L.divIcon({html,className:'',iconSize:[sz+4,sz+4],iconAnchor:[(sz+4)/2,(sz+4)/2],popupAnchor:[0,-((sz+4)/2+8)]}),
    pane:'paneGsj',
    zIndexOffset:d.trace?0:10
  }).bindPopup(popup, {maxWidth:260});
}

function buildGsjLayer(){
  if(gsjLayer){ map.removeLayer(gsjLayer); gsjLayer=null; }
  const fMetal   =document.getElementById('mf-metal').checked;
  const fNonmetal=document.getElementById('mf-nonmetal').checked;
  const fFuel    =document.getElementById('mf-fuel').checked;
  const fTrace   =document.getElementById('mf-trace').checked;
  gsjLayer=L.layerGroup({pane:'paneGsj'});
  GSJ_MINE_DATA.forEach(d=>{
    const st=getMineStyle(d.mat);
    if(d.trace && !fTrace) return;
    if(!d.trace){
      if(st.cat==='metal'    && !fMetal)    return;
      if(st.cat==='nonmetal' && !fNonmetal) return;
      if(st.cat==='fuel'     && !fFuel)     return;
    }
    makeMineMarker(d).addTo(gsjLayer);
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

  let data = [...GSJ_MINE_DATA];

  // 古いレイヤー削除
  if(gsjLayer){ map.removeLayer(gsjLayer); gsjLayer=null; }
  gsjLayer = L.layerGroup({pane:'paneGsj'});

  // フィルター状態取得
  const fMetal    = document.getElementById('mf-metal').checked;
  const fNonmetal = document.getElementById('mf-nonmetal').checked;
  const fFuel     = document.getElementById('mf-fuel').checked;
  const fTrace    = document.getElementById('mf-trace').checked;

  const total = data.length;
  const BATCH = 50;
  let done = 0;

  const processBatch = () => new Promise(resolve => {
    const end = Math.min(done + BATCH, total);
    for(let i=done; i<end; i++){
      const d = data[i];
      const st = getMineStyle(d.mat);
      if(d.trace && !fTrace){ done++; continue; }
      if(!d.trace){
        if(st.cat==='metal'     && !fMetal)    { done++; continue; }
        if(st.cat==='nonmetal'  && !fNonmetal) { done++; continue; }
        if(st.cat==='fuel'      && !fFuel)     { done++; continue; }
      }
      makeMineMarker(d).addTo(gsjLayer);
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
  };
  localStorage.setItem('gm_mine_filter', JSON.stringify(state));
  // 表示中のときのみ再構築（非表示中は次回表示時に反映される）
  if(gsjVisible) loadMineData();
}

function _restoreMineFilter(){
  try {
    const s = JSON.parse(localStorage.getItem('gm_mine_filter'));
    if(!s) return;
    const el = id => document.getElementById(id);
    if(el('mf-metal'))    el('mf-metal').checked    = s.metal    !== false;
    if(el('mf-nonmetal')) el('mf-nonmetal').checked = s.nonmetal !== false;
    if(el('mf-fuel'))     el('mf-fuel').checked     = s.fuel     !== false;
    if(el('mf-trace'))    el('mf-trace').checked    = s.trace    !== false;
  } catch(e){}
}

function toggleGsjLayer(){
  gsjVisible = !gsjVisible;
  const btn = document.getElementById('btn-gsj');
  btn.classList.toggle('active', gsjVisible);
  if(gsjVisible){
    // レイヤーが既に構築済みなら即表示
    if(gsjLayer){
      gsjLayer.addTo(map);
    } else {
      // 未読込 → オフラインシートへ誘導
    }
  } else {
    if(gsjLayer) map.removeLayer(gsjLayer);
  }
}



// ─── 凡例モーダル ───
const LEGEND_B64='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';
function openMineLegend(){
  const img=document.getElementById('mine-legend-img');
  // 毎回確実にセット
  if(LEGEND_B64 && !img.getAttribute('data-loaded')){
    img.src='data:image/png;base64,'+LEGEND_B64;
    img.setAttribute('data-loaded','1');
  }
  document.getElementById('mine-legend-overlay').classList.add('open');
}
function closeMineLegend(){
  document.getElementById('mine-legend-overlay').classList.remove('open');
}

// ═══════════════════════════════════════════