'use strict';
'use strict';

// ═══════════════════════════════════════════
//  IndexedDB
// ═══════════════════════════════════════════
const DB_NAME='gm_tiles', DB_VER=3, ST='tiles', ST_MINE='mine_data';
let db=null;

function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(ST)) d.createObjectStore(ST);
      if(!d.objectStoreNames.contains(ST_MINE)) d.createObjectStore(ST_MINE);
    };
    r.onsuccess=e=>{db=e.target.result;res();}; r.onerror=e=>rej(e);
  });
}
function idb(mode,fn,store){ return new Promise((res,rej)=>{ const tx=db.transaction(store||ST,mode),s=tx.objectStore(store||ST),r=fn(s); r.onsuccess=()=>res(r.result); r.onerror=e=>rej(e); }); }
const dbGet=(k)=>idb('readonly',s=>s.get(k));
const dbPut=(k,v)=>idb('readwrite',s=>s.put(v,k));
const dbClr=()=>idb('readwrite',s=>s.clear());
const dbCnt=()=>idb('readonly',s=>s.count());
const dbGetMine=(k)=>idb('readonly',s=>s.get(k),ST_MINE);
const dbPutMine=(k,v)=>idb('readwrite',s=>s.put(v,k),ST_MINE);
const dbDelMine=(k)=>idb('readwrite',s=>s.delete(k),ST_MINE);

// ═══════════════════════════════════════════
//  タイルソース
// ═══════════════════════════════════════════
const SRCS={
  std:  {url:'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',   ext:'png', attr:'地理院タイル'},
  photo:{url:'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', ext:'jpg', attr:'地理院写真'},
  topo: {url:'https://tile.opentopomap.org/{z}/{x}/{y}.png',                ext:'png', attr:'OpenTopoMap'},
};
function tileURL(key,z,x,y){ return SRCS[key].url.replace('{z}',z).replace('{x}',x).replace('{y}',y); }
function tileKey(key,z,x,y){ return key+'/'+z+'/'+x+'/'+y; }

// ═══════════════════════════════════════════
//  カスタムキャッシュレイヤー
// ═══════════════════════════════════════════
function makeCachedLayer(srcKey){
  return L.TileLayer.extend({
    _sk:srcKey,
    createTile(coords,done){
      const img=document.createElement('img');
      img.crossOrigin='anonymous';
      const maxNative=this.options.maxNativeZoom;
      let z=coords.z,x=coords.x,y=coords.y;
      if(z>maxNative){
        const diff=z-maxNative, factor=Math.pow(2,diff);
        z=maxNative; x=Math.floor(coords.x/factor); y=Math.floor(coords.y/factor);
        const size=256*factor;
        img.style.width=size+'px'; img.style.height=size+'px';
        img.style.marginLeft=-(coords.x%factor)*256+'px';
        img.style.marginTop=-(coords.y%factor)*256+'px';
        img.style.imageRendering='pixelated';
      }
      const key=tileKey(this._sk,z,x,y);
      const net=tileURL(this._sk,coords.z,coords.x,coords.y);
      if(!db){ img.src=net; img.onload=()=>done(null,img); img.onerror=e=>done(e,img); return img; }
      dbGet(key).then(cached=>{
        if(cached){ const type=this._sk==='photo'?'image/jpeg':'image/png'; img.src=URL.createObjectURL(new Blob([cached],{type})); }
        else img.src=net;
        img.onload=()=>done(null,img); img.onerror=e=>done(e,img);
      }).catch(()=>{ img.src=net; img.onload=()=>done(null,img); img.onerror=e=>done(e,img); });
      return img;
    }
  });
}

