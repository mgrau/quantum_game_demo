/**
 * Entry point for the standalone bundle.
 *
 * Deliberately exports *only* a default. Mixing named and default exports would
 * make the UMD global the module namespace, so a <script> tag would have to
 * reach through `MistyStates.MistyStates` or `MistyStates.default`. With a lone
 * default export the global is the API object itself:
 *
 *   <script src="misty-states.js"></script>
 *   <script>document.body.innerHTML = MistyStates.svg('00|11')</script>
 */

import { MistyStates } from './api'

export default MistyStates
