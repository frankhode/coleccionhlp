"""Build an allowlisted static site, excluding tests, Git metadata and tools."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent.parent
out = root / 'dist'
if out.exists():
    shutil.rmtree(out)
out.mkdir()
for name in ['index.html', 'favicon.svg', '.nojekyll', 'hlp-inventario.tsv', 'fas-desde-831.json']:
    shutil.copy2(root / name, out / name)
for name in ['assets', 'data', 'images']:
    if (root / name).exists():
        shutil.copytree(root / name, out / name)
print(f'Sitio preparado en {out}')
