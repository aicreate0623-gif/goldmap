#!/usr/bin/env python3
"""
gen_bears.py
熊出没情報を複数ソースから収集し data/bears.json を生成する。
GitHub Actions から毎日 JST 06:00 (UTC 21:00) に実行される。

対応ソース:
  - Google My Maps KML (富山・栃木・静岡・石川・奈良・島根鳥取・滋賀・山形・青森)
  - kumadas.net JSON API (秋田)
  - テレビ朝日 JSON (全国) ※シーズン外はスキップ
  # - higumap.info (北海道) ※ログイン必須のためスキップ中
"""

import json
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

import requests

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------

OUTPUT_PATH      = Path(__file__).parent.parent / "data" / "bears.json"   # 後方互換で残す
OUTPUT_HEAT_PATH = Path(__file__).parent.parent / "data" / "bears_heat.json"
OUTPUT_PINS_PATH = Path(__file__).parent.parent / "data" / "bears_pins.json"

# ピン表示に使う直近日数
PINS_DAYS = 90

USER_AGENT = (
    "Mozilla/5.0 (compatible; GoldMapBot/1.0; "
    "+https://github.com/your-org/goldmap)"
)

HEADERS = {"User-Agent": USER_AGENT}

REQUEST_TIMEOUT = 30  # 秒

# KML ソース定義
# fmt: off
KML_SOURCES = [
    {
        "pref": "富山県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=1chPdwv1B9w0z0VhRWqg6xV2mssU&forcekml=1",
        "note": "富山県ツキノワグマ出没情報地図【クマっぷ】",
    },
    {
        "pref": "栃木県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=10qIEI8EW5IVAY82zXyoF8DbWto0aUyc&forcekml=1",
        "note": "とちぎのクマ目撃情報2025",
    },
    {
        "pref": "静岡県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=1hwFI-xmiB1uYeEpfNetfP15CS9uxo08&forcekml=1",
        "note": "令和７年度静岡県ツキノワグマ目撃情報",
    },
    {
        "pref": "石川県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=1yzG7cN9fx5lPUMyE_Xp5k7r_EXjSz_0&forcekml=1",
        "note": "R7 ツキノワグマ目撃・痕跡情報",
    },
    {
        "pref": "奈良県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=1ij-CG5R6Kc1fFnd_eFvI3gbeWOQvvFs&forcekml=1",
        "note": "奈良市・木津川市　クマ目撃情報マップ",
    },
    {
        "pref": "島根県・鳥取県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=1g5S_PUzzPjzY5UFp8IBBamT0vOhOGvg&forcekml=1",
        "note": "島根県・鳥取県クマ目撃マップ",
    },
    {
        "pref": "滋賀県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=1rE5HcSdJnm2gX3iT1FMt0aCVuQ9ArDs&forcekml=1",
        "note": "大津市ツキノワグマ出没マップ",
    },
    {
        "pref": "山形県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=1N9E9rixBQwxB4TKQ2XsP32GLOi6w6qQ&forcekml=1",
        "note": "Yamagata Prefecture Bear Sightings",
    },
    {
        "pref": "青森県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=13Nbo8EFxhx50lQsl4SptQctrnNU&forcekml=1",
        "note": "青森県クマ目撃情報",
    },
    {
        "pref": "宮城県",
        "species": "ツキノワグマ",
        "url": "https://www.google.com/maps/d/u/0/kml?mid=1aZCXqs7vrAPEBhE4HkT3CwmlMdunP2Y&forcekml=1",
        "note": "宮城県クマ目撃情報",
    },
]
# fmt: on

# ---------------------------------------------------------------------------
# KML パーサー
# ---------------------------------------------------------------------------

# KML の名前空間
_KML_NS = {
    "kml": "http://www.opengis.net/kml/2.2",
    "gx": "http://www.google.com/kml/ext/2.2",
}


def _kml_text(el, tag: str) -> str:
    """子要素のテキストを安全に取得（名前空間あり・なし両対応）"""
    # 名前空間あり
    child = el.find(f"kml:{tag}", _KML_NS)
    if child is not None and child.text:
        return child.text.strip()
    # 名前空間なし（一部 KML）
    child = el.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return ""


