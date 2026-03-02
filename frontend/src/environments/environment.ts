export const environment = {
  production: false,
  apiUrl: 'http://localhost:5102', // same origin; proxy in angular.json forwards /api to backend
  // Azure AD app registration (set these in your app registration)
  msal: {
    clientId: '5c286802-9e81-4aa6-abd3-f083ad57c5dc',       // Application (client) ID from Azure portal
    tenantId: '1335991b-55a1-47b7-a4dd-177f429f0719', // 'common' for multi-tenant, or your tenant ID
    redirectUri: 'http://localhost:4200',
    postLogoutRedirectUri: 'http://localhost:4200',
    // Scope for the backend API (must match backend AzureAd:Audience or api://<clientId>)
    apiScope: 'api://andy-back/Api.Access'
  }
};
