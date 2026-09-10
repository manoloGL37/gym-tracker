import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ExerciseApiService } from './exercise-api.service';
import { CreateExerciseRequest, ExerciseFilterOptionsResponse, ExercisePageResponse, ExerciseResponse } from './exercise-api.models';

const exercise: ExerciseResponse = {
  id: '3e467840-1333-46f3-b4d7-556dd7c0618c',
  clientId: null,
  source: 'EXERCISES_DATASET',
  sourceId: 'bench-press',
  editable: false,
  deletable: false,
  category: 'strength',
  equipment: 'barbell',
  targetMuscle: 'chest',
  muscleGroup: 'upper body',
  secondaryMuscles: ['triceps'],
  translations: [{ language: 'en', name: 'Bench press', instructions: null }],
  aliases: [],
};

describe('ExerciseApiService', () => {
  let service: ExerciseApiService;
  let requests: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ExerciseApiService);
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => requests.verify());

  it('sends only supported list filters and preserves the custom page response', () => {
    const page: ExercisePageResponse = { content: [exercise], page: 0, size: 20, totalElements: 42, totalPages: 3 };
    let received: ExercisePageResponse | undefined;

    service.list({ page: 0, size: 20, search: 'bench', equipment: 'barbell', muscleGroup: 'upper body' })
      .subscribe(value => received = value);

    const request = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/exercises?page=0&size=20&search=bench&equipment=barbell&muscleGroup=upper%20body');
    expect(request.request.method).toBe('GET');
    request.flush(page);
    expect(received).toEqual(page);
  });

  it('uses the documented create, detail, update and delete routes', () => {
    const create: CreateExerciseRequest = {
      clientId: 'c4bd572d-c9dc-4155-8ac1-af6ddc08d68a',
      category: null,
      equipment: null,
      targetMuscle: null,
      muscleGroup: null,
      secondaryMuscles: null,
      translations: [{ language: 'en', name: 'My movement', instructions: null }],
    };

    service.create(create).subscribe();
    const createRequest = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/exercises');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual(create);
    createRequest.flush({ ...exercise, id: 'custom-id', source: 'USER', clientId: create.clientId, editable: true, deletable: true });

    service.get('custom-id').subscribe();
    requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/exercises/custom-id').flush(exercise);

    service.update('custom-id', create).subscribe();
    const updateRequest = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/exercises/custom-id');
    expect(updateRequest.request.method).toBe('PUT');
    updateRequest.flush(exercise);

    service.delete('custom-id').subscribe();
    const deleteRequest = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/exercises/custom-id');
    expect(deleteRequest.request.method).toBe('DELETE');
    deleteRequest.flush(null);
  });

  it('loads filter options separately from the paginated catalog', () => {
    const options: ExerciseFilterOptionsResponse = {
      categories: ['strength'],
      equipment: ['barbell'],
      muscleGroups: ['upper body'],
      targetMuscles: ['chest'],
    };

    service.getFilterOptions().subscribe(value => expect(value).toEqual(options));

    const request = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/exercises/filter-options');
    expect(request.request.method).toBe('GET');
    request.flush(options);
  });
});
