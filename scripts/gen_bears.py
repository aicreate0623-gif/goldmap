#!/usr/bin/env python3
"""
gen_bears.py
熊出没情報を複数ソースから収集し data/bears.json を生成する。
GitHub Actions から毎日 JST 06:00 (UTC 21:00) に実行される。

対応ソース:
  - Google My Maps KML (富山・栃木・静岡・石川・奈良・島根鳥取・滋賀・山形・青森・宮城)
  - kumadas.net JSON API (秋田)
  - テレビ朝日 JSON (全国) ※シーズン外はスキップ
  - 東京都 CSV (CC BY / 東京都オープンデータ) ※accuracy High/Medium のみ
  - 福島県 Excel (CC BY 2.1 / 福島県) ※令和7年度
  - 新潟県 ArcGIS FeatureServer (Survey123 / 新潟県鳥獣被害対策支援センター)
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
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
# フィールド: ObjectID, 出没年, 月, 日, 出没時間, 市町村名, 地名, 出没状況の概要, 出没頭数, x(経度), y(緯度)
# ---------------------------------------------------------------------------

def fetch_saitama_csv() -> list[dict]:
    import io, csv as csv_mod
    url = "https://opendata.pref.saitama.lg.jp/resource_download/6789"
    # ブラウザ風ヘッダーで403回避
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.5",
        "Referer": "https://opendata.pref.saitama.lg.jp/datasets/2290",
    }
    print(f"  [CSV] 埼玉県 ...", end=" ", flush=True)
    try:
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"SKIP ({e})")
        return []
    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reader = csv_mod.DictReader(io.StringIO(resp.content.decode("utf-8-sig", errors="replace")))
    for row in reader:
        # 座標: x=経度, y=緯度
        try:
            lng = float(row.get("x") or row.get("X") or 0)
            lat = float(row.get("y") or row.get("Y") or 0)
        except (ValueError, TypeError):
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue
        # 日付: 出没年・月・日を結合
        year  = str(row.get("出没年") or "").strip()
        month = str(row.get("月") or "").strip().zfill(2)
        day   = str(row.get("日") or "").strip().zfill(2)
        date_str = f"{year}-{month}-{day}" if year and month and day else ""
        place  = str(row.get("市町村名") or "") + " " + str(row.get("地名") or "")
        detail = str(row.get("出没状況の概要") or "")
        record_id = f"saitama_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        records.append({"id": record_id, "lat": round(lat,6), "lng": round(lng,6),
            "date": date_str.strip(), "pref": "埼玉県", "place": place.strip()[:100],
            "species": "ツキノワグマ", "detail": detail[:200],
            "source_url": url, "fetched_at": fetched_at})
    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------
# 札幌市 ヒグマ出没情報 CSV（CC BY 4.0）
# ---------------------------------------------------------------------------

def fetch_sapporo_csv() -> list[dict]:
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


# ---------------------------------------------------------------------------
# 東京都 CSV（東京都オープンデータ CC BY）
# 列: lat, lon, number, date, accuracy, "sightings, traces, etc."
# accuracy: High/Medium のみ採用（Low 除外）
# URL: /bear/data ページから動的取得（年次更新に自動追従）
# ---------------------------------------------------------------------------

def fetch_tokyo_csv() -> list[dict]:
    import io, csv as csv_mod
    SOURCE_PAGE = "https://www.kankyo.metro.tokyo.lg.jp/nature/animals_plants/bear/data"
    BASE        = "https://www.kankyo.metro.tokyo.lg.jp"
    FALLBACK    = "https://www.kankyo.metro.tokyo.lg.jp/documents/d/kankyo/tukinowaguma_source20260302"
    print("  [CSV] 東京都 ...", end=" ", flush=True)

    # CSV直リンクをページから動的取得
    csv_url = None
    try:
        page = requests.get(SOURCE_PAGE, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        page.raise_for_status()
        m = re.search(r'(/documents/d/kankyo/tukinowaguma_source\d+)', page.text)
        if m:
            csv_url = BASE + m.group(1)
    except requests.RequestException:
        pass

    if not csv_url:
        csv_url = FALLBACK
        print("(fallback URL) ", end="", flush=True)

    try:
        resp = requests.get(csv_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"SKIP ({e})")
        return []

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    reader = csv_mod.DictReader(
        io.StringIO(resp.content.decode("utf-8-sig", errors="replace"))
    )

    kind_map = {
        "Sightings": "目撃",
        "Trace":     "痕跡",
        "Filming":   "撮影",
        "Capture":   "捕獲",
    }

    for row in reader:
        # accuracy フィルタ: Low 除外
        if (row.get("accuracy") or "").strip() == "Low":
            continue
        try:
            lat = float(row.get("lat") or 0)
            lng = float(row.get("lon") or 0)
        except (ValueError, TypeError):
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue

        date_str = _parse_date(str(row.get("date") or ""))
        kind_raw = str(row.get("sightings, traces, etc.") or "").strip()
        detail   = kind_map.get(kind_raw, kind_raw)

        record_id = f"tokyo_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        records.append({
            "id":         record_id,
            "lat":        round(lat, 6),
            "lng":        round(lng, 6),
            "date":       date_str,
            "pref":       "東京都",
            "place":      "",
            "species":    "ツキノワグマ",
            "detail":     detail,
            "source_url": SOURCE_PAGE,
            "fetched_at": fetched_at,
        })

    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------
# 福島県 Excel（福島県 CC BY 2.1）
# 列: No., 緯度, 経度, 日付, 年, 月, 時間, 市町村, 場所, 被害, 頭数, 体長(m), 環境, 状況
# 緯度・経度が直接含まれるため、ジオコーディング不要
# ---------------------------------------------------------------------------

def fetch_fukushima_csv() -> list[dict]:
    import io
    url         = "https://www.pref.fukushima.lg.jp/uploaded/life/878833_2585032_misc.xlsx"
    SOURCE_PAGE = "https://www.pref.fukushima.lg.jp/sec/16035b/tukinowaguma-mokugeki.html"
    print("  [XLSX] 福島県 ...", end=" ", flush=True)

    try:
        import pandas as pd
    except ImportError:
        print("SKIP (pandas 未インストール)")
        return []

    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"SKIP ({e})")
        return []

    try:
        df = pd.read_excel(
            io.BytesIO(resp.content),
            engine="openpyxl",
            header=0,
            dtype=str,
        )
    except Exception as e:
        print(f"SKIP (Excel読込失敗: {e})")
        return []

    # 列名正規化（Shift-JIS 由来の文字化け対策として位置インデックスも併用）
    cols = list(df.columns)
    def _col(name: str, idx: int) -> str:
        """列名で取れれば使い、なければ位置インデックスで取る"""
        for c in cols:
            if name in str(c):
                return c
        return cols[idx] if idx < len(cols) else ""

    col_lat    = _col("緯度", 1)
    col_lng    = _col("経度", 2)
    col_date   = _col("日付", 3)
    col_city   = _col("市町村", 7)
    col_place  = _col("場所",   8)
    col_detail = _col("状況",  13)

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for _, row in df.iterrows():
        try:
            lat = float(str(row.get(col_lat) or "").strip())
            lng = float(str(row.get(col_lng) or "").strip())
        except (ValueError, TypeError):
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue

        date_str   = _parse_date(str(row.get(col_date) or "").strip())
        city       = str(row.get(col_city)   or "").strip()
        place      = str(row.get(col_place)  or "").strip()
        detail     = str(row.get(col_detail) or "").strip()[:200]
        place_full = f"{city} {place}".strip()[:100]

        record_id = f"fukushima_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
        records.append({
            "id":         record_id,
            "lat":        round(lat, 6),
            "lng":        round(lng, 6),
            "date":       date_str,
            "pref":       "福島県",
            "place":      place_full,
            "species":    "ツキノワグマ",
            "detail":     detail,
            "source_url": SOURCE_PAGE,
            "fetched_at": fetched_at,
        })

    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------
# 新潟県 ArcGIS FeatureServer (Survey123 / 新潟県鳥獣被害対策支援センター)
# フィールド:
#   geometry.x/y → 経度/緯度 (WGS84)
#   field_7  → 出没市町村
#   field_8  → 出没区分（目撃/痕跡/人身）
#   field_9  → 出没時の状況
#   field_17 → 出没地区
#   field_20 → 出没日（Unixミリ秒）
# ---------------------------------------------------------------------------

def fetch_niigata_arcgis() -> list[dict]:
    BASE_URL = (
        "https://services6.arcgis.com/SKz58fvdFlaEB35q/arcgis/rest/services"
        "/survey123_08d14b98657b47309b868f49602375c8_results/FeatureServer/0/query"
    )
    SOURCE_PAGE = "https://www.arcgis.com/apps/dashboards/20b4d06fb3b34776959a4e69c7a8511a"
    print("  [ArcGIS] 新潟県 ...", end=" ", flush=True)

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    offset = 0
    page_size = 2000

    while True:
        params = {
            "f":                 "json",
            "where":             "1=1",
            "outFields":         "field_7,field_8,field_9,field_17,field_20",
            "returnGeometry":    "true",
            "outSR":             "4326",
            "resultOffset":      offset,
            "resultRecordCount": page_size,
            "orderByFields":     "objectid ASC",
        }
        try:
            resp = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError) as e:
            print(f"SKIP ({e})")
            return []

        features = data.get("features", [])
        for feat in features:
            geom = feat.get("geometry") or {}
            attr = feat.get("attributes") or {}

            x = geom.get("x")
            y = geom.get("y")
            if x is None or y is None:
                continue
            try:
                lng, lat = float(x), float(y)
            except (TypeError, ValueError):
                continue
            if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
                continue

            # 出没日: Unixミリ秒 → YYYY-MM-DD
            ts = attr.get("field_20")
            if ts:
                try:
                    date_str = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                except (TypeError, ValueError, OSError):
                    date_str = ""
            else:
                date_str = ""

            city   = str(attr.get("field_7")  or "").strip()
            area   = str(attr.get("field_17") or "").strip()
            kind   = str(attr.get("field_8")  or "").strip()
            detail = str(attr.get("field_9")  or "").strip()[:200]
            place  = f"{city} {area}".strip()[:100]

            record_id = f"niigata_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"
            records.append({
                "id":         record_id,
                "lat":        round(lat, 6),
                "lng":        round(lng, 6),
                "date":       date_str,
                "pref":       "新潟県",
                "place":      place,
                "species":    "ツキノワグマ",
                "detail":     f"{kind} {detail}".strip(),
                "source_url": SOURCE_PAGE,
                "fetched_at": fetched_at,
            })

        # 次ページ判定
        if data.get("exceededTransferLimit"):
            offset += page_size
            time.sleep(0.5)
        else:
            break

    print(f"OK ({len(records)} records)")
    return records


# ---------------------------------------------------------------------------
# kumamap.com API（全国・ニュースベース）
# エンドポイント: https://kumamap.com/api/sightings
# フィールド:
#   location.lat / location.lng → 座標 (WGS84)
#   location.jp.prefecture      → 都道府県
#   location.jp.locality        → 市区町村
#   timestamp                   → ISO8601 日時
#   bearType                    → blackBear / brownBear
#   bearCount                   → 頭数
#   additionalData.summary.jp   → 状況説明
# ---------------------------------------------------------------------------

def fetch_kumamap() -> list[dict]:
    url = "https://kumamap.com/api/sightings"
    print("  [API] kumamap.com (全国) ...", end=" ", flush=True)

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

    if not isinstance(data, list):
        print("SKIP (unexpected format)")
        return []

    species_map = {
        "blackBear": "ツキノワグマ",
        "brownBear": "ヒグマ",
    }

    records: list[dict] = []
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for item in data:
        # hidden フラグが立っているものはスキップ
        if item.get("hidden"):
            continue

        loc = item.get("location") or {}
        try:
            lat = float(loc.get("lat") or 0)
            lng = float(loc.get("lng") or 0)
        except (TypeError, ValueError):
            continue
        if not (20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0):
            continue

        jp = loc.get("jp") or {}
        pref     = str(jp.get("prefecture") or "不明").strip()
        locality = str(jp.get("locality")   or "").strip()

        date_str = _parse_date(str(item.get("timestamp") or ""))

        bear_type = item.get("bearType") or "blackBear"
        species   = species_map.get(bear_type, "クマ")

        summary = (
            (item.get("additionalData") or {})
            .get("summary", {})
            .get("jp", "")
        ) or str((item.get("description") or {}).get("jp", ""))

        _raw_id = item.get('id')
        record_id = f"kumamap_{_raw_id}" if _raw_id else f"kumamap_{abs(hash(f'{lat:.5f}{lng:.5f}{date_str}')) % 10**8:08d}"

        records.append({
            "id":         record_id,
            "lat":        round(lat, 6),
            "lng":        round(lng, 6),
            "date":       date_str,
            "pref":       pref,
            "place":      locality[:100],
            "species":    species,
            "detail":     summary[:200],
            "source_url": url,
            "fetched_at": fetched_at,
        })

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
    for fn, name in [
        (fetch_akita_csv,     "秋田"),
        (fetch_saitama_csv,   "埼玉"),
        (fetch_sapporo_csv,   "札幌"),
        (fetch_tokyo_csv,      "東京都"),
        (fetch_fukushima_csv,  "福島県"),
        (fetch_niigata_arcgis, "新潟県"),
    ]:
        try:
            all_records.extend(fn())
        except Exception:
            print(f"  ERROR: {name}")
            traceback.print_exc()
        time.sleep(1)

    # kumamap.com 全国APIソース
    print("\n[kumamap.com 全国API処理]")
    try:
        all_records.extend(fetch_kumamap())
    except Exception:
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