def _strip_html(text: str) -> str:
    """HTML タグと連続空白を除去"""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _parse_date(raw: str) -> str:
    """
    日付文字列を YYYY-MM-DD 形式に正規化する。
    パース失敗時は空文字を返す。
    """
    if not raw:
        return ""
    # ISO 8601 形式（タイムスタンプ付き）
    for fmt in (
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y/%m/%d",
        "%Y-%m-%d",
        "%Y年%m月%d日",
    ):
        try:
            return datetime.strptime(raw[:len(fmt) + 5], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    # 日付っぽい数字列を抽出
    m = re.search(r"(\d{4})[/\-年](\d{1,2})[/\-月](\d{1,2})", raw)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def _parse_coords(coord_str: str) -> tuple[float, float] | None:
    """
    KML <coordinates> テキスト（lng,lat[,alt]）を (lat, lng) タプルに変換。
    不正値は None を返す。
    """
    parts = coord_str.strip().split(",")
    if len(parts) < 2:
        return None
    try:
        lng = float(parts[0])
        lat = float(parts[1])
    except ValueError:
        return None
    # 日本の範囲チェック（粗め）
    if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
        return None
    return lat, lng


def fetch_kml(source: dict) -> list[dict]:
    """1 つの KML ソースを取得してレコードリストに変換する。"""
    pref = source["pref"]
    url = source["url"]
    print(f"  [KML] {pref} ...", end=" ", flush=True)

    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"SKIP ({e})")
        return []

    try:
        root = ET.fromstring(resp.content)
    except ET.ParseError as e:
        print(f"SKIP (XML parse error: {e})")
        return []

    # Placemark を全探索（Document/Folder 入れ子に対応）
    placemarks = root.findall(".//kml:Placemark", _KML_NS)
    if not placemarks:
        placemarks = root.findall(".//Placemark")

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for pm in placemarks:
        # 座標取得
        coord_el = pm.find(".//kml:coordinates", _KML_NS)
        if coord_el is None:
            coord_el = pm.find(".//coordinates")
        if coord_el is None or not coord_el.text:
            continue
        coords = _parse_coords(coord_el.text)
        if coords is None:
            continue
        lat, lng = coords

        # 名称・説明
        name = _kml_text(pm, "name")
        desc = _strip_html(_kml_text(pm, "description"))

        # 日付：<TimeStamp><when> か name/description から抽出
        date_str = ""
        ts_when = pm.find(".//kml:TimeStamp/kml:when", _KML_NS)
        if ts_when is None:
            ts_when = pm.find(".//TimeStamp/when")
        if ts_when is not None and ts_when.text:
            date_str = _parse_date(ts_when.text)
        if not date_str:
            # name か description に日付が入っている場合
            for candidate in (name, desc):
                date_str = _parse_date(candidate)
                if date_str:
                    break

        # 場所名：name を優先、なければ desc 先頭40文字
        place = name if name else desc[:40]

        record_id = (
            f"{pref}_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        )

        records.append(
            {
                "id": record_id,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "date": date_str,
                "pref": pref,
                "place": place,
                "species": source.get("species", "ツキノワグマ"),
                "detail": desc[:200] if desc else "",
                "source_url": url,
                "fetched_at": fetched_at,
            }
        )

    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------
# kumadas.net JSON API (秋田県)
# ---------------------------------------------------------------------------

def fetch_kumadas() -> list[dict]:
    """kumadas.net の JSON API から秋田県データを取得する。"""
    url = "https://kumadas.net/api/ver1/sightings/post_list"
    print(f"  [API] 秋田県 (kumadas.net) ...", end=" ", flush=True)

    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        print(f"SKIP ({e})")
        return []
    except json.JSONDecodeError as e:
        print(f"SKIP (JSON parse error: {e})")
        return []

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # レスポンス構造は {"sightings": [...]} と推測（404 だったため要調整）
    items = data if isinstance(data, list) else data.get("sightings", data.get("data", []))

    for item in items:
        try:
            lat = float(item.get("lat") or item.get("latitude") or 0)
            lng = float(item.get("lng") or item.get("longitude") or 0)
        except (TypeError, ValueError):
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue

        date_str = _parse_date(
            str(item.get("date") or item.get("sighted_at") or item.get("created_at") or "")
        )
        place = str(item.get("place") or item.get("address") or item.get("location") or "")
        detail = str(item.get("detail") or item.get("description") or item.get("note") or "")

        record_id = (
            f"akita_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        )
        records.append(
            {
                "id": record_id,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "date": date_str,
                "pref": "秋田県",
                "place": place[:100],
                "species": "ツキノワグマ",
                "detail": detail[:200],
                "source_url": url,
                "fetched_at": fetched_at,
            }
        )

    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------
# テレビ朝日 全国 JSON (シーズン中のみ)
# ---------------------------------------------------------------------------

def fetch_tvAsahi() -> list[dict]:
    """
    テレビ朝日の全国クマ出没 JSON を取得する。
    URL に年度が含まれるため、現在年を使って試みる。
    シーズン外（404 等）は静かにスキップ。
    """
    year = datetime.now().year
    # URLパターン: /special/YYYYMM bear/sys/data.json  (例: 202506bear)
    # 例年 6 月シーズン開始のため 06 固定で試みる
    url = f"https://news.tv-asahi.co.jp/special/{year}06bear/sys/data.json"
    print(f"  [JSON] 全国 (テレ朝 {year}) ...", end=" ", flush=True)

    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if resp.status_code in (403, 404):
            print(f"SKIP (HTTP {resp.status_code} - シーズン外の可能性)")
            return []
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        print(f"SKIP ({e})")
        return []
    except json.JSONDecodeError as e:
        print(f"SKIP (JSON parse error: {e})")
        return []

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 構造不明のため汎用的に探索
    items = data if isinstance(data, list) else data.get("data", data.get("items", []))

    for item in items:
        try:
            lat = float(item.get("lat") or item.get("latitude") or 0)
            lng = float(item.get("lng") or item.get("longitude") or 0)
        except (TypeError, ValueError):
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue

        date_str = _parse_date(str(item.get("date") or item.get("datetime") or ""))
        pref = str(item.get("pref") or item.get("prefecture") or "不明")
        place = str(item.get("place") or item.get("address") or "")
        detail = str(item.get("detail") or item.get("description") or "")

        record_id = (
            f"national_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        )
        records.append(
            {
                "id": record_id,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "date": date_str,
                "pref": pref,
                "place": place[:100],
                "species": "クマ",
                "detail": detail[:200],
                "source_url": url,
                "fetched_at": fetched_at,
            }
        )

    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 秋田県クマダス CSV（公式オープンデータ CC BY 4.0）
# ---------------------------------------------------------------------------

def fetch_akita_csv() -> list[dict]:
    """秋田県オープンデータカタログのクマダスCSVを取得する。"""
    import io, csv as csv_mod
    url = "https://ckan.pref.akita.lg.jp/dataset/f801a10f-f076-47e4-b5a6-0bb5569639e0/resource/0678f9b3-4bf7-4212-9c0e-c0cb9b09b3cf/download?user-download=true"
    print(f"  [CSV] 秋田県 (クマダス) ...", end=" ", flush=True)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"SKIP ({e})")
        return []

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reader = csv_mod.DictReader(io.StringIO(resp.content.decode("utf-8-sig", errors="replace")))
    for row in reader:
        lat_val = next((row[k] for k in row if "緯度" in k or k.lower() in ("lat","latitude")), "")
        lng_val = next((row[k] for k in row if "経度" in k or k.lower() in ("lng","lon","longitude")), "")
        if not lat_val or not lng_val:
            continue
        try:
            lat, lng = float(lat_val), float(lng_val)
        except ValueError:
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue
        date_str = _parse_date(str(next((row[k] for k in row if "日" in k), "")))
        place    = str(next((row[k] for k in row if "市町村" in k or "場所" in k or "住所" in k), ""))
        detail   = str(next((row[k] for k in row if "状況" in k or "コメント" in k or "種別" in k), ""))
        record_id = f"akita_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        records.append({"id": record_id, "lat": round(lat,6), "lng": round(lng,6),
            "date": date_str, "pref": "秋田県", "place": place[:100],
            "species": "ツキノワグマ", "detail": detail[:200],
            "source_url": "https://kumadas.net/", "fetched_at": fetched_at})
    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------
