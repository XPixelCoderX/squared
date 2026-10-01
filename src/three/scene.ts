/**
 * CUBIC — the 3D board.
 *
 * Rendering, camera orbit (right button drag, left drag, wheel, pinch) and the
 * "game lock" choreography: whenever the active layer changes, the camera
 * swings onto that layer and the layer lights up.
 */

import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type BufferGeometry as BufferGeometryType,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  type CellValue,
  type Plane,
  type Player,
  type Status,
  cellsOfPlane,
  nextPlane,
  planeNormal,
  planeShort,
} from "../game/rules";
import {
  type ViewFrame,
  DEFAULT_CAMERA_RADIUS,
  MARKER_RADIUS,
  MAX_CAMERA_RADIUS,
  MIN_CAMERA_RADIUS,
  cellWorldPosition,
  overviewFrame,
  pickCellOnPlane,
  viewFrame,
} from "./geometry";

const PLAYER_COLOR: Record<Player, number> = { 1: 0xff4d6d, 2: 0x38d5ff };
const FAMILY_COLOR: Record<Plane["family"], number> = {
  x: 0xff9a63,
  y: 0x79f2a8,
  z: 0x8fa6ff,
};

const MIN_RADIUS = MIN_CAMERA_RADIUS;
const MAX_RADIUS = MAX_CAMERA_RADIUS;
const DEFAULT_RADIUS = DEFAULT_CAMERA_RADIUS;
const OVERVIEW_RADIUS = DEFAULT_CAMERA_RADIUS + 1;

export interface BoardView {
  board: readonly CellValue[];
  active: Plane;
  legal: readonly number[];
  lastMove: number | null;
  winLine: readonly number[] | null;
  currentPlayer: Player;
  status: Status;
  freeMove: boolean;
  /** false while the bot is thinking or the game is over */
  inputEnabled: boolean;
}

export interface SceneCallbacks {
  onCellChosen: (cell: number) => void;
  onHoverChange?: (cell: number | null) => void;
  onOrbitStart?: () => void;
}

interface DragState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  orbiting: boolean;
  button: number;
}

interface LabelRecord {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  key: string;
}

export class CubicScene {
  private readonly container: HTMLElement;
  private readonly callbacks: SceneCallbacks;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly raycaster = new Raycaster();

  private readonly cubeGroup = new Group();
  private readonly markers: Mesh[] = [];
  private readonly markerMaterials: MeshStandardMaterial[] = [];
  private readonly rings: Mesh[] = [];
  private readonly ringMaterials: MeshBasicMaterial[] = [];
  private readonly hitVolumes: Mesh[] = [];

  private readonly markerGeometries: Record<Player, BufferGeometryType>;
  private readonly ghost: Mesh;
  private readonly ghostMaterial: MeshStandardMaterial;
  private readonly slab: Mesh;
  private readonly slabMaterial: MeshBasicMaterial;
  private readonly slabEdge: Group;
  private readonly slabEdgeMaterial: MeshBasicMaterial;
  private readonly nextEdge: Group;
  private readonly nextEdgeMaterial: MeshBasicMaterial;
  private readonly grid: Group;
  private readonly gridMaterial: MeshBasicMaterial;
  private readonly winBeam: Mesh;
  private readonly winBeamMaterial: MeshBasicMaterial;
  private readonly activeLabel: Sprite;
  private readonly activeLabelMaterial: SpriteMaterial;
  private readonly activeLabelRecord: LabelRecord;
  private readonly backdropTexture: CanvasTexture;

  private readonly displayed = new Array<CellValue>(27).fill(0);
  private readonly markerScale = new Array<number>(27).fill(1);
  private readonly markerTarget = new Array<number>(27).fill(1);

  private view: BoardView | null = null;
  private hoverCell: number | null = null;
  private readonly pointer = new Vector2();
  private pointerInside = false;
  private pointerDragged = false;
  private readonly drags = new Map<number, DragState>();
  private pinchDistance: number | null = null;

