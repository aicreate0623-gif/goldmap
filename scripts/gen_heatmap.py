#!/usr/bin/env python3
"""
gen_heatmap.py  GSJ鉱床DB＋Firestore投稿座標 → data/heatmap.json 生成

【出力構造】
  {
    "generated_at": "...",
    "total_submissions": N,
    "free":  { GeoJSON FeatureCollection, GRID_SIZE_FREE (~10km) },  ← GSJ鉱床DBから生成（静的・一回のみ）
    "paid":  { GeoJSON FeatureCollection, GRID_SIZE_PAID (~1km)  }   ← Firestore投稿座標から生成
  }

【freeデータ生成条件（GSJ鉱床DB）】
  gsj_mine_data_full.json を読み込み以下でフィルター:
  - category_id=1（金属鉱物のみ）
  - mineral に "Au" または "Ag" を含む
  - map_scale が 50万・75万分の1のみ（200万・500万を除外）
  - work_status は全て含む（稼行・休廃止・鉱徴すべて）

【paidクラスタ条件】
  自セルに投稿があり、自セルから4グリッド以内（9×9範囲）に
  投稿セルが2つ以上存在し、かつ9×9範囲内の全投稿の星平均が
  MIN_AVG_STARS(1.0)以上のセルのみ出力。
  ※ 最大隣接距離: 0.04°×√2 ≈ 5.6km（設計上の契約として許容）

【Phase2で有効化する手順】
  1. GitHub Secrets に FIREBASE_PROJECT_ID, FIREBASE_SA_KEY を追加
  2. GitHub Actions workflow の UNCOMMENT 箇所を外す
  3. このファイルの "[PHASE2 UNCOMMENT]" 行のコメントを外す
"""

import json
import math
import os
import random
from datetime import datetime, timezone
from pathlib import Path

OUTPUT_PATH = Path(__file__).parent.parent / 'data' / 'heatmap.json'

# ── グリッドサイズ定数 ────────────────────────────────────
GRID_SIZE_FREE = 0.1   # 約10km（無料tier・フィルターなし）
GRID_SIZE_PAID = 0.01  # 約1km （有料tier・クラスタ条件あり）

# ── 座標ジッター設定（プライバシー保護）────────────────────
JITTER_MIN_KM = 2.0   # 最小オフセット距離（km）
JITTER_MAX_KM = 3.0   # 最大オフセット距離（km）

def apply_jitter(lat, lng):
    """
    座標に JITTER_MIN_KM〜JITTER_MAX_KM のランダムオフセットをかける。
    方向はランダム（0〜360°）、距離は一様乱数。
    1°≈111kmとして度単位に変換。緯度方向のlng補正あり。
    """
    dist_km  = random.uniform(JITTER_MIN_KM, JITTER_MAX_KM)
    angle    = random.uniform(0, 2 * math.pi)
    d_lat    = (dist_km / 111.0) * math.cos(angle)
    d_lng    = (dist_km / (111.0 * math.cos(math.radians(lat)))) * math.sin(angle)
    return round(lat + d_lat, 6), round(lng + d_lng, 6)
# ── paidクラスタ条件 ──────────────────────────────────────
NEIGHBOR_RADIUS = 4    # 自セルから何グリッド以内を近傍とするか（9×9範囲）
MIN_NEIGHBOR_CELLS = 2 # 近傍範囲内に必要な投稿セル数（自セル除く）
MIN_AVG_STARS = 0.0    # 星なし投稿も反映（近傍条件は維持）


def coord_to_grid(lat, lng, grid_size):
    return (
        round(round(lat / grid_size) * grid_size, 6),
        round(round(lng / grid_size) * grid_size, 6),
    )


def fetch_coords_from_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore

    project_id = os.environ['FIREBASE_PROJECT_ID']
    if not firebase_admin._apps:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred, {'projectId': project_id})
    db = firestore.client()
    docs = db.collection('coords').stream()
    results = []
    for d in docs:
        data = d.to_dict()
        lat  = data.get('lat')
        lng  = data.get('lng')
        if lat is None or lng is None:
            continue
        results.append({
            'lat':    lat,
            'lng':    lng,
            'stars':  data.get('stars', 0),   # 未設定は0扱い
            'isGold': data.get('isGold', False),  # 金キーワードフラグ
            'date':   data.get('date', ''),    # 将来の鮮度フィルタ用・今回は不使用
        })
    return results


