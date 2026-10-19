"""
Fetch the IAU/USGS Gazetteer of Planetary Nomenclature centre-point exports (KMZ) for the bodies the features domain
labels, once, into data-raw/features/<BODY>_nomenclature_center_pts.kmz, and record the retrieval time.

Source: https://planetarynames.wr.usgs.gov/GIS_Downloads (USGS Astrogeology / IAU WGPSN; public domain, U.S. Government work).
Usage:  python -I scripts/data/features/fetch_gazetteer.py [--force]
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

BASE = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/{}_nomenclature_center_pts.kmz'
BODIES = [
    'MOON', 'MERCURY', 'VENUS', 'MARS', 'IO', 'EUROPA', 'GANYMEDE', 'CALLISTO', 'TITAN', 'ENCELADUS', 'MIMAS',
    'IAPETUS', 'TETHYS', 'DIONE', 'RHEA', 'MIRANDA', 'ARIEL', 'TITANIA', 'TRITON', 'PLUTO', 'CHARON', 'CERES', 'VESTA',
    'PHOBOS', 'EROS',
]

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'data-raw', 'features')


def main() -> None:
    force = '--force' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    log = {}
    for body in BODIES:
        url = BASE.format(body)
        dest = os.path.join(OUT, f'{body}_nomenclature_center_pts.kmz')
        if os.path.exists(dest) and not force:
            print(f'skip {body} (cached)')
            continue
        req = urllib.request.Request(url, headers={'User-Agent': 'Cosmos-SCI-FORGE-2026/1.0 (student exhibition; offline snapshot)'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
        except Exception as exc:  # noqa: BLE001 - report and continue
            print(f'FAIL {body}: {exc}')
            continue
        with open(dest, 'wb') as f:
            f.write(data)
        log[body] = {'url': url, 'bytes': len(data), 'retrieved': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
        print(f'ok {body} {len(data)} B')
        time.sleep(0.5)
    meta_path = os.path.join(OUT, 'retrieval.json')
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, encoding='utf-8') as f:
            meta = json.load(f)
    meta.update(log)
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
