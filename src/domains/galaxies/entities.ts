/**
 * Entity provider for galaxies ('gal:<id>', 'gal:ungc:<slug>') and large-scale structures ('struct:<id>').
 * Entities are materialised lazily from the catalogue; positions are fixed (ICRS, metres from the Solar System).
 */
import type * as THREE from 'three';
import type { Capability, DomainId } from '../../core/entity';
import type { Entity, EntityProvider, SearchRecord } from '../../core/entity';
import type { Fact, FactSheet, ProvenanceClass, SourceRef } from '../../data/provenance';
import { KPC_M, MPC_M } from '../../core/units';
import type { Galaxy, GalaxyCatalog, Structure } from './catalog';

const DOMAIN: DomainId = 'extragalactic';
const CAPS: Capability[] = ['focus', 'travel', 'bookmark', 'sources', 'related'];
const LY_PER_MPC = 3.2615637771674333e6;

export const SRC = {
  ungc: { datasetId: 'ungc-local-volume', reference: 'Karachentsev, Makarov & Kaisina 2013, AJ 145, 101' } as SourceRef,
  famous: { datasetId: 'galaxies-famous-curated' } as SourceRef,
  structures: { datasetId: 'galaxies-structures-curated' } as SourceRef,
  images: { datasetId: 'galaxies-impostors-dss2', reference: 'DSS2 colour HiPS (STScI/CDS) via CDS hips2fits', note: 'textures/galaxies/impostors.json' } as SourceRef,
  milkyway: { datasetId: 'galactic-milkyway-model', reference: 'Reid et al. 2019, ApJ 885, 131 (spiral arms)' } as SourceRef,
};

function q(value: number | null, unit: string, provenance: ProvenanceClass, sigDigits: number, source?: SourceRef, model?: string) {
  return { value: value !== null && Number.isFinite(value) ? value : null, unit, provenance, sigDigits, source, model };
}

const lyText = (mpc: number): string => {
  const ly = mpc * LY_PER_MPC;
  if (ly < 1e6) return `${Math.round(ly / 1000).toLocaleString('en')} thousand light-years`;
  if (ly < 1e9) return `${(ly / 1e6).toPrecision(ly < 1e7 ? 2 : 3)} million light-years`;
  return `${(ly / 1e9).toPrecision(3)} billion light-years`;
};

export function morphologyText(g: Galaxy): string {
  const m = g.morphology ?? '';
  if (/dSph|Sph/.test(m)) return 'Dwarf spheroidal galaxy';
  if (/dE/.test(m)) return 'Dwarf elliptical galaxy';
  if (/BCD/.test(m)) return 'Blue compact dwarf galaxy';
  if (/^Ir|^Im|irregular|dIrr|Irr/i.test(m)) return /barred/i.test(m) ? 'Barred irregular galaxy' : 'Irregular galaxy';
  if (/elliptical|^E/i.test(m)) return 'Elliptical galaxy';
  if (/S0/.test(m)) return 'Lenticular galaxy';
  if (/SB|barred/i.test(m)) return 'Barred spiral galaxy';
  if (/^S|spiral/i.test(m)) return 'Spiral galaxy';
  if (/merger|interacting/i.test(m)) return 'Interacting galaxies';
  return 'Galaxy';
}

const STRUCT_KIND_TEXT: Record<Structure['kind'], string> = {
  group: 'Galaxy group', cluster: 'Galaxy cluster', supercluster: 'Supercluster', void: 'Cosmic void', wall: 'Galaxy wall (filament)',
};

export function galaxyRadiusM(g: Galaxy): number {
  return ((g.majorAxisKpc ?? 3) * 0.5) * KPC_M;
}

