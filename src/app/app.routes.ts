

import { MainLayoutComponent } from './layout/main-layout/main-layout.component';
import { HomeComponent } from './pages/home/home.component';
import { RoutinesComponent } from './pages/routines/routines.component';
import { CalendarComponent } from './pages/calendar/calendar.component';
import { WeightComponent } from './pages/weight/weight.component';
import { TrainingComponent } from './pages/training/training.component';

import { AddWorkoutComponent } from './pages/add-workout/add-workout.component';

import { Routes } from '@angular/router';
import { SelectRoutineComponent } from './pages/select-routine/select-routine.component';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/auth/login.component').then(m => m.LoginComponent), title: 'Login' },
  { path: 'register', loadComponent: () => import('./pages/auth/register.component').then(m => m.RegisterComponent), title: 'Create account' },
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
      { path: 'stats', loadComponent: () => import('./pages/stats/stats.component').then(m => m.StatsComponent), title: 'Stats' },
      { path: 'exercises', loadComponent: () => import('./pages/exercise-history/exercise-history.component').then(m => m.ExerciseHistoryComponent), title: 'Exercise History' },
      { path: 'exercise-catalog', loadComponent: () => import('./pages/exercise-catalog/exercise-catalog.component').then(m => m.ExerciseCatalogComponent), title: 'Exercise Catalog' },
      { path: 'training', component: TrainingComponent, title: 'Training' },
      { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent), title: 'Settings' },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
