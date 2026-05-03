import { describe, expect, it } from 'vitest';
import {
  getOrchestratorPolicy,
  resolveCanonicalOrchestratorModel,
  canonicalizeProfileModels,
} from './orchestrator';

describe('orchestrator compatibility policy', () => {
  it('detects legacy runtime when only sdd-orchestrator exists', () => {
    const policy = getOrchestratorPolicy(['sdd-orchestrator', 'sdd-apply']);
    expect(policy.canonicalName).toBe('sdd-orchestrator');
    expect(policy.migrationEnabled).toBe(false);
  });

  it('detects updated runtime when gentle-orchestrator exists', () => {
    const policy = getOrchestratorPolicy(['gentle-orchestrator', 'sdd-apply']);
    expect(policy.canonicalName).toBe('gentle-orchestrator');
    expect(policy.migrationEnabled).toBe(true);
  });

  it('resolves dual-key precedence to canonical runtime key', () => {
    const updated = getOrchestratorPolicy(['sdd-orchestrator', 'gentle-orchestrator']);
    const updatedModel = resolveCanonicalOrchestratorModel(
      { 'sdd-orchestrator': 'legacy/model', 'gentle-orchestrator': 'new/model' },
      updated,
    );
    expect(updatedModel).toBe('new/model');

    const legacy = getOrchestratorPolicy(['sdd-orchestrator']);
    const legacyModel = resolveCanonicalOrchestratorModel(
      { 'sdd-orchestrator': 'legacy/model', 'gentle-orchestrator': 'new/model' },
      legacy,
    );
    expect(legacyModel).toBe('legacy/model');
  });

  it('uses safe legacy fallback when neither orchestrator key is discoverable', () => {
    const policy = getOrchestratorPolicy(['sdd-apply', 'sdd-design']);
    expect(policy.canonicalName).toBe('sdd-orchestrator');
    expect(policy.migrationEnabled).toBe(false);
  });

  it('writes only canonical key for updated runtime migration', () => {
    const policy = getOrchestratorPolicy(['gentle-orchestrator']);
    const next = canonicalizeProfileModels({
      'sdd-orchestrator': 'legacy/model',
      'sdd-apply': 'phase/model',
    }, policy);

    expect(next['gentle-orchestrator']).toBe('legacy/model');
    expect(next['sdd-orchestrator']).toBeUndefined();
    expect(next['sdd-apply']).toBe('phase/model');
  });
});
