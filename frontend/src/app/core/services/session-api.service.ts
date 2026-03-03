import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AppConfig } from '../config/app-config';

export interface SessionListItem {
  id: string;
  name: string;
  date: string;
  updated_at: string;
  is_owner?: boolean;
  owner_user_id?: string;
  owner_display_name?: string;
}

export interface SharedWithItem {
  user_id: string;
  display_name?: string;
  role: string;
  shared_at: string;
}

export interface SessionDetail {
  id: string;
  name: string;
  date: string;
  created_at?: string;
  updated_at?: string;
  is_owner?: boolean;
  owner_user_id?: string;
  owner_display_name?: string;
  shared_with?: SharedWithItem[];
  source_files: { fileName: string; content: string }[];
  target_files: { fileName: string; content: string }[];
  chat_history: { role: string; content: string }[];
  current_mapping: MappingResultDto | null;
  rules: { name: string; content: string }[];
}

export interface MappingResultDto {
  mappings: MappingItemDto[];
  unmapped_source_columns: string[];
  unmapped_target_columns: string[];
  global_confidence: number;
  analysis_summary: string;
}

export interface MappingItemDto {
  target_column: string;
  source_columns: string[];
  confidence_score: number;
  match_type: string;
  reasoning?: string;
  transformation_rule?: string;
}

export interface SessionCreateDto {
  name?: string;
  source_files: { fileName: string; content: string }[];
  target_files: { fileName: string; content: string }[];
  chat_history: { role: string; content: string }[];
  current_mapping?: MappingResultDto | null;
  rules: { name: string; content: string }[];
}

export interface SessionUpdateDto {
  name?: string;
  source_files?: { fileName: string; content: string }[];
  target_files?: { fileName: string; content: string }[];
  chat_history?: { role: string; content: string }[];
  current_mapping?: MappingResultDto | null;
  rules?: { name: string; content: string }[];
}

@Injectable({ providedIn: 'root' })
export class SessionApiService {
  constructor(private http: HttpClient) {}

  private get baseUrl(): string {
    return `${AppConfig.settings.apiUrl || ''}/api`;
  }

  private options = { withCredentials: true };

  list(): Observable<SessionListItem[]> {
    return this.http.get<SessionListItem[]>(`${this.baseUrl}/sessions`, this.options);
  }

  get(id: string): Observable<SessionDetail> {
    return this.http.get<SessionDetail>(`${this.baseUrl}/sessions/${id}`, this.options);
  }

  create(dto: SessionCreateDto): Observable<SessionListItem> {
    const body = {
      name: dto.name,
      source_files: dto.source_files,
      target_files: dto.target_files,
      chat_history: dto.chat_history,
      current_mapping: dto.current_mapping ?? null,
      rules: dto.rules,
    };
    return this.http.post<SessionListItem>(`${this.baseUrl}/sessions`, body, this.options);
  }

  update(id: string, dto: SessionUpdateDto): Observable<SessionListItem> {
    const body = {
      name: dto.name,
      source_files: dto.source_files,
      target_files: dto.target_files,
      chat_history: dto.chat_history,
      current_mapping: dto.current_mapping ?? null,
      rules: dto.rules,
    };
    return this.http.put<SessionListItem>(`${this.baseUrl}/sessions/${id}`, body, this.options);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/sessions/${id}`, this.options);
  }

  shareSession(id: string, sharedWithUserIds: string[], role: string = 'viewer', displayNames?: Record<string, string>): Observable<void> {
    const body: { shared_with_user_ids: string[]; role: string; display_names?: Record<string, string> } = { shared_with_user_ids: sharedWithUserIds, role };
    if (displayNames && Object.keys(displayNames).length) body.display_names = displayNames;
    return this.http.post<void>(`${this.baseUrl}/sessions/${id}/share`, body, this.options);
  }

  unshareSession(id: string, sharedWithUserId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/sessions/${id}/share/${encodeURIComponent(sharedWithUserId)}`, this.options);
  }

  /** Known users (with display names) for share suggestions. Optional q= prefix filter. */
  getSuggestedUsers(q?: string): Observable<{ users: { user_id: string; display_name?: string }[] }> {
    const options = q != null && q !== '' ? { ...this.options, params: { q } } : this.options;
    return this.http.get<{ users: { user_id: string; display_name?: string }[] }>(`${this.baseUrl}/users`, options);
  }
}
