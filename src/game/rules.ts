/**
 * CUBIC — game rules.
 *
 * Board: a 3x3x3 lattice = 27 cells.
 * "Games": the 9 axis aligned layers (slices) of the lattice — 3 for each axis.
 *
 * Turn structure (ultimate-tic-tac-toe style lock):
 *   - You may only play inside the ACTIVE layer.
 *   - The cell you pick locks the next player into the layer through that cell,
 *     using a rotating family order X -> Y -> Z -> X.
 *   - If the active layer is full you get a free move anywhere (never a dead end).
 *
 * Win: any straight line of three in the cube (49 lines: 27 axis, 18 coplanar
 * diagonal, 4 space diagonal).
 */

export type Player = 1 | 2;
export type CellValue = 0 | Player;
export type Family = "x" | "y" | "z";
export type Status = "playing" | "won" | "draw";

export interface Plane {
  readonly family: Family;
  readonly offset: number;
}

export interface GameState {
  /** length 27, index = idx(x, y, z) */
  readonly board: readonly CellValue[];
  readonly turn: Player;
  /** the single layer that accepts a move right now */
  readonly active: Plane;
  /** true when the active layer was full and the player may play anywhere */
  readonly freeMove: boolean;
  readonly moveCount: number;
  readonly lastMove: number | null;
  readonly status: Status;
  readonly winner: Player | 0;
  readonly winLine: readonly number[] | null;
}

export const X: Player = 1;
export const O: Player = 2;
export const CELL_COUNT = 27;
export const FAMILIES: readonly Family[] = ["x", "y", "z"];

/** layer families rotate in this order every move — that is the "lock" */
const NEXT_FAMILY: Record<Family, Family> = { x: "y", y: "z", z: "x" };

export const START_PLANE: Plane = { family: "y", offset: 1 };

/* ------------------------------------------------------------------ helpers */

export function idx(x: number, y: number, z: number): number {
  return x + 3 * y + 9 * z;
}

export function coords(i: number): [number, number, number] {
  return [i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9)];
}

export function coordOf(i: number, family: Family): number {
  const [x, y, z] = coords(i);
  return family === "x" ? x : family === "y" ? y : z;
}

export function otherPlayer(p: Player): Player {
  return p === X ? O : X;
}

export function playerName(p: Player): "X" | "O" {
  return p === X ? "X" : "O";
}

export function samePlane(a: Plane, b: Plane): boolean {
  return a.family === b.family && a.offset === b.offset;
}

export function planeKey(p: Plane): string {
  return `${p.family}${p.offset}`;
}

/** the 9 games, ordered x0 x1 x2 y0 y1 y2 z0 z1 z2 */
export const ALL_PLANES: readonly Plane[] = FAMILIES.flatMap((family) =>
  [0, 1, 2].map((offset) => ({ family, offset })),
);

export function planeCells(plane: Plane): number[] {
  const cells: number[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (coordOf(i, plane.family) === plane.offset) cells.push(i);
  }
  return cells;
}

const PLANE_CELLS = new Map<string, number[]>(
  ALL_PLANES.map((p) => [planeKey(p), planeCells(p)]),
);

export function cellsOfPlane(plane: Plane): readonly number[] {
  return PLANE_CELLS.get(planeKey(plane)) ?? planeCells(plane);
}

export function familyIndex(family: Family): 0 | 1 | 2 {
  return family === "x" ? 0 : family === "y" ? 1 : 2;
}

export function planeIndex(plane: Plane): number {
  return familyIndex(plane.family) * 3 + plane.offset;
}

export function planeAtIndex(index: number): Plane {
  return { family: FAMILIES[Math.floor(index / 3)], offset: index % 3 };
}

/**
 * Parse a short key like "y2" (used by the UI).
 * Labels are 1-based, so "y1" is the bottom Y layer (offset 0).
 */
export function planeAt(key: string): Plane | null {
  const match = /^([xyz])([1-3])$/.exec(key.toLowerCase());
  if (!match) return null;
  return { family: match[1] as Family, offset: Number(match[2]) - 1 };
}

export function planeNormal(plane: Plane): [number, number, number] {
  return [
    plane.family === "x" ? 1 : 0,
    plane.family === "y" ? 1 : 0,
    plane.family === "z" ? 1 : 0,
  ];
}

const FAMILY_TITLES: Record<Family, string> = {
  x: "X slices",
  y: "Y slices",
  z: "Z slices",
};

const OFFSET_TITLES: Record<Family, readonly string[]> = {
  x: ["Left", "Middle", "Right"],
  y: ["Bottom", "Middle", "Top"],
  z: ["Back", "Middle", "Front"],
};

export function familyTitle(family: Family): string {
  return FAMILY_TITLES[family];
}

export function planeTitle(plane: Plane): string {
  return `${plane.family.toUpperCase()} · ${OFFSET_TITLES[plane.family][plane.offset]}`;
}

/** 1-based label used everywhere in the UI: X1..X3, Y1..Y3, Z1..Z3 */
export function planeShort(plane: Plane): string {
  return `${plane.family.toUpperCase()}${plane.offset + 1}`;
}

/** where the board walks the NEXT player: the layer through the played cell */
export function nextPlane(from: Plane, cell: number): Plane {
  const family = NEXT_FAMILY[from.family];
  return { family, offset: coordOf(cell, family) };
}

/* -------------------------------------------------------------------- lines */

function inBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && x < 3 && y >= 0 && y < 3 && z >= 0 && z < 3;
}