export function createGalaxiesProvider(cat: GalaxyCatalog): EntityProvider {
  const cache = new Map<string, Entity>();
  const records: SearchRecord[] = [];
  for (const g of cat.galaxies) {
    records.push({ id: g.id, name: g.name, aliases: g.aliases, kind: 'galaxy', domain: DOMAIN, importance: g.importance, tagline: tagline(g) });
  }
  for (const s of cat.structures) {
    records.push({ id: s.id, name: s.name, aliases: [], kind: structKind(s), domain: DOMAIN, importance: s.id === 'struct:local-group' || s.id === 'struct:laniakea' || s.id === 'struct:virgo-cluster' ? 80 : 58, tagline: `${STRUCT_KIND_TEXT[s.kind]}, ${lyText(s.distMpc)} away` });
  }
  // Identifier index: catalogue names and aliases ("NGC 224", "M 31", "MESSIER031").
  const ident = new Map<string, string>();
  const norm = (s: string): string => s.toLowerCase().replace(/messier\s*0*/g, 'm').replace(/\s+/g, '').replace(/^(ngc|ic|ugc|eso|pgc)0+/, '$1');
  for (const g of cat.galaxies) for (const a of [g.name, ...g.aliases]) ident.set(norm(a), g.id);

  function build(id: string): Entity | undefined {
    const g = cat.byId.get(id);
    if (g) return galaxyEntity(g);
    const s = cat.structuresById.get(id);
    if (s) return structureEntity(s);
    return undefined;
  }

  return {
    domain: DOMAIN,
    resolve(id: string): Entity | undefined {
      let e = cache.get(id);
      if (!e) {
        e = build(id);
        if (e) cache.set(id, e);
      }
      return e;
    },
    searchRecords: () => records,
    resolveIdentifier(query: string): string[] {
      const hit = ident.get(norm(query));
      return hit ? [hit] : [];
    },
  };
}

function structKind(s: Structure): Entity['kind'] {
  return s.kind === 'group' ? 'galaxy-group' : s.kind === 'cluster' ? 'galaxy-cluster' : s.kind === 'supercluster' ? 'supercluster' : s.kind === 'void' ? 'void' : 'cosmic-structure';
}

function tagline(g: Galaxy): string {
  return `${morphologyText(g)}, ${lyText(g.distMpc)} away`;
}

function galaxyEntity(g: Galaxy): Entity {
  const R = galaxyRadiusM(g);
  const px = g.pos.x * MPC_M, py = g.pos.y * MPC_M, pz = g.pos.z * MPC_M;
  return {
    id: g.id, name: g.name, aliases: g.aliases, kind: 'galaxy', domain: DOMAIN, parentId: g.parentId,
    radiusM: R,
    position: (_t: number, out: THREE.Vector3) => out.set(px, py, pz),
    framingRadiusM: R * 1.15,
    viewDistance: { min: 0.08 * R, default: 3.1 * R, max: 40 * MPC_M },
    contextScaleMin: Math.log10(Math.max(R * 8, 0.05 * MPC_M)),
    tagline: tagline(g),
    capabilities: CAPS,
    importance: g.importance,
    representation: g.impostor ? 'observed' : 'illustrative',
    facts: () => galaxyFacts(g),
  };
}

