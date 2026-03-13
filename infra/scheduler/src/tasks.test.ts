import { describe, it, expect } from 'vitest';
import { parseTasks, taskId, isFleetEligible } from './tasks.js';

const SAMPLE_TASKS = `# Project Alpha — Tasks

### Phase 1

- [ ] Write baseline evaluation script [fleet-eligible]
  Why: Need initial accuracy data before scaling
  Done when: Script runs on 10 samples without error
  Priority: high

- [ ] Design evaluation rubric [requires-opus] [zero-resource]
  Why: Need consistent criteria across experiments
  Done when: Rubric doc with 5+ dimensions exists
  Priority: medium

- [x] Set up project directory
  Why: Need project structure
  Done when: README and TASKS exist

- [ ] Run full evaluation [blocked-by: baseline script]
  Why: Main experiment
  Done when: Results for all models documented
  Priority: high

- [ ] Update README with findings [in-progress: 2026-03-10]
  Why: Keep docs current
  Done when: README has latest results
`;

describe('parseTasks', () => {
  it('parses open tasks', () => {
    const tasks = parseTasks(SAMPLE_TASKS, 'alpha');
    // Should include: baseline eval, design rubric, run full eval, update readme
    // Should exclude: set up project (completed)
    const openTasks = tasks.filter(t => !t.text.startsWith('[x]'));
    expect(openTasks.length).toBe(4);
  });

  it('extracts priority', () => {
    const tasks = parseTasks(SAMPLE_TASKS, 'alpha');
    const baseline = tasks.find(t => t.text.includes('baseline'));
    expect(baseline?.priority).toBe('high');
  });

  it('extracts done-when', () => {
    const tasks = parseTasks(SAMPLE_TASKS, 'alpha');
    const baseline = tasks.find(t => t.text.includes('baseline'));
    expect(baseline?.doneWhen).toContain('10 samples');
  });

  it('extracts why', () => {
    const tasks = parseTasks(SAMPLE_TASKS, 'alpha');
    const baseline = tasks.find(t => t.text.includes('baseline'));
    expect(baseline?.why).toContain('accuracy data');
  });

  it('extracts tags', () => {
    const tasks = parseTasks(SAMPLE_TASKS, 'alpha');
    const baseline = tasks.find(t => t.text.includes('baseline'));
    expect(baseline?.tags).toContain('fleet-eligible');

    const rubric = tasks.find(t => t.text.includes('rubric'));
    expect(rubric?.tags).toContain('requires-opus');
    expect(rubric?.tags).toContain('zero-resource');
  });

  it('sets project name', () => {
    const tasks = parseTasks(SAMPLE_TASKS, 'alpha');
    expect(tasks.every(t => t.project === 'alpha')).toBe(true);
  });

  it('skips completed tasks', () => {
    const tasks = parseTasks(SAMPLE_TASKS, 'alpha');
    expect(tasks.find(t => t.text.includes('Set up project'))).toBeUndefined();
  });
});

describe('taskId', () => {
  it('produces stable IDs', () => {
    expect(taskId('Write tests')).toBe(taskId('Write tests'));
  });

  it('produces different IDs for different tasks', () => {
    expect(taskId('Write tests')).not.toBe(taskId('Fix bug'));
  });
});

describe('isFleetEligible', () => {
  it('returns true for fleet-eligible tag', () => {
    const task = parseTasks(SAMPLE_TASKS, 'alpha').find(t => t.text.includes('baseline'))!;
    expect(isFleetEligible(task)).toBe(true);
  });

  it('returns false for requires-opus tag', () => {
    const task = parseTasks(SAMPLE_TASKS, 'alpha').find(t => t.text.includes('rubric'))!;
    expect(isFleetEligible(task)).toBe(false);
  });

  it('returns false for blocked tasks', () => {
    const task = parseTasks(SAMPLE_TASKS, 'alpha').find(t => t.text.includes('full evaluation'))!;
    expect(isFleetEligible(task)).toBe(false);
  });

  it('returns false for in-progress tasks', () => {
    const task = parseTasks(SAMPLE_TASKS, 'alpha').find(t => t.text.includes('Update README'))!;
    expect(isFleetEligible(task)).toBe(false);
  });
});
