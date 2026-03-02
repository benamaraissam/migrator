# User identity: cookie vs OAuth 2 / Azure AD

## Current behaviour (no auth)

- **Cookie** `migrator_uid`: API sets it on first request; browser sends it back. Used as `OwnerUserId` for sessions.
- **X-User-Id** (optional): Not used today. Could be added as a fallback when the cookie is blocked (e.g. private/incognito).

These are **not** part of OAuth 2. They are anonymous identifiers so the app works without login.

---

## With OAuth 2 + Azure AD app registration (delegation)

**One-way authentication only:** Use a **single** Azure AD app registration. The SPA gets a token via Azure AD (redirect login); the API **only validates** that token. No client secret, no server-to-server auth — the API trusts the JWT from Azure AD.

You **do not** use X-User-Id or the cookie for identity. The user id comes from the **JWT access token**.

### Flow

1. **Azure AD app registration** (one app for both SPA and API)
   - **Frontend (SPA)**:
     - Platform: Single-page application.
     - Redirect URIs: e.g. `http://localhost:4200`, `https://your-app.com`.
     - Under **Authentication**: allow implicit/auth code flow as needed; for SPA typically **Authorization code + PKCE**.
   - **API**:
     - Expose an API: scope e.g. `api://<client-id>/access_as_user` (delegated).
   - Under **API permissions**: add the delegated scope above so the SPA can request it.

2. **Frontend (Angular)**
   - Use **MSAL Angular** (`@azure/msal-angular`) with the SPA’s client id, tenant id, redirect URI.
   - Set `msal.clientId` and `msal.tenantId` (and optionally `redirectUri`, `postLogoutRedirectUri`) in `frontend/src/environments/environment.ts` (and `environment.prod.ts` for production). If `clientId` is empty, auth is disabled and no Sign in / Sign out is shown.
   - The app subscribes to `MsalService.handleRedirectObservable()` in `AppComponent` so the redirect after Azure AD login is processed.
   - **Sign in / Sign out**: In the Migrator sidebar, when auth is enabled you get “Sign in” (calls `AuthService.login()`) and “Sign out” (calls `AuthService.logout()`). When logged in, the current user name (or email) is shown.
   - On login, MSAL gets an **access token** for the API scope (e.g. `api://<client-id>/access_as_user`).
   - For each HTTP call to the API, send:  
     `Authorization: Bearer <access_token>`  
   (handled by `MsalInterceptor` and `protectedResourceMap`). No X-User-Id header; the token **is** the identity.

3. **Backend (.NET API)**
   - Use **Microsoft.Identity.Web** (or JWT Bearer) to validate the token:
     - Authority: `https://login.microsoftonline.com/<tenant-id>/v2.0`
     - Audience: your API’s scope (e.g. `api://<client-id>`) or client id.
   - **Backend**: `SessionsController` and `MappingController` are marked with `[Authorize]`. When `AzureAd:ClientId` is set, `UseAuthentication()` and `UseAuthorization()` run; requests without a valid Bearer token get **401 Unauthorized**.
   - **User id** for sessions: read from the **validated token’s claims**, e.g.:
     - `oid` (object id) – stable Azure AD user id (recommended for `OwnerUserId`).
     - or `sub` (subject).  
   So “X-User-Id” is **replaced** by the token’s `oid` (or `sub`); you never send a custom X-User-Id when using OAuth 2.

### What “user id” means with OAuth 2

| Source        | Use for `OwnerUserId` / DB |
|---------------|-----------------------------|
| Cookie / X-User-Id | Anonymous id (no login)     |
| JWT claim `oid`   | Azure AD user (with login)  |

With Azure AD:

- Frontend: no X-User-Id; only `Authorization: Bearer <token>`.
- Backend: `userId = User.FindFirstValue("oid")` (or similar) after validating the token. Use that as the “user id” for connecting sessions to the signed-in user.

So: **you don’t need an “X-User-Id” to connect with OAuth 2 Azure AD; the backend gets the user from the JWT (e.g. `oid`) when using app registration and delegation.**
