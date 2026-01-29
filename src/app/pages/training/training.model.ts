export interface ActiveTraining {
  id: string; // always 'active'
  routineId: string;
  routineName: string;
  startedAt: string;
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
