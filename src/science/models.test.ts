import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY, getModel, listModels, modelKey } from './models';

describe('model registry', () => {
  it('is populated with well-formed, uniquely keyed entries', () => {
    const all = listModels();
    expect(all.length).toBeGreaterThan(10);
    for (const m of all) {
      expect(m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(Number.isInteger(m.version) && m.version >= 1).toBe(true);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.summary.length).toBeGreaterThan(0);
      expect(m.references.length).toBeGreaterThan(0);
      expect(MODEL_REGISTRY[modelKey(m)]).toBe(m);
    }
  });
  it('resolves full keys and bare ids; unknown is undefined', () => {
    const m = listModels()[0];
    expect(getModel(modelKey(m))).toBe(m);
    expect(getModel(m.id)?.id).toBe(m.id);
    expect(getModel('nope@9')).toBeUndefined();
  });
});
