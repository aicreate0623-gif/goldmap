#!/usr/bin/env python3
"""
gen_heatmap.py  Firestore 投稿座標 → data/heatmap.json 生成

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
import sys
from datetime import datetime, timezone
from pathlib import Path

OUTPUT_PATH = Path(__file__).parent.parent / 'data' / 'heatmap.json'
GRID_SIZE = 0.01

def coord_to_grid(lat, lng):
    return (round(lat / GRID_SIZE) * GRID_SIZE,
            round(lng / GRID_SIZE) * GRID_SIZE)

def fetch_coords_from_firestore():
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

def aggregate_to_grid(coords):
    grid = {}
    for c in coords:
        try:
            key = coord_to_grid(float(c['lat']), float(c['lng']))
            grid[key] = grid.get(key, 0) + 1
        except (KeyError, TypeError, ValueError):
            continue
    if not grid:
        return []
    max_count = max(grid.values())
    result = []
    for (lat, lng), count in grid.items():
        result.append({'lat': round(lat, 6), 'lng': round(lng, 6),
                       'weight': round(count / max_count, 4), 'count': count})
    return sorted(result, key=lambda x: -x['weight'])

def build_geojson(points):
    features = [{'type': 'Feature',
                 'geometry': {'type': 'Point', 'coordinates': [p['lng'], p['lat']]},
                 'properties': {'weight': p['weight'], 'count': p['count']}}
                for p in points]
    return {'type': 'FeatureCollection',
            'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'total_submissions': sum(p['count'] for p in points),
            'features': features}

def main():
    print("=== gen_heatmap.py start ===")
    coords = fetch_coords_from_firestore()
    print(f"  取得件数: {len(coords)}")
    points = aggregate_to_grid(coords)
    print(f"  グリッド数: {len(points)}")
    geojson = build_geojson(points)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
    print(f"  出力: {OUTPUT_PATH}")
    print(f"  total_submissions: {geojson['total_submissions']}")
    print("=== gen_heatmap.py done ===")

if __name__ == '__main__':
    main()
