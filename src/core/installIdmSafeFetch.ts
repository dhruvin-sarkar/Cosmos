/**
 * Side-effect module: import it before anything else so the IDM-safe fetch is installed before any other module's code runs
 * (import declarations are hoisted, so a call placed between imports would still run after every imported module).
 */
import { installIdmSafeFetch } from './idmSafeFetch';

installIdmSafeFetch();
