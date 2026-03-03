import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { AppConfig } from '../config/app-config';
import { MsalService } from '@azure/msal-angular';
import { getApiScopes } from '../auth/msal-config';

export interface RawFileDto {
  fileName: string;
  content: string;
}

export interface MapSchemaRequest {
  source_files: RawFileDto[];
  target_files: RawFileDto[];
  user_instruction?: string;
  rules?: string;
}

export interface MappingItemDto {
  target_column: string;
  source_columns: string[];
  confidence_score: number;
  match_type: string;
  reasoning?: string;
  transformation_rule?: string;
}

export interface MappingResultDto {
  mappings: MappingItemDto[];
  unmapped_source_columns: string[];
  unmapped_target_columns: string[];
  global_confidence: number;
  analysis_summary: string;
}

export interface RefineMappingRequest {
  source_files: RawFileDto[];
  target_files: RawFileDto[];
  current_mapping: MappingResultDto;
  messages: { role: string; content: string }[];
  user_message: string;
  rules?: string;
}

export interface RefineMappingResponse {
  mapping: MappingResultDto;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class MappingApiService {
  private readonly baseUrl = AppConfig.settings.apiUrl;
  private readonly msal = inject(MsalService, { optional: true });

  constructor(private http: HttpClient) {}

  mapSchemaStream(
    request: MapSchemaRequest,
    onProgress: (phase: string, detail: string) => void,
    onToken: (token: string) => void,
    onXhr?: (xhr: XMLHttpRequest) => void
  ): Observable<MappingResultDto> {
    const scopes = getApiScopes();
    const account = this.msal?.instance?.getAllAccounts()?.[0];

    console.log('[SSE] scopes:', scopes, '| account:', account?.username ?? 'none');

    const tokenPromise: Promise<string | null> =
      scopes.length && account && this.msal
        ? this.msal.instance
            .acquireTokenSilent({ scopes, account })
            .then((res) => {
              console.log('[SSE] acquireTokenSilent OK, accessToken length:', res?.accessToken?.length);
              return res?.accessToken ?? null;
            })
            .catch((err) => {
              console.error('[SSE] acquireTokenSilent FAILED:', err);
              return null;
            })
        : Promise.resolve(null);

    return from(tokenPromise).pipe(
      switchMap((token) => {
        console.log('[SSE] Token for XHR:', token ? `OK (${token.slice(0, 20)}…)` : 'NULL — expect 401');
        return new Observable<MappingResultDto>((subscriber) => {
          const body = JSON.stringify(request);
          const xhr = new XMLHttpRequest();
          if (onXhr) onXhr(xhr);
          let buffer = '';
          let eventType = '';
          let gotResult = false;
          let pendingData = '';

          console.log('[SSE] Starting map-schema-stream request');

          xhr.open('POST', `${this.baseUrl}/api/map-schema-stream`);
          xhr.setRequestHeader('Content-Type', 'application/json');
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
          xhr.withCredentials = true;

          xhr.onreadystatechange = () => {
        if (xhr.readyState !== 3 && xhr.readyState !== 4) return;

        const text = xhr.responseText;
        const newPart = text.slice(buffer.length);
        buffer = text;

        if (!newPart) {
          if (xhr.readyState === 4 && !gotResult && !subscriber.closed) {
            const status = xhr.status;
            console.error(`[SSE] Connection closed (status ${status}) without receiving a result event. Response length: ${buffer.length}`);
            if (status === 0) {
              subscriber.error(new Error('Connection failed — is the API server running?'));
            } else if (status !== 200) {
              subscriber.error(new Error(`API returned status ${status}: ${xhr.statusText}`));
            } else {
              subscriber.error(new Error('Stream ended without a result. Check API server logs.'));
            }
          }
          return;
        }

        const chunk = pendingData + newPart;
        const lines = chunk.split('\n');
        pendingData = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('event: ')) {
            eventType = trimmed.slice(7).trim();
          } else if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const data = JSON.parse(jsonStr);
              console.log(`[SSE] event=${eventType}`, eventType === 'token' ? '(token)' : data);
              if (eventType === 'progress') {
                onProgress(data.phase ?? '', data.detail ?? '');
              } else if (eventType === 'token') {
                onToken(data.token ?? '');
              } else if (eventType === 'result') {
                gotResult = true;
                subscriber.next(data);
                subscriber.complete();
                return;
              } else if (eventType === 'error') {
                gotResult = true;
                console.error('[SSE] Server error event:', data);
                subscriber.error(new Error(data.error ?? 'Unknown server error'));
                return;
              } else {
                console.warn(`[SSE] Unknown event type: '${eventType}'`, data);
              }
            } catch (parseErr) {
              console.warn(`[SSE] JSON parse failed for event '${eventType}':`, jsonStr.slice(0, 200), parseErr);
            }
            eventType = '';
          }
        }

        if (xhr.readyState === 4 && !gotResult && !subscriber.closed) {
          const status = xhr.status;
          console.error(`[SSE] XHR done (status ${status}), no result event received. Buffer length: ${buffer.length}`);
          if (buffer.length < 500) console.error('[SSE] Full response:', buffer);
          if (status === 0) {
            subscriber.error(new Error('Connection failed — is the API server running?'));
          } else if (status !== 200) {
            try {
              const errBody = JSON.parse(buffer);
              subscriber.error(new Error(errBody.error || `API error ${status}`));
            } catch {
              subscriber.error(new Error(`API returned status ${status}: ${xhr.statusText || 'Unknown error'}`));
            }
          } else {
            subscriber.error(new Error('Stream completed without a mapping result. Check API server logs for errors.'));
          }
        }
      };

      xhr.onerror = () => {
        console.error('[SSE] XHR network error');
        subscriber.error(new Error('Network error — check that the API server is running'));
      };

      xhr.ontimeout = () => {
        console.error('[SSE] XHR timeout');
        subscriber.error(new Error('Request timed out'));
      };

      xhr.send(body);
        });
      })
    );
  }

  refineMapping(request: RefineMappingRequest): Observable<RefineMappingResponse> {
    return this.http
      .post<RefineMappingResponse>(`${this.baseUrl}/api/refine-mapping`, request)
      .pipe(catchError((err) => { throw err.error?.error || err.message; }));
  }
}
