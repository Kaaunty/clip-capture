import { describe, it, expect } from 'vitest';
import { validateClipEventPayload } from '../src/types/contracts';

describe('Contracts Validation', () => {
  it('validates a valid event payload', () => {
    const payload = {
      fieldId: 'field-1',
      triggeredAt: new Date().toISOString(),
      commandId: 'cmd-123',
      triggerSource: 'PHYSICAL_BUTTON' as const,
    };
    expect(validateClipEventPayload(payload)).toBe(true);
  });

  it('rejects payload missing commandId', () => {
    const payload = {
      fieldId: 'field-1',
      triggeredAt: new Date().toISOString(),
      triggerSource: 'PHYSICAL_BUTTON',
    };
    expect(validateClipEventPayload(payload)).toBe(false);
  });

  it('rejects payload with invalid trigger source', () => {
    const payload = {
      fieldId: 'field-1',
      triggeredAt: new Date().toISOString(),
      commandId: 'cmd-123',
      triggerSource: 'INVALID_SOURCE',
    };
    expect(validateClipEventPayload(payload)).toBe(false);
  });

  it('rejects invalid Date object in triggeredAt', () => {
    const payload = {
      fieldId: 'field-1',
      triggeredAt: new Date('invalid-date-string'),
      commandId: 'cmd-123',
      triggerSource: 'PHYSICAL_BUTTON' as const,
    };
    expect(validateClipEventPayload(payload)).toBe(false);
  });

  it('rejects null or non-object payloads', () => {
    expect(validateClipEventPayload(null)).toBe(false);
    expect(validateClipEventPayload(undefined)).toBe(false);
    expect(validateClipEventPayload('string')).toBe(false);
  });
});
