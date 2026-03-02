import { LogLevel, Configuration as MsalConfiguration, BrowserCacheLocation } from '@azure/msal-browser';
import { environment } from '../../../environments/environment';

const clientId = environment.msal?.clientId ?? '';
const tenantId = environment.msal?.tenantId ?? 'common';
const redirectUri = environment.msal?.redirectUri ?? 'http://localhost:4200';
const postLogoutRedirectUri = environment.msal?.postLogoutRedirectUri ?? 'http://localhost:4200';

export function isMsalEnabled(): boolean {
  return typeof clientId === 'string' && clientId.length > 0;
}

export function msalConfig(): MsalConfiguration {
  const authority = `https://login.microsoftonline.com/${tenantId}`;
  const apiScope = clientId ? `api://${clientId}/access_as_user` : '';
  return {
    auth: {
      clientId,
      authority,
      redirectUri,
      postLogoutRedirectUri,
      navigateToLoginRequestUrl: true
    },
    cache: {
      cacheLocation: BrowserCacheLocation.SessionStorage,
      storeAuthStateInCookie: false
    },
    system: {
      loggerOptions: {
        loggerCallback: (level: LogLevel, message: string, containsPii: boolean) => {
          if (containsPii) return;
          switch (level) {
            case LogLevel.Error: console.error(message); break;
            case LogLevel.Warning: console.warn(message); break;
            case LogLevel.Info: console.info(message); break;
            case LogLevel.Verbose: console.debug(message); break;
            default: break;
          }
        },
        logLevel: LogLevel.Warning
      }
    }
  };
}

export function protectedResourceMap(): [string, string[]][] {
  // Scope must match what backend expects (AzureAd:Audience). For single app use api://<clientId>/access_as_user with same clientId as backend.
  const apiScope = (environment.msal?.apiScope) || (clientId ? `api://${clientId}/access_as_user` : '');
  // Use same base as API requests (session-api.service uses environment.apiUrl + '/api')
  const baseUrl = (typeof window !== 'undefined' && (window as any).__env?.apiUrl) || environment.apiUrl || '';
  const apiBase = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api` : '/api';
  if (!apiScope) return [];
  const entries: [string, string[]][] = [[apiBase, [apiScope]]];
  // When using full URL, also register relative /api so proxy/same-origin requests get the token
  if (apiBase !== '/api') entries.push(['/api', [apiScope]]);
  return entries;
}

/** Scopes used for API requests (same as protectedResourceMap for the API base). Use this for XHR/fetch to attach the same token as HttpClient. */
export function getApiScopes(): string[] {
  const apiScope = (environment.msal?.apiScope) || (clientId ? `api://${clientId}/access_as_user` : '');
  return apiScope ? [apiScope] : [];
}
