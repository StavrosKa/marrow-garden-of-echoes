import { describe, expect, it } from 'vitest';
import { copy } from './copy';

describe('garden-of-echoes', () => {
  it('has an app name', () => {
    expect(copy.appName).toBe('Garden of Echoes');
  });
});