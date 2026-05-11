import { describe, expect, it } from 'vitest';
import { formatActiveModelBadgeText } from './components';
import type { ActiveProfileState } from './src/types';

const baseProfile: ActiveProfileState = {
  modelId: 'openai/gpt-5',
  contextLimit: 400000,
  providerName: 'OpenAI',
  modelName: 'GPT-5',
};

describe('formatActiveModelBadgeText', () => {
  it('should return placeholder when profile is null', () => {
    expect(formatActiveModelBadgeText(null)).toBe('No SDD model active');
  });

  it('should return placeholder when profile is undefined', () => {
    expect(formatActiveModelBadgeText(undefined)).toBe('No SDD model active');
  });

  it('should include reasoning effort when present', () => {
    const text = formatActiveModelBadgeText({
      ...baseProfile,
      reasoningEffort: 'high',
    });

    expect(text).toBe('GPT-5 · 400k ctx · effort: high');
  });

  it('should omit effort when absent', () => {
    const text = formatActiveModelBadgeText(baseProfile);

    expect(text).toBe('GPT-5 · 400k ctx');
  });

  it('should use profile name when display mode is "profile" and profileName is set', () => {
    const text = formatActiveModelBadgeText(
      { ...baseProfile, profileName: 'frontend-team' },
      'profile',
    );

    expect(text).toBe('frontend-team · 400k ctx');
  });

  it('should fall back to model name when display mode is "profile" but profileName is missing', () => {
    const text = formatActiveModelBadgeText(baseProfile, 'profile');

    expect(text).toBe('GPT-5 · 400k ctx');
  });

  it('should fall back to model name when display mode is "profile" but profileName is blank', () => {
    const text = formatActiveModelBadgeText(
      { ...baseProfile, profileName: '   ' },
      'profile',
    );

    expect(text).toBe('GPT-5 · 400k ctx');
  });

  it('should ignore profile name when display mode is "model" (default)', () => {
    const text = formatActiveModelBadgeText({
      ...baseProfile,
      profileName: 'frontend-team',
    });

    expect(text).toBe('GPT-5 · 400k ctx');
  });

  it('should keep effort label when display mode is "profile" and profileName is set', () => {
    const text = formatActiveModelBadgeText(
      {
        ...baseProfile,
        profileName: 'frontend-team',
        reasoningEffort: 'high',
      },
      'profile',
    );

    expect(text).toBe('frontend-team · 400k ctx · effort: high');
  });
});
