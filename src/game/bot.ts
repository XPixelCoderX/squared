/**
 * CUBIC — bot opponent.
 *
 * The bot plays the locked-layer game with the same rules as a human: it only
 * ever returns legal moves, and the layer rotation is part of the search tree.
 *
 *  easy   — random legal move (with the occasional obvious win)
 *  medium — immediate tactics plus a depth-3 search
 *  hard   — iterative deepening alpha-beta with a "live line" eval
 */

import {
  LINES,
  type CellValue,
  type GameState,
  type Player,
  applyMove,
  coords,
  legalMoves,
  otherPlayer,
  winningLineFor,
} from "./rules";

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const MAX_SCORE = 1_000_000;

/* ------------------------------------------------------------------- eval */

/** which layer (0..8) a line lies in, -1 when the line crosses layers */
function planeIndexOfLine(line: readonly number[]): number {
  for (let family = 0; family < 3; family++) {
    const offset = coords(line[0])[family];
    if (line.every((c) => coords(c)[family] === offset)) return family * 3 + offset;
  }
  return -1;
}

const LINE_PLANE: readonly number[] = LINES.map(planeIndexOfLine);

/** every layer weighted by how likely it still is to be played in */
function planeAvailability(board: readonly number[]): number[] {
  const avail = new Array<number>(9).fill(1);
  for (let family = 0; family < 3; family++) {
    for (let offset = 0; offset < 3; offset++) {
      let filled = 0;
      for (let i = 0; i < board.length; i++) {
        if (coords(i)[family] === offset && board[i] !== 0) filled++;
      }
      avail[family * 3 + offset] = Math.max(0.15, 1 - filled / 9);
    }
  }
  return avail;
}

function evaluate(state: GameState, me: Player): number {
  const board = state.board;
  const avail = planeAvailability(board as number[]);
  const opp = otherPlayer(me);
  let score = 0;

  for (let l = 0; l < LINES.length; l++) {
    const line = LINES[l];
    const plane = LINE_PLANE[l];
    const weight = plane >= 0 ? avail[plane] : 0.8;
    let mine = 0;
    let theirs = 0;
    let empty = 0;
    for (const c of line) {
      const v = board[c];
      if (v === me) mine++;
      else if (v === opp) theirs++;
      else empty++;
    }
    if (mine > 0 && theirs > 0) continue; // dead line
    if (theirs === 0 && mine > 0) score += (mine === 2 ? 6 : empty === 2 ? 1 : 0) * weight;
    else if (mine === 0 && theirs > 0) {
      score -= (theirs === 2 ? 9 : empty === 2 ? 1.15 : 0) * weight;
    }
  }

  // central cells touch the most lines
  for (let i = 0; i < board.length; i++) {
    const mark = board[i];
    if (mark === 0) continue;
    const [x, y, z] = coords(i);
    const centrality = 3 - (Math.abs(x - 1) + Math.abs(y - 1) + Math.abs(z - 1));
    score += (mark === me ? 1 : -1) * centrality * 0.12;
  }
  return score;
}

/* ----------------------------------------------------------------- search */

interface Budget {
  deadline: number;
  nodes: number;
  maxNodes: number;
  /** set when a search was cut short: values from a cut subtree are unreliable */
  aborted: boolean;
}

function outOfTime(budget: Budget): boolean {
  if (budget.nodes > budget.maxNodes || Date.now() > budget.deadline) {
    budget.aborted = true;
    return true;
  }
  return false;
}