function galaxyFacts(g: Galaxy): FactSheet {
  const src = g.source === 'famous' ? SRC.famous : SRC.ungc;
  const distSrc: SourceRef = { ...src, reference: g.distRef ?? src.reference };
  const props: Fact[] = [
    { key: 'type', label: 'Type', text: `${morphologyText(g)}${g.morphology ? ` (${g.morphology})` : ''}`, provenance: 'observed', source: src },
    { key: 'distance', label: 'Distance from the Sun', quantity: { ...q(g.distMpc * MPC_M, 'm', 'observed', 3, distSrc), uncertainty: g.distErrMpc !== null ? { kind: 'symmetric', sigma: g.distErrMpc * MPC_M } : undefined }, provenance: 'observed', source: distSrc, help: g.distMethod ? `Distance method: ${g.distMethod} (UNGC code; TRGB = tip of the red-giant branch, Cep = Cepheids, TF = Tully–Fisher, h = Hubble flow).` : undefined },
    { key: 'lightTravel', label: 'Light travel time', quantity: q(g.distMpc * LY_PER_MPC, 'yr', 'derived', 3, distSrc, 'distance/c@1'), provenance: 'derived', help: 'The light we see left this galaxy this many years ago.' },
    { key: 'diameter', label: 'Diameter (Holmberg / D25 isophote)', quantity: q(g.majorAxisKpc !== null ? g.majorAxisKpc * KPC_M : null, 'm', 'observed', 2, src), provenance: 'observed', source: src, help: 'Size out to a faint surface-brightness isophote; the stellar halo extends further.' },
    { key: 'angularSize', label: 'Apparent size from Earth', quantity: q(g.majorAxisArcmin, 'arcmin', 'observed', 3, src), provenance: 'observed', source: src },
    { key: 'inclination', label: 'Inclination (0° = face-on)', quantity: q(g.inclinationDeg, 'deg', 'observed', 2, src), provenance: 'observed', source: src },
    { key: 'pa', label: 'Position angle of the major axis', quantity: q(g.positionAngleDeg, 'deg', 'observed', 3, src), provenance: 'observed', source: src },
    { key: 'absMagB', label: 'Absolute magnitude (B)', quantity: q(g.absMagB, 'mag', 'derived', 3, src, 'distance-modulus@1'), provenance: 'derived', help: 'Not corrected for dust extinction.' },
    { key: 'mstar', label: 'Stellar mass', quantity: q(g.logMstarMsun !== null ? Math.pow(10, g.logMstarMsun) : null, 'M_sun', 'derived', 2, src, 'k-band-ml-0.6@1'), provenance: 'derived', help: 'From the near-infrared luminosity with a fixed mass-to-light ratio (0.6): an estimate.' },
    { key: 'mhi', label: 'Neutral hydrogen mass', quantity: q(g.logMHIMsun !== null ? Math.pow(10, g.logMHIMsun) : null, 'M_sun', 'observed', 2, SRC.ungc), provenance: 'observed', source: SRC.ungc },
    { key: 'vhelio', label: 'Radial velocity (heliocentric)', quantity: q(g.vHelioKms, 'km/s', 'observed', 3, src), provenance: 'observed', source: src, help: 'Negative = approaching us.' },
  ];
  if (g.bhMassMsun !== null) props.push({ key: 'bh', label: 'Central black hole mass', quantity: q(g.bhMassMsun, 'M_sun', 'observed', 2, { ...SRC.famous, reference: g.bhRef ?? undefined }), provenance: 'observed', source: { ...SRC.famous, reference: g.bhRef ?? undefined } });
  if (g.mainDisturber) props.push({ key: 'disturber', label: 'Dominant neighbour', text: g.mainDisturber, provenance: 'observed', source: SRC.ungc });
  const sources: SourceRef[] = [src];
  if (g.source === 'famous' && g.mainDisturber !== null) sources.push(SRC.ungc);
  if (g.impostor) sources.push(SRC.images);
  const orient = g.orientationSource === 'catalogue' ? 'catalogued inclination and position angle'
    : g.orientationSource === 'image-moments' ? 'orientation measured from the image (no catalogue position angle)'
      : 'an illustrative orientation (not catalogued)';
  const repr = g.impostor
    ? `Observed image (DSS2 colour, foreground stars removed) projected onto the galaxy's disc plane using ${orient}. Seen from Earth's direction it matches the photograph; from other angles it is a deprojection — real galaxies are thicker, with bulges and halos.${g.impostor.file ? ' Up close it becomes a 3-D cloud of star-forming regions sampled from the same image; its thickness and bulge are a model (reconstructed), not measured.' : ''}${g.impostor.masked ? ' Companion galaxies and foreground star clusters seen on the image were removed from it (they are shown at their own positions).' : ''}`
    : `Glow with the catalogued size and brightness, ${g.spheroid ? 'spheroidal' : `a disc shape with ${orient}`}; no image is used. Distant galaxies are drawn brighter than true scaling (1/d instead of 1/d²) so they stay visible.`;
  return {
    entityId: g.id,
    summary: `${g.name} is ${/^[AEIOU]/.test(morphologyText(g)) ? 'an' : 'a'} ${morphologyText(g).toLowerCase()} ${lyText(g.distMpc)} away${g.majorAxisKpc !== null ? `, about ${Math.round(g.majorAxisKpc * 3.2616).toLocaleString('en')} thousand light-years across` : ''}.`,
    sections: [{ id: 'properties', title: 'Properties', facts: props }],
    representation: { provenance: g.impostor ? 'observed' : 'illustrative', description: repr },
    sources,
    epoch: { label: 'Positions J2000.0 (ICRS)' },
    missing: [g.majorAxisKpc === null ? 'Diameter' : '', g.inclinationDeg === null ? 'Inclination' : '', g.positionAngleDeg === null ? 'Position angle' : '', g.distErrMpc === null ? 'Distance uncertainty' : ''].filter(Boolean),
    assumptions: ['Positions are fixed: galaxy motions over a human lifetime are far below what can be shown.', 'Distances are the catalogue values; Local-Volume distances are rounded to 0.01 Mpc in the UNGC.'],
  };
}

