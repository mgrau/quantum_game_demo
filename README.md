# Misty: quantum game demo

A five-level, browser-based quantum circuit puzzle. Drag gates onto wires and
watch the state change as the circuit runs.

The demo builds one idea at a time:

1. flip a qubit with X;
2. create a superposition with H;
3. entangle two qubits with H and CNOT;
4. recreate an operation that must work for every input; and
5. solve Deutsch's constant-or-balanced problem with one sealed-box query.

The last two levels make multi-case grading visible. The game tests the same
circuit against every input or hidden function, animates each passing case, and
only then shows the level-complete transition.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

For a production build:

```sh
npm run build
```

The circuit parser, simulator, renderer, and drag editor are vendored from the
companion `misty_states` project so this repository works from a fresh clone.

## Level content

The five shipped levels live in [`src/levels/00-demo.yaml`](src/levels/00-demo.yaml).
Every level includes a reference solution, and the test suite verifies that all
five solutions pass the same grader used in the game.
