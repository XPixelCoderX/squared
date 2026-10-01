import { describe, expect, it } from "vitest";
import {
  ALL_PLANES,
  CELL_COUNT,
  LINES,
  LINES_BY_CELL,
  type CellValue,
  type GameState,
  applyMove,
  cellsOfPlane,
  coords,
  createGame,
  findWinner,
  idx,
  isLegal,
  legalMoves,
  linesOfPlane,
  planeAt,
  planeCells,
  planeIndex,
  planeShort,
  planeTitle,
  planeAtIndex,
} from "./rules";

function stateWith(board: CellValue[], active: GameState["active"], turn: 1 | 2): GameState {
  const filled = board.filter((v) => v !== 0).length;
  return {
    board,
    turn,
    active,
    freeMove: false,
    moveCount: filled,
    lastMove: null,
    status: "playing",
    winner: 0,
    winLine: null,
  };
}

describe("the cube", () => {
  it("has 27 cells and 49 winning lines", () => {
    expect(CELL_COUNT).toBe(27);
    expect(LINES).toHaveLength(49);
  });

  it("has 27 axis lines, 18 face diagonals and 4 space diagonals", () => {
    const counts = [0, 0, 0, 0];
    for (const line of LINES) {
      const a = coords(line[0]);
      const b = coords(line[1]);
      const nonZero = [0, 1, 2].filter((k) => b[k] - a[k] !== 0).length;
      counts[nonZero]++;
    }
    expect(counts[1]).toBe(27);
    expect(counts[2]).toBe(18);
    expect(counts[3]).toBe(4);
  });

  it("never repeats a line and covers every cell", () => {
    expect(new Set(LINES.map((l) => l.join("-"))).size).toBe(LINES.length);
    expect(LINES_BY_CELL).toHaveLength(27);
    for (let i = 0; i < 27; i++) expect(LINES_BY_CELL[i].length).toBeGreaterThan(0);
  });

  it("has 9 layers of 9 cells; each family of 3 partitions the cube", () => {
    expect(ALL_PLANES).toHaveLength(9);
    for (const plane of ALL_PLANES) {
      expect(cellsOfPlane(plane)).toHaveLength(9);
      expect(linesOfPlane(plane)).toHaveLength(8);
    }
    for (const family of ["x", "y", "z"] as const) {
      const seen = new Set<number>();
      for (const plane of ALL_PLANES.filter((p) => p.family === family)) {
        for (const c of planeCells(plane)) {
          expect(seen.has(c)).toBe(false);
          seen.add(c);
        }
      }
      expect(seen.size).toBe(27);
    }
  });

  it("puts the right number of cells in each layer of a family", () => {
    expect(planeCells({ family: "x", offset: 0 })).toHaveLength(9);
  });

  it("round-trips the layer keys the UI uses", () => {
    for (const plane of ALL_PLANES) {
      expect(planeAtIndex(planeIndex(plane))).toEqual(plane);
      expect(planeAt(planeShort(plane).toLowerCase())).toEqual(plane);
      expect(planeTitle(plane)).toMatch(/^[XYZ] · /);
    }
    expect(planeAt("nope")).toBeNull();
    expect(planeAt("q1")).toBeNull();
    expect(planeAt("x9")).toBeNull();
  });

  it("indexes cells consistently", () => {
    for (let i = 0; i < CELL_COUNT; i++) {
      expect(idx(...coords(i))).toBe(i);
    }
  });
});

