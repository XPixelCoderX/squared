/**
 * CUBIC — application glue: rules + bot + 3D scene + DOM UI.
 */

import { chooseBotMove, type Difficulty } from "../game/bot";
import {
  type GameState,
  type Plane,
  type Player,
  applyMove,
  cellsOfPlane,
  createGame,
  isLegal,
  legalMoves,
  nextPlane,
  planeAt,
  planeShort,
  planeTitle,
  playerName,
  samePlane,
} from "../game/rules";
import { CubicScene } from "../three/scene";
import { cellLayerNames } from "../three/geometry";

export type GameMode = "hotseat" | "bot";

interface HistoryEntry {
  player: Player;
  cell: number;
  painted: Plane;
  locks: Plane | null;
  free: boolean;
}

const BOT_PLAYER: Player = 2;
const BOT_DELAY_MS = 460;

export class CubicApp {
  private readonly scene: CubicScene;
  private state: GameState = createGame();
  private mode: GameMode = "hotseat";
  private difficulty: Difficulty = "medium";
  private thinking = false;
  private history: HistoryEntry[] = [];
  private inspected: Plane | null = null;
  private hoverCell: number | null = null;
  private turnToken = 0;
  private botTimer = 0;
  private introTimer = 0;
  private toastTimer = 0;
  private overlayTimer = 0;

  private readonly el: {
    viewport: HTMLElement;
    turnDot: HTMLElement;
    turnLabel: HTMLElement;
    turnSub: HTMLElement;
    freeBadge: HTMLElement;
    gamesGrid: HTMLElement;
    gamesProgress: HTMLElement;
    moveList: HTMLElement;
    modeSwitch: HTMLElement;
    difficultyRow: HTMLElement;
    difficultySwitch: HTMLElement;
    statusBanner: HTMLElement;
    statusText: HTMLElement;
    hoverChip: HTMLElement;
    hoverText: HTMLElement;
    thinking: HTMLElement;
    overlay: HTMLElement;
    overlayKicker: HTMLElement;
    overlayTitle: HTMLElement;
    overlaySub: HTMLElement;
    help: HTMLElement;
  };

  constructor() {
    this.el = {
      viewport: must("viewport"),
      turnDot: must("turn-dot"),
      turnLabel: must("turn-label"),
      turnSub: must("turn-sub"),
      freeBadge: must("free-badge"),
      gamesGrid: must("games-grid"),
      gamesProgress: must("games-progress"),
      moveList: must("move-list"),
      modeSwitch: must("mode-switch"),
      difficultyRow: must("difficulty-row"),
      difficultySwitch: must("difficulty-switch"),
      statusBanner: must("status-banner"),
      statusText: must("status-text"),
      hoverChip: must("hover-chip"),
      hoverText: must("hover-text"),
      thinking: must("thinking"),
      overlay: must("overlay"),
      overlayKicker: must("overlay-kicker"),
      overlayTitle: must("overlay-title"),
      overlaySub: must("overlay-sub"),
      help: must("help"),
    };

    this.scene = new CubicScene(this.el.viewport, {
      onCellChosen: (cell) => this.onCellChosen(cell),
      onHoverChange: (cell) => this.onHover(cell),
      onOrbitStart: () => this.hideHoverChip(),
    });

    this.bindUi();
    this.startNewGame(true);
    window.addEventListener("resize", () => this.updateFraming());
    this.updateFraming();

    this.exposeDebugApi();
  }

  /* ------------------------------------------------------------ game flow */

  private startNewGame(intro = false): void {
    this.turnToken++;
    window.clearTimeout(this.botTimer);
    window.clearTimeout(this.overlayTimer);
    window.clearTimeout(this.introTimer);
    this.state = createGame();
    this.history = [];
    this.thinking = false;
    this.inspected = null;
    this.hoverCell = null;
    this.el.overlay.hidden = true;
    this.el.thinking.hidden = true;
    this.render();

    const announce = () =>
      this.flash(
        `Locked onto ${planeShort(this.state.active)} — ${playerName(this.state.turn)} to play`,
      );

    if (intro) {
      // open on the whole cube, then lock onto the first game
      this.scene.resetView(true);
      const token = this.turnToken;
      this.introTimer = window.setTimeout(() => {
        if (token !== this.turnToken) return;
        this.scene.focusOn(this.state.active);
        announce();
      }, 750);
    } else {
      this.scene.focusOn(this.state.active);
      announce();
    }
  }

