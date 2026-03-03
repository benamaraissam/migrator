export interface AppConfigData {
  apiUrl: string;
  msal?: {
    clientId?: string;
    tenantId?: string;
    redirectUri?: string;
    postLogoutRedirectUri?: string;
    apiScope?: string;
  };
}

export class AppConfig {
  private static _config: AppConfigData = { apiUrl: '' };

  static get settings(): AppConfigData {
    return this._config;
  }

  static async load(): Promise<void> {
    const response = await fetch('assets/config/config.json');
    if (!response.ok) {
      console.error(`Failed to load config.json (status ${response.status})`);
      return;
    }
    this._config = await response.json();
  }
}
