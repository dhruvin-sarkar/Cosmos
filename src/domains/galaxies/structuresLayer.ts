/**
 * Large-scale structure annotations ('galaxies:structures'): labels for groups, clusters, superclusters, voids and
 * walls (structures.json), plus a dotted, view-facing circle of the characteristic radius for superclusters, voids and
 * walls — dotted because their extents are illustrative (VISUAL_DIRECTION "provenance texture"). Annotations sit in
 * the overlay group and follow the 'labels' overlay.
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, LabelCandidate, Layer, PickHit } from '../../core/types';
import { MPC_M } from '../../core/units';
import type { LocalGalaxiesLayer } from './localLayer';
import type { Structure } from './catalog';
import { structureLabelOpacity } from './fade';

const SEG = 96;
const MAX_RENDER_DEPTH = 1e14;
const RING_KINDS = new Set(['supercluster', 'void', 'wall']);

const VOID_TINT = [0.55, 0.62, 0.75] as const;
const RING_TINT = [0.78, 0.72, 0.6] as const;

export function createStructuresLayer(local: LocalGalaxiesLayer): Layer {
  let svc: EngineServices | null = null;
  let rings: THREE.LineSegments | null = null;
  let ringPos: Float32Array | null = null;
  let ringCol: Float32Array | null = null;
  let ringStructs: Structure[] = [];
  const scratch = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const sp = { x: 0, y: 0, depthM: 0, visible: false };

  function build(structs: Structure[]): void {
    ringStructs = structs.filter((s) => RING_KINDS.has(s.kind));
    const n = ringStructs.length * SEG * 2;
    ringPos = new Float32Array(n * 3);
    ringCol = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(ringCol, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    rings = new THREE.LineSegments(geo, mat);
    rings.frustumCulled = false;
    svc!.groups.overlay.add(rings);
  }

  return {
    id: 'galaxies:structures',
    init(s: EngineServices): void {
      svc = s;
    },

    update(ctx: FrameContext): void {
      const cat = local.catalog;
      if (!svc || !cat) return;
      if (!rings) build(cat.structures);
      if (!rings || !ringPos || !ringCol) return;
      // Every ring kind is faded out below ~22.4 (Local Group scales): skip the per-frame rebuild (perf).
      const show = ctx.overlays.labels && ctx.scaleLog10 > 22.4 && ctx.scaleLog10 < 26.4;
      rings.visible = show;
      if (!show) return;
      const camR = ctx.cameraPosition.length();
      const k = Math.min(1, (MAX_RENDER_DEPTH * ctx.metersPerUnit) / (camR + 400 * MPC_M));
      const toUnits = k / ctx.metersPerUnit;
      right.set(1, 0, 0).applyQuaternion(ctx.cameraQuaternion);
      up.set(0, 1, 0).applyQuaternion(ctx.cameraQuaternion);
      let v = 0;
      for (const s of ringStructs) {
        const op = structureLabelOpacity(s.kind, ctx.scaleLog10) * 0.16;
        const R = s.radiusMpc * MPC_M;
        const cx = (s.pos.x * MPC_M - ctx.cameraPosition.x) * toUnits;
        const cy = (s.pos.y * MPC_M - ctx.cameraPosition.y) * toUnits;
        const cz = (s.pos.z * MPC_M - ctx.cameraPosition.z) * toUnits;
        const r = R * toUnits;
        const tint = s.kind === 'void' ? VOID_TINT : RING_TINT;
        for (let i = 0; i < SEG; i++) {
          // Dotted: draw every other segment.
          const on = i % 2 === 0 ? op : 0;
          for (let e = 0; e < 2; e++) {
            const a = ((i + e) / SEG) * Math.PI * 2;
            const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
            ringPos[v * 3] = cx + ca * right.x + sa * up.x;
            ringPos[v * 3 + 1] = cy + ca * right.y + sa * up.y;
            ringPos[v * 3 + 2] = cz + ca * right.z + sa * up.z;
            ringCol[v * 3] = tint[0] * on; ringCol[v * 3 + 1] = tint[1] * on; ringCol[v * 3 + 2] = tint[2] * on;
            v++;
          }
        }
      }
      const g = rings.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    },

    collectLabels(ctx: FrameContext, out: LabelCandidate[]): void {
      const cat = local.catalog;
      if (!cat || ctx.scaleLog10 < 22.4) return;
      for (const s of cat.structures) {
        const op = structureLabelOpacity(s.kind, ctx.scaleLog10);
        if (op < 0.05) continue;
        scratch.set(s.pos.x, s.pos.y, s.pos.z).multiplyScalar(MPC_M);
        ctx.project(scratch, sp);
        if (!sp.visible) continue;
        const d = Math.max(scratch.distanceTo(ctx.cameraPosition), 1);
        const rPx = (s.radiusMpc * MPC_M / d) * ctx.pixelsPerRadian;
        const name = s.positionQuality === 'approximate' && RING_KINDS.has(s.kind) ? `${s.name} (approx.)` : s.name;
        out.push({
          entityId: s.id, text: name, x: sp.x, y: sp.y, kind: 'structure',
          priority: (s.id === 'struct:laniakea' || s.id === 'struct:virgo-cluster' || s.id === 'struct:great-attractor' || s.id === 'struct:coma-cluster' ? 70 : 52) + (s.kind === 'supercluster' ? 6 : 0),
          offsetPx: RING_KINDS.has(s.kind) ? Math.min(rPx, 400) * 0.0 : 8, opacity: op,
          detail: `${s.distMpc < 100 ? s.distMpc.toFixed(s.distMpc < 10 ? 1 : 0) : Math.round(s.distMpc)} Mpc`,
        });
      }
    },

    pick(ctx: FrameContext, x: number, y: number, radiusPx: number): PickHit[] {
      const cat = local.catalog;
      const hits: PickHit[] = [];
      if (!cat) return hits;
      for (const s of cat.structures) {
        if (structureLabelOpacity(s.kind, ctx.scaleLog10) < 0.2) continue;
        scratch.set(s.pos.x, s.pos.y, s.pos.z).multiplyScalar(MPC_M);
        ctx.project(scratch, sp);
        if (!sp.visible) continue;
        const dd = Math.hypot(sp.x - x, sp.y - y);
        if (dd <= radiusPx * 1.5) hits.push({ entityId: s.id, distancePx: dd, depthM: sp.depthM, priority: 40 });
      }
      return hits;
    },

    dispose(): void {
      if (rings) {
        rings.removeFromParent();
        rings.geometry.dispose();
        (rings.material as THREE.Material).dispose();
      }
    },
  };
}
