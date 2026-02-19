import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/migrator/migrator.component').then((m) => m.MigratorComponent) },
  { path: '**', redirectTo: '' }
];
