import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSupervisorPrompt, buildFleetPrompt, parseSessionOutput } from './session.js';

describe('buildSupervisorPrompt', () => {
  it('includes orient instruction', () => {
    const prompt = buildSupervisorPrompt('/repo');
    expect(prompt).toContain('/orient');
  });

  it('includes commit and push instructions', () => {
    const prompt = buildSupervisorPrompt('/repo');
    expect(prompt).toContain('commit');
    expect(prompt).toContain('push');
  });

  it('includes session discipline', () => {
    const prompt = buildSupervisorPrompt('/repo');
    expect(prompt).toContain('APPROVAL_QUEUE');
  });
});

describe('buildFleetPrompt', () => {
  it('includes the specific task', () => {
    const prompt = buildFleetPrompt({
      id: 'abc',
      text: 'Write unit tests for parser',
      project: 'agent-framework',
      priority: 'high',
      doneWhen: 'All parser functions have tests with >80% coverage',
      why: 'Parser is untested and critical',
      tags: ['fleet-eligible'],
    });
    expect(prompt).toContain('Write unit tests for parser');
    expect(prompt).toContain('agent-framework');
    expect(prompt).toContain('>80% coverage');
  });

  it('instructs worker NOT to run orient', () => {
    const prompt = buildFleetPrompt({
      id: 'abc',
      text: 'Fix typo',
      project: 'docs',
      priority: 'low',
      tags: ['fleet-eligible'],
    });
    expect(prompt).toContain('Do NOT run /orient');
  });

  it('instructs worker to commit and push', () => {
    const prompt = buildFleetPrompt({
      id: 'abc',
      text: 'Fix typo',
      project: 'docs',
      priority: 'low',
      tags: [],
    });
    expect(prompt).toContain('commit');
    expect(prompt).toContain('push');
  });
});

describe('parseSessionOutput', () => {
  it('detects successful completion', () => {
    const result = parseSessionOutput(0, 5000);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBe(5000);
  });

  it('detects failure', () => {
    const result = parseSessionOutput(1, 3000);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