def aggregate_free(coords, grid_size):
    """
    無料tier用: 全件グリッド集計・フィルターなし
    weight = 件数の正規化値
    """
    grid = {}
    for c in coords:
        try:
            key = coord_to_grid(float(c['lat']), float(c['lng']), grid_size)
            grid[key] = grid.get(key, 0) + 1
        except (KeyError, TypeError, ValueError):
            continue
    if not grid:
        return []
    max_count = max(grid.values())
    result = [
        {
            'lat':    lat,
            'lng':    lng,
            'weight': round(count / max_count, 4),
            'count':  count,
        }
        for (lat, lng), count in grid.items()
    ]
    return sorted(result, key=lambda x: -x['weight'])


def aggregate_paid(coords, grid_size):
    """
    有料tier用: クラスタ条件付きグリッド集計

    手順:
      1. 全座標をグリッドにスナップしてセル別に集計（件数・星合計）
      2. 各セルについて NEIGHBOR_RADIUS グリッド以内の近傍セルを探索
      3. 近傍セル数 >= MIN_NEIGHBOR_CELLS かつ 近傍含む全投稿の星平均 >= MIN_AVG_STARS
         の条件を満たすセルのみ出力
      4. weight = (近傍含む件数合計 × 星平均) の正規化値
    """
    # Step1: グリッド集計
    grid = {}
    for c in coords:
        try:
            lat    = float(c['lat'])
            lng    = float(c['lng'])
            stars  = float(c.get('stars', 0))
            is_gold = bool(c.get('isGold', False))
            key    = coord_to_grid(lat, lng, grid_size)
            if key not in grid:
                grid[key] = {'count': 0, 'stars_sum': 0.0, 'is_gold': False}
            grid[key]['count']     += 1
            grid[key]['stars_sum'] += stars
            # 1件でも金キーワードがあればセルをisGoldとする
            if is_gold:
                grid[key]['is_gold'] = True
        except (KeyError, TypeError, ValueError):
            continue

    if not grid:
        return []

    # Step2-3: 近傍探索とフィルタリング
    # グリッドキーを整数インデックスに変換して高速検索
    # key=(lat,lng) → idx=(ilat, ilng) で整数演算
    idx_map = {}
    for (lat, lng), v in grid.items():
        ilat = round(lat / grid_size)
        ilng = round(lng / grid_size)
        idx_map[(ilat, ilng)] = v

    filtered = []
    r = NEIGHBOR_RADIUS
    for (ilat, ilng), v in idx_map.items():
        # 自セルから r グリッド以内の近傍セルを収集（自セル除く）
        neighbor_cells = []
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                if di == 0 and dj == 0:
                    continue  # 自セルは除く
                nb = idx_map.get((ilat + di, ilng + dj))
                if nb is not None:
                    neighbor_cells.append(nb)

        # isGoldセルは近傍条件をスキップして通す（孤立OK）
        if not v['is_gold']:
            # 近傍セル数チェック
            if len(neighbor_cells) < MIN_NEIGHBOR_CELLS:
                continue

        # 近傍全体（自セル含む）の件数・星合計
        total_count     = v['count'] + sum(nb['count'] for nb in neighbor_cells)
        total_stars_sum = v['stars_sum'] + sum(nb['stars_sum'] for nb in neighbor_cells)
        avg_stars       = total_stars_sum / total_count if total_count > 0 else 0.0

        # 星平均チェック
        if avg_stars < MIN_AVG_STARS:
            continue

        filtered.append({
            'lat':       round(ilat * grid_size, 6),
            'lng':       round(ilng * grid_size, 6),
            'count':     v['count'],           # 自セルの件数
            'is_gold':   v['is_gold'],          # 金キーワードフラグ
            'avg_stars': round(avg_stars, 2),  # 近傍含む星平均
            'raw_score': v['count'] * max(avg_stars, 0.1),  # 星0でも最低スコア保証
        })

    if not filtered:
        return []

    max_score = max(p['raw_score'] for p in filtered)
    result = [
        {
            'lat':       p['lat'],
            'lng':       p['lng'],
            'weight':    round(p['raw_score'] / max_score, 4),
            'count':     p['count'],
            'avg_stars': p['avg_stars'],
        }
        for p in filtered
    ]
    return sorted(result, key=lambda x: -x['weight'])


def build_geojson(points, jitter=False):
    features = []
    for p in points:
        lat, lng = p['lat'], p['lng']
        if jitter:
            lat, lng = apply_jitter(lat, lng)
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [lng, lat]},
            'properties': {k: v for k, v in p.items() if k not in ('lat', 'lng')},
        })
    return {'type': 'FeatureCollection', 'features': features}