/** Unit vector perpendicular to the Milky Way -> centre axis (tilted 25 deg toward the north side): a side-on view. */
function sideOnDir(p: { x: number; y: number; z: number }): readonly [number, number, number] {
  const n = Math.hypot(p.x, p.y, p.z) || 1;
  const ax = [p.x / n, p.y / n, p.z / n];
  // u = ax x Z (normalized), w = u x ax
  const ul = Math.hypot(ax[1], ax[0]) || 1;
  const u = [ax[1] / ul, -ax[0] / ul, 0];
  const w = [u[1] * ax[2] - u[2] * ax[1], u[2] * ax[0] - u[0] * ax[2], u[0] * ax[1] - u[1] * ax[0]];
  const d = [0.9 * u[0] + 0.42 * w[0], 0.9 * u[1] + 0.42 * w[1], 0.9 * u[2] + 0.42 * w[2]];
  const dl = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / dl, d[1] / dl, d[2] / dl];
}

function structureEntity(s: Structure): Entity {
  const R = s.radiusMpc * MPC_M;
  const px = s.pos.x * MPC_M, py = s.pos.y * MPC_M, pz = s.pos.z * MPC_M;
  return {
    id: s.id, name: s.name, aliases: [], kind: structKind(s), domain: DOMAIN, parentId: s.parentId,
    // Not a solid body: no radiusM (it would occlude labels and stop the camera at the 'surface'); size via framingRadiusM.
    radiusM: null,
    position: (_t: number, out: THREE.Vector3) => out.set(px, py, pz),
    framingRadiusM: R,
    viewDistance: { min: 0.3 * R, default: (s.id === 'struct:local-group' ? 1.5 : 2.6) * R, max: 3000 * MPC_M },
    contextScaleMin: Math.log10(R * 2.2),
    approachDir: s.id === 'struct:local-group' ? sideOnDir(s.pos) : undefined,
    tagline: `${STRUCT_KIND_TEXT[s.kind]}, ${lyText(s.distMpc)} away`,
    capabilities: CAPS,
    importance: s.id === 'struct:local-group' || s.id === 'struct:laniakea' ? 80 : 58,
    representation: s.positionQuality === 'catalogued' ? 'observed' : 'illustrative',
    facts: (): FactSheet => ({
      entityId: s.id,
      summary: s.description,
      sections: [{
        id: 'properties', title: 'Properties', facts: [
          { key: 'kind', label: 'Type', text: STRUCT_KIND_TEXT[s.kind], provenance: 'observed', source: SRC.structures },
          { key: 'distance', label: 'Distance from the Sun (centre)', quantity: q(s.distMpc * MPC_M, 'm', s.redshift !== null ? 'derived' : 'observed', 3, SRC.structures, s.redshift !== null ? 'flat-lcdm@1' : undefined), provenance: s.redshift !== null ? 'derived' : 'observed', source: SRC.structures, help: s.redshift !== null ? 'Comoving distance from the redshift with the Planck 2018 cosmology.' : undefined },
          { key: 'redshift', label: 'Redshift', quantity: q(s.redshift, '', 'observed', 3, SRC.structures), provenance: 'observed', source: SRC.structures },
          { key: 'radius', label: 'Characteristic radius', quantity: q(R, 'm', 'observed', 2, SRC.structures), provenance: 'observed', source: SRC.structures },
          { key: 'members', label: 'Members (indicative)', quantity: q(s.members, '', 'observed', 2, SRC.structures), provenance: 'observed', source: SRC.structures, help: s.membersNote ?? undefined },
          { key: 'position', label: 'Centre position', text: s.positionQuality === 'catalogued' ? 'Catalogued' : 'Approximate (illustrative centre)', provenance: s.positionQuality === 'catalogued' ? 'observed' : 'illustrative', source: SRC.structures },
        ],
      }],
      representation: {
        provenance: s.positionQuality === 'catalogued' ? 'observed' : 'illustrative',
        description: 'Marked by a label at its catalogued centre; the galaxies themselves come from the UNGC, 2MRS and DESI catalogues. Superclusters, voids and walls have no sharp edges: centres and sizes are indicative.',
      },
      sources: [{ ...SRC.structures, reference: s.refs.join('; ') }],
      assumptions: ['Positions from redshift are in redshift space (peculiar velocities not removed): galaxy clusters appear as thin streaks pointing back at the Milky Way ("fingers of God"). This is a real measurement effect, not a rendering error.'],
    }),
  };
}
