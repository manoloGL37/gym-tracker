import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CreateRoutineRequest, RoutinePageResponse, RoutineResponse } from './routine-api.models';
import { RoutineApiService } from './routine-api.service';

const request: CreateRoutineRequest = {
  clientId: '4a278a9e-1b6f-4ab4-a971-32a1a2a4d3f1', name: 'Push', description: null,
  exercises: [{ exerciseId: '1f7f28ac-4929-4fe2-b4ee-955470b1e095', position: 0, sets: 3, targetReps: 10, restSeconds: 90, notes: null }],
};
const routine: RoutineResponse = { id: 'e90415c9-30c2-4235-b974-55be4d9a87d0', clientId: request.clientId!, name: request.name, description: request.description, exercises: [{ id: 'routine-exercise-id', ...request.exercises[0] }], createdAt: '2026-01-01T10:00:00', updatedAt: '2026-01-01T10:00:00' };

describe('RoutineApiService', () => {
  let service: RoutineApiService;
  let requests: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(RoutineApiService);
    requests = TestBed.inject(HttpTestingController);
  });
  afterEach(() => requests.verify());

  it('uses the Spring Page list route without treating it as the exercise page', () => {
    const page: RoutinePageResponse = { content: [{ id: routine.id, clientId: routine.clientId, name: routine.name, description: null, createdAt: routine.createdAt, updatedAt: routine.updatedAt }], totalElements: 1, totalPages: 2, size: 10, number: 0, sort: { empty: false, sorted: true, unsorted: false }, pageable: { offset: 0, sort: { empty: false, sorted: true, unsorted: false }, pageNumber: 0, pageSize: 10, paged: true, unpaged: false }, first: true, last: false, numberOfElements: 1, empty: false };
    service.list({ page: 0, size: 10 }).subscribe(value => expect(value).toEqual(page));
    const call = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/routines?page=0&size=10');
    expect(call.request.method).toBe('GET');
    call.flush(page);
  });

  it('uses documented create, detail, full update and delete endpoints', () => {
    service.create(request).subscribe();
    let call = requests.expectOne('https://gym-tracker-api-s70k.onrender.com/api/routines');
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(request);
    call.flush(routine);

    service.get(routine.id).subscribe();
    call = requests.expectOne(`https://gym-tracker-api-s70k.onrender.com/api/routines/${routine.id}`);
    expect(call.request.method).toBe('GET');
    call.flush(routine);

    service.update(routine.id, request).subscribe();
    call = requests.expectOne(`https://gym-tracker-api-s70k.onrender.com/api/routines/${routine.id}`);
    expect(call.request.method).toBe('PUT');
    expect(call.request.body).toEqual(request);
    call.flush(routine);

    service.delete(routine.id).subscribe();
    call = requests.expectOne(`https://gym-tracker-api-s70k.onrender.com/api/routines/${routine.id}`);
    expect(call.request.method).toBe('DELETE');
    call.flush(null);
  });
});
