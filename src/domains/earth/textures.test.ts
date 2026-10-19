import { describe, expect, it } from 'vitest';
import { parseTexturePath } from './textures';

describe('parseTexturePath', () => {
  it('splits the downscale suffix', () => {
    expect(parseTexturePath('textures/moon/color_8k.jpg@4096')).toEqual({ path: 'textures/moon/color_8k.jpg', maxWidth: 4096 });
  });
  it('leaves plain paths alone', () => {
    expect(parseTexturePath('textures/earth/day_4k.jpg')).toEqual({ path: 'textures/earth/day_4k.jpg', maxWidth: null });
  });
});
