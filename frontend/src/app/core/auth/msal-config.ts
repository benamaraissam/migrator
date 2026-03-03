import { LogLevel, Configuration as MsalConfiguration, BrowserCacheLocation } from '@azure/msal-browser';
import { AppConfig } from '../config/app-config';

export function isMsalEnabled(): boolean {
  const clientId = AppConfig.settings.msal?.clientId ?? '';
  return typeof clientId === 'string' && clientId.length > 0;
}

export function msalConfig(): MsalConfiguration {
  const cfg = AppConfig.settings;
  const clientId = cfg.msal?.clientId ?? '';
  const tenantId = cfg.msal?.tenantId ?? 'common';
  const redirectUri = cfg.msal?.redirectUri ?? 'http://localhost:4200';
  const postLogoutRedirectUri = cfg.msal?.postLogoutRedirectUri ?? 'http://localhost:4200';
  const authority = `https://login.microsoftonline.com/${tenantId}`;

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
  const cfg = AppConfig.settings;
  const clientId = cfg.msal?.clientId ?? '';
  const apiScope = cfg.msal?.apiScope || (clientId ? `api://${clientId}/access_as_user` : '');
  const baseUrl = cfg.apiUrl || '';
  const apiBase = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api` : '/api';
  if (!apiScope) return [];
  const entries: [string, string[]][] = [[apiBase, [apiScope]]];
  if (apiBase !== '/api') entries.push(['/api', [apiScope]]);
  return entries;
}

export function getApiScopes(): string[] {
  const cfg = AppConfig.settings;
  const clientId = cfg.msal?.clientId ?? '';
  const apiScope = cfg.msal?.apiScope || (clientId ? `api://${clientId}/access_as_user` : '');
  return apiScope ? [apiScope] : [];
}
