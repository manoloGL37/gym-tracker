import { CloudRoutineDraft, toCreateRoutineRequest } from './routine-domain';

describe('routine cloud draft mapping', () => {
  it('preserves the cloud exercise UUID and explicitly rebuilds zero-based positions', () => {
    const draft: CloudRoutineDraft = {
      clientId: 'stable-client-id', name: 'Upper', description: ' ', exercises: [
        { exerciseId: 'uuid-b', exerciseName: 'B', exerciseSource: 'USER', sets: 4, targetReps: 8, restSeconds: 120, notes: '  note  ' },
        { exerciseId: 'uuid-a', exerciseName: 'A', exerciseSource: 'EXERCISES_DATASET', sets: 3, targetReps: 10, restSeconds: 90, notes: '' },
      ],
    };
    const request = toCreateRoutineRequest(draft);
    expect(request.clientId).toBe('stable-client-id');
    expect(request.description).toBeNull();
    expect(request.exercises).toEqual([
      { exerciseId: 'uuid-b', position: 0, sets: 4, targetReps: 8, restSeconds: 120, notes: 'note' },
      { exerciseId: 'uuid-a', position: 1, sets: 3, targetReps: 10, restSeconds: 90, notes: null },
    ]);
  });
});
