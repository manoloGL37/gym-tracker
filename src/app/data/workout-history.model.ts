export interface WorkoutHistory {
  id: string;
  routineId: string;
  routineName: string;
  startedAt: string;
  finishedAt: string;
  /** Captured at session start; absent on legacy records. Never inferred on recovery. */
  calendarZone?: string;
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
