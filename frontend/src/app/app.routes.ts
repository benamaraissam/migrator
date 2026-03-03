import { Routes } from '@angular/router';
import { isMsalEnabled } from './core/auth/msal-config';
import { MsalGuard } from '@azure/msal-angular';

export function buildRoutes(): Routes {
  const defaultRoute = {
    path: '',
    loadComponent: () => import('./features/migrator/migrator.component').then((m) => m.MigratorComponent),
    ...(isMsalEnabled() ? { canActivate: [MsalGuard] } : {})
  };

  return [
    defaultRoute,
    { path: '**', redirectTo: '' }
  ];
}
