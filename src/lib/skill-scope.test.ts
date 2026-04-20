import { describe, expect, it } from 'vitest';
import { skillMatchesAgentScope } from './skill-scope';

describe('skillMatchesAgentScope', () => {
  it('matches personal workspace skills through workspace grants', () => {
    expect(skillMatchesAgentScope(
      { workspaceId: 'ws-personal', companyId: null } as never,
      { companyId: null } as never,
      new Set(['ws-personal'])
    )).toBe(true);
  });

  it('preserves company fallback for legacy company-scoped skills', () => {
    expect(skillMatchesAgentScope(
      { workspaceId: null, companyId: 'co-1' } as never,
      { companyId: 'co-1' } as never,
      new Set(['ws-personal'])
    )).toBe(true);
  });
});
