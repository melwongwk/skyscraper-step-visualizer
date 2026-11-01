# Skyscraper Step Visualizer: trace replay

A step-by-step viewer for skyscraper puzzle solvers, for learning how
backtracking works. It contains no solver. You write a trace from your own C
program, load it here, and the page replays every placement and removal with a
board, counters, a depth chart and a step log.
Everything runs in the browser; there is no server and no build step.

## How to use it

1. Download `skytrace.h` and `skytrace.c` from the Puzzle tab (Use your own solver).
2. Add them to your project and call `trace_start`, `trace_place`, `trace_remove`
   and `trace_end` from your solver.
3. Run your solver. It writes a `skyscraper.trace` file.
4. Choose that file on the page, or drop it anywhere on the page.
5. When you are done testing, delete `skytrace.c`, `skytrace.h`, the `#include`
   and every `trace_` call from your project before you submit it.

Press Load sample trace to try the page without a solver. The Puzzle tab can
also make a random puzzle and show its clues in one line to copy.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page, with its styles |
| `js/app.js` | The page's code |
| `js/engine.js` | Reads a trace file and replays it |
| `js/helper.js` | The two C helper files offered for download |
| `js/sample.js`, `sample-5x5-partial.trace` | The sample trace |

Open `index.html` in a browser to run it locally, or upload the folder to any
static host.

## License

MIT. See `LICENSE`.
