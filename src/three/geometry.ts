/**
 * CUBIC — geometry helpers.
 *
 * The board is a 3x3x3 lattice with one unit between cell centres, centred on
 * the world origin: cell coords {0,1,2}^3 map to world {-1,0,1}^3.
 *
 * Everything in here is plain maths (no WebGL), so it can be unit tested.
 */

import { Vector3 } from "three";
import { type Plane, coordOf, coords, familyIndex, idx } from "../game/rules";

export const CUBE_EXTENT = 1.5; // 3x3x3 cube spans -1.5 .. 1.5
export const MARKER_RADIUS = 0.3;
export const DEFAULT_CAMERA_RADIUS = 6.2;
export const MIN_CAMERA_RADIUS = 4.2;
export const MAX_CAMERA_RADIUS = 14;

const AXIS_VECTORS: readonly Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, 1),
];

/** tilt direction per axis family: the camera sits a little to this side */
const LATERAL: readonly Vector3[] = [
  new Vector3(0, 0.38, 0.92).normalize(), // X layers: seen from the front
  new Vector3(0.16, 0, 0.99).normalize(), // Y layers: seen from the front
  new Vector3(0.52, 0.38, 0).normalize(), // Z layers: seen from the right
];

/** how straight down the layer axis the camera looks (0.8 ≈ 37° off axis) */
const ALONG = 0.8;

export function cellWorldPosition(cell: number): Vector3 {
  const [x, y, z] = coords(cell);
  return new Vector3(x - 1, y - 1, z - 1);
}

export function cellWorldPositionInto(cell: number, target: Vector3): Vector3 {
  const [x, y, z] = coords(cell);
  return target.set(x - 1, y - 1, z - 1);
}

/** signed world coordinate of a layer plane along its axis (-1, 0 or 1) */
export function layerConstant(plane: Plane): number {
  return plane.offset - 1;
}

export function planeNormalVector(plane: Plane): Vector3 {
  return AXIS_VECTORS[familyIndex(plane.family)].clone();
}

/**
 * Camera direction to view a layer from: mostly along the layer's axis but
 * tilted sideways, so the nine slots read as a grid instead of a flat line and
 * the other layers separate visually.
 */
export function layerViewDirection(plane: Plane): Vector3 {
  const axis = AXIS_VECTORS[familyIndex(plane.family)];
  // offset 0 -> look along -axis, else along +axis
  const sign = plane.offset === 0 ? -1 : 1;
  const lateral = LATERAL[familyIndex(plane.family)];
  return new Vector3()
    .copy(axis)
    .multiplyScalar(sign * ALONG)
    .addScaledVector(lateral, Math.sqrt(Math.max(0, 1 - ALONG * ALONG)))
    .normalize();
}

/** the point the camera looks at: the centre of the active layer */
export function layerViewTarget(plane: Plane): Vector3 {
  return AXIS_VECTORS[familyIndex(plane.family)].clone().multiplyScalar(plane.offset - 1);
}

/**
 * Screen-up for a layer view. Looking almost straight down an axis makes the
 * default "up = +Y" degenerate (and would roll the camera by 90°), so the up
 * vector is the sideways tilt direction pushed out of the view direction. The
 * far side of the layer ends up at the top of the screen.
 */
export function layerViewUp(plane: Plane): Vector3 {
  const direction = layerViewDirection(plane);
  const lateral = LATERAL[familyIndex(plane.family)];
  const up = lateral.clone().multiplyScalar(-1).addScaledVector(direction, lateral.dot(direction));
  if (up.lengthSq() < 1e-6) return new Vector3(0, 1, 0);
  return up.normalize();
}

export interface ViewFrame {
  position: Vector3;
  target: Vector3;
  up: Vector3;
}

export function viewFrame(plane: Plane, radius: number): ViewFrame {
  const direction = layerViewDirection(plane);
  const target = layerViewTarget(plane);
  return {
    position: direction.multiplyScalar(radius).add(target),
    target,
    up: layerViewUp(plane),
  };
}

/** frame the whole cube (the default / reset view) */
export function overviewFrame(radius: number): ViewFrame {
  const position = new Vector3(0.72, 0.5, 0.92).normalize().multiplyScalar(radius);
  return { position, target: new Vector3(0, 0, 0), up: new Vector3(0, 1, 0) };
}

/**
 * Pick the slot under a ray inside the given layer.
 *
 * The ray is intersected with the (infinite) plane of the layer; the hit point
 * is snapped to the nearest lattice cell. A result is only returned when the
 * cell is in `legal`, so clicking can never suggest an impossible move.
 */
export function pickCellOnPlane(
  rayOrigin: Vector3,
  rayDirection: Vector3,
  plane: Plane,
  legal: readonly number[],
): number | null {
  const normal = planeNormalVector(plane);
  const denom = normal.dot(rayDirection);
  if (Math.abs(denom) < 1e-6) return null;

  const constant = layerConstant(plane);
  const t = (constant - normal.dot(rayOrigin)) / denom;
  if (t <= 0) return null;

  const hit = new Vector3().copy(rayDirection).multiplyScalar(t).add(rayOrigin);

  const lateral: number[] = [];
  for (let i = 0; i < 3; i++) {
    if (familyIndex(plane.family) === i) continue;
    lateral.push(hit.getComponent(i));
  }

  const reach = CUBE_EXTENT + 0.3;
  if (lateral.some((v) => Math.abs(v) > reach)) return null;

  const snapped = lateral.map((v) => Math.min(2, Math.max(0, Math.round(v + 1))));
  let cell: number;
  if (plane.family === "x") cell = idx(plane.offset, snapped[0], snapped[1]);
  else if (plane.family === "y") cell = idx(snapped[0], plane.offset, snapped[1]);
  else cell = idx(snapped[0], snapped[1], plane.offset);

  return legal.includes(cell) ? cell : null;
}

/** 1-based layer labels of a cell, matching the UI ("X1 Y2 Z3") */
export function cellLayerNames(cell: number): string {
  return `X${coordOf(cell, "x") + 1} Y${coordOf(cell, "y") + 1} Z${coordOf(cell, "z") + 1}`;
}
