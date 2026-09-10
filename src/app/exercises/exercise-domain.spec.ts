import {
  canDeleteExercise,
  canEditExercise,
  createCustomExerciseDraft,
  getExerciseName,
  getExerciseTranslation,
  toCreateExerciseRequest,
} from './exercise-domain';
import { ExerciseResponse } from './exercise-api.models';

const datasetExercise: ExerciseResponse = {
  id: 'dataset-id',
  clientId: null,
  source: 'EXERCISES_DATASET',
  sourceId: 'squat',
  editable: false,
  deletable: false,
  category: null,
  equipment: null,
  targetMuscle: null,
  muscleGroup: null,
  secondaryMuscles: null,
  translations: [
    { language: 'en', name: 'Squat', instructions: null },
    { language: 'es', name: 'Sentadilla', instructions: null },
  ],
  aliases: [],
};

describe('exercise domain helpers', () => {
  it('uses the active language, then English, then the first translation', () => {
    expect(getExerciseName(datasetExercise, 'es')).toBe('Sentadilla');
    expect(getExerciseTranslation(datasetExercise, 'fr')?.name).toBe('Squat');
    expect(getExerciseName({ ...datasetExercise, translations: [{ language: 'de', name: 'Kniebeuge', instructions: null }] }, 'es')).toBe('Kniebeuge');
  });

  it('uses server permissions instead of source or name guesses', () => {
    expect(canEditExercise(datasetExercise)).toBeFalse();
    expect(canDeleteExercise(datasetExercise)).toBeFalse();
    expect(canEditExercise({ ...datasetExercise, source: 'USER', editable: true })).toBeTrue();
  });

  it('keeps a native clientId stable when a custom-exercise request is retried', () => {
    const draft = createCustomExerciseDraft('es');
    draft.name = 'Remo propio';
    draft.secondaryMuscles = 'bíceps, espalda';

    const firstRequest = toCreateExerciseRequest(draft);
    const retryRequest = toCreateExerciseRequest(draft);

    expect(firstRequest.clientId).toBe(draft.clientId);
    expect(retryRequest.clientId).toBe(firstRequest.clientId);
    expect(firstRequest.secondaryMuscles).toEqual(['bíceps', 'espalda']);
  });
});
