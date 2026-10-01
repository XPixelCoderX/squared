import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { ALL_PLANES, cellsOfPlane, coords, idx, planeAtIndex } from "../game/rules";
import { cellWorldPosition, pickCellOnPlane, viewFrame } from "./geometry";

describe("cell positions", () => {
  it("maps the lattice onto world space", () => {
    expect(cellWorldPosition(idx(0, 0, 0)).toArray()).toEqual([-1, -1, -1]);
    expect(cellWorldPosition(idx(2, 2, 2)).toArray()).toEqual([1, 1, 1]);
    expect(cellWorldPosition(idx(1, 1, 1)).toArray()).toEqual([0, 0, 0]);
  });
});

describe("picking after the camera locked onto a game", () => {
  // for each of the 9 games: use the exact camera frame the app animates to,
  // then "click" the projected screen position of each of that layer's cells
  for (const plane of ALL_PLANES) {
    it(`hits the right cell in layer ${plane.family}${plane.offset}`, () => {
      const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 100);
      const frame = viewFrame(plane, 7);
      camera.position.copy(frame.position);
      camera.lookAt(frame.target);
      camera.updateMatrixWorld(true);

      const legal = cellsOfPlane(plane);
      const raycaster = new Raycaster();

      for (const cell of legal) {
        const ndc = cellWorldPosition(cell).project(camera);
        raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
        const picked = pickCellOnPlane(
          raycaster.ray.origin.clone(),
          raycaster.ray.direction.clone(),
          plane,
          legal,
        );
        expect(picked, `layer ${plane.family}${plane.offset} cell ${cell} ${coords(cell)}`).toBe(cell);
      }
    });
  }

  it("ignores clicks outside the cube, behind the camera, and illegal cells", () => {
    const plane = { family: "y" as const, offset: 1 };
    const legal = cellsOfPlane(plane);
    // straight down through the middle of the centre cell
    expect(pickCellOnPlane(new Vector3(0, 5, 0), new Vector3(0, -1, 0), plane, legal)).toBe(
      idx(1, 1, 1),
    );
    // way off to the side: outside the 3x3 area
    expect(pickCellOnPlane(new Vector3(9, 5, 0), new Vector3(0, -1, 0), plane, legal)).toBeNull();
    // ray pointing away from the layer
    expect(pickCellOnPlane(new Vector3(0, -5, 0), new Vector3(0, -1, 0), plane, legal)).toBeNull();
    // not a legal destination -> no pick
    expect(pickCellOnPlane(new Vector3(0, 5, 0), new Vector3(0, -1, 0), plane, [])).toBeNull();
    // a ray parallel to the layer never hits it
    expect(pickCellOnPlane(new Vector3(0, 5, 0), new Vector3(1, 0, 0), plane, legal)).toBeNull();
  });

  it("only ever returns legal cells", () => {
    for (let p = 0; p < 9; p++) {
      const plane = planeAtIndex(p);
      const cells = cellsOfPlane(plane);
      const legal = cells.slice(0, 4);
      for (const cell of cells) {
        const origin = cellWorldPosition(cell).add(new Vector3(0.13, 4, 0.07));
        const picked = pickCellOnPlane(origin, new Vector3(0, -1, 0), plane, legal);
        expect(picked === null || legal.includes(picked)).toBe(true);
      }
    }
  });
});