describe("turn lock", () => {
  it("starts in the middle Y layer", () => {
    const g = createGame();
    expect(g.active).toEqual({ family: "y", offset: 1 });
    expect(legalMoves(g)).toHaveLength(9);
  });

  it("locks the next player into the layer through the played cell", () => {
    let g = createGame();
    g = applyMove(g, idx(2, 1, 2)); // inside Y1 -> next family is Z
    expect(g.active).toEqual({ family: "z", offset: 2 });
    g = applyMove(g, idx(0, 0, 2)); // inside Z2 -> next family is X
    expect(g.active).toEqual({ family: "x", offset: 0 });
    g = applyMove(g, idx(0, 2, 1)); // inside X0 -> back to Y
    expect(g.active).toEqual({ family: "y", offset: 2 });
  });

  it("rejects clicks outside the active layer", () => {
    const g = createGame();
    expect(isLegal(g, idx(0, 0, 0))).toBe(false);
    expect(() => applyMove(g, idx(0, 0, 0))).toThrow();
    expect(isLegal(g, idx(1, 1, 1))).toBe(true);
  });

  it("gives a free move when the active layer is full", () => {
    const board = new Array<CellValue>(27).fill(0);
    for (const c of cellsOfPlane({ family: "y", offset: 0 })) board[c] = 1;
    board[idx(0, 1, 1)] = 2;
    const g = stateWith(board, { family: "y", offset: 0 }, 2);
    // all 9 cells of the active layer are taken -> the whole cube opens up
    const everywhere: number[] = [];
    for (let i = 0; i < 27; i++) if (board[i] === 0) everywhere.push(i);
    expect(legalMoves(g).sort((a, b) => a - b)).toEqual(everywhere.sort((a, b) => a - b));
    const next = applyMove(g, idx(2, 1, 1));
    expect(next.freeMove).toBe(false);
    expect(next.active).toEqual({ family: "z", offset: 1 });
  });
});

describe("winning", () => {
  it("wins on a diagonal inside a layer", () => {
    const board = new Array<CellValue>(27).fill(0);
    board[idx(0, 0, 0)] = 1;
    board[idx(1, 1, 0)] = 1;
    board[idx(0, 1, 0)] = 2;
    board[idx(1, 0, 0)] = 2;
    board[idx(0, 2, 0)] = 2;
    const g = stateWith(board, { family: "z", offset: 0 }, 1);
    const done = applyMove(g, idx(2, 2, 0));
    expect(done.status).toBe("won");
    expect(done.winner).toBe(1);
    expect(done.winLine?.slice().sort()).toEqual(
      [idx(0, 0, 0), idx(1, 1, 0), idx(2, 2, 0)].sort(),
    );
  });

  it("detects a space diagonal", () => {
    const board = new Array<CellValue>(27).fill(0);
    board[idx(0, 0, 0)] = 1;
    board[idx(1, 1, 1)] = 1;
    board[idx(2, 2, 2)] = 1;
    expect(findWinner(board).winner).toBe(1);
    expect(findWinner(board).line).toEqual([idx(0, 0, 0), idx(1, 1, 1), idx(2, 2, 2)]);
  });

  it("finds no winner on an empty board", () => {
    expect(findWinner(new Array<CellValue>(27).fill(0)).winner).toBe(0);
  });
});

describe("draws", () => {
  it("are impossible: every full cube contains a line", () => {
    // exhaustive search over all 14/13 split colourings (~8k nodes).
    // a full cube always contains 3 in a row, so a finished game always has
    // a winner — the draw branch in applyMove is only a safety net.
    expect(fullCubeWithoutLineExists()).toBe(false);
  });
});

/** exhaustive: does any 14/13 split of the cube avoid every winning line? */
function fullCubeWithoutLineExists(): boolean {
  const board = new Array<CellValue>(27).fill(0);
  const counts = { 1: 0, 2: 0 };

  const feasible = (cell: number, player: CellValue): boolean => {
    for (const li of LINES_BY_CELL[cell]) {
      const line = LINES[li];
      if (line.every((c) => c === cell || board[c] === player)) return false;
    }
    return true;
  };

  const solve = (cell: number): boolean => {
    if (cell === 27) return counts[1] === 14 && counts[2] === 13;
    const order: CellValue[] = counts[1] <= counts[2] ? [1, 2] : [2, 1];
    for (const p of order) {
      if (counts[p as 1 | 2] >= (p === 1 ? 14 : 13)) continue;
      if (!feasible(cell, p)) continue;
      board[cell] = p;
      counts[p as 1 | 2]++;
      if (solve(cell + 1)) return true;
      counts[p as 1 | 2]--;
      board[cell] = 0;
    }
    return false;
  };

  return solve(0);
}
