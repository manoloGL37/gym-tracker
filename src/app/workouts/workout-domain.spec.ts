import { CloudActiveExercise, newCloudSetDraft, toBackendLocalDateTime } from './workout-domain';

describe('cloud workout domain', () => {
  it('uses one-based deterministic set numbers, including unsent drafts', () => {
    const exercise: CloudActiveExercise = { id: 'workout-exercise-id', exerciseId: 'exercise-id', position: 0, name: 'Press', notes: null, sets: [] };
    const first = newCloudSetDraft(exercise); exercise.sets.push(first);
    const second = newCloudSetDraft(exercise);
    expect(first.setNumber).toBe(1);
    expect(second.setNumber).toBe(2);
    expect(first.clientId).toBeTruthy();
  });

  it('serializes LocalDateTime without UTC conversion or a Z suffix', () => {
    const value = toBackendLocalDateTime(new Date(2026, 8, 10, 14, 30, 5));
    expect(value).toBe('2026-09-10T14:30:05');
    expect(value.endsWith('Z')).toBeFalse();
  });
});
