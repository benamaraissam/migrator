import { Injectable, inject } from '@angular/core';
import { MsalService } from '@azure/msal-angular';
import { isMsalEnabled } from './msal-config';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly msal = inject(MsalService, { optional: true });

  get isAuthEnabled(): boolean {
    return isMsalEnabled();
  }

  get isLoggedIn(): boolean {
    if (!this.msal?.instance) return false;
    const accounts = this.msal.instance.getAllAccounts();
    return accounts.length > 0;
  }

  get currentUser(): { name?: string; email?: string; oid?: string } | null {
    if (!this.msal?.instance) return null;
    const accounts = this.msal.instance.getAllAccounts();
    const account = accounts[0];
    if (!account) return null;
    return {
      name: account.name ?? undefined,
      email: account.idTokenClaims?.['preferred_username'] as string ?? account.username,
      oid: account.idTokenClaims?.['oid'] as string ?? undefined
    };
  }

  /** Returns the access token for the API scope, or null if not logged in / MSAL disabled. */
  async getAccessToken(): Promise<string | null> {
    if (!this.msal?.instance) return null;
    const accounts = this.msal.instance.getAllAccounts();
    const account = accounts[0];
    if (!account) return null;
    const apiScope = environment.msal?.apiScope;
    if (!apiScope) return null;
    try {
      const result = await this.msal.instance.acquireTokenSilent({ scopes: [apiScope], account });
      return result?.accessToken ?? null;
    } catch {
      return null;
    }
  }

  login(): void {
    this.msal?.loginRedirect();
  }

  logout(): void {
    this.msal?.logoutRedirect();
  }
}