  /** keep the cube centred in the part of the screen the panels do not cover */
  private updateFraming(): void {
    const rect = this.el.viewport.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    let right = rect.width;
    let bottom = rect.height;
    let top = 0;

    const panel = document.getElementById("panel");
    if (panel) {
      const box = panel.getBoundingClientRect();
      if (box.top > rect.height * 0.25) bottom = Math.min(bottom, box.top); // bottom sheet
      else if (box.left > rect.width * 0.3) right = Math.min(right, box.left); // right rail
    }

    const hud = document.getElementById("hud");
    if (hud) {
      const box = hud.getBoundingClientRect();
      if (box.bottom < rect.height * 0.45 && box.left < rect.width * 0.6) {
        top = Math.max(top, box.bottom); // top bar
      }
    }

    bottom = Math.max(top + 0.3 * rect.height, bottom);
    right = Math.max(0.35 * rect.width, right);

    const centerX = (0 + right) / 2;
    const centerY = (top + bottom) / 2;
    this.scene.setFramingShift(centerX - rect.width / 2, centerY - rect.height / 2);
  }

  private onCellChosen(cell: number): void {
    if (this.thinking || this.state.status !== "playing") return;
    if (!this.inputEnabled() || !isLegal(this.state, cell)) return;
    this.playMove(cell);
  }

  private playMove(cell: number): void {
    const mover = this.state.turn;
    const painted = this.state.active;
    const free = !cellsOfPlane(painted).includes(cell);
    const next = applyMove(this.state, cell);
    this.history.push({
      player: mover,
      cell,
      painted,
      locks: next.status === "playing" ? next.active : null,
      free,
    });
    this.state = next;
    this.hoverCell = null;
    this.inspected = null;
    this.render();

    if (this.state.status === "playing") {
      this.scene.focusOn(this.state.active);
      if (this.state.freeMove) {
        this.flash(`Free move — ${planeShort(this.state.active)} is full, play anywhere`);
      } else {
        this.flash(`Locked onto ${planeShort(this.state.active)} — ${playerName(this.state.turn)} to play`);
      }
      this.maybeRunBot();
    } else {
      this.onGameOver();
    }
  }

  private maybeRunBot(): void {
    if (this.mode !== "bot") return;
    if (this.state.status !== "playing") return;
    if (this.state.turn !== BOT_PLAYER) return;

    const token = this.turnToken;
    this.thinking = true;
    this.render();
    this.el.thinking.hidden = false;

    const budget = this.difficulty === "hard" ? 320 : 220;
    window.clearTimeout(this.botTimer);
    this.botTimer = window.setTimeout(() => {
      if (token !== this.turnToken || this.state.status !== "playing") return;
      const move = chooseBotMove(this.state, this.difficulty, { timeBudgetMs: budget });
      this.thinking = false;
      this.el.thinking.hidden = true;
      if (token !== this.turnToken) return;
      this.playMove(move);
    }, BOT_DELAY_MS);
  }

  private onGameOver(): void {
    this.el.thinking.hidden = true;
    const win = this.state.status === "won";
    if (win && this.state.winLine) {
      this.scene.focusLine(this.state.winLine);
    }
    const title = win
      ? `${playerName(this.state.winner as Player)} wins`
      : "Draw";
    const sub = win
      ? this.mode === "bot" && this.state.winner === BOT_PLAYER
        ? "The bot lined up three. Try another level?"
        : this.mode === "bot"
          ? "You beat the bot."
          : "Three in a row through the cube."
      : "No line survived the full cube — impossible, but here we are.";
    this.el.overlayKicker.textContent = `Game over · ${this.history.length} moves`;
    this.el.overlayTitle.textContent = title;
    this.el.overlaySub.textContent = sub;
    this.flash(win ? `${title}!` : title, 3200);
    this.overlayTimer = window.setTimeout(() => {
      this.el.overlay.hidden = false;
    }, 1100);
  }

  private inputEnabled(): boolean {
    if (this.thinking || this.state.status !== "playing") return false;
    if (this.mode === "bot" && this.state.turn === BOT_PLAYER) return false;
    return true;
  }

  /* ------------------------------------------------------------------- ui */