/** all 49 winning lines of a 3x3x3 lattice */
export const LINES: readonly (readonly number[])[] = (() => {
  const dirs: Array<[number, number, number]> = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        // keep one of each opposite pair: first non zero component positive
        const first = dx !== 0 ? dx : dy !== 0 ? dy : dz;
        if (first < 0) continue;
        dirs.push([dx, dy, dz]);
      }
    }
  }

  const lines: number[][] = [];
  for (let z = 0; z < 3; z++) {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        for (const [dx, dy, dz] of dirs) {
          // start cells have no predecessor: every line is produced exactly once
          if (inBounds(x - dx, y - dy, z - dz)) continue;
          if (!inBounds(x + 2 * dx, y + 2 * dy, z + 2 * dz)) continue;
          lines.push([idx(x, y, z), idx(x + dx, y + dy, z + dz), idx(x + 2 * dx, y + 2 * dy, z + 2 * dz)]);
        }
      }
    }
  }
  return lines;
})();

export const LINES_BY_CELL: readonly (readonly number[])[] = (() => {
  const table: number[][] = Array.from({ length: CELL_COUNT }, () => []);
  LINES.forEach((line, l) => {
    for (const c of line) table[c].push(l);
  });
  return table;
})();

const PLANE_LINES = new Map<string, number[]>(
  ALL_PLANES.map((plane) => {
    const cells = new Set(cellsOfPlane(plane));
    const found: number[] = [];
    LINES.forEach((line, l) => {
      if (line.every((c) => cells.has(c))) found.push(l);
    });
    return [planeKey(plane), found];
  }),
);

/** the 8 lines drawn on a single layer (3 rows, 3 columns, 2 diagonals) */
export function linesOfPlane(plane: Plane): readonly number[] {
  return PLANE_LINES.get(planeKey(plane)) ?? [];
}

/* -------------------------------------------------------------------- state */

export function createGame(start: Plane = START_PLANE): GameState {
  return {
    board: new Array<CellValue>(CELL_COUNT).fill(0),
    turn: X,
    active: start,
    freeMove: false,
    moveCount: 0,
    lastMove: null,
    status: "playing",
    winner: 0,
    winLine: null,
  };
}

export function isFreeMove(state: GameState): boolean {
  return cellsOfPlane(state.active).every((c) => state.board[c] !== 0);
}

export function legalMoves(state: GameState): number[] {
  if (state.status !== "playing") return [];
  const inPlane = cellsOfPlane(state.active).filter((c) => state.board[c] === 0);
  if (inPlane.length > 0) return inPlane;
  const everywhere: number[] = [];
  for (let i = 0; i < CELL_COUNT; i++) if (state.board[i] === 0) everywhere.push(i);
  return everywhere;
}

export function isLegal(state: GameState, cell: number): boolean {
  return legalMoves(state).includes(cell);
}

/** the line (if any) completed by the last mark placed on `cell` */
export function winningLineFor(
  board: readonly CellValue[],
  cell: number,
): readonly number[] | null {
  const mark = board[cell];
  if (mark === 0) return null;
  for (const l of LINES_BY_CELL[cell]) {
    const line = LINES[l];
    if (board[line[0]] === mark && board[line[1]] === mark && board[line[2]] === mark) {
      return line;
    }
  }
  return null;
}

export function findWinner(board: readonly CellValue[]): {
  winner: Player | 0;
  line: readonly number[] | null;
} {
  for (const line of LINES) {
    const v = board[line[0]];
    if (v !== 0 && board[line[1]] === v && board[line[2]] === v) {
      return { winner: v, line };
    }
  }
  return { winner: 0, line: null };
}

export function applyMove(state: GameState, cell: number): GameState {
  if (state.status !== "playing") throw new Error("game already finished");
  if (!isLegal(state, cell)) throw new Error(`illegal move: cell ${cell}`);

  const board = state.board.slice() as CellValue[];
  board[cell] = state.turn;

  const line = winningLineFor(board, cell);
  const moveCount = state.moveCount + 1;

  let status: Status = "playing";
  let winner: Player | 0 = 0;
  let winLine: readonly number[] | null = null;
  if (line) {
    status = "won";
    winner = state.turn;
    winLine = line;
  } else if (moveCount === CELL_COUNT) {
    status = "draw";
  }

  const active = nextPlane(state.active, cell);
  return {
    board,
    turn: otherPlayer(state.turn),
    active,
    freeMove: status === "playing" && cellsOfPlane(active).every((c) => board[c] !== 0),
    moveCount,
    lastMove: cell,
    status,
    winner,
    winLine,
  };
}

/* --------------------------------------------------------------- analysis */

/** empty cells, inside the legal set, that would win the game right now */
export function winningMoves(state: GameState, player: Player): number[] {
  const out: number[] = [];
  for (const cell of legalMoves(state)) {
    const board = state.board.slice() as CellValue[];
    board[cell] = player;
    if (winningLineFor(board, cell)) out.push(cell);
  }
  return out;
}

/** empty cells that would complete a line for `player` if it were their turn */
export function threats(board: readonly CellValue[], player: Player): number[] {
  const out: number[] = [];
  for (const line of LINES) {
    let mine = 0;
    let empty = -1;
    let blocked = false;
    for (const c of line) {
      const v = board[c];
      if (v === player) mine++;
      else if (v === 0) empty = c;
      else blocked = true;
    }
    if (!blocked && mine === 2 && empty >= 0) out.push(empty);
  }
  return out;
}

export function marksOf(board: readonly CellValue[], player: Player): number {
  let n = 0;
  for (const v of board) if (v === player) n++;
  return n;
}

export function activeCells(state: GameState): readonly number[] {
  return cellsOfPlane(state.active);
}
