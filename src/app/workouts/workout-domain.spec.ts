import { CloudActiveExercise, cloudActiveFromWorkout, fillCloudPlannedSets, newCloudSetDraft, toBackendLocalDateTime } from './workout-domain';

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

  it('fills the planned account sets from the routine without replacing retryable drafts', () => {
    const workout = {
      id: 'workout', clientId: 'workout-client', routineId: 'routine', startedAt: '2026-09-11T08:00:00', completedAt: null, notes: null, createdAt: '2026-09-11T08:00:00',
      exercises: [{ id: 'workout-exercise', exerciseId: 'exercise-id', position: 0, notes: null, sets: [] }],
    };
    const routine = {
      id: 'routine', clientId: null, name: 'Día A', description: null, createdAt: '2026-01-01T00:00:00', updatedAt: '2026-01-01T00:00:00',
      exercises: [{ id: 'routine-exercise', exerciseId: 'exercise-id', position: 0, sets: 3, targetReps: 8, restSeconds: 90, notes: null }],
    };
    const active = cloudActiveFromWorkout(workout, routine.name, new Map([['exercise-id', 'Press']]));
    const retryable = newCloudSetDraft(active.exercises[0]);
    active.exercises[0].sets.push(retryable);

    fillCloudPlannedSets(active, routine);

    expect(active.exercises[0].sets.length).toBe(3);
    expect(active.exercises[0].sets[0]).toBe(retryable);
    expect(active.exercises[0].sets.map(set => set.setNumber)).toEqual([1, 2, 3]);
  });
});