  private azimuth = 0.62;
  private polar = 1.02;
  private radius = DEFAULT_RADIUS;
  private readonly lookAt = new Vector3();
  private targetAzimuth = 0.62;
  private targetPolar = 1.02;
  private targetRadius = DEFAULT_RADIUS;
  private readonly targetLookAt = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly targetUp = new Vector3(0, 1, 0);
  /** screen-space shift (px) that centres the board in the free area */
  private readonly framing = new Vector2();

  private clock = 0;
  private lastFrame = 0;
  private frameHandle = 0;
  private disposed = false;
  private lockFlash = 0;

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.domElement.classList.add("cubic-canvas");
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x05070e);
    this.scene.fog = new Fog(0x05070e, 16, 34);

    this.camera = new PerspectiveCamera(45, 1, 0.1, 200);

    this.scene.add(new HemisphereLight(0x9fb6ff, 0x0a0d18, 1.15));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const rim = new DirectionalLight(0x6f8dff, 0.75);
    rim.position.set(-6, -4, -5);
    this.scene.add(rim);

    this.backdropTexture = makeRadialTexture("#111c38", "#04060c");
    this.scene.add(
      new Mesh(
        new SphereGeometry(58, 32, 16),
        new MeshBasicMaterial({ map: this.backdropTexture, side: BackSide, depthWrite: false, fog: false }),
      ),
    );
    this.scene.add(buildStars());
    this.scene.add(this.cubeGroup);
    this.scene.add(buildWireCube());

    this.slabMaterial = new MeshBasicMaterial({
      color: FAMILY_COLOR.y,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: DoubleSide,
    });
    this.slab = new Mesh(new PlaneGeometry(3.02, 3.02), this.slabMaterial);
    this.slab.renderOrder = -2;
    this.cubeGroup.add(this.slab);

    this.slabEdgeMaterial = new MeshBasicMaterial({
      color: FAMILY_COLOR.y,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.slabEdge = buildLayerFrame(3.24, 0.05, this.slabEdgeMaterial);
    this.cubeGroup.add(this.slabEdge);

    this.nextEdgeMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.nextEdge = buildLayerFrame(3.14, 0.022, this.nextEdgeMaterial);
    this.nextEdge.visible = false;
    this.cubeGroup.add(this.nextEdge);

    // the tic-tac-toe grid of the active game
    this.gridMaterial = new MeshBasicMaterial({
      color: 0xdfe8ff,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.grid = buildLayerGrid(3, 0.011, this.gridMaterial);
    this.cubeGroup.add(this.grid);

    this.markerGeometries = {
      1: new IcosahedronGeometry(MARKER_RADIUS, 0),
      2: new SphereGeometry(MARKER_RADIUS, 24, 16),
    };

    this.ghostMaterial = new MeshStandardMaterial({
      color: PLAYER_COLOR[1],
      emissive: PLAYER_COLOR[1],
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    this.ghost = new Mesh(this.markerGeometries[1], this.ghostMaterial);
    this.ghost.visible = false;
    this.cubeGroup.add(this.ghost);

    for (let cell = 0; cell < 27; cell++) {
      const material = new MeshStandardMaterial({
        color: PLAYER_COLOR[1],
        emissive: PLAYER_COLOR[1],
        emissiveIntensity: 0.24,
        roughness: 0.3,
        metalness: 0.12,
        transparent: true,
        opacity: 1,
      });
      const mesh = new Mesh(this.markerGeometries[1], material);
      mesh.position.copy(cellWorldPosition(cell));
      mesh.visible = false;
      mesh.scale.setScalar(0.01);
      this.cubeGroup.add(mesh);
      this.markers.push(mesh);
      this.markerMaterials.push(material);

      const hit = new Mesh(
        new BoxGeometry(0.98, 0.98, 0.98),
        new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.position.copy(cellWorldPosition(cell));
      hit.visible = false;
      hit.userData.cell = cell;
      this.cubeGroup.add(hit);
      this.hitVolumes.push(hit);

      const ringMaterial = new MeshBasicMaterial({
        color: 0xdfe8ff,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: DoubleSide,
      });
      const ring = new Mesh(new RingGeometry(0.3, 0.375, 32), ringMaterial);
      ring.position.copy(cellWorldPosition(cell));
      ring.visible = false;
      this.cubeGroup.add(ring);
      this.rings.push(ring);
      this.ringMaterials.push(ringMaterial);
    }

    this.winBeamMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.winBeam = new Mesh(
      new CylinderGeometry(0.06, 0.06, 1, 12, 1, true),
      this.winBeamMaterial,
    );
    this.winBeam.visible = false;
    this.cubeGroup.add(this.winBeam);

    this.activeLabelRecord = makeTextTexture("", "#e8ecff");
    this.activeLabelMaterial = new SpriteMaterial({
      map: this.activeLabelRecord.texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.activeLabel = new Sprite(this.activeLabelMaterial);
    this.activeLabel.scale.set(0.66, 0.33, 1);
    this.activeLabel.visible = false;
    this.cubeGroup.add(this.activeLabel);

    this.attachEvents();
    this.resize();
    this.lastFrame = performance.now();
    this.animate();
  }

  /* --------------------------------------------------------------- public */

  setState(view: BoardView): void {
    const previous = this.view;
    this.view = view;

    const activeCells = new Set(cellsOfPlane(view.active));
    const legal = new Set(view.legal);
    const winCells = new Set(view.winLine ?? []);
    const playing = view.status === "playing";

    for (let cell = 0; cell < 27; cell++) {
      const value = view.board[cell];
      if (value !== this.displayed[cell]) {
        this.displayed[cell] = value;
        const marker = this.markers[cell];
        marker.visible = value !== 0;
        if (value !== 0) {
          this.markerScale[cell] = 0.04;
          this.markerTarget[cell] = 1;
        }
      }

      const material = this.markerMaterials[cell];
      material.color.setHex(PLAYER_COLOR[value === 0 ? 1 : (value as Player)]);
      material.emissive.setHex(PLAYER_COLOR[value === 0 ? 1 : (value as Player)]);

      const inActive = activeCells.has(cell);
      const dimmed = value !== 0 && !inActive && playing && winCells.size === 0;
      material.opacity = dimmed ? 0.24 : 1;
      material.depthWrite = !dimmed;
      material.emissiveIntensity = winCells.has(cell) ? 1.2 : inActive ? 0.45 : 0.14;

      const showRing = playing && legal.has(cell);
      this.rings[cell].visible = showRing;
      this.hitVolumes[cell].visible = showRing;
      this.ringMaterials[cell].opacity = showRing ? 0.18 : 0;
    }

    this.orientLayer(this.slab, view.active, 0);
    this.orientLayer(this.slabEdge, view.active, 0.03);
    this.orientLayer(this.grid, view.active, 0.015);
    this.grid.visible = playing;
    this.gridMaterial.opacity = 0.1 + (view.freeMove ? 0 : 0.06);
    const familyColor = FAMILY_COLOR[view.active.family];
    this.slabMaterial.color.setHex(familyColor);
    this.slabMaterial.opacity = playing ? 0.1 : 0.05;
    this.slabEdgeMaterial.color.setHex(familyColor);
    this.slabEdgeMaterial.opacity = playing ? 0.7 : 0.22;
    this.nextEdge.visible = false;
    this.nextEdgeMaterial.opacity = 0;

    this.setActiveLabel(planeShort(view.active), playing);

    if (view.winLine && view.winLine.length >= 2) {
      const a = cellWorldPosition(view.winLine[0]);
      const b = cellWorldPosition(view.winLine[view.winLine.length - 1]);
      const dir = b.clone().sub(a);
      this.winBeam.visible = true;
      this.winBeam.position.copy(a).add(b).multiplyScalar(0.5);
      this.winBeam.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
      this.winBeam.scale.set(1, dir.length(), 1);
    } else {
      this.winBeam.visible = false;
    }

    if (
      previous &&
      (previous.active.family !== view.active.family || previous.active.offset !== view.active.offset)
    ) {
      this.lockFlash = 1;
    }

    this.updateHoverGhost();
  }

  /** swing the camera onto a layer */
  focusOn(plane: Plane, immediate = false): void {
    // coming from the zoomed-out overview, ease back to the play distance;
    // a deliberate zoom-in by the player is preserved
    if (this.targetRadius > DEFAULT_RADIUS + 0.4) this.targetRadius = DEFAULT_RADIUS;
    this.applyFrame(viewFrame(plane, this.targetRadius), immediate);
  }

  /** frame a finished winning line */
  focusLine(cells: readonly number[]): void {
    if (cells.length < 2) return;
    const a = cellWorldPosition(cells[0]);
    const b = cellWorldPosition(cells[cells.length - 1]);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).normalize();
    const up = new Vector3(0, 1, 0);
    const side = new Vector3().crossVectors(dir, up);
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    side.normalize();
    const view = side.multiplyScalar(0.82).addScaledVector(up, 0.45).normalize();
    const radius = clamp(Math.min(this.targetRadius, 6.6), MIN_RADIUS, MAX_RADIUS);
    this.targetRadius = radius;
    this.applyFrame(
      {
        position: view.multiplyScalar(radius).add(mid),
        target: mid.clone(),
        up: new Vector3(0, 1, 0),
      },
      false,
    );
  }

  resetView(immediate = false): void {
    this.targetRadius = OVERVIEW_RADIUS;
    this.applyFrame(overviewFrame(OVERVIEW_RADIUS), immediate);
  }

  /**
   * Offset the rendered frame so the cube sits in the middle of the area that
   * is not covered by the HUD/panel. Values are pixels in screen space: how far
   * the free area's centre is from the viewport centre (y down).
   */
  setFramingShift(xPixels: number, yPixels: number): void {
    this.framing.set(xPixels, yPixels);
  }

  setHoverCell(cell: number | null): void {
    if (this.hoverCell === cell) return;
    this.hoverCell = cell;
    this.updateHoverGhost();
    this.callbacks.onHoverChange?.(cell);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.onResize);
    const el = this.renderer.domElement;
    el.removeEventListener("contextmenu", this.onContextMenu);
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    el.removeEventListener("wheel", this.onWheel);
    this.backdropTexture.dispose();
    this.activeLabelRecord.texture.dispose();
    this.renderer.dispose();
    el.remove();
  }

  /* -------------------------------------------------------------- visuals */

  private applyFrame(frame: ViewFrame, immediate: boolean): void {
    const dir = frame.position.clone().sub(frame.target);
    const azimuth = Math.atan2(dir.x, dir.z);
    const polar = Math.acos(Math.min(1, Math.max(-1, dir.normalize().y)));
    this.targetAzimuth = this.nearestEquivalent(azimuth);
    this.targetPolar = polar;
    this.targetLookAt.copy(frame.target);
    this.targetUp.copy(frame.up);
    if (immediate) {
      this.azimuth = this.targetAzimuth;
      this.polar = this.targetPolar;
      this.radius = this.targetRadius;
      this.lookAt.copy(this.targetLookAt);
      this.up.copy(this.targetUp);
    }
  }

  private updateHoverGhost(): void {
    const view = this.view;
    const cell = this.hoverCell;
    const canPlay = !!view && view.inputEnabled && view.status === "playing";

    if (!canPlay || cell === null || !view || !view.legal.includes(cell)) {
      this.ghost.visible = false;
      this.nextEdge.visible = false;
      this.nextEdgeMaterial.opacity = 0;
      // while the board is not accepting input, keep the slots of the active
      // game faintly marked so the locked-in area stays readable
      const idle = !!view && view.status === "playing";
      for (let i = 0; i < 27; i++) {
        if (!this.rings[i].visible) continue;
        this.ringMaterials[i].opacity = idle ? (view!.inputEnabled ? 0.18 : 0.08) : 0;
      }
      return;
    }

    const player = view.currentPlayer;
    this.ghostMaterial.color.setHex(PLAYER_COLOR[player]);
    this.ghostMaterial.emissive.setHex(PLAYER_COLOR[player]);
    this.ghost.geometry = this.markerGeometries[player];
    this.ghost.position.copy(cellWorldPosition(cell));
    this.ghost.visible = true;

    const target = nextPlane(view.active, cell);
    this.orientLayer(this.nextEdge, target, 0.06);
    this.nextEdgeMaterial.color.setHex(FAMILY_COLOR[target.family]);
    this.nextEdge.visible = true;
    this.nextEdgeMaterial.opacity = 0.45;

    for (let i = 0; i < 27; i++) {
      if (!this.rings[i].visible) continue;
      this.ringMaterials[i].opacity = i === cell ? 0.8 : 0.18;
    }
  }

  private setActiveLabel(text: string, visible: boolean): void {
    if (this.activeLabelRecord.key !== text) {
      replaceTextTexture(this.activeLabelRecord, text, "#e8ecff");
    }
    this.activeLabel.visible = visible;
  }

  private orientLayer(object: Object3D, plane: Plane, along: number): void {
    const normal = new Vector3(...planeNormal(plane));
    const sign = plane.offset === 0 ? -1 : 1;
    const constant = plane.offset - 1 + along * sign;
    object.position.copy(normal).multiplyScalar(constant);
    if (plane.family === "x") object.rotation.set(0, Math.PI / 2, 0);
    else if (plane.family === "y") object.rotation.set(-Math.PI / 2, 0, 0);
    else object.rotation.set(0, 0, 0);

    if (plane.family === "y") this.activeLabel.position.set(1.9, constant, -1.7);
    else if (plane.family === "x") this.activeLabel.position.set(constant, 1.9, -1.7);
    else this.activeLabel.position.set(1.9, 1.7, constant);
  }

  /* -------------------------------------------------------------- events */

  private attachEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener("contextmenu", this.onContextMenu);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("resize", this.onResize);
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private onResize = (): void => {
    this.resize();
  };

  private resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.pointerInside = true;
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.updatePointer(event);
    this.drags.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      orbiting: event.button === 2,
      button: event.button,
    });
    this.pointerDragged = false;
    if (this.drags.size === 2) this.pinchDistance = this.pinchDistanceNow();
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.updatePointer(event);
    const state = this.drags.get(event.pointerId);

    if (this.drags.size === 2) {
      const distance = this.pinchDistanceNow();
      if (this.pinchDistance !== null && distance !== null && this.pinchDistance > 1) {
        this.targetRadius = clamp(
          this.targetRadius * (this.pinchDistance / Math.max(1, distance)),
          MIN_RADIUS,
          MAX_RADIUS,
        );
      }
      this.pinchDistance = distance;
      return;
    }

    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    state.x = event.clientX;
    state.y = event.clientY;

    if (
      !state.orbiting &&
      Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 6
    ) {
      state.orbiting = true;
      this.pointerDragged = true;
      this.setHoverCell(null);
      this.callbacks.onOrbitStart?.();
    }
    if (state.orbiting) {
      // same handedness as three's OrbitControls: drag right spins the cube right
      this.targetAzimuth -= dx * 0.0075;
      this.targetPolar = clamp(this.targetPolar - dy * 0.0075, 0.14, Math.PI - 0.14);
      // dragging should track the cursor closely
      this.azimuth += (this.targetAzimuth - this.azimuth) * 0.5;
      this.polar += (this.targetPolar - this.polar) * 0.5;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const state = this.drags.get(event.pointerId);
    this.drags.delete(event.pointerId);
    if (this.drags.size < 2) this.pinchDistance = null;
    if (!state) return;

    this.updatePointer(event);
    const view = this.view;
    const isClick = !state.orbiting && !this.pointerDragged && state.button === 0;
    if (isClick && view && view.inputEnabled && view.status === "playing") {
      const cell = this.pickAtPointer();
      if (cell !== null) this.callbacks.onCellChosen(cell);
    }
  };

  private onPointerLeave = (): void => {
    this.pointerInside = false;
    this.setHoverCell(null);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.targetRadius = clamp(
      this.targetRadius * Math.exp(event.deltaY * 0.0011),
      MIN_RADIUS,
      MAX_RADIUS,
    );
  };

  private pinchDistanceNow(): number | null {
    const points = Array.from(this.drags.values());
    if (points.length < 2) return null;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  /* ------------------------------------------------------------- picking */

  private pickAtPointer(): number | null {
    const view = this.view;
    if (!view) return null;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const direct = pickCellOnPlane(
      this.raycaster.ray.origin.clone(),
      this.raycaster.ray.direction.clone(),
      view.active,
      view.legal,
    );
    if (direct !== null) return direct;

    const visible = this.hitVolumes.filter((volume) => volume.visible);
    const hits = this.raycaster.intersectObjects(visible, false);
    if (hits.length > 0) {
      const cell = hits[0].object.userData.cell as number;
      if (view.legal.includes(cell)) return cell;
    }
    return null;
  }

  /* --------------------------------------------------------------- frame */

  private animate = (): void => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.animate);

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.clock += dt;

    const ease = 1 - Math.exp(-dt * 6.5);
    this.azimuth += (this.targetAzimuth - this.azimuth) * ease;
    this.polar += (this.targetPolar - this.polar) * ease;
    this.radius += (this.targetRadius - this.radius) * ease;
    this.lookAt.lerp(this.targetLookAt, ease);

    this.up.lerp(this.targetUp, ease).normalize();

    // shift the whole camera so the board lands in the visible area
    const focus = this.lookAt.clone();
    if (this.framing.lengthSq() > 0.01) {
      const height = this.container.clientHeight || window.innerHeight;
      const worldPerPixel = (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.radius) / height;
      const forward = this.sphericalOffset();
      const right = new Vector3().crossVectors(forward, this.up).normalize();
      focus.addScaledVector(right, -this.framing.x * worldPerPixel);
      focus.addScaledVector(this.up, this.framing.y * worldPerPixel);
    }

    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      focus.x + this.radius * sinPolar * Math.sin(this.azimuth),
      focus.y + this.radius * Math.cos(this.polar),
      focus.z + this.radius * sinPolar * Math.cos(this.azimuth),
    );
    this.camera.up.copy(this.up);
    this.camera.lookAt(focus);

    if (this.pointerInside && this.view?.inputEnabled && this.drags.size === 0) {
      this.setHoverCell(this.pickAtPointer());
    }

    for (let cell = 0; cell < 27; cell++) {
      const scale = this.markerScale[cell];
      const target = this.markerTarget[cell];
      if (Math.abs(scale - target) > 0.002) {
        this.markerScale[cell] = scale + (target - scale) * (1 - Math.exp(-dt * 14));
        const progress = Math.min(1, this.markerScale[cell]);
        const overshoot = 1 + Math.sin(progress * Math.PI) * 0.14;
        this.markers[cell].scale.setScalar(this.markerScale[cell] * overshoot);
      }
    }

    const breathe = 0.5 + Math.sin(this.clock * 2.1) * 0.5;

    if (this.lockFlash > 0) {
      this.lockFlash = Math.max(0, this.lockFlash - dt * 1.5);
      const pulse = 1 + this.lockFlash * 0.25;
      this.slabEdge.scale.set(pulse, pulse, 1);
      this.slabMaterial.opacity = (this.view?.status === "playing" ? 0.1 : 0.05) + this.lockFlash * 0.18;
    }

    if (this.view?.status === "playing") {
      this.slabEdgeMaterial.color.setHex(FAMILY_COLOR[this.view.active.family]);
      this.slabEdgeMaterial.opacity = 0.45 + breathe * 0.35;
    }

    if (this.ghost.visible) {
      this.ghost.scale.setScalar(0.94 + Math.sin(this.clock * 5) * 0.05);
    }
    if (this.hoverCell !== null && this.rings[this.hoverCell].visible) {
      this.ringMaterials[this.hoverCell].opacity = 0.72 + Math.sin(this.clock * 6) * 0.14;
      this.rings[this.hoverCell].scale.setScalar(1 + Math.sin(this.clock * 6) * 0.04);
    }
    if (this.winBeam.visible) this.winBeamMaterial.opacity = 0.5 + breathe * 0.45;
    if (this.activeLabel.visible) this.activeLabelMaterial.opacity = 0.7 + breathe * 0.3;

    this.renderer.render(this.scene, this.camera);
  };

  /** unit vector from the camera towards the target */
  private sphericalOffset(): Vector3 {
    const sinPolar = Math.sin(this.polar);
    return new Vector3(
      -sinPolar * Math.sin(this.azimuth),
      -Math.cos(this.polar),
      -sinPolar * Math.cos(this.azimuth),
    );
  }

  private nearestEquivalent(azimuth: number): number {
    const twoPi = Math.PI * 2;
    const delta = (((azimuth - this.azimuth + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
    return this.azimuth + delta;
  }
}

/* ------------------------------------------------------------- utilities */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildLayerFrame(size: number, thickness: number, material: MeshBasicMaterial): Group {
  const group = new Group();
  const half = size / 2;
  const bars: Array<[number, number, number, number]> = [
    [0, half, size, thickness],
    [0, -half, size, thickness],
    [half, 0, thickness, size],
    [-half, 0, thickness, size],
  ];
  for (const [x, y, sx, sy] of bars) {
    const bar = new Mesh(new BoxGeometry(sx, sy, thickness), material);
    bar.position.set(x, y, 0);
    group.add(bar);
  }
  return group;
}

/** the 2x2 inner lines that turn a layer into a 3x3 board */
function buildLayerGrid(size: number, thickness: number, material: MeshBasicMaterial): Group {
  const group = new Group();
  const positions = [-size / 6, size / 6];
  for (const p of positions) {
    const horizontal = new Mesh(new BoxGeometry(size, thickness, thickness), material);
    horizontal.position.set(0, p, 0);
    group.add(horizontal);
    const vertical = new Mesh(new BoxGeometry(thickness, size, thickness), material);
    vertical.position.set(p, 0, 0);
    group.add(vertical);
  }
  return group;
}

function buildWireCube(): Group {
  const group = new Group();
  const material = new MeshBasicMaterial({
    color: 0x5f7099,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const span = 3;
  const t = 0.013;
  const bars: Array<[number, number, number, number, number, number]> = [];
  for (const a of [-span / 2, span / 2]) {
    for (const b of [-span / 2, span / 2]) {
      bars.push([a, b, 0, t, t, span]);
      bars.push([a, 0, b, t, span, t]);
      bars.push([0, a, b, span, t, t]);
    }
  }
  for (const [x, y, z, sx, sy, sz] of bars) {
    const bar = new Mesh(new BoxGeometry(sx, sy, sz), material);
    bar.position.set(x, y, z);
    group.add(bar);
  }
  return group;
}

function buildStars(): Points {
  const count = 520;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const dir = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(17 + Math.random() * 20);
    positions[i * 3] = dir.x;
    positions[i * 3 + 1] = dir.y;
    positions[i * 3 + 2] = dir.z;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  return new Points(
    geometry,
    new PointsMaterial({
      color: 0x9db4e0,
      size: 0.12,
      transparent: true,
      opacity: 0.5,
      sizeAttenuation: true,
      fog: false,
    }),
  );
}

function makeRadialTexture(inner: string, outer: string): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function makeTextTexture(text: string, color: string): LabelRecord {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const record: LabelRecord = { canvas, texture, key: "" };
  replaceTextTexture(record, text, color);
  return record;
}

function replaceTextTexture(record: LabelRecord, text: string, color: string): void {
  const ctx = record.canvas.getContext("2d")!;
  ctx.clearRect(0, 0, record.canvas.width, record.canvas.height);
  ctx.font = "700 80px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillText(text, record.canvas.width / 2, record.canvas.height / 2);
  record.texture.needsUpdate = true;
  record.key = text;
}
