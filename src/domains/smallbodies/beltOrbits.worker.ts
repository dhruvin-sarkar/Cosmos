/** Belt-rock orbit table off the main thread (see beltOrbits.ts). */
import { handleOrbitsMessage } from './beltOrbits';

self.onmessage = handleOrbitsMessage;
