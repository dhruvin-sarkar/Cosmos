/**
 * Feature entities ('feat:<body>:<slug>'): a point on the parent body's surface at the parent's TRUE position plus
 * R · (orientation · n̂). The drawn position (exhibition scale) is provided by core/visualScale through the parent's
 * satellite-system mapping (the layer registers each feature with parentId = body).
 */
import * as THREE from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import type { Fact, FactSheet, SourceRef } from '../../data/provenance';
import { bodyFrame, drawnGreatRedSpot, surfaceNormal, type BodyFrame } from './bodyFrames';
import { FEATURE_RECORDS, GAZETTEER_DATASET, SITES_DATASET, systemIILongitude, type FeatureRecord } from './data';

export interface FeatureEntity extends Entity {
  readonly record: FeatureRecord;
  readonly frame: BodyFrame;
  /** Body-fixed unit normal of the site (+Z north, +X lon 0). */
  readonly normal: THREE.Vector3;
  /** Parent radius, m (registry entity radius when available). */
  bodyRadiusM(): number;
  /** Parent entity (registry), null when the parent's domain is not loaded. */
  parent(): Entity | null;
  /** Solar elevation above the local horizon at `tMs` (deg), null when the parent or the Sun is not registered. */
  sunElevationDeg(tMs: number): number | null;
}

const fmtLat = (d: number): string => `${Math.abs(d).toFixed(2)}° ${d >= 0 ? 'N' : 'S'}`;
const fmtLon = (d: number): string => `${Math.abs(d).toFixed(2)}° ${d >= 0 ? 'E' : 'W'}`;
const fmtKm = (km: number): string => (km >= 100 ? Math.round(km).toLocaleString('en-US') : km.toFixed(km >= 10 ? 0 : 1));

function typeNoun(r: FeatureRecord): string {
  if (r.category === 'landing-site') return 'Landing site';
  return r.type || 'Feature';
}

function tagline(r: FeatureRecord, bodyName: string): string {
  if (r.tagline) return r.tagline;
  const size = r.diameterKm ? `, ${fmtKm(r.diameterKm)} km across` : '';
  return `${typeNoun(r)} on ${bodyName}${size}.`;
}

function sourceOf(r: FeatureRecord): SourceRef {
  if (r.source === 'gazetteer') {
    return { datasetId: GAZETTEER_DATASET, reference: r.link ?? undefined, note: r.gazetteerId ? `Gazetteer feature ${r.gazetteerId}` : undefined };
  }
  return { datasetId: SITES_DATASET, reference: r.mission?.coordinateSource ?? r.reference };
}

function buildFacts(e: FeatureEntity, nowMs: () => number): FactSheet {
  const r = e.record;
  const src = sourceOf(r);
  const bodyName = e.frame.name;
  const props: Fact[] = [
    { key: 'type', label: 'Type', text: r.type || typeNoun(r), provenance: 'observed', source: src },
    { key: 'body', label: 'On', text: bodyName.replace(/^the /, 'The '), provenance: 'observed' },
  ];
  if (r.dynamic) {
    const l2 = systemIILongitude(r.dynamic, nowMs());
    props.push(
      { key: 'lat', label: 'Latitude', text: '≈ 22° S (planetographic)', provenance: 'observed', source: src },
      {
        key: 'lon', label: 'Longitude (System II)', quantity: { value: Math.round(l2 * 10) / 10, unit: 'deg', provenance: 'derived', model: 'grs-linear-drift@1', source: src },
        provenance: 'derived', source: src, help: `Extrapolated from ${r.dynamic.systemIILonDeg}° W on ${r.dynamic.epoch.slice(0, 10)} with a drift of ${r.dynamic.driftDegPerMonth}°/month. The spot drifts; position approximate.`,
      },
    );
  } else if (r.lonDeg !== null) {
    props.push(
      { key: 'lat', label: 'Latitude', text: fmtLat(r.latDeg), provenance: 'observed', source: src, help: 'Planetocentric latitude.' },
      { key: 'lon', label: 'Longitude', text: fmtLon(r.lonDeg), provenance: 'observed', source: src, help: 'East-positive longitude in the IAU body-fixed frame.' },
    );
  }
  if (r.category !== 'landing-site') {
    props.push({
      key: 'diameter', label: 'Diameter',
      quantity: { value: r.diameterKm, unit: 'km', provenance: 'observed', source: src, sigDigits: 3 }, provenance: 'observed', source: src,
      help: 'Gazetteer extent: crater diameter or the longest dimension of the feature.',
    });
  }
  const el = e.sunElevationDeg(nowMs());
  if (el !== null && !r.dynamic) {
    const a = Math.abs(Math.round(el));
    props.push({
      key: 'sun', label: 'Sunlight now', provenance: 'derived',
      text: el > 0.5 ? `Day: Sun ${a}° above the horizon` : el > -0.5 ? 'On the terminator (sunrise or sunset)' : `Night: Sun ${a}° below the horizon`,
      help: 'Solar elevation at the site for the current simulation time, from the body’s IAU orientation and the Sun direction.',
    });
  }
  if (r.approval) props.push({ key: 'status', label: 'Name status', text: r.approval + (r.approvalDate ? ` (${r.approvalDate.slice(0, 4)})` : ''), provenance: 'observed', source: src });

  const sections: FactSheet['sections'] = [{ id: 'properties', title: 'Properties', facts: props }];
  if (r.mission) {
    sections.push({
      id: 'science', title: 'Mission',
      facts: [
        { key: 'mission', label: 'Mission', text: r.mission.name, provenance: 'observed', source: src },
        { key: 'agency', label: 'Agency', text: r.mission.agency, provenance: 'observed', source: src },
        { key: 'date', label: 'Landed', text: r.mission.date, provenance: 'observed', source: src },
        { key: 'coords', label: 'Coordinates from', text: r.mission.coordinateSource, provenance: 'observed', source: src },
      ],
    });
  }
  const paragraphs: string[] = [];
  if (r.origin) paragraphs.push(`Name origin: ${r.origin}`);
  if (r.reference) paragraphs.push(`Reference: ${r.reference}`);
  if (r.link) paragraphs.push(`IAU/USGS Gazetteer entry: ${r.link}`);
  if (paragraphs.length) sections.push({ id: 'overview', title: 'About the name', facts: [], paragraphs });

  const sources: SourceRef[] = [src];
  if (r.source === 'gazetteer' && r.link) sources.push({ datasetId: GAZETTEER_DATASET, reference: 'Gazetteer of Planetary Nomenclature, IAU WGPSN / USGS Astrogeology' });

  const placement = r.dynamic
    ? 'The marker follows the Great Red Spot as drawn in the illustrative Jupiter map; the real spot drifts in longitude (see System II longitude).'
    : `Marker placed at the published centre coordinates on ${bodyName}, using the same IAU body orientation the planet or moon is drawn with.`;
  return {
    entityId: e.id,
    summary: tagline(r, bodyName),
    sections,
    representation: { provenance: r.dynamic ? 'reconstructed' : 'observed', description: placement },
    sources,
    missing: r.diameterKm === null && r.category === 'feature' ? ['Diameter'] : undefined,
    assumptions: ['Positions are on a sphere of the body\'s mean radius; on irregular bodies the marker can sit above or below the real surface.'],
  };
}

