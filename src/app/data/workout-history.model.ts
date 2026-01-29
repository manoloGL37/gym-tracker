export interface WorkoutHistory {
  id: string;
  routineId: string;
  routineName: string;
  startedAt: string;
  finishedAt: string;
  exercises: {
    exerciseId: string;
    name: string;
    sets: {
      setIndex: number;
      reps: number | null;
      weight: number | null;
    }[];
    observation?: string;
  }[];
}