function search(
  state: GameState,
  me: Player,
  depth: number,
  alpha: number,
  beta: number,
  budget: Budget,
): number {
  if (state.status === "won") return state.winner === me ? MAX_SCORE : -MAX_SCORE;
  if (state.status === "draw") return 0;
  if (depth <= 0) return evaluate(state, me) * 8;
  if (outOfTime(budget)) return evaluate(state, me) * 8;

  if (state.turn === me) {
    let best = -Infinity;
    for (const m of orderMoves(state, me)) {
      budget.nodes++;
      const child = applyMove(state, m);
      const v = child.status === "won" && child.winner === me
        ? MAX_SCORE
        : search(child, me, depth - 1, alpha, beta, budget);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = Infinity;
  for (const m of orderMoves(state, otherPlayer(me))) {
    budget.nodes++;
    const child = applyMove(state, m);
    const v = child.status === "won" && child.winner !== me
      ? -MAX_SCORE
      : search(child, me, depth - 1, alpha, beta, budget);
    if (v < best) best = v;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** move ordering: wins first, then blocks, then central / many-line cells */
function orderMoves(state: GameState, mover: Player): number[] {
  const opp = otherPlayer(mover);
  return legalMoves(state)
    .map((m) => {
      const board = state.board.slice() as CellValue[];
      let s = linesThrough(m);
      board[m] = mover;
      if (winningLineFor(board, m)) s += 1000;
      board[m] = opp;
      if (winningLineFor(board, m)) s += 500;
      board[m] = 0;
      return { m, s };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

const LINES_THROUGH: readonly number[] = (() => {
  const table = new Array<number>(27).fill(0);
  for (const line of LINES) for (const c of line) table[c]++;
  return table;
})();

function linesThrough(cell: number): number {
  return LINES_THROUGH[cell];
}

/* -------------------------------------------------------------- public API */

export interface BotOptions {
  /** how long the hard bot may think (ms) */
  timeBudgetMs?: number;
  random?: () => number;
}

/** the currently winning moves for `player` that are also legal right now */
export function immediateWins(state: GameState, player: Player): number[] {
  const out: number[] = [];
  for (const m of legalMoves(state)) {
    const board = state.board.slice() as CellValue[];
    board[m] = player;
    if (winningLineFor(board, m)) out.push(m);
  }
  return out;
}

export function chooseBotMove(
  state: GameState,
  difficulty: Difficulty,
  options: BotOptions = {},
): number {
  const rng = options.random ?? Math.random;
  const moves = legalMoves(state);
  if (moves.length === 0) throw new Error("no legal moves");
  if (moves.length === 1) return moves[0];

  const me: Player = state.turn;
  const wins = immediateWins(state, me);

  if (difficulty === "easy") {
    if (wins.length > 0 && rng() < 0.65) return pick(wins, rng);
    return pick(moves, rng);
  }

  if (difficulty === "medium") {
    if (wins.length > 0) return pick(wins, rng);
    const blocks = immediateWins(state, otherPlayer(me));
    if (blocks.length > 0 && state.moveCount > 1) return pick(blocks, rng);
    const budget: Budget = {
      deadline: Date.now() + 250,
      nodes: 0,
      maxNodes: 40_000,
      aborted: false,
    };
    const result = bestMove(state, me, 3, budget, rng);
    // when the shallow search is cut short the ordered fallback is still sound
    return result.move;
  }

  if (wins.length > 0) return pick(wins, rng);

  const total = options.timeBudgetMs ?? 220;
  const start = Date.now();
  const budget: Budget = {
    deadline: start + total,
    nodes: 0,
    maxNodes: 400_000,
    aborted: false,
  };
  // the first entry of the ordering is already a sane move to fall back on
  let best = orderMoves(state, me)[0];
  for (let depth = 2; depth <= 12; depth++) {
    const result = bestMove(state, me, depth, budget, rng);
    if (result.complete) best = result.move;
    // never start a depth we cannot hope to finish
    if (result.aborted || Date.now() - start > total * 0.55) break;
  }
  return best;
}

function bestMove(
  state: GameState,
  me: Player,
  depth: number,
  budget: Budget,
  rng: () => number,
): { move: number; complete: boolean; aborted: boolean } {
  const moves = orderMoves(state, me);
  let alpha = -Infinity;
  let bestScore = -Infinity;
  const best: number[] = [];
  let complete = true;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const child = applyMove(state, m);
    budget.aborted = false;
    const v =
      child.status === "won" && child.winner === me
        ? MAX_SCORE
        : search(child, me, depth - 1, alpha, Infinity, budget);

    if (budget.aborted) {
      // this move's value is only a partial bound — ignore it and the rest
      complete = false;
      break;
    }
    if (v > bestScore) {
      bestScore = v;
      best.length = 0;
      best.push(m);
    } else if (v === bestScore) {
      best.push(m);
    }
    if (v > alpha) alpha = v;
  }

  const move = best.length > 0 ? pick(best, rng) : moves[0];
  return { move, complete, aborted: budget.aborted };
}

function pick(list: readonly number[], rng: () => number): number {
  return list[Math.floor(rng() * list.length) % list.length];
}
