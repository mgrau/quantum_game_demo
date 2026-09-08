/**
 * What version of this drew your figure.
 *
 * A literal rather than a read of `package.json`, because the library is meant
 * to be importable anywhere and a JSON import is a build-tool question in a
 * place that should not have one. `version.test.ts` holds the two in step, so
 * the literal cannot drift from the manifest without a test saying so.
 */
export const VERSION = '0.1.0'
