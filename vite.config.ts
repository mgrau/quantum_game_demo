import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

/**
 * misty_states is consumed as a vendored source package, not a built bundle.
 *
 * Its `exports` map points at TypeScript, which this build compiles like any
 * other source file. Keeping the small rendering kernel in `vendor/` makes the
 * demo installable from a fresh clone instead of depending on a sibling repo.
 */
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  base: './',
  optimizeDeps: { exclude: ['misty-states'] },
  // Svelte's browser build, which is what the app ships and what a component
  // test has to mount.
  resolve: { conditions: ['browser'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
