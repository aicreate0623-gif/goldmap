"""
チュートリアル画像 → WebP 一括変換スクリプト
使い方:
  1. このファイルを goldmap フォルダに置く
  2. python convert_tutorial_webp.py
  3. images/tutorial/ の jpg/png が自動検出されて .webp に変換される
"""
from PIL import Image
import os, glob

SRC_DIR = os.path.join('images', 'tutorial')
QUALITY = 82   # 0-100（高いほど高品質・重い）
MAX_W   = 800  # 最大横幅px（縦は自動）

# jpg / png を自動スキャン（番号順にソート）
src_files = sorted(
    glob.glob(os.path.join(SRC_DIR, '*.jpg')) +
    glob.glob(os.path.join(SRC_DIR, '*.jpeg')) +
    glob.glob(os.path.join(SRC_DIR, '*.png')),
    key=lambda p: os.path.splitext(os.path.basename(p))[0]
)

if not src_files:
    print(f'⚠ {SRC_DIR} に変換対象ファイルが見つかりません')
    exit(1)

total_before = 0
total_after  = 0

for src_path in src_files:
    src_name  = os.path.basename(src_path)
    stem      = os.path.splitext(src_name)[0]
    dest_name = stem + '.webp'
    dest_path = os.path.join(SRC_DIR, dest_name)

    before = os.path.getsize(src_path)
    total_before += before

    img = Image.open(src_path).convert('RGB')

    # 横幅が MAX_W を超えていればリサイズ
    if img.width > MAX_W:
        ratio = MAX_W / img.width
        new_h = int(img.height * ratio)
        img   = img.resize((MAX_W, new_h), Image.LANCZOS)

    img.save(dest_path, 'WEBP', quality=QUALITY, method=6)

    after = os.path.getsize(dest_path)
    total_after += after
    ratio_pct = (1 - after / before) * 100
    print(f'  ✅ {src_name} → {dest_name}  {before//1024}KB → {after//1024}KB  ({ratio_pct:.0f}%削減)')

print()
print(f'合計: {total_before//1024}KB → {total_after//1024}KB  ({(1-total_after/total_before)*100:.0f}%削減)')
print()
print('次のステップ:')
print('  ui.js の IMG_EXT を修正してください（自動化済みなら不要）')