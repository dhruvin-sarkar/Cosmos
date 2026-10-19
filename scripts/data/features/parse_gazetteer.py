"""
Parse the cached Gazetteer KMZ exports (data-raw/features/*.kmz) into one compact JSON table:
data-raw/features/gazetteer_all.json = { "<BODY>": [ { name, type, code, lat, lon, diameterKm, origin, approval, approvalDate,
link, minLon, maxLon, minLat, maxLat } ] }.  Coordinates as exported (planetocentric latitude, longitude 0-360 positive East).
Usage: python -I scripts/data/features/parse_gazetteer.py
"""
import glob
import json
import os
import xml.etree.ElementTree as ET
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RAW = os.path.join(ROOT, 'data-raw', 'features')
NS = '{http://www.opengis.net/kml/2.2}'


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main() -> None:
    out = {}
    for path in sorted(glob.glob(os.path.join(RAW, '*_nomenclature_center_pts.kmz'))):
        body = os.path.basename(path).split('_nomenclature')[0]
        with zipfile.ZipFile(path) as z:
            kml = next(n for n in z.namelist() if n.endswith('.kml'))
            root = ET.fromstring(z.read(kml))
        rows = []
        for pm in root.iter(NS + 'Placemark'):
            d = {sd.get('name'): (sd.text or '').strip() for sd in pm.iter(NS + 'SimpleData')}
            rows.append({
                'name': d.get('clean_name') or (pm.findtext(NS + 'name') or '').strip(),
                'type': d.get('type', ''),
                'code': d.get('code', ''),
                'lat': num(d.get('center_lat')),
                'lon': num(d.get('center_lon')),
                'diameterKm': num(d.get('diameter')),
                'origin': d.get('origin', ''),
                'approval': d.get('approval', ''),
                'approvalDate': (d.get('approvaldt') or '')[:10].replace('/', '-'),
                'link': d.get('link', ''),
                'minLon': num(d.get('min_lon')), 'maxLon': num(d.get('max_lon')),
                'minLat': num(d.get('min_lat')), 'maxLat': num(d.get('max_lat')),
            })
        out[body] = rows
        print(f'{body}: {len(rows)}')
    with open(os.path.join(RAW, 'gazetteer_all.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)


if __name__ == '__main__':
    main()
