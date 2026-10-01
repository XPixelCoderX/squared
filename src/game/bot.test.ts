import { describe, expect, it } from "vitest";
import { type Difficulty, chooseBotMove, immediateWins } from "./bot";
import {
  type CellValue,
  type GameState,
  applyMove,
  createGame,
  idx,
  isLegal,

} from "./rules";

const DIFFS: Difficulty[] = ["easy", "medium", "hard"];

/** deterministic rng so a failure is reproducible */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function stateOf(board: CellValue[], turn: 1 | 2): GameState {
  return {
    board,
    turn,
    active: { family: "z", offset: 0 },
    freeMove: false,
    moveCount: board.filter((v) => v !== 0).length,
    lastMove: null,
    status: "playing",
    winner: 0,
    winLine: null,
  };
}

describe("bot move legality", () => {
  for (const difficulty of DIFFS) {
    it(`${difficulty} only ever plays legal moves`, () => {
      for (let game = 0; game < 25; game++) {
        let state = createGame();
        const random = rng(game * 977 + 13);
        let plies = 0;
        while (state.status === "playing" && plies++ < 30) {
          const move = chooseBotMove(state, difficulty, { random, timeBudgetMs: 20 });
          expect(isLegal(state, move)).toBe(true);
          state = applyMove(state, move);
        }
        expect(plies).toBeLessThanOrEqual(28);
      }
    });
  }
});

describe("bot tactics", () => {
  it("takes an immediate win instead of blocking", () => {
    const board = new Array<CellValue>(27).fill(0);
    board[idx(0, 0, 0)] = 1;
    board[idx(1, 1, 0)] = 1;
    board[idx(0, 2, 0)] = 2;
    board[idx(1, 2, 0)] = 2;
    const state = stateOf(board, 1);
    // both sides threaten (2,2,0); X to move simply wins
    expect(immediateWins(state, 2)).toContain(idx(2, 2, 0));
    const move = chooseBotMove(state, "hard", { random: rng(7), timeBudgetMs: 60 });
    expect(move).toBe(idx(2, 2, 0));
  });

  it("blocks the only threat when it has none of its own", () => {
    const board = new Array<CellValue>(27).fill(0);
    board[idx(0, 1, 0)] = 1;
    board[idx(2, 0, 0)] = 1;
    board[idx(1, 2, 0)] = 2;
    board[idx(2, 2, 0)] = 2; // threatens (0,2,0)
    const state = stateOf(board, 1);
    expect(immediateWins(state, 2)).toEqual([idx(0, 2, 0)]);
    const move = chooseBotMove(state, "hard", { random: rng(5), timeBudgetMs: 60 });
    expect(move).toBe(idx(0, 2, 0));
  });

  it("beats the easy bot as player two", () => {
    for (let game = 0; game < 5; game++) {
      const random = rng(game * 17 + 101);
      let state = createGame();
      while (state.status === "playing") {
        const difficulty: Difficulty = state.turn === 1 ? "easy" : "hard";
        state = applyMove(state, chooseBotMove(state, difficulty, { random, timeBudgetMs: 60 }));
      }
      expect(state.winner).not.toBe(1);
    }
  });
});

describe("self play", () => {
  it("always finishes within 27 plies", () => {
    for (let game = 0; game < 10; game++) {
      let state = createGame();
      const random = rng(game * 31 + 5);
      let plies = 0;
      while (state.status === "playing" && plies < 30) {
        const difficulty: Difficulty = plies % 2 === 0 ? "hard" : "medium";
        state = applyMove(state, chooseBotMove(state, difficulty, { random, timeBudgetMs: 40 }));
        plies++;
      }
      expect(state.status === "won" || state.status === "draw").toBe(true);
      expect(plies).toBeLessThanOrEqual(27);
    }
  });
});