# 埼玉県 CSV（公式オープンデータ PDL1.0）
# ---------------------------------------------------------------------------

def fetch_saitama_csv() -> list[dict]:
    """埼玉県オープンデータポータルのツキノワグマ出没CSVを取得する。"""
    import io, csv as csv_mod
    url = "https://opendata.pref.saitama.lg.jp/resource_download/6789"
    print(f"  [CSV] 埼玉県 ...", end=" ", flush=True)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"SKIP ({e})")
        return []

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reader = csv_mod.DictReader(io.StringIO(resp.content.decode("utf-8-sig", errors="replace")))
    for row in reader:
        lat_val = next((row[k] for k in row if "緯度" in k or k.lower() in ("lat","latitude","y座標","y")), "")
        lng_val = next((row[k] for k in row if "経度" in k or k.lower() in ("lng","lon","longitude","x座標","x")), "")
        if not lat_val or not lng_val:
            continue
        try:
            lat, lng = float(lat_val), float(lng_val)
        except ValueError:
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue
        date_str = _parse_date(str(next((row[k] for k in row if "日" in k), "")))
        place    = str(next((row[k] for k in row if "市町村" in k or "場所" in k or "住所" in k), ""))
        detail   = str(next((row[k] for k in row if "状況" in k or "コメント" in k), ""))
        record_id = f"saitama_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        records.append({"id": record_id, "lat": round(lat,6), "lng": round(lng,6),
            "date": date_str, "pref": "埼玉県", "place": place[:100],
            "species": "ツキノワグマ", "detail": detail[:200],
            "source_url": url, "fetched_at": fetched_at})
    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------
