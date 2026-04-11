#!/usr/bin/env python3
"""
gen_heatmap.py  Firestore 投稿座標 → data/heatmap.json 生成

【出力構造】
  {
    "generated_at": "...",
    "total_submissions": N,
    "free":  { GeoJSON FeatureCollection, GRID_SIZE_FREE  (~10km) },
    "paid":  { GeoJSON FeatureCollection, GRID_SIZE_PAID  (~1km)  }
  }

【現在の状態】
  Firebase接続部分はコメントアウトされたスタブ。
  実行するとサンプルデータで data/heatmap.json を生成する。

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

# ── グリッドサイズ定数（実データが集まったら調整）────────────
GRID_SIZE_FREE = 0.1   # 約10km（無料tier）
GRID_SIZE_PAID = 0.01  # 約1km （有料tier）


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
    return [{'lat': d.get('lat'), 'lng': d.get('lng')} for d in docs
            if d.get('lat') and d.get('lng')]


def aggregate_to_grid(coords, grid_size):
    """座標リストをグリッドに集計し、正規化したweightを付与して返す"""
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
    result = []
    for (lat, lng), count in grid.items():
        result.append({
            'lat': lat, 'lng': lng,
            'weight': round(count / max_count, 4),
            'count': count,
        })
    return sorted(result, key=lambda x: -x['weight'])


def build_geojson(points):
    features = [
        {
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [p['lng'], p['lat']]},
            'properties': {'weight': p['weight'], 'count': p['count']},
        }
        for p in points
    ]
    return {
        'type': 'FeatureCollection',
        'features': features,
    }


def main():
    print("=== gen_heatmap.py start ===")
    coords = fetch_coords_from_firestore()
    print(f"  取得件数: {len(coords)}")

    # 2段階グリッド集計
    points_free = aggregate_to_grid(coords, GRID_SIZE_FREE)
    points_paid = aggregate_to_grid(coords, GRID_SIZE_PAID)
    print(f"  グリッド数 free({GRID_SIZE_FREE}°): {len(points_free)}")
    print(f"  グリッド数 paid({GRID_SIZE_PAID}°): {len(points_paid)}")

    output = {
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'total_submissions': sum(p['count'] for p in points_paid),
        'grid_size_free': GRID_SIZE_FREE,
        'grid_size_paid': GRID_SIZE_PAID,
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
