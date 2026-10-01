# CUBIC — 3D tic-tac-toe in a cube

A 3×3×3 cube you can orbit with the mouse. The cube is really **nine tic-tac-toe
games** (one for every slice of the cube); a move **locks the next player into
one of those games**, and the camera swings onto it so you always see the board
you must play in.

Built with Vite + TypeScript + three.js. No backend, no build step needed to run
it — everything is client side.

---

## How to play

* The board is a **3×3×3 cube**: 27 slots.
* It also slices into **9 games**, nine slots each — three slices for every axis
  (labelled `X1 X2 X3`, `Y1 Y2 Y3`, `Z1 Z2 Z3`).
* On your turn you may **only play inside the active game** — the glowing layer
  with the grid on it. Every other slot is dimmed.
* The slot you take **locks the next player into the game that runs through
  that slot** and the camera swings there. The lock rotates axis families each
  move (`X → Y → Z → X`), so the game you hand over is decided by one
  coordinate of your slot.
* If the active game is full, you get a **free move** anywhere in the cube. The
  board can never dead-end.
* **Win** by lining up three of your marks: across the face of a game, through
  the layers, or corner to corner through the whole cube (49 possible lines).
* **Draws are impossible.** Every full cube of 27 marks contains a 3-in-a-row —
  this is proven exhaustively by a test (`fullCubeWithoutLineExists`), so every
  finished game has a winner.

## Controls

| Action | Input |
| --- | --- |
| Place a mark | **Left click / tap** a slot in the active game |
| Orbit the camera | **Right-click drag** (or drag with the left button, or one-finger drag on touch) |
| Zoom | **Mouse wheel** or pinch |
| Look at a specific game | Click its chip in *The 9 games* panel |
| Back to the active game | *Back to active game* button, `R` resets the view, `N` starts a new game |

The hover chip at the bottom tells you which game your slot will lock, and the
matching chip in the panel lights up before you commit.

## Modes

* **Hotseat 1v1** — two players share the screen and trade turns; the camera
  keeps up with the lock so nobody has to remember whose game it is.
* **vs Bot** — you are `X` and move first; the bot is `O`.
  * `easy` — random, with the occasional obvious win taken.
  * `medium` — immediate wins and blocks, then a depth-3 search.
  * `hard` — iterative-deepening alpha-beta with a time budget, move ordering
    and an evaluation that understands how likely each slice is to be played
    again. It never returns an illegal move and always takes a win or a block.

## Project layout

```
index.html            layout: viewport, HUD, side panel, overlays
src/main.ts           boot + WebGL failure fallback
src/style.css         glass UI, responsive layout
src/game/rules.ts     the cube: cells, the 9 games, 49 lines, lock rotation, win detection
src/game/bot.ts       bot: legality, tactics, iterative deepening search
src/three/geometry.ts camera maths: layer view frames, ray → slot picking
src/three/scene.ts    rendering, orbit controls, the lock choreography
src/app/app.ts        glue: state machine, DOM panel, move list, framing
```

`src/game/rules.ts` and `src/three/geometry.ts` are pure and unit tested —
including a test that projects every cell of all 9 games through the real
camera frame and asserts that clicking its screen position picks it back.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 33 tests: rules, bot, geometry/picking
npm run typecheck
npm run build      # production bundle in dist/
npm run preview    # serve the production build
```

## Design notes

* **Nothing to learn about the rules UI.** The active game is the only lit
  layer; everything else is dimmed and un-clickable, so an illegal click is
  impossible by construction (`legalMoves()` feeds both the rendering and the
  ray picking).
* **The camera is the turn indicator.** Every move re-frames the cube onto the
  game that was handed over, so hotseat play never needs a "whose turn is it"
  conversation.
* **The lock uses an axis rotation** rather than a free choice of which game to
  hand over: one slot, one resulting game, no extra prompt, and much better
  draw/parity behaviour (`X` would otherwise be strongly favoured).
* **Draws really are impossible** — the whole game is a race for the 49 lines on
  a board that ends with a winner every time.