# 札幌市 ヒグマ出没情報 CSV（CC BY 4.0）
# ---------------------------------------------------------------------------

def fetch_sapporo_csv() -> list[dict]:
    """札幌市 CKAN の最新年ヒグマ出没CSVを取得する。"""
    import io, csv as csv_mod
    urls = [
        "https://ckan.pf-sapporo.jp/dataset/0d3197ef-c473-48ac-86bd-0fc34084b0ee/resource/76c539c8-cd17-4449-a972-6ddc8c3d5306/download/2025sapporobearappearance.csv",
        "https://ckan.pf-sapporo.jp/dataset/0d3197ef-c473-48ac-86bd-0fc34084b0ee/resource/0fba45c6-b2e5-4038-b9ad-8c91da0af9a2/download/2024sapporobearappearance.csv",
    ]
    print(f"  [CSV] 札幌市 (ヒグマ) ...", end=" ", flush=True)
    resp, used_url = None, ""
    for url in urls:
        try:
            r = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            if r.status_code == 200:
                resp, used_url = r, url
                break
        except requests.RequestException:
            continue
    if resp is None:
        print("SKIP (全URLが取得不可)")
        return []

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reader = csv_mod.DictReader(io.StringIO(resp.content.decode("utf-8-sig", errors="replace")))
    for row in reader:
        lat_val = next((row[k] for k in row if "緯度" in k or k.lower() in ("lat","latitude","y")), "")
        lng_val = next((row[k] for k in row if "経度" in k or k.lower() in ("lng","lon","longitude","x")), "")
        if not lat_val or not lng_val:
            continue
        try:
            lat, lng = float(lat_val), float(lng_val)
        except ValueError:
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue
        date_str = _parse_date(str(next((row[k] for k in row if "日" in k), "")))
        place    = str(next((row[k] for k in row if "区" in k or "場所" in k or "住所" in k), ""))
        detail   = str(next((row[k] for k in row if "状況" in k or "種別" in k or "コメント" in k), ""))
        record_id = f"sapporo_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        records.append({"id": record_id, "lat": round(lat,6), "lng": round(lng,6),
            "date": date_str, "pref": "北海道", "place": f"札幌市 {place}"[:100],
            "species": "ヒグマ", "detail": detail[:200],
            "source_url": used_url, "fetched_at": fetched_at})
    print(f"OK ({len(records)} records)")
    return records


