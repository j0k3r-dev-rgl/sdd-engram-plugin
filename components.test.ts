import { describe, expect, it } from 'vitest';
import { formatActiveModelBadgeText } from './components';

describe('formatActiveModelBadgeText', () => {
  it('should include reasoning effort when present', () => {
    const text = formatActiveModelBadgeText({
      modelName: 'GPT-5',
      contextLimit: 400000,
      reasoningEffort: 'high',
    });

    expect(text).toBe('GPT-5 · 400k ctx · effort: high');
  });

  it('should omit effort when absent', () => {
    const text = formatActiveModelBadgeText({
      modelName: 'GPT-5',
      contextLimit: 400000,
    });

    expect(text).toBe('GPT-5 · 400k ctx');
  });
});
