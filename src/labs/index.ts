/**
 * Lab auto-discovery: every src/labs/<id>/index.ts registers its panel with registerLabPanel() (src/ui/labs/registry.ts) at
 * import time, so adding a lab never touches a shared file.
 */
const modules = import.meta.glob('./*/index.ts', { eager: true });

/** Paths of the loaded lab modules (for diagnostics). */
export const LAB_MODULES: readonly string[] = Object.keys(modules);