const sTmp = new THREE.Vector3();
const sDir = new THREE.Vector3();

export function createFeatureEntities(registry: EntityRegistry, nowMs: () => number): FeatureEntity[] {
  const out: FeatureEntity[] = [];
  const grs = drawnGreatRedSpot();
  for (const r of FEATURE_RECORDS) {
    const frame = bodyFrame(r.body);
    if (!frame) continue;
    let lat = r.latDeg, lon = r.lonDeg;
    if (r.dynamic) {
      if (!grs) continue;
      lat = grs.latDeg;
      lon = grs.lonDeg;
    }
    if (lon === null) continue;
    const normal = surfaceNormal(lat, lon, new THREE.Vector3());
    let parentRef: Entity | null = null;
    const parent = (): Entity | null => {
      if (!parentRef) parentRef = registry.get(frame.entityId) ?? null;
      return parentRef;
    };
    const bodyRadiusM = (): number => parent()?.radiusM ?? frame.radiusM;
    const q = new THREE.Quaternion();
    const n = new THREE.Vector3();
    const featureRadiusM = r.diameterKm ? (r.diameterKm * 1000) / 2 : 0;
    const R = frame.radiusM;
    // Inspect framing: the feature plus some context, never closer than the global maps resolve (≈ 0.15–0.25 R).
    const minFraming = R * (r.category === 'landing-site' ? 0.22 : 0.15);
    const framing = Math.min(Math.max(featureRadiusM * 1.25, minFraming), R * 0.6);
    const e: FeatureEntity = {
      id: r.id,
      name: r.name,
      aliases: r.aliases,
      kind: 'region',
      domain: 'solar',
      parentId: frame.entityId,
      // A surface region has no sphere of its own: a radius would make the engine treat it as a disc (label occlusion, camera
      // clearance). Its extent lives in the fact sheet; framing comes from framingRadiusM / viewDistance.
      radiusM: null,
      framingRadiusM: framing,
      viewDistance: { min: framing * 0.2, default: framing * 2.4, max: R * 4 },
      tagline: tagline(r, frame.name),
      capabilities: ['focus', 'travel', 'sources', 'bookmark'],
      importance: Math.round(r.importance * 0.6),
      representation: r.dynamic ? 'reconstructed' : 'observed',
      record: r,
      frame,
      normal,
      bodyRadiusM,
      parent,
      position(tMs: number, o: THREE.Vector3): THREE.Vector3 {
        const p = parent();
        if (!p) return o.set(0, 0, 0);
        p.position(tMs, o);
        frame.orient(tMs, q);
        n.copy(normal).applyQuaternion(q);
        return o.addScaledVector(n, bodyRadiusM());
      },
      sunElevationDeg(tMs: number): number | null {
        const p = parent(), sun = registry.get('sol:sun');
        if (!p || !sun) return null;
        p.position(tMs, sTmp);
        sun.position(tMs, sDir).sub(sTmp).normalize();
        frame.orient(tMs, q);
        n.copy(normal).applyQuaternion(q);
        return (Math.asin(THREE.MathUtils.clamp(n.dot(sDir), -1, 1)) * 180) / Math.PI;
      },
      facts: () => buildFacts(e, nowMs),
    };
    out.push(e);
  }
  return out;
}
