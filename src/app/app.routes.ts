

import { MainLayoutComponent } from './layout/main-layout/main-layout.component';
import { HomeComponent } from './pages/home/home.component';
import { RoutinesComponent } from './pages/routines/routines.component';
import { CalendarComponent } from './pages/calendar/calendar.component';
// import { BodyWeightComponent } from './pages/body-weight/body-weight.component';
import { WeightComponent } from './pages/weight/weight.component';
import { TrainingComponent } from './pages/training/training.component';
import { StatsComponent } from './pages/stats/stats.component';

import { AddWorkoutComponent } from './pages/add-workout/add-workout.component';

import { Routes } from '@angular/router';
import { SelectRoutineComponent } from './pages/select-routine/select-routine.component';

export const routes: Routes = [
  {
    path: '',
    component: MainLayoutComponent,
    children: [
      { path: 'home', component: HomeComponent, title: 'Home' },
      { path: 'routines', component: RoutinesComponent, title: 'Routines' },
      { path: 'select-routine', component: SelectRoutineComponent, title: 'Select Routine' },
      { path: 'calendar', component: CalendarComponent, title: 'Calendar' },
      { path: 'calendar/:id', loadComponent: () => import('./pages/calendar/workout-detail/workout-detail.component').then(m => m.WorkoutDetailComponent), title: 'Workout Detail' },
      { path: 'add-workout', component: AddWorkoutComponent, title: 'Add Workout' },
      { path: 'weight', component: WeightComponent, title: 'Weight' },
      { path: 'stats', component: StatsComponent, title: 'Stats' },
      { path: 'training', component: TrainingComponent, title: 'Training' },
      { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent), title: 'Settings' },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
