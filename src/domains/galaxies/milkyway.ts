/**
 * The Milky Way as seen from outside (Local Group scales). A fallback 'mw:galaxy' entity is provided here only
 * through an EntityProvider, so a galaxy domain that registers its own 'mw:galaxy' entity always wins
 * (the registry resolves registered entities before providers).
 */
import type * as THREE from 'three';
import type { Entity, EntityProvider, SearchRecord } from '../../core/entity';
import type { FactSheet } from '../../data/provenance';
import { GALACTIC_CENTER_DIRECTION_ICRS } from '../../core/frames';
import { KPC_M } from '../../core/units';
import { LOCAL_GROUP_ID, MILKY_WAY_ID } from './catalog';
import { SRC } from './entities';

/** Sun – Galactic Centre distance, kpc (GRAVITY Collaboration 2024, A&A 692, A242; milkyway.json sun.galactocentricDistancePc). */
export const MW_R0_KPC = 8.2759;

export function createMilkyWayFallbackProvider(): EntityProvider {
  const R = 15 * KPC_M;
  const g = GALACTIC_CENTER_DIRECTION_ICRS;
  const px = g.x * MW_R0_KPC * KPC_M, py = g.y * MW_R0_KPC * KPC_M, pz = g.z * MW_R0_KPC * KPC_M;
  let cached: Entity | null = null;
  const record: SearchRecord = {
    id: MILKY_WAY_ID, name: 'Milky Way', aliases: ['The Galaxy', 'Our galaxy'], kind: 'galaxy', domain: 'galaxy', importance: 96,
    tagline: 'Our home galaxy: a barred spiral about 100 000 light-years across',
  };
  const facts = (): FactSheet => ({
    entityId: MILKY_WAY_ID,
    summary: 'The Milky Way is a barred spiral galaxy of a few hundred billion stars. The Sun lies about 27 000 light-years from its centre, between two spiral arms.',
    sections: [{
      id: 'properties', title: 'Properties', facts: [
        { key: 'r0', label: 'Sun – Galactic Centre distance', quantity: { value: MW_R0_KPC * KPC_M, unit: 'm', provenance: 'observed', sigDigits: 4, source: { datasetId: 'galactic-milkyway-model', reference: 'GRAVITY Collaboration 2024, A&A 692, A242' } }, provenance: 'observed' },
        { key: 'arms', label: 'Spiral arms', text: 'Reid et al. 2019 maser-parallax fit (Norma–Outer, Scutum–Centaurus, Sagittarius–Carina, Local spur, Perseus)', provenance: 'reconstructed', source: SRC.milkyway },
        { key: 'bar', label: 'Bar', text: 'Half-length ≈ 5 kpc at ≈ 28° to the Sun–centre line (Wegg et al. 2015; Portail et al. 2017)', provenance: 'reconstructed', source: SRC.milkyway },
      ],
    }],
    representation: {
      provenance: 'reconstructed',
      description: 'Nobody has seen the Milky Way from outside. This face-on view is reconstructed from maser-parallax spiral-arm fits, the measured bar and bulge, and an exponential disc; the far side, the arm extensions, the dust lanes and the star-forming knots are illustrative.',
    },
    sources: [SRC.milkyway],
  });
  return {
    domain: 'galaxy',
    resolve(id: string): Entity | undefined {
      if (id !== MILKY_WAY_ID) return undefined;
      cached ??= {
        id: MILKY_WAY_ID, name: 'Milky Way', aliases: record.aliases, kind: 'galaxy', domain: 'galaxy', parentId: LOCAL_GROUP_ID,
        radiusM: R, position: (_t: number, out: THREE.Vector3) => out.set(px, py, pz), framingRadiusM: R * 1.1,
        viewDistance: { min: 0.5 * KPC_M, default: 3.2 * R, max: 3e3 * KPC_M }, contextScaleMin: 20.6,
        tagline: record.tagline, capabilities: ['focus', 'travel', 'bookmark', 'sources'], importance: 96,
        representation: 'reconstructed', facts,
      };
      return cached;
    },
    searchRecords: () => [record],
  };
}