  private bindUi(): void {
    this.el.modeSwitch.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
      if (!button) return;
      const mode = button.dataset.mode as GameMode;
      if (mode === this.mode) return;
      this.mode = mode;
      this.startNewGame();
      this.updateFraming();
    });

    this.el.difficultySwitch.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-difficulty]");
      if (!button) return;
      this.difficulty = button.dataset.difficulty as Difficulty;
      this.render();
      this.updateFraming();
    });

    this.el.gamesGrid.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-plane]");
      if (!button) return;
      const plane = planeAt(button.dataset.plane as string);
      if (!plane) return;
      this.inspected = plane;
      this.scene.focusOn(plane);
      this.flash(
        samePlane(plane, this.state.active)
          ? `${planeShort(plane)} is the active game`
          : `Inspecting ${planeShort(plane)} — ${planeTitle(plane)}`,
      );
    });

    must("new-game").addEventListener("click", () => this.startNewGame());
    must("reset-view").addEventListener("click", () => {
      this.inspected = null;
      this.scene.resetView();
    });
    must("focus-button").addEventListener("click", () => this.focusActive(true));

    must("help-button").addEventListener("click", () => {
      this.el.help.hidden = false;
    });
    must("help-close").addEventListener("click", () => {
      this.el.help.hidden = true;
    });
    must("overlay-again").addEventListener("click", () => this.startNewGame());
    must("overlay-close").addEventListener("click", () => {
      this.el.overlay.hidden = true;
    });

    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (key === "n") this.startNewGame();
      else if (key === "r") {
        this.inspected = null;
        this.scene.resetView();
      } else if (key === "escape") {
        this.el.help.hidden = true;
        this.el.overlay.hidden = true;
      }
    });
  }

  private focusActive(announce = false): void {
    this.inspected = null;
    this.scene.focusOn(this.state.active);
    if (announce && this.state.status === "playing") {
      this.flash(
        this.state.freeMove
          ? "Free move — play anywhere"
          : `Locked onto ${planeShort(this.state.active)}`,
      );
    }
  }

  private onHover(cell: number | null): void {
    this.hoverCell = cell;
    this.updateHoverChip();
    this.updateGameChips();
  }

  private updateHoverChip(): void {
    const cell = this.hoverCell;
    if (cell === null || !this.inputEnabled() || this.state.status !== "playing") {
      this.hideHoverChip();
      return;
    }
    const locks = nextPlane(this.state.active, cell);
    this.el.hoverText.innerHTML =
      `Slot <b>${cellLayerNames(cell)}</b> · locks <b>${planeShort(locks)}</b>`;
    this.el.hoverChip.hidden = false;
  }

  private hideHoverChip(): void {
    this.el.hoverChip.hidden = true;
  }

  private flash(text: string, duration = 2000): void {
    this.el.statusText.textContent = text;
    this.el.statusBanner.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.el.statusBanner.hidden = true;
    }, duration);
  }

  /* ---------------------------------------------------------------- render */

  private render(): void {
    const legal = legalMoves(this.state);
    this.scene.setState({
      board: this.state.board,
      active: this.state.active,
      legal,
      lastMove: this.state.lastMove,
      winLine: this.state.winLine,
      currentPlayer: this.state.turn,
      status: this.state.status,
      freeMove: this.state.freeMove,
      inputEnabled: this.inputEnabled(),
    });

    const finished = this.state.status !== "playing";
    const player = finished && this.state.winner !== 0 ? (this.state.winner as Player) : this.state.turn;
    const name = playerName(player);
    this.el.turnDot.classList.toggle("is-o", name === "O");
    this.el.turnLabel.textContent =
      this.state.status === "won"
        ? `${name} wins`
        : this.state.status === "draw"
          ? "Draw"
          : this.mode === "bot"
            ? name === "O"
              ? "O to play · bot"
              : "X to play · you"
            : `${name} to play`;
    this.el.turnSub.textContent = finished
      ? `${this.history.length} moves played`
      : `Game ${planeShort(this.state.active)} · ${planeTitle(this.state.active)}`;
    this.el.freeBadge.hidden = !this.state.freeMove || finished;

    for (const button of Array.from(
      this.el.modeSwitch.querySelectorAll<HTMLElement>("[data-mode]"),
    )) {
      button.classList.toggle("is-active", button.dataset.mode === this.mode);
    }
    this.el.difficultyRow.hidden = this.mode !== "bot";
    for (const button of Array.from(
      this.el.difficultySwitch.querySelectorAll<HTMLElement>("[data-difficulty]"),
    )) {
      button.classList.toggle("is-active", button.dataset.difficulty === this.difficulty);
    }

    this.el.gamesProgress.textContent = `${this.state.moveCount} / 27 marks`;
    this.updateGameChips();
    this.renderMoveList();
    this.updateHoverChip();
  }

  private updateGameChips(): void {
    const planes = allPlanes();
    if (this.el.gamesGrid.childElementCount !== planes.length) {
      this.el.gamesGrid.replaceChildren(
        ...planes.map((plane) => {
          const chip = document.createElement("button");
          chip.className = `game-chip is-family-${plane.family}`;
          chip.dataset.plane = planeShort(plane).toLowerCase();
          chip.innerHTML =
            `<span class="chip-name">${planeShort(plane)}</span>` +
            `<span class="chip-sub">—</span>` +
            `<span class="chip-dots">${"<i></i>".repeat(9)}</span>`;
          return chip;
        }),
      );
    }

    const nextPreview = this.hoverCell !== null && this.inputEnabled()
      ? nextPlane(this.state.active, this.hoverCell)
      : null;

    planes.forEach((plane, index) => {
      const chip = this.el.gamesGrid.children[index] as HTMLElement;
      const cells = cellsOfPlane(plane);
      const marks = cells.filter((c) => this.state.board[c] !== 0).length;
      const dots = chip.querySelector(".chip-dots") as HTMLElement;
      cells.forEach((cell, dotIndex) => {
        const dot = dots.children[dotIndex] as HTMLElement;
        const value = this.state.board[cell];
        dot.className = value === 1 ? "is-x" : value === 2 ? "is-o" : "";
      });
      const sub = chip.querySelector(".chip-sub") as HTMLElement;
      const isActive = samePlane(plane, this.state.active) && this.state.status === "playing";
      const isInspected = this.inspected !== null && samePlane(plane, this.inspected);
      sub.textContent = isActive ? "active" : marks === 9 ? "full" : `${marks}/9`;
      chip.classList.toggle("is-active", isActive || isInspected);
      chip.classList.toggle("is-full", marks === 9);
      chip.classList.toggle("is-next", nextPreview !== null && samePlane(plane, nextPreview));
    });
  }

  private renderMoveList(): void {
    if (this.history.length === 0) {
      this.el.moveList.replaceChildren(
        Object.assign(document.createElement("li"), {
          className: "empty",
          textContent: `${playerName(this.state.turn)} opens in ${planeShort(this.state.active)} — nine free slots.`,
        }),
      );
      return;
    }

    const items = this.history.map((entry, index) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="index">${index + 1}</span>` +
        `<span class="mark ${entry.player === 1 ? "is-x" : "is-o"}">${playerName(entry.player)}</span>` +
        `<span class="where">${cellLayerNames(entry.cell)}</span>` +
        `<span class="locks">${entry.free ? "free move" : entry.locks ? `→ ${planeShort(entry.locks)}` : "win"}</span>`;
      if (index === this.history.length - 1) li.classList.add("is-latest");
      return li;
    });
    this.el.moveList.replaceChildren(...items.reverse());
    this.el.moveList.scrollTop = 0;
  }

  /* --------------------------------------------------------------- debug */

  private exposeDebugApi(): void {
    Object.defineProperty(window, "__cubic", {
      value: {
        state: () => this.state,
        history: () => this.history,
        play: (cell: number) => this.onCellChosen(cell),
        legalMoves: () => legalMoves(this.state),
        setMode: (mode: GameMode) => {
          this.mode = mode;
          this.startNewGame();
        },
        setDifficulty: (difficulty: Difficulty) => {
          this.difficulty = difficulty;
          this.render();
        },
      },
      configurable: true,
    });
  }
}

/* ------------------------------------------------------------- utilities */

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element;
}

function allPlanes(): Plane[] {
  const planes: Plane[] = [];
  for (const family of ["x", "y", "z"] as const) {
    for (let offset = 0; offset < 3; offset++) planes.push({ family, offset });
  }
  return planes;
}
