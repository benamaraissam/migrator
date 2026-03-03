import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HTTP_INTERCEPTORS } from '@angular/common/http';

import { routes } from './app.routes';
import { isMsalEnabled, msalConfig, protectedResourceMap } from './core/auth/msal-config';
import { IPublicClientApplication, PublicClientApplication, InteractionType } from '@azure/msal-browser';
import { MSAL_INSTANCE, MSAL_GUARD_CONFIG, MSAL_INTERCEPTOR_CONFIG, MsalService, MsalGuard, MsalInterceptor, MsalBroadcastService } from '@azure/msal-angular';

function msalInstanceFactory(): IPublicClientApplication {
  return new PublicClientApplication(msalConfig());
}

function msalInitFactory(msalInstance: IPublicClientApplication) {
  return () => msalInstance.initialize();
}

function msalGuardConfigFactory() {
  return { interactionType: InteractionType.Redirect };
}

function msalInterceptorConfigFactory() {
  return {
    interactionType: InteractionType.Redirect,
    protectedResourceMap: new Map(protectedResourceMap())
  };
}

export function appConfig(): ApplicationConfig {
  const msalProviders = isMsalEnabled()
    ? [
        { provide: MSAL_INSTANCE, useFactory: msalInstanceFactory },
        { provide: APP_INITIALIZER, useFactory: msalInitFactory, deps: [MSAL_INSTANCE], multi: true },
        { provide: MSAL_GUARD_CONFIG, useFactory: msalGuardConfigFactory },
        { provide: MSAL_INTERCEPTOR_CONFIG, useFactory: msalInterceptorConfigFactory },
        { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
        MsalBroadcastService,
        MsalService,
        MsalGuard
      ]
    : [];

  return {
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter(routes),
      provideHttpClient(withInterceptorsFromDi()),
      ...msalProviders
    ]
  };
}
