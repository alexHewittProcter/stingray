import * as THREE from 'three';
import type { Hud } from './hud';
import type { GameState } from '../sim/launch';
import { type Interactable, lineAt, nearestUsable } from '../sim/interactables';

// Phase 3, M5 presentation: while sim/interactables.ts nearestUsable is non-null the HUD shows "E · {prompt}" low
// centre and the prop glows faintly (an emissive lift, no outline shader); the flavour line shows while combat.t is
// before its `until`. Nothing here touches the sim.
//
// Which object is a prop: any Object3D under the root with `userData.interactable = '<id>'` (T4 and T5 tag their
// drawn props; the tag may sit on a group — every mesh under it glows). Until a prop is tagged, an interactable with
// no tagged object falls back to T1's greybox block nearest its pos (meshes named 'prop' or 'chair', within
// FALLBACK_REACH), tagged once on first use — so the greybox rooms glow too.

/** The emissive added to a highlighted prop's materials — faint, warm. */
const GLOW = new THREE.Color(0x3a3014);
const FALLBACK_REACH = 1.0; // m from the interactable's pos to the greybox block's box
const FALLBACK_NAMES = new Set(['prop', 'chair']);

interface Glowing {
  original: THREE.Material | THREE.Material[];
  lit: THREE.Material | THREE.Material[];
}

/**
 * Light or unlight every mesh under `object` (M5's glow). The first time a mesh is lit its material is cloned with
 * the emissive lifted (materials are shared between props, so the lift must not touch the original); unlit restores
 * the original. A material with no emissive (MeshBasicMaterial) is lightened instead.
 */
export function highlight(object: THREE.Object3D, on: boolean): void {
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    let glow = o.userData.glow as Glowing | undefined;
    if (!glow) {
      if (!on) return;
      const original = o.material as THREE.Material | THREE.Material[];
      glow = { original, lit: Array.isArray(original) ? original.map(lift) : lift(original) };
      o.userData.glow = glow;
    }
    o.material = on ? glow.lit : glow.original;
  });
}

function lift(m: THREE.Material): THREE.Material {
  const lit = m.clone();
  if ('emissive' in lit && lit.emissive instanceof THREE.Color) lit.emissive.add(GLOW);
  else if ('color' in lit && lit.color instanceof THREE.Color) lit.color.lerp(new THREE.Color(0xffffff), 0.15);
  return lit;
}

/** The objects under root tagged `userData.interactable === id`. */
export function tagged(root: THREE.Object3D, id: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.interactable === id) found.push(o);
  });
  return found;
}

export interface InteractView {
  /** Once per drawn frame: the prompt, the glow and the flavour line for this state. */
  update(g: GameState): void;
}

export function createInteractView(root: THREE.Object3D, hud: Pick<Hud, 'showPrompt' | 'showLine'>, list: readonly Interactable[]): InteractView {
  let lit: { id: string; objects: THREE.Object3D[] } | null = null;
  const box = new THREE.Box3();
  const point = new THREE.Vector3();

  const objectsFor = (it: Interactable): THREE.Object3D[] => {
    const found = tagged(root, it.id);
    if (found.length > 0) return found;
    // T1 greybox fallback: the untagged block nearest the pos.
    point.set(it.pos.x, it.pos.y + 0.3, it.pos.z);
    let best: THREE.Object3D | null = null;
    let bestD = FALLBACK_REACH;
    root.updateMatrixWorld();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !FALLBACK_NAMES.has(o.name) || o.userData.interactable !== undefined) return;
      const d = box.setFromObject(o).distanceToPoint(point);
      if (d <= bestD) [best, bestD] = [o, d];
    });
    if (best === null) return [];
    (best as THREE.Object3D).userData.interactable = it.id;
    return [best];
  };

  return {
    update(g) {
      const usable = nearestUsable(g.troy, list);
      hud.showPrompt(usable?.prompt ?? null);
      if ((usable?.id ?? null) !== (lit?.id ?? null)) {
        if (lit) for (const o of lit.objects) highlight(o, false);
        lit = usable ? { id: usable.id, objects: objectsFor(usable) } : null;
        if (lit) for (const o of lit.objects) highlight(o, true);
      }
      hud.showLine(g.troy.where === 'onFoot' ? lineAt(g.hud, g.combat.t) : null);
    },
  };
}
