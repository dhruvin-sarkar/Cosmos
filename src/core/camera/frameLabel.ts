/**
 * Human-readable description of the camera's active reference frame, e.g. "Geocentric · ICRS axes",
 * "Heliocentric · ecliptic up", "Galactocentric", "Comoving · observer-centred".
 */
import type { CameraMode } from '../types';
import type { Entity } from '../entity';

const CENTRIC: Readonly<Record<string, string>> = {
  'sol:sun': 'Heliocentric',
  'sol:earth': 'Geocentric',
  'sol:moon': 'Selenocentric',
  'mw:galaxy': 'Galactocentric',
  'mw:sgr-a*': 'Galactocentric',
  'mw:galactic-center': 'Galactocentric',
  'struct:local-group': 'Local Group barycentric',
};

/** True for anchors whose context is the expanding universe as seen by us (redshift surveys, CMB). */
export function isCosmological(entity: Entity | null): boolean {
  if (!entity) return false;
  return entity.domain === 'cosmology' || entity.id.startsWith('cosmo:');
}

export function centricName(entity: Entity | null): string {
  if (!entity) return 'Barycentric (SSB)';
  const known = CENTRIC[entity.id];
  if (known) return known;
  if (entity.kind === 'galaxy' && entity.id.startsWith('mw:')) return 'Galactocentric';
  return `${entity.name}-centred`;
}

export type UpReference = 'pole' | 'ecliptic' | 'galactic' | 'orbit';

/**
 * @param anchor     current camera anchor
 * @param up         dominant up reference
 * @param poleBody   body whose pole is "up" (when up === 'pole')
 */
export function buildFrameLabel(anchor: Entity | null, up: UpReference, mode: CameraMode, poleBody: Entity | null): string {
  if (isCosmological(anchor)) return 'Comoving · observer-centred';
  const centric = centricName(anchor);
  if (mode === 'free') return `${centric} · free flight`;
  if (mode === 'follow' || up === 'orbit') return `${centric} · orbital frame (radial / along-track)`;
  if (up === 'pole') {
    if (!poleBody || poleBody.id === 'sol:earth') return `${centric} · ICRS axes`;
    return `${centric} · ${poleBody.name} north up`;
  }
  if (up === 'ecliptic') return `${centric} · ecliptic up`;
  return centric === 'Galactocentric' ? 'Galactocentric' : `${centric} · galactic north up`;
}
