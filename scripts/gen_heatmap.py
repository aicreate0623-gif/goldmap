#!/usr/bin/env python3
"""
gen_heatmap.py  Firestore 投稿座標 → data/heatmap.json 生成

【出力構造】
  {
    "generated_at": "...",
    "total_submissions": N,
    "free":  { GeoJSON FeatureCollection, GRID_SIZE_FREE (~10km) },
    "paid":  { GeoJSON FeatureCollection, GRID_SIZE_PAID (~1km)  }
  }

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
import os
from datetime import datetime, timezone
from pathlib import Path

OUTPUT_PATH = Path(__file__).parent.parent / 'data' / 'heatmap.json'

# ── グリッドサイズ定数 ────────────────────────────────────
GRID_SIZE_FREE = 0.1   # 約10km（無料tier・フィルターなし）
GRID_SIZE_PAID = 0.01  # 約1km （有料tier・クラスタ条件あり）

# ── paidクラスタ条件 ──────────────────────────────────────
NEIGHBOR_RADIUS = 4    # 自セルから何グリッド以内を近傍とするか（9×9範囲）
MIN_NEIGHBOR_CELLS = 2 # 近傍範囲内に必要な投稿セル数（自セル除く）
MIN_AVG_STARS = 1.0    # 近傍範囲内の全投稿の星平均下限


def coord_to_grid(lat, lng, grid_size):
    return (
        round(round(lat / grid_size) * grid_size, 6),
        round(round(lng / grid_size) * grid_size, 6),
    )


def fetch_coords_from_firestore():
    # [PHASE2 UNCOMMENT] ↓
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
            'lat':   lat,
            'lng':   lng,
            'stars': data.get('stars', 0),  # 未設定は0扱い
            'date':  data.get('date', ''),  # 将来の鮮度フィルタ用・今回は不使用
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
            lat   = float(c['lat'])
            lng   = float(c['lng'])
            stars = float(c.get('stars', 0))
            key   = coord_to_grid(lat, lng, grid_size)
            if key not in grid:
                grid[key] = {'count': 0, 'stars_sum': 0.0}
            grid[key]['count']     += 1
            grid[key]['stars_sum'] += stars
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
            'count':     v['count'],          # 自セルの件数
            'avg_stars': round(avg_stars, 2), # 近傍含む星平均
            'raw_score': v['count'] * avg_stars,
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


def build_geojson(points):
    features = [
        {
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [p['lng'], p['lat']]},
            'properties': {k: v for k, v in p.items() if k not in ('lat', 'lng')},
        }
        for p in points
    ]
    return {'type': 'FeatureCollection', 'features': features}


def main():
    print("=== gen_heatmap.py start ===")
    coords = fetch_coords_from_firestore()
    print(f"  取得件数: {len(coords)}")

    points_free = aggregate_free(coords, GRID_SIZE_FREE)
    points_paid = aggregate_paid(coords, GRID_SIZE_PAID)
    print(f"  グリッド数 free({GRID_SIZE_FREE}°): {len(points_free)}")
    print(f"  グリッド数 paid({GRID_SIZE_PAID}°): {len(points_paid)}"
          f"  (近傍{NEIGHBOR_RADIUS}グリッド・隣接{MIN_NEIGHBOR_CELLS}セル以上・星平均{MIN_AVG_STARS}以上)")

    output = {
        'generated_at':              datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'total_submissions':         sum(p['count'] for p in points_paid) if points_paid
                                     else sum(p['count'] for p in points_free),
        'grid_size_free':            GRID_SIZE_FREE,
        'grid_size_paid':            GRID_SIZE_PAID,
        'cluster_neighbor_radius':   NEIGHBOR_RADIUS,
        'cluster_min_neighbor_cells': MIN_NEIGHBOR_CELLS,
        'cluster_min_avg_stars':     MIN_AVG_STARS,
        'free': build_geojson(points_free),
        'paid': build_geojson(points_paid),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  出力: {OUTPUT_PATH}")
    print(f"  total_submissions: {output['total_submissions']}")
    print("=== gen_heatmap.py done ===")


if __name__ == '__main__':
    main()