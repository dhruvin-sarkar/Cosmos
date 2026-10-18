/**
 * Icon vocabulary: entity kinds, provenance classes and the few astronomy glyphs lucide lacks. Custom glyphs follow
 * lucide's grammar (24-unit grid, currentColor strokes, round caps/joins) so they sit in the same family.
 */
import type { ComponentType, ReactNode, SVGProps } from 'react';
import {
  Calculator, Circle, CircleDashed, Cloud, Globe, Map as MapIcon, Moon, Network, Orbit, Paintbrush, Rocket, Satellite,
  Sparkles, Sun, Telescope, Waypoints,
} from 'lucide-react';
import type { DomainId, EntityKind } from '../core/entity';
import type { ProvenanceClass } from '../data/provenance';

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
  'aria-hidden'?: boolean | 'true' | 'false';
}

export type IconComponent = ComponentType<IconProps>;

function glyph(name: string, children: ReactNode): IconComponent {
  function Glyph({ size = 24, className, strokeWidth = 1.75, ...rest }: IconProps & SVGProps<SVGSVGElement>) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className ? `cx-icon ${className}` : 'cx-icon'}
        aria-hidden="true"
        {...rest}
      >
        {children}
      </svg>
    );
  }
  Glyph.displayName = name;
  return Glyph;
}

export const AsteroidIcon = glyph(
  'AsteroidIcon',
  <>
    <path d="M7.6 5.4c2.2-1.6 5.7-1.8 8-.3 2.3 1.5 3.9 3.8 3.5 6.7-.4 2.8-1.7 5-4.2 6.5-2.6 1.5-6 1.6-8.2-.3C4.4 16.3 3.6 13.6 4.1 10.9c.4-2.2 1.6-4.1 3.5-5.5z" />
    <circle cx="10" cy="10" r="1.6" />
    <circle cx="14.6" cy="14.2" r="1.1" />
  </>,
);

export const CometIcon = glyph(
  'CometIcon',
  <>
    <circle cx="7" cy="17" r="3" />
    <path d="M9.6 14.4 19.5 4.5" />
    <path d="M10 17.6l8.5-5.6" />
    <path d="M6.4 14l5.2-8.6" />
  </>,
);

export const DebrisIcon = glyph(
  'DebrisIcon',
  <>
    <path d="M4.5 7.5 7.8 5l1.4 3.4-3.3 1.4z" />
    <path d="M14.2 4.2l3.6 1.1-1.2 3.4-3.2-1.2z" />
    <path d="M9.2 13.4l4.2-1.1 1.1 3.5-3.4 2z" />
    <path d="M17.4 14.6l3 1.3-1.4 3.1-2.4-1.4z" />
    <path d="M4.6 17.2l2.4.8-1.6 2.2z" />
  </>,
);

/** A galaxy seen at an angle: disk with a central bulge. */
export const GalaxyIcon = glyph(
  'GalaxyIcon',
  <>
    <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-24 12 12)" />
    <ellipse cx="12" cy="12" rx="3.4" ry="2.4" transform="rotate(-24 12 12)" />
  </>,
);

/** Face-on two-armed spiral (Milky Way reconstruction). */
export const SpiralIcon = glyph(
  'SpiralIcon',
  <>
    <circle cx="12" cy="12" r="1.6" />
    <path d="M13.6 12c0 3.1-2.6 5.4-5.6 4.8-3-.6-4.6-3.6-3.6-6.9" />
    <path d="M10.4 12c0-3.1 2.6-5.4 5.6-4.8 3 .6 4.6 3.6 3.6 6.9" />
  </>,
);

export const BlackHoleIcon = glyph(
  'BlackHoleIcon',
  <>
    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    <circle cx="12" cy="12" r="6.4" />
    <ellipse cx="12" cy="12" rx="10.5" ry="3" transform="rotate(-12 12 12)" />
  </>,
);

/** Star with a band where liquid water could persist, and a planet inside it. */
export const HabitableZoneIcon = glyph(
  'HabitableZoneIcon',
  <>
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="9.6" />
    <circle cx="19.8" cy="12" r="1" fill="currentColor" />
  </>,
);

export const SpaceStationIcon = glyph(
  'SpaceStationIcon',
  <>
    <rect x="10" y="9.5" width="4" height="5" rx="1" />
    <path d="M10 12H7.5M14 12h2.5" />
    <rect x="2.5" y="7" width="5" height="10" rx="0.8" />
    <rect x="16.5" y="7" width="5" height="10" rx="0.8" />
    <path d="M12 9.5V6M12 14.5V18" />
  </>,
);

export const KIND_ICON: Record<EntityKind, IconComponent> = {
  star: Sun,
  planet: Globe,
  'dwarf-planet': Globe,
  moon: Moon,
  asteroid: AsteroidIcon,
  comet: CometIcon,
  'interstellar-object': CometIcon,
  spacecraft: Rocket,
  satellite: Satellite,
  'space-station': SpaceStationIcon,
  'rocket-body': Rocket,
  debris: DebrisIcon,
  exoplanet: Orbit,
  'stellar-system': Orbit,
  'black-hole': BlackHoleIcon,
  nebula: Cloud,
  'star-cluster': Sparkles,
  constellation: Waypoints,
  galaxy: GalaxyIcon,
  'galaxy-group': Network,
  'galaxy-cluster': Network,
  supercluster: Network,
  void: Circle,
  region: CircleDashed,
  'cosmic-structure': Network,
  reference: CircleDashed,
};

export const KIND_LABEL: Record<EntityKind, string> = {
  star: 'Star',
  planet: 'Planet',
  'dwarf-planet': 'Dwarf planet',
  moon: 'Moon',
  asteroid: 'Asteroid',
  comet: 'Comet',
  'interstellar-object': 'Interstellar object',
  spacecraft: 'Spacecraft',
  satellite: 'Satellite',
  'space-station': 'Space station',
  'rocket-body': 'Rocket body',
  debris: 'Debris',
  exoplanet: 'Exoplanet',
  'stellar-system': 'Planetary system',
  'black-hole': 'Black hole',
  nebula: 'Nebula',
  'star-cluster': 'Star cluster',
  constellation: 'Constellation',
  galaxy: 'Galaxy',
  'galaxy-group': 'Galaxy group',
  'galaxy-cluster': 'Galaxy cluster',
  supercluster: 'Supercluster',
  void: 'Cosmic void',
  region: 'Region',
  'cosmic-structure': 'Cosmic structure',
  reference: 'Reference',
};

export const DOMAIN_LABEL: Record<DomainId, string> = {
  earth: 'Earth',
  orbital: 'Earth orbit',
  solar: 'Solar System',
  stars: 'Stars',
  exoplanets: 'Exoplanets',
  galaxy: 'Milky Way',
  blackhole: 'Galactic Center',
  extragalactic: 'Galaxies',
  cosmology: 'Cosmic scale',
  sky: 'Sky',
};

export const PROVENANCE_ICON: Record<ProvenanceClass, IconComponent> = {
  observed: Telescope,
  derived: Calculator,
  reconstructed: MapIcon,
  illustrative: Paintbrush,
};

export function kindIcon(kind: EntityKind | string): IconComponent {
  return (KIND_ICON as Record<string, IconComponent>)[kind] ?? CircleDashed;
}

export function kindLabel(kind: EntityKind | string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? 'Object';
}