# 重複除去
# ---------------------------------------------------------------------------

def deduplicate(records: list[dict]) -> list[dict]:
    """
    同一座標・同一日付のレコードを除去する。
    id が衝突する場合も除去。
    """
    seen_ids: set[str] = set()
    seen_pos: set[tuple] = set()
    result: list[dict] = []

    for r in records:
        pos_key = (round(r["lat"], 4), round(r["lng"], 4), r["date"])
        if r["id"] in seen_ids or pos_key in seen_pos:
            continue
        seen_ids.add(r["id"])
        seen_pos.add(pos_key)
        result.append(r)

    return result


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main() -> int:
    print("=== gen_bears.py 開始 ===")
    print(f"実行時刻 (UTC): {datetime.now(timezone.utc).isoformat()}")

    all_records: list[dict] = []

    # KML ソース
    print("\n[KML ソース処理]")
    for source in KML_SOURCES:
        try:
            records = fetch_kml(source)
            all_records.extend(records)
        except Exception:
            print(f"  ERROR: {source['pref']}")
            traceback.print_exc()
        time.sleep(1)  # サーバー負荷軽減

    # kumadas.net API (秋田)
    print("\n[API ソース処理]")
    try:
        all_records.extend(fetch_kumadas())
    except Exception:
        traceback.print_exc()

    # テレビ朝日 全国 JSON
    print("\n[全国 JSON ソース処理]")
    try:
        all_records.extend(fetch_tvAsahi())
    except Exception:
        traceback.print_exc()

    # CSV ソース（公式オープンデータ）
    print("\n[CSV ソース処理]")
    for fn, name in [(fetch_akita_csv, "秋田"), (fetch_saitama_csv, "埼玉"), (fetch_sapporo_csv, "札幌")]:
        try:
            all_records.extend(fn())
        except Exception:
            print(f"  ERROR: {name}")
            traceback.print_exc()
        time.sleep(1)

    # 重複除去
    before = len(all_records)
    all_records = deduplicate(all_records)
    print(f"\n重複除去: {before} → {len(all_records)} records")

    # 日付降順ソート
    all_records.sort(key=lambda r: r["date"] or "0000-00-00", reverse=True)

    # ── 出力 ──────────────────────────────────────────────────────
    from datetime import timedelta
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # 1) bears_heat.json: 全件・座標のみ [[lat, lng], ...]
    heat_data = [[r["lat"], r["lng"]] for r in all_records]
    with OUTPUT_HEAT_PATH.open("w", encoding="utf-8") as f:
        json.dump(heat_data, f, separators=(",", ":"))
    print(f"\n✅ {OUTPUT_HEAT_PATH} に {len(heat_data)} 件（座標のみ）")

    # 2) bears_pins.json: 直近 PINS_DAYS 日以内・全フィールド
    cutoff_str = (datetime.now(timezone.utc).date() - timedelta(days=PINS_DAYS)).strftime("%Y-%m-%d")
    pins_data = [r for r in all_records if r["date"] and r["date"] >= cutoff_str]
    with OUTPUT_PINS_PATH.open("w", encoding="utf-8") as f:
        json.dump(pins_data, f, ensure_ascii=False, indent=2)
    print(f"✅ {OUTPUT_PINS_PATH} に {len(pins_data)} 件（直近{PINS_DAYS}日）")

    # 3) bears.json: 後方互換（pins と同内容）
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(pins_data, f, ensure_ascii=False, indent=2)
    print(f"✅ {OUTPUT_PATH} に {len(pins_data)} 件（後方互換）")

    return 0


if __name__ == "__main__":
    sys.exit(main())