def load_gsj_free_coords():
    """
    GSJ鉱床DB（gsj_mine_data_full.json）を読み込み、
    freeヒートマップ用にフィルターした座標リストを返す。

    フィルター条件（スクショ確定仕様）:
      - category_id=1（金属鉱物のみ）
      - mineral に "Au" または "Ag" を含む（Au_Ag系）
      - map_scale が 50 または 75（200万・500万分の1を除外）
      - work_status は全て含む（稼行・休廃止・鉱徴すべて）
    """
    gsj_path = Path(__file__).parent.parent / 'data' / 'gsj_mine_data_full.json'
    if not gsj_path.exists():
        # scripts/ と同階層の data/ を試みる
        gsj_path = Path(__file__).parent / 'gsj_mine_data_full.json'
    if not gsj_path.exists():
        raise FileNotFoundError(f"gsj_mine_data_full.json が見つかりません: {gsj_path}")

    with open(gsj_path, encoding='utf-8') as f:
        features = json.load(f)

    coords = []
    for feat in features:
        p = feat.get('properties', {})
        # 金属鉱物のみ
        if p.get('category_id') != 1:
            continue
        # Au/Ag系のみ
        mineral = str(p.get('mineral', ''))
        if 'Au' not in mineral and 'Ag' not in mineral:
            continue
        # 広域図幅除外（200万・500万分の1）
        scale = p.get('map_scale')
        if scale in (200, 500):
            continue
        # 座標取得
        coords_geom = feat.get('geometry', {}).get('coordinates', [])
        if len(coords_geom) < 2:
            continue
        lng, lat = coords_geom[0], coords_geom[1]
        coords.append({'lat': lat, 'lng': lng, 'stars': 0, 'isGold': True})

    return coords


def load_mines_coords():
    """
    data.js の MINES 配列（スポットボタンで表示される砂金採取スポット）から
    座標を抽出して返す。GSJ_MINE_DATA より前の部分のみ対象。
    """
    import re
    data_js_path = Path(__file__).parent.parent / 'js' / 'data.js'
    if not data_js_path.exists():
        print(f"  [警告] data.js が見つかりません: {data_js_path} → MINESスキップ")
        return []

    with open(data_js_path, encoding='utf-8') as f:
        content = f.read()

    # GSJ_MINE_DATA より前の部分（= MINES 配列）だけ対象
    mines_section = content.split('const GSJ_MINE_DATA')[0]
    matches = re.findall(r'\{lat:([\d.]+),lng:([\d.]+),name:', mines_section)
    coords = [{'lat': float(lat), 'lng': float(lng)} for lat, lng in matches]
    return coords


def main():
    print("=== gen_heatmap.py start ===")

    # ── 静的ベースデータ: GSJ鉱床DB + MINESスポット
    gsj_coords   = load_gsj_free_coords()
    mines_coords = load_mines_coords()
    base_coords  = gsj_coords + mines_coords
    print(f"  GSJ絞込件数（Au/Ag・金属・50万75万）: {len(gsj_coords)}")
    print(f"  MINESスポット件数: {len(mines_coords)}")
    print(f"  静的ベース合計: {len(base_coords)}")

    # ── free: 静的ベースデータのみ
    points_free = aggregate_free(base_coords, GRID_SIZE_FREE)
    print(f"  グリッド数 free({GRID_SIZE_FREE}°): {len(points_free)}")

    # ── paid: 静的ベース + Firestore投稿座標
    firestore_coords = fetch_coords_from_firestore()
    print(f"  Firestore取得件数: {len(firestore_coords)}")
    points_paid = aggregate_paid(base_coords + firestore_coords, GRID_SIZE_PAID)
    print(f"  グリッド数 paid({GRID_SIZE_PAID}°): {len(points_paid)}"
          f"  (近傍{NEIGHBOR_RADIUS}グリッド・隣接{MIN_NEIGHBOR_CELLS}セル以上・星平均{MIN_AVG_STARS}以上)")

    output = {
        'generated_at':               datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'total_submissions':          sum(p['count'] for p in points_paid) if points_paid
                                      else sum(p['count'] for p in points_free),
        'grid_size_free':             GRID_SIZE_FREE,
        'grid_size_paid':             GRID_SIZE_PAID,
        'cluster_neighbor_radius':    NEIGHBOR_RADIUS,
        'cluster_min_neighbor_cells': MIN_NEIGHBOR_CELLS,
        'cluster_min_avg_stars':      MIN_AVG_STARS,
        'free': build_geojson(points_free),
        'paid': build_geojson(points_paid, jitter=True),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  出力: {OUTPUT_PATH}")
    print(f"  total_submissions: {output['total_submissions']}")
    print("=== gen_heatmap.py done ===")


if __name__ == '__main__':
    main()