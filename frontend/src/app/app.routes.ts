import { Routes } from '@angular/router';
import { isMsalEnabled } from './core/auth/msal-config';
import { MsalGuard } from '@azure/msal-angular';

const defaultRoute = {
  path: '',
  loadComponent: () => import('./features/migrator/migrator.component').then((m) => m.MigratorComponent),
  ...(isMsalEnabled() ? { canActivate: [MsalGuard] } : {})
};

export const routes: Routes = [
  defaultRoute,
  { path: '**', redirectTo: '' }
];
