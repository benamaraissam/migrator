import { Component, ViewEncapsulation, NgZone, ElementRef, ViewChild, AfterViewInit, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MappingApiService, type MappingResultDto, type MappingItemDto, type RawFileDto } from '../../core/services/mapping-api.service';
import { SessionApiService, type SessionListItem, type SessionDetail, type SharedWithItem } from '../../core/services/session-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { FilePreviewComponent } from '../../shared/components/file-preview/file-preview.component';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ChatMsg { role: 'user' | 'assistant'; content: string; }
interface RuleItem { name: string; content: string; }
interface MappingRow extends MappingItemDto {
  _status: 'pending' | 'validated';
  _original?: MappingItemDto;
}

const OPENED_SHARED_SESSION_IDS_KEY = 'migrator_opened_shared_session_ids';

const EXAMPLE_SOURCE_FILES: RawFileDto[] = [
  {
    fileName: 'customers_old.json',
    content: JSON.stringify({
      table_name: 'customers_old',
      columns: [
        { name: 'first_name', data_type: 'varchar', nullable: false, sample_values: ['John', 'Anna'] },
        { name: 'last_name', data_type: 'varchar', nullable: false, sample_values: ['Doe', 'Smith'] },
        { name: 'dob', data_type: 'date', nullable: true, sample_values: ['1990-01-01'] },
        { name: 'email', data_type: 'varchar', nullable: true }
      ]
    }, null, 2)
  },
  {
    fileName: 'products_legacy.csv',
    content: [
      'table_name,column_name,data_type,nullable,description',
      'products_legacy,product_id,int,false,Primary key',
      'products_legacy,product_name,varchar,false,Product display name',
      'products_legacy,price,decimal,false,Unit price',
      'products_legacy,created_at,timestamp,false,Creation date'
    ].join('\n')
  },
  {
    fileName: 'orders_schema.txt',
    content: [
      '=== ORDERS TABLE (orders_legacy) ===',
      'order_id (bigint, PK)',
      'customer_id (int, FK to customers)',
      'order_date (date)',
      'total_amount (decimal(10,2))',
      'status (varchar: PENDING, SHIPPED, CANCELLED)'
    ].join('\n')
  }
];

const EXAMPLE_TARGET_FILES: RawFileDto[] = [
  {
    fileName: 'customers_new.json',
    content: JSON.stringify({
      table_name: 'customers_new',
      columns: [
        { name: 'full_name', data_type: 'string', nullable: false },
        { name: 'birth_date', data_type: 'datetime', nullable: true },
        { name: 'email', data_type: 'string', nullable: true }
      ]
    }, null, 2)
  },
  {
    fileName: 'target_schema.csv',
    content: [
      'table,column,type,nullable',
      'products_new,id,string,false',
      'products_new,name,string,false',
      'products_new,unit_price,double,false',
      'products_new,created_at,datetime,false',
      'orders_new,order_id,string,false',
      'orders_new,customer_ref,string,false',
      'orders_new,order_date,date,false',
      'orders_new,amount,double,false',
      'orders_new,status,string,false'
    ].join('\n')
  }
];

@Component({
  selector: 'app-migrator',
  standalone: true,
  imports: [CommonModule, FormsModule, FilePreviewComponent],
  templateUrl: './migrator.component.html',
  styleUrl: './migrator.component.css',
  encapsulation: ViewEncapsulation.None
})
export class MigratorComponent implements OnInit, AfterViewInit, OnDestroy {
  sourceFiles: RawFileDto[] = [];
  targetFiles: RawFileDto[] = [];
  userInstruction = '';
  currentMapping: MappingResultDto | null = null;
  mappingRows: MappingRow[] = [];
  chatHistory: ChatMsg[] = [];
  streamLog: string[] = [];
  streamTokens = '';
  isGenerating = false;
  errorMessage = '';

  selectedSourceFile: RawFileDto | null = null;
  selectedTargetFile: RawFileDto | null = null;

  // Rules
  rules: RuleItem[] = [];
  rulesCollapsed = true;
  sessionCollapsed = false;
  rulesDropdownOpen = false;
  /** When set, the rule editor is in "edit" mode for this index; when null, it's "add new". */
  editingRuleIndex: number | null = null;
  showRuleEditor = false;
  ruleEditorName = '';
  ruleEditorContent = '';

  // Session
  showSessionPicker = false;
  savedSessions: SessionListItem[] = [];
  /** IDs of shared sessions the user has opened (load); used to show/hide unread badge. Persisted in localStorage. */
  openedSharedSessionIds = new Set<string>();
  currentSessionId: string | null = null;
  currentSessionName = '';
  currentSessionMeta: { is_owner: boolean; owner_user_id?: string; owner_display_name?: string; shared_with: SharedWithItem[] } | null = null;
  shareUserInput = '';
  shareRole: 'viewer' | 'editor' = 'viewer';
  suggestedUsers: { user_id: string; display_name?: string }[] = [];
  showShareSuggestions = false;
  shareInputReadonly = true;
  /** Display name of the user currently selected in the share input (so we can show it in the list after Add). */
  selectedShareDisplayName: string | null = null;
  /** user_id that had selectedShareDisplayName (so we only use the name when input still matches). */
  selectedShareUserId: string | null = null;

  // Mapping controls
  mappingState: 'normal' | 'minimized' | 'maximized' = 'normal';
  showExportMenu = false;
  showUnmappedOnly = false;
  unmappedCount = 0;
  collapsedMappingGroups = new Set<string>();

  // Stream overlay
  showStreamOverlay = false;

  // Source picker for changing mapped source
  showSourcePicker = false;
  sourcePickerRowIdx = -1;
  sourcePickerOptions: string[] = [];
  sourcePickerQuery = '';
  sourcePickerMatchType = '';
  sourcePickerConfidence = 0;
  sourcePickerTransformation = '';
  pickerTop = 0;
  pickerLeft = 0;

  // SQL autocomplete
  sqlSuggestions: string[] = [];
  sqlSuggestionIdx = -1;
  sqlShowSuggestions = false;
  private sqlKeywords = ['SELECT', 'FROM', 'WHERE', 'AS', 'CAST', 'COALESCE', 'CONCAT', 'TRIM', 'UPPER', 'LOWER', 'SUBSTRING', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'REPLACE', 'CONVERT', 'VARCHAR', 'INT', 'INTEGER', 'BIGINT', 'FLOAT', 'DOUBLE', 'DECIMAL', 'DATE', 'DATETIME', 'TIMESTAMP', 'STRING', 'BOOLEAN', 'TRUE', 'FALSE'];

  matchTypes = [
    { value: 'exact', label: 'Exact', color: '#16a34a' },
    { value: 'semantic', label: 'Semantic', color: '#2563eb' },
    { value: 'derived', label: 'Derived', color: '#9333ea' },
    { value: 'transformed', label: 'Transformed', color: '#ca8a04' },
    { value: 'manual', label: 'Manual', color: '#0891b2' },
    { value: 'incompatible', label: 'Incompatible', color: '#dc2626' },
  ];

  // Session toast
  sessionToast = '';
  sessionToastFading = false;

  // XHR reference for stop
  private currentXhr: XMLHttpRequest | null = null;

  @ViewChild('vSplitter') vSplitterRef!: ElementRef<HTMLElement>;
  @ViewChild('hSplitter') hSplitterRef!: ElementRef<HTMLElement>;
  @ViewChild('topRow') topRowRef!: ElementRef<HTMLElement>;
  @ViewChild('bottomRow') bottomRowRef!: ElementRef<HTMLElement>;
  @ViewChild('chatMessagesEl') chatMessagesEl!: ElementRef<HTMLElement>;

  private cleanupFns: (() => void)[] = [];

  constructor(
    private api: MappingApiService,
    private sessionApi: SessionApiService,
    public auth: AuthService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    try {
      const raw = localStorage.getItem(OPENED_SHARED_SESSION_IDS_KEY);
      if (raw) {
        const ids: string[] = JSON.parse(raw);
        if (Array.isArray(ids)) this.openedSharedSessionIds = new Set(ids);
      }
    } catch (_) { /* ignore */ }
    this.loadSessionsList();
  }

  ngAfterViewInit(): void {
    this.initSplitters();
  }

  ngOnDestroy(): void {
    this.cleanupFns.forEach(fn => fn());
  }

  // ── Files ──
  onSourceFiles(files: FileList | null): void {
    if (!files?.length) return;
    Array.from(files).forEach(f => {
      f.text().then(content => {
        const file: RawFileDto = { fileName: f.name, content };
        this.sourceFiles = [...this.sourceFiles, file];
        if (!this.selectedSourceFile) this.selectedSourceFile = file;
        this.cdr.detectChanges();
      });
    });
  }

  onTargetFiles(files: FileList | null): void {
    if (!files?.length) return;
    Array.from(files).forEach(f => {
      f.text().then(content => {
        const file: RawFileDto = { fileName: f.name, content };
        this.targetFiles = [...this.targetFiles, file];
        if (!this.selectedTargetFile) this.selectedTargetFile = file;
        this.cdr.detectChanges();
      });
    });
  }

  removeSourceFile(f: RawFileDto): void {
    this.sourceFiles = this.sourceFiles.filter(x => x !== f);
    if (this.selectedSourceFile === f) this.selectedSourceFile = this.sourceFiles[0] || null;
  }

  removeTargetFile(f: RawFileDto): void {
    this.targetFiles = this.targetFiles.filter(x => x !== f);
    if (this.selectedTargetFile === f) this.selectedTargetFile = this.targetFiles[0] || null;
  }

  selectSourceFile(f: RawFileDto): void { this.selectedSourceFile = f; }
  selectTargetFile(f: RawFileDto): void { this.selectedTargetFile = f; }

  loadExample(): void {
    this.sourceFiles = EXAMPLE_SOURCE_FILES.map(f => ({ fileName: f.fileName, content: f.content }));
    this.targetFiles = EXAMPLE_TARGET_FILES.map(f => ({ fileName: f.fileName, content: f.content }));
    this.selectedSourceFile = this.sourceFiles[0] ?? null;
    this.selectedTargetFile = this.targetFiles[0] ?? null;
    this.currentMapping = null;
    this.mappingRows = [];
  }

  onDrop(event: DragEvent, side: 'source' | 'target'): void {
    event.preventDefault();
    event.stopPropagation();
    const dt = event.dataTransfer;
    if (!dt?.files?.length) return;
    if (side === 'source') this.onSourceFiles(dt.files);
    else this.onTargetFiles(dt.files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  // ── Chat ──
  sendMessage(): void {
    const text = this.userInstruction.trim();
    if (!text) return;
    if (!this.sourceFiles.length || !this.targetFiles.length) {
      this.errorMessage = 'Add at least one source and one target file.';
      return;
    }
    this.errorMessage = '';
    this.chatHistory.push({ role: 'user', content: text });
    this.userInstruction = '';
    this.isGenerating = true;
    this.streamLog = [];
    this.streamTokens = '';

    const rulesText = this.rules.map(r => r.content).join('\n\n') || undefined;

    console.log('[Migrator] Sending message:', text, '| Files:', this.sourceFiles.length, 'source,', this.targetFiles.length, 'target');

    this.api.mapSchemaStream(
      {
        source_files: this.sourceFiles,
        target_files: this.targetFiles,
        user_instruction: text,
        rules: rulesText
      },
      (phase, detail) => this.zone.run(() => { this.streamLog = [...this.streamLog, `${phase}: ${detail}`]; }),
      (token) => this.zone.run(() => { this.streamTokens += token; }),
      (xhr) => { this.currentXhr = xhr; }
    ).subscribe({
      next: (result) => this.zone.run(() => {
        console.log('[Migrator] Received mapping result:', result.mappings?.length, 'mappings');
        this.currentMapping = result;
        this.buildMappingRows();
        this.chatHistory.push({ role: 'assistant', content: result.analysis_summary || 'Mapping generated.' });
        this.isGenerating = false;
        this.currentXhr = null;
        this.scrollChat();
      }),
      error: (err) => this.zone.run(() => {
        console.error('[Migrator] Stream error:', err);
        this.errorMessage = err?.message || String(err);
        this.isGenerating = false;
        this.currentXhr = null;
      })
    });
  }

  stopGeneration(): void {
    if (this.currentXhr) {
      this.currentXhr.abort();
      this.currentXhr = null;
    }
    this.isGenerating = false;
  }

  scrollChat(): void {
    setTimeout(() => {
      if (this.chatMessagesEl?.nativeElement) {
        this.chatMessagesEl.nativeElement.scrollTop = this.chatMessagesEl.nativeElement.scrollHeight;
      }
    }, 50);
  }

  // ── Mapping rows ──
  private buildMappingRows(): void {
    if (!this.currentMapping) { this.mappingRows = []; this.unmappedCount = 0; this.collapsedMappingGroups.clear(); return; }
    const rows: MappingRow[] = this.currentMapping.mappings.map(m => ({
      ...m, _status: 'pending' as const, _original: { ...m }
    }));
    const unmappedTarget = this.currentMapping.unmapped_target_columns || [];
    unmappedTarget.forEach(col => {
      rows.push({
        target_column: col, source_columns: [], confidence_score: 0, match_type: '',
        _status: 'pending', _original: undefined
      });
    });
    this.mappingRows = rows;
    this.unmappedCount = unmappedTarget.length;
    this.collapsedMappingGroups.clear();
  }

  isMapped(row: MappingRow): boolean { return row.source_columns.length > 0; }

  validateRow(idx: number): void {
    if (this.mappingRows[idx]) this.mappingRows[idx]._status = 'validated';
  }

  rollbackRow(idx: number): void {
    const row = this.mappingRows[idx];
    if (row._original) {
      row.source_columns = [...row._original.source_columns];
      row.confidence_score = row._original.confidence_score;
      row.match_type = row._original.match_type;
      row.reasoning = row._original.reasoning;
      row.transformation_rule = row._original.transformation_rule;
    }
    row._status = 'pending';
  }

  unmapRow(idx: number): void {
    const row = this.mappingRows[idx];
    row.source_columns = [];
    row.confidence_score = 0;
    row.match_type = '';
    row.reasoning = undefined;
    row.transformation_rule = undefined;
    row._status = 'pending';
    this.unmappedCount = this.mappingRows.filter(r => !this.isMapped(r)).length;
  }

  openSourcePicker(event: MouseEvent, idx: number): void {
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this.pickerTop = rect.bottom + 4;
    this.pickerLeft = rect.left;
    this.sourcePickerOptions = this.collectAllSourceColumns();
    this.sourcePickerQuery = '';
    this.sourcePickerRowIdx = idx;
    const row = this.mappingRows[idx];
    this.sourcePickerMatchType = row?.match_type || '';
    this.sourcePickerConfidence = Math.max(0, Math.min(100, this.confPercent(row?.confidence_score ?? 0)));
    this.sourcePickerTransformation = row?.transformation_rule || '';
    this.showSourcePicker = true;

    setTimeout(() => {
      const popup = document.querySelector('.source-picker-popup') as HTMLElement;
      if (!popup) return;
      const popRect = popup.getBoundingClientRect();
      if (popRect.right > window.innerWidth - 8) this.pickerLeft = window.innerWidth - popRect.width - 8;
      if (popRect.bottom > window.innerHeight - 8) this.pickerTop = rect.top - popRect.height - 4;
    }, 0);
  }

  isCurrentSource(col: string): boolean {
    if (this.sourcePickerRowIdx < 0) return false;
    const row = this.mappingRows[this.sourcePickerRowIdx];
    return row?.source_columns?.includes(col) ?? false;
  }

  pickSource(col: string): void {
    if (this.sourcePickerRowIdx >= 0 && this.mappingRows[this.sourcePickerRowIdx]) {
      const row = this.mappingRows[this.sourcePickerRowIdx];
      if (row.source_columns.includes(col)) {
        row.source_columns = row.source_columns.filter(c => c !== col);
      } else {
        row.source_columns = [...row.source_columns, col];
      }

      if (row.source_columns.length === 0) {
        row.match_type = '';
        row.confidence_score = 0;
        row.reasoning = undefined;
        row.transformation_rule = undefined;
        this.sourcePickerMatchType = '';
        this.sourcePickerConfidence = 0;
        this.sourcePickerTransformation = '';
      } else {
        row.match_type = row.match_type || 'semantic';
        if (!this.sourcePickerMatchType) this.sourcePickerMatchType = row.match_type;
      }
      row._status = 'pending';
    }
    this.unmappedCount = this.mappingRows.filter(r => !this.isMapped(r)).length;
  }

  closeSourcePicker(): void {
    this.showSourcePicker = false;
    this.sourcePickerQuery = '';
    this.sqlShowSuggestions = false;
  }

  setMatchType(type: string): void {
    this.sourcePickerMatchType = type;
    this.applySourcePickerMetadata();
  }

  applySourcePickerMetadata(): void {
    if (this.sourcePickerRowIdx < 0 || !this.mappingRows[this.sourcePickerRowIdx]) return;
    const row = this.mappingRows[this.sourcePickerRowIdx];
    const confidence = Number(this.sourcePickerConfidence);
    const safeConfidence = Number.isFinite(confidence) ? Math.min(100, Math.max(0, confidence)) : 0;
    this.sourcePickerConfidence = safeConfidence;

    row.match_type = (this.sourcePickerMatchType || '').trim();
    row.confidence_score = safeConfidence;
    const tr = (this.sourcePickerTransformation || '').trim();
    row.transformation_rule = tr || undefined;
    row._status = 'pending';
  }

  getConfGradient(): string {
    const c = this.sourcePickerConfidence;
    if (c >= 80) return 'linear-gradient(90deg, #16a34a, #22c55e)';
    if (c >= 50) return 'linear-gradient(90deg, #ca8a04, #eab308)';
    return 'linear-gradient(90deg, #dc2626, #ef4444)';
  }

  highlightedSql(): SafeHtml {
    const text = this.sourcePickerTransformation || '';
    if (!text) return this.sanitizer.bypassSecurityTrustHtml('\n');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const kwSet = new Set(this.sqlKeywords.map(k => k.toLowerCase()));
    const colSet = new Set(this.sourcePickerOptions.map(c => c.toLowerCase()));

    const html = esc(text)
      .replace(/'[^']*'/g, (s) => `<span class="sql-str">${s}</span>`)
      .replace(/\b[\w.]+\b/g, (word) => {
        const low = word.toLowerCase();
        if (kwSet.has(low)) return `<span class="sql-kw">${word}</span>`;
        if (colSet.has(low) || colSet.has(low.replace(/^\w+\./, ''))) return `<span class="sql-col">${word}</span>`;
        if (/^\d+(\.\d+)?$/.test(word)) return `<span class="sql-num">${word}</span>`;
        return word;
      }) + '\n';
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  onSqlInput(): void {
    this.applySourcePickerMetadata();
    const text = this.sourcePickerTransformation || '';
    const wordMatch = text.match(/[\w.]+$/);
    if (!wordMatch || wordMatch[0].length < 1) {
      this.sqlShowSuggestions = false;
      return;
    }
    const prefix = wordMatch[0].toLowerCase();
    const cols = this.sourcePickerOptions
      .filter(c => c.toLowerCase().startsWith(prefix) && c.toLowerCase() !== prefix);
    const kws = this.sqlKeywords
      .filter(k => k.toLowerCase().startsWith(prefix) && k.toLowerCase() !== prefix);
    this.sqlSuggestions = [...cols, ...kws].slice(0, 14);
    this.sqlSuggestionIdx = 0;
    this.sqlShowSuggestions = this.sqlSuggestions.length > 0;
  }

  onSqlKeydown(event: KeyboardEvent): void {
    if (!this.sqlShowSuggestions) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.sqlSuggestionIdx = Math.min(this.sqlSuggestionIdx + 1, this.sqlSuggestions.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.sqlSuggestionIdx = Math.max(this.sqlSuggestionIdx - 1, 0);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && this.sqlSuggestionIdx >= 0) {
      event.preventDefault();
      this.applySqlSuggestion(this.sqlSuggestions[this.sqlSuggestionIdx]);
    } else if (event.key === 'Escape') {
      this.sqlShowSuggestions = false;
    }
  }

  applySqlSuggestion(suggestion: string): void {
    const text = this.sourcePickerTransformation || '';
    const wordMatch = text.match(/[\w.]+$/);
    if (wordMatch) {
      this.sourcePickerTransformation = text.slice(0, text.length - wordMatch[0].length) + suggestion + ' ';
    } else {
      this.sourcePickerTransformation = text + suggestion + ' ';
    }
    this.sqlShowSuggestions = false;
    this.applySourcePickerMetadata();
  }

  isSqlKeyword(s: string): boolean {
    return this.sqlKeywords.includes(s.toUpperCase());
  }

  sqlLineNumbers(): number[] {
    const text = this.sourcePickerTransformation || '';
    const count = (text.match(/\n/g) || []).length + 1;
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  syncSqlScroll(event: Event): void {
    const ta = event.target as HTMLTextAreaElement;
    const wrap = ta.closest('.sql-editor-wrap');
    if (!wrap) return;
    const gutter = wrap.querySelector('.sql-gutter') as HTMLElement;
    const pre = wrap.querySelector('.sql-highlight') as HTMLElement;
    if (gutter) gutter.scrollTop = ta.scrollTop;
    if (pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }
  }

  filteredSourcePickerOptions(): string[] {
    const q = this.sourcePickerQuery.trim().toLowerCase();
    if (!q) return this.sourcePickerOptions;
    return this.sourcePickerOptions.filter(col => col.toLowerCase().includes(q));
  }

  private collectAllSourceColumns(): string[] {
    const cols: string[] = [];
    this.sourceFiles.forEach(f => {
      try {
        const parsed = JSON.parse(f.content);
        if (parsed?.columns) {
          const tbl = parsed.table_name || f.fileName.replace(/\.[^.]+$/, '');
          parsed.columns.forEach((c: any) => cols.push(`${tbl}.${c.name}`));
        } else if (Array.isArray(parsed) && parsed.length) {
          const tbl = f.fileName.replace(/\.[^.]+$/, '');
          Object.keys(parsed[0]).forEach(k => cols.push(`${tbl}.${k}`));
        }
      } catch {
        const lines = f.content.trim().split(/\r?\n/);
        if (lines.length) {
          const tbl = f.fileName.replace(/\.[^.]+$/, '');
          const headers = lines[0].split(/[,;\t|]/);
          headers.forEach(h => { if (h.trim()) cols.push(`${tbl}.${h.trim()}`); });
        }
      }
    });
    return cols;
  }

  groupedMappings(): { table: string; rows: { row: MappingRow; idx: number }[]; mappedCount: number; unmappedCount: number; totalCount: number; avgConf: number; confColor: string; sourceTables: string[] }[] {
    const allGroups = new Map<string, { row: MappingRow; idx: number }[]>();
    this.mappingRows.forEach((row, idx) => {
      const parts = row.target_column.split('.');
      const table = parts.length > 1 ? parts.slice(0, -1).join('.') : 'Mappings';
      if (!allGroups.has(table)) allGroups.set(table, []);
      allGroups.get(table)!.push({ row, idx });
    });

    return Array.from(allGroups.entries()).map(([table, allRows]) => {
      const mappedItems = allRows.filter(r => this.isMapped(r.row));
      const unmappedItems = allRows.filter(r => !this.isMapped(r.row));
      const avgConf = mappedItems.length
        ? mappedItems.reduce((s, r) => s + this.confPercent(r.row.confidence_score), 0) / mappedItems.length
        : 0;
      const srcTables = new Set<string>();
      mappedItems.forEach(r => {
        (r.row.source_columns || []).forEach(sc => {
          const dot = sc.indexOf('.');
          if (dot > 0) srcTables.add(sc.substring(0, dot));
        });
      });
      const visibleRows = this.showUnmappedOnly ? allRows.filter(r => !this.isMapped(r.row)) : allRows;
      return {
        table,
        rows: visibleRows,
        mappedCount: mappedItems.length,
        unmappedCount: unmappedItems.length,
        totalCount: allRows.length,
        avgConf: Math.round(avgConf),
        confColor: this.getConfColor(avgConf),
        sourceTables: [...srcTables]
      };
    });
  }

  toggleUnmappedFilter(): void {
    this.showUnmappedOnly = !this.showUnmappedOnly;
  }

  toggleMappingGroup(table: string): void {
    if (this.collapsedMappingGroups.has(table)) this.collapsedMappingGroups.delete(table);
    else this.collapsedMappingGroups.add(table);
  }

  isMappingGroupCollapsed(table: string): boolean {
    return this.collapsedMappingGroups.has(table);
  }

  getConfColor(pct: number): string {
    if (pct >= 80) return 'var(--accent)';
    if (pct >= 50) return 'var(--yellow)';
    return 'var(--red)';
  }

  // ── Rules ──
  toggleRules(): void { this.rulesCollapsed = !this.rulesCollapsed; }
  toggleSession(): void { this.sessionCollapsed = !this.sessionCollapsed; }
  toggleRulesDropdown(e: Event): void { e.stopPropagation(); this.rulesDropdownOpen = !this.rulesDropdownOpen; }

  addRuleFromFile(input: HTMLInputElement): void {
    const files = input.files;
    if (!files?.length) return;
    Array.from(files).forEach(f => {
      f.text().then(content => {
        this.rules = [...this.rules, { name: f.name, content }];
        this.cdr.detectChanges();
      });
    });
    input.value = '';
    this.rulesDropdownOpen = false;
  }

  openRuleEditor(index?: number): void {
    if (index !== undefined && this.rules[index]) {
      this.editingRuleIndex = index;
      this.ruleEditorName = this.rules[index].name;
      this.ruleEditorContent = this.rules[index].content;
    } else {
      this.editingRuleIndex = null;
      this.ruleEditorName = '';
      this.ruleEditorContent = '';
    }
    this.showRuleEditor = true;
    this.rulesDropdownOpen = false;
  }

  closeRuleEditor(): void {
    this.showRuleEditor = false;
    this.editingRuleIndex = null;
    this.ruleEditorName = '';
    this.ruleEditorContent = '';
  }

  saveRule(): void {
    if (!this.ruleEditorContent.trim()) return;
    const name = this.ruleEditorName?.trim() || 'Custom rule';
    const content = this.ruleEditorContent;
    if (this.editingRuleIndex !== null) {
      this.rules = this.rules.map((r, i) =>
        i === this.editingRuleIndex! ? { name, content } : r
      );
    } else {
      this.rules = [...this.rules, { name, content }];
    }
    this.closeRuleEditor();
  }

  removeRule(idx: number): void {
    this.rules = this.rules.filter((_, i) => i !== idx);
  }

  // ── Session ──
  private loadSessionsList(): void {
    this.sessionApi.list().subscribe({
      next: (list) => {
        this.savedSessions = list;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.savedSessions = [];
        this.errorMessage = err?.error?.error || err?.message || 'Failed to load sessions.';
        this.cdr.detectChanges();
      }
    });
  }

  saveSession(): void {
    const name = this.currentSessionName?.trim() || (this.currentSessionId ? 'Session' : `Session ${new Date().toLocaleString()}`);
    const dto = {
      name,
      source_files: this.sourceFiles,
      target_files: this.targetFiles,
      chat_history: this.chatHistory,
      current_mapping: this.currentMapping,
      rules: this.rules
    };
    if (this.currentSessionId) {
      this.sessionApi.update(this.currentSessionId, dto).subscribe({
        next: (updated) => {
          this.currentSessionName = updated.name;
          this.loadSessionsList();
          this.showSessionToast('Session saved');
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.errorMessage = err?.error?.error || err?.message || 'Failed to save session.';
          this.cdr.detectChanges();
        }
      });
    } else {
      this.sessionApi.create(dto).subscribe({
        next: (created) => {
          this.currentSessionId = created.id;
          this.currentSessionName = created.name;
          this.currentSessionMeta = { is_owner: true, shared_with: [] };
          this.loadSessionsList();
          this.showSessionToast('Session saved');
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.errorMessage = err?.error?.error || err?.message || 'Failed to save session.';
          this.cdr.detectChanges();
        }
      });
    }
  }

  private showSessionToast(msg: string): void {
    this.sessionToast = msg;
    this.sessionToastFading = false;
    setTimeout(() => { this.sessionToastFading = true; }, 1800);
    setTimeout(() => { this.sessionToast = ''; this.sessionToastFading = false; }, 2200);
  }

  openSessionPicker(): void {
    this.loadSessionsList();
    this.showSessionPicker = true;
  }

  /** Number of shared sessions the user has not opened yet; shown as badge on Load session button. */
  get unreadSharedCount(): number {
    return this.savedSessions.filter(s => !s.is_owner && !this.openedSharedSessionIds.has(s.id)).length;
  }

  loadSession(item: SessionListItem): void {
    this.sessionApi.get(item.id).subscribe({
      next: (detail) => {
        this.sourceFiles = detail.source_files ?? [];
        this.targetFiles = detail.target_files ?? [];
        this.chatHistory = (detail.chat_history ?? []).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        this.currentMapping = detail.current_mapping ?? null;
        this.rules = (detail.rules ?? []).map(r => ({ name: r.name, content: r.content }));
        this.selectedSourceFile = this.sourceFiles[0] || null;
        this.selectedTargetFile = this.targetFiles[0] || null;
        this.buildMappingRows();
        this.currentSessionId = item.id;
        this.currentSessionName = detail.name ?? '';
        this.currentSessionMeta = { is_owner: detail.is_owner ?? true, owner_user_id: detail.owner_user_id, owner_display_name: detail.owner_display_name, shared_with: detail.shared_with ?? [] };
        this.showSessionPicker = false;
        if (!item.is_owner) {
          this.openedSharedSessionIds.add(item.id);
          try {
            localStorage.setItem(OPENED_SHARED_SESSION_IDS_KEY, JSON.stringify([...this.openedSharedSessionIds]));
          } catch (_) { /* ignore */ }
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to load session.';
        this.cdr.detectChanges();
      }
    });
  }

  deleteSession(item: SessionListItem): void {
    this.sessionApi.delete(item.id).subscribe({
      next: () => {
        this.savedSessions = this.savedSessions.filter(s => s.id !== item.id);
        if (this.currentSessionId === item.id) {
          this.currentSessionId = null;
          this.currentSessionName = '';
          this.currentSessionMeta = null;
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to delete session.';
        this.cdr.detectChanges();
      }
    });
  }

  clearSession(): void {
    this.currentSessionId = null;
    this.currentSessionName = '';
    this.currentSessionMeta = null;
    this.sourceFiles = [];
    this.targetFiles = [];
    this.chatHistory = [];
    this.currentMapping = null;
    this.mappingRows = [];
    this.rules = [];
    this.selectedSourceFile = null;
    this.selectedTargetFile = null;
    this.streamLog = [];
    this.streamTokens = '';
    this.errorMessage = '';
  }

  addShare(): void {
    const id = this.currentSessionId;
    /** Use resolved user_id: from selection (dropdown) or typed input. */
    const userId = this.selectedShareUserId ?? this.shareUserInput?.trim();
    if (!id || !userId) return;
    const displayName = (userId === this.selectedShareUserId ? this.selectedShareDisplayName : null)
      ?? this.suggestedUsers.find(u => u.user_id === userId)?.display_name
      ?? undefined;
    const displayNames = displayName ? { [userId]: displayName } : undefined;
    this.sessionApi.shareSession(id, [userId], this.shareRole, displayNames).subscribe({
      next: () => {
        this.shareUserInput = '';
        this.showShareSuggestions = false;
        this.suggestedUsers = [];
        this.selectedShareDisplayName = null;
        this.selectedShareUserId = null;
        if (this.currentSessionMeta) {
          this.currentSessionMeta.shared_with = [...this.currentSessionMeta.shared_with, { user_id: userId, display_name: displayName ?? undefined, role: this.shareRole, shared_at: new Date().toISOString() }];
        }
        this.loadSessionsList();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to share.';
        this.cdr.detectChanges();
      }
    });
  }

  loadShareSuggestions(): void {
    const q = this.shareUserInput?.trim() || undefined;
    if (q !== this.selectedShareDisplayName?.trim() && q !== this.selectedShareUserId) {
      this.selectedShareUserId = null;
      this.selectedShareDisplayName = null;
    }
    this.sessionApi.getSuggestedUsers(q).subscribe({
      next: (res) => {
        const myOid = this.auth.currentUser?.oid ?? '';
        const alreadyShared = new Set((this.currentSessionMeta?.shared_with ?? []).map(s => s.user_id));
        this.suggestedUsers = (res.users ?? []).filter(u => u.user_id !== myOid && !alreadyShared.has(u.user_id));
        this.showShareSuggestions = this.suggestedUsers.length > 0;
        this.cdr.detectChanges();
      },
      error: () => { this.suggestedUsers = []; this.showShareSuggestions = false; this.cdr.detectChanges(); }
    });
  }

  selectShareSuggestion(user: { user_id: string; display_name?: string }): void {
    this.shareUserInput = (user.display_name?.trim()) ? user.display_name.trim() : user.user_id;
    this.selectedShareUserId = user.user_id;
    this.selectedShareDisplayName = user.display_name ?? null;
    this.showShareSuggestions = false;
    this.suggestedUsers = [];
    this.cdr.detectChanges();
  }

  onShareInputBlur(): void {
    this.shareInputReadonly = true;
    setTimeout(() => { this.showShareSuggestions = false; this.suggestedUsers = []; this.cdr.detectChanges(); }, 150);
  }

  /** Show display name, or a short user id when name is missing (e.g. "User 8b7d3ab1"). */
  formatUserDisplay(userId: string, displayName?: string | null): string {
    if (displayName?.trim()) return displayName.trim();
    if (!userId) return userId;
    return userId.length > 12 ? `User ${userId.slice(0, 8)}…` : userId;
  }

  removeShare(userId: string): void {
    const id = this.currentSessionId;
    if (!id) return;
    this.sessionApi.unshareSession(id, userId).subscribe({
      next: () => {
        if (this.currentSessionMeta) {
          this.currentSessionMeta.shared_with = this.currentSessionMeta.shared_with.filter(s => s.user_id !== userId);
        }
        this.loadSessionsList();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to remove share.';
        this.cdr.detectChanges();
      }
    });
  }

  // ── Mapping panel controls ──
  minimizeMapping(): void { this.mappingState = 'minimized'; }
  maximizeMapping(): void { this.mappingState = 'maximized'; }
  restoreMapping(): void { this.mappingState = 'normal'; }

  toggleExportMenu(): void { this.showExportMenu = !this.showExportMenu; }

  exportAs(format: string): void {
    this.showExportMenu = false;
    if (!this.currentMapping) return;
    if (format === 'json') this.exportJSON();
    else if (format === 'csv') this.exportCSV();
    else if (format === 'pdf') this.exportPDF();
    else if (format === 'sql') this.exportSQL();
    else if (format === 'databricks') this.exportDatabricks();
  }

  private exportJSON(): void {
    const data = JSON.stringify(this.currentMapping, null, 2);
    this.downloadFile(data, 'mapping-result.json', 'application/json');
  }

  private exportCSV(): void {
    if (!this.currentMapping) return;
    let csv = 'Source,Target,Type,Confidence,Transformation,Status,Reasoning\n';
    this.mappingRows.forEach(r => {
      const src = (r.source_columns || []).join('; ') || '—';
      const pct = this.isMapped(r) ? this.confPercent(r.confidence_score) + '%' : '—';
      const mt = this.isMapped(r) ? (r.match_type || 'semantic') : '—';
      const transform = r.transformation_rule || (this.isMapped(r) ? 'direct' : '—');
      const status = !this.isMapped(r) ? 'Unmapped' : (r._status === 'validated' ? 'Validated' : 'Pending');
      csv += `"${src}","${r.target_column}","${mt}","${pct}","${transform}","${status}","${(r.reasoning || '').replace(/"/g, '""')}"\n`;
    });
    this.downloadFile(csv, 'mapping-result.csv', 'text/csv');
  }

  private exportSQL(): void {
    if (!this.currentMapping) return;
    let sql = '-- Schema Mapping SQL\n';
    this.currentMapping.mappings.forEach(m => {
      const src = (m.source_columns || []).join(', ');
      const rule = m.transformation_rule;
      sql += `-- ${src} -> ${m.target_column} (${m.match_type}, ${m.confidence_score}%)\n`;
      sql += rule ? `SELECT ${rule} AS ${m.target_column.split('.').pop()};\n\n` : `SELECT ${src} AS ${m.target_column.split('.').pop()};\n\n`;
    });
    this.downloadFile(sql, 'mapping-result.sql', 'text/plain');
  }

  private exportDatabricks(): void {
    if (!this.currentMapping) return;
    let py = '# Schema Mapping - PySpark / Databricks\nfrom pyspark.sql import functions as F\n\n';
    py += 'df_result = df_source';
    this.currentMapping.mappings.forEach(m => {
      const tgt = m.target_column.split('.').pop();
      const src = (m.source_columns || [])[0]?.split('.').pop() || tgt;
      const rule = m.transformation_rule;
      py += rule ? `\n  .withColumn("${tgt}", F.expr("${rule}"))` : `\n  .withColumnRenamed("${src}", "${tgt}")`;
    });
    py += '\n';
    this.downloadFile(py, 'mapping-result.py', 'text/plain');
  }

  private exportPDF(): void {
    if (!this.currentMapping) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const mx = 14;
    let y = 0;

    const hexToRgb = (h: string): [number, number, number] => {
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      return [r, g, b];
    };
    const pdfConfColor = (pct: number) => pct >= 80 ? '#16a34a' : pct >= 50 ? '#ca8a04' : '#dc2626';
    const pdfBadgeColor = (type: string): string => {
      const map: Record<string, string> = { exact: '#16a34a', semantic: '#2563eb', derived: '#9333ea', transformed: '#ca8a04', manual: '#0891b2', incompatible: '#dc2626' };
      return map[type] || '#6b7280';
    };
    const liveMappedRows = this.mappingRows.filter(r => this.isMapped(r));
    const liveUnmappedRows = this.mappingRows.filter(r => !this.isMapped(r));
    const liveGlobalConfidence = liveMappedRows.length
      ? (liveMappedRows.reduce((sum, r) => sum + this.confPercent(r.confidence_score), 0) / liveMappedRows.length)
      : 0;
    const gc = Math.round(liveGlobalConfidence);
    const gcCol = hexToRgb(pdfConfColor(gc));
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const totalMappings = liveMappedRows.length;
    const totalUnmapped = liveUnmappedRows.length;

    const addPageFooter = () => {
      doc.setFontSize(6);
      doc.setTextColor(148, 163, 184);
      doc.text('Schema Mapping Report — Confidential', mx, H - 5);
      doc.text(`Generated ${dateStr} at ${timeStr}`, W - mx, H - 5, { align: 'right' });
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.text(`Page ${doc.getCurrentPageInfo().pageNumber} of ${pageCount}`, W / 2, H - 5, { align: 'center' });
    };

    // ── Header ──
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 30, 'F');
    doc.setFillColor(37, 99, 246);
    doc.rect(0, 30, W, 1, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text('Schema Mapping Report', mx, 13);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('Data Migration Mapping Analysis', mx, 20);

    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`${dateStr} at ${timeStr}`, W - mx, 10, { align: 'right' });

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...gcCol);
    doc.text(`${gc.toFixed(0)}%`, W - mx, 20, { align: 'right' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('Global Confidence', W - mx, 25, { align: 'right' });

    y = 36;

    // ── Summary cards ──
    const cardW = (W - 2 * mx - 8) / 3;
    const cards = [
      { label: 'Mapped Columns', value: `${totalMappings}`, color: [22, 163, 74] as [number, number, number] },
      { label: 'Unmapped Columns', value: `${totalUnmapped}`, color: [249, 115, 22] as [number, number, number] },
      { label: 'Confidence Score', value: `${gc.toFixed(0)}%`, color: gcCol },
    ];
    for (let i = 0; i < cards.length; i++) {
      const cx = mx + i * (cardW + 4);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(cx, y, cardW, 14, 2, 2, 'FD');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(cards[i].label, cx + 4, y + 5);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...cards[i].color);
      doc.text(cards[i].value, cx + 4, y + 12);
    }
    y += 20;

    // ── Analysis summary ──
    if (this.currentMapping.analysis_summary) {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      const summaryLines = doc.splitTextToSize(this.currentMapping.analysis_summary, W - 2 * mx - 10);
      const summaryHeight = Math.min(summaryLines.length, 4) * 3.5 + 6;
      doc.roundedRect(mx, y, W - 2 * mx, summaryHeight, 2, 2, 'FD');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Analysis Summary', mx + 4, y + 4.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(summaryLines.slice(0, 4), mx + 4, y + 8.5);
      y += summaryHeight + 4;
    }

    // ── Mapping tables ──
    const exportGroupsMap = new Map<string, { row: MappingRow; idx: number }[]>();
    this.mappingRows.forEach((row, idx) => {
      const parts = row.target_column.split('.');
      const table = parts.length > 1 ? parts.slice(0, -1).join('.') : 'Mappings';
      if (!exportGroupsMap.has(table)) exportGroupsMap.set(table, []);
      exportGroupsMap.get(table)!.push({ row, idx });
    });
    const groups = Array.from(exportGroupsMap.entries()).map(([table, allRows]) => {
      const mappedItems = allRows.filter(r => this.isMapped(r.row));
      const unmappedItems = allRows.filter(r => !this.isMapped(r.row));
      const avgConf = mappedItems.length
        ? mappedItems.reduce((s, r) => s + this.confPercent(r.row.confidence_score), 0) / mappedItems.length
        : 0;
      const srcTables = new Set<string>();
      mappedItems.forEach(r => {
        (r.row.source_columns || []).forEach(sc => {
          const dot = sc.indexOf('.');
          if (dot > 0) srcTables.add(sc.substring(0, dot));
        });
      });
      return {
        table,
        rows: allRows,
        mappedCount: mappedItems.length,
        unmappedCount: unmappedItems.length,
        totalCount: allRows.length,
        avgConf: Math.round(avgConf),
        confColor: this.getConfColor(avgConf),
        sourceTables: [...srcTables],
      };
    });

    for (const group of groups) {
      if (y > H - 40) { addPageFooter(); doc.addPage(); y = 10; }

      const avgCol = hexToRgb(pdfConfColor(group.avgConf));

      // Group header
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(mx, y, W - 2 * mx, 10, 2, 2, 'F');
      doc.setFont('courier', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      const tableLabel = group.table === '_default' ? 'Mappings' : group.table;
      doc.text(tableLabel, mx + 5, y + 7);

      let headerX = mx + 5 + doc.getTextWidth(tableLabel) + 4;
      if (group.sourceTables.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text(`← ${group.sourceTables.join(', ')}`, headerX, y + 7);
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      const statsText = `${group.totalCount} columns · ${group.mappedCount} mapped · ${group.unmappedCount} unmapped`;
      doc.text(statsText, W - mx - 30, y + 7, { align: 'right' });

      if (group.mappedCount > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...avgCol);
        doc.text(`${group.avgConf.toFixed(0)}%`, W - mx - 5, y + 7, { align: 'right' });
      }

      y += 12;

      // Build rows: mapping row + reasoning sub-row
      const tableBody: string[][] = [];
      const reasoningRowIndices = new Set<number>();

      for (const item of group.rows) {
        const r = item.row;
        if (!this.isMapped(r)) {
          tableBody.push(['—', '>', this.shortCol(r.target_column), '—', '—', '—', 'Unmapped']);
        } else {
          const src = (r.source_columns || []).join(', ') || '—';
          const pct = this.confPercent(r.confidence_score);
          const mt = r.match_type || 'semantic';
          const transform = r.transformation_rule || '';
          const status = r._status === 'validated' ? 'Validated' : 'Pending';
          tableBody.push([src, '>', this.shortCol(r.target_column), mt, `${pct.toFixed(0)}%`, transform || 'direct', status]);

          const reasoning = (r.reasoning || '').trim();
          if (reasoning) {
            reasoningRowIndices.add(tableBody.length);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            const maxReasonW = W - 2 * mx - 10;
            const wrappedLines = doc.splitTextToSize(`${reasoning}`, maxReasonW);
            const wrappedText = wrappedLines.slice(0, 3).join('\n');
            tableBody.push([{
              content: wrappedText,
              colSpan: 7,
              styles: {
                font: 'helvetica',
                fontStyle: 'normal',
                fontSize: 7,
                textColor: [100, 116, 139],
                overflow: 'linebreak',
              },
            } as any]);
          }
        }
      }

      const tableW = W - 2 * mx;
      const arrowW = 7;
      const rest = tableW - arrowW;
      const cw = {
        src: rest * 0.25,
        arrow: arrowW,
        tgt: rest * 0.20,
        type: rest * 0.10,
        conf: rest * 0.07,
        transform: rest * 0.25,
        status: rest * 0.13,
      };

      autoTable(doc, {
        startY: y,
        tableWidth: tableW,
        head: [['Source Column(s)', '', 'Target Column', 'Match Type', 'Conf.', 'Transformation', 'Status']],
        body: tableBody,
        margin: { left: mx, right: mx },
        theme: 'grid',
        styles: {
          lineColor: [226, 232, 240],
          lineWidth: 0.2,
          overflow: 'linebreak',
          font: 'helvetica',
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [51, 65, 85],
          fontStyle: 'bold',
          fontSize: 6.5,
          cellPadding: 3,
          font: 'helvetica',
        },
        bodyStyles: { fontSize: 7, cellPadding: 2.5, textColor: [30, 41, 59], font: 'helvetica' },
        columnStyles: {
          0: { cellWidth: cw.src },
          1: { halign: 'center', cellWidth: cw.arrow },
          2: { cellWidth: cw.tgt },
          3: { cellWidth: cw.type, fontSize: 6.5 },
          4: { cellWidth: cw.conf, halign: 'center' },
          5: { fontSize: 6, cellWidth: cw.transform },
          6: { cellWidth: cw.status, halign: 'center', fontSize: 6.5 },
        },
        didParseCell: (hookData: any) => {
          if (hookData.section !== 'body') return;
          const rowIdx = hookData.row.index;

          if (reasoningRowIndices.has(rowIdx)) {
            hookData.cell.styles.font = 'helvetica';
            hookData.cell.styles.fontSize = 7;
            hookData.cell.styles.textColor = [100, 116, 139];
            hookData.cell.styles.fontStyle = 'normal';
            hookData.cell.styles.fillColor = [248, 249, 252];
            hookData.cell.styles.cellPadding = { top: 1.5, bottom: 1.5, left: 6, right: 3 };
            hookData.cell.styles.overflow = 'linebreak';
            return;
          }

          const ci = hookData.column.index;
          if (ci === 0) {
            hookData.cell.styles.font = 'courier';
            hookData.cell.styles.textColor = [22, 163, 74];
            hookData.cell.styles.fontStyle = 'bold';
          }
          if (ci === 1) {
            hookData.cell.styles.textColor = [148, 163, 184];
          }
          if (ci === 2) {
            hookData.cell.styles.font = 'courier';
            hookData.cell.styles.textColor = [37, 99, 246];
            hookData.cell.styles.fontStyle = 'bold';
          }
          if (ci === 3) {
            hookData.cell.styles.textColor = hexToRgb(pdfBadgeColor(hookData.cell.raw));
          }
          if (ci === 4) {
            const val = parseFloat(hookData.cell.raw);
            if (!isNaN(val)) hookData.cell.styles.textColor = hexToRgb(pdfConfColor(val));
            hookData.cell.styles.fontStyle = 'bold';
          }
          if (ci === 5) {
            hookData.cell.styles.font = 'courier';
            hookData.cell.styles.textColor = [161, 98, 7];
            if (hookData.cell.raw === 'direct') {
              hookData.cell.styles.textColor = [148, 163, 184];
              hookData.cell.styles.fontStyle = 'italic';
              hookData.cell.styles.font = 'helvetica';
            }
          }
          if (ci === 6) {
            const status = hookData.cell.raw;
            if (status === 'Validated') {
              hookData.cell.styles.textColor = [22, 163, 74];
              hookData.cell.styles.fontStyle = 'bold';
            } else if (status === 'Unmapped') {
              hookData.cell.styles.textColor = [249, 115, 22];
              hookData.cell.styles.fontStyle = 'bold';
            } else {
              hookData.cell.styles.textColor = [161, 98, 7];
            }
          }
        },
        alternateRowStyles: { fillColor: [249, 250, 251] },
      });

      y = ((doc as any).lastAutoTable?.finalY ?? y) + 6;
    }

    // ── Unmapped columns section ──
    const uSrc = this.currentMapping.unmapped_source_columns || [];
    const dynamicUnmappedTargets = this.mappingRows
      .filter(r => !this.isMapped(r))
      .map(r => r.target_column);
    const uTgt = Array.from(new Set([...(this.currentMapping.unmapped_target_columns || []), ...dynamicUnmappedTargets]));
    if (uSrc.length > 0 || uTgt.length > 0) {
      if (y > H - 30) { addPageFooter(); doc.addPage(); y = 10; }
      const boxH = 8 + (uSrc.length ? 5 : 0) + (uTgt.length ? 5 : 0);
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(252, 165, 165);
      doc.roundedRect(mx, y, W - 2 * mx, boxH, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(153, 27, 27);
      doc.text('Unmapped Columns', mx + 4, y + 5);
      let uy = y + 9;
      doc.setFont('courier', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(185, 28, 28);
      if (uSrc.length) {
        const srcText = doc.splitTextToSize(`Source: ${uSrc.join(', ')}`, W - 2 * mx - 10);
        doc.text(srcText[0], mx + 4, uy);
        uy += 5;
      }
      if (uTgt.length) {
        const tgtText = doc.splitTextToSize(`Target: ${uTgt.join(', ')}`, W - 2 * mx - 10);
        doc.text(tgtText[0], mx + 4, uy);
      }
    }

    // ── Footer on all pages ──
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(226, 232, 240);
      doc.line(mx, H - 9, W - mx, H - 9);
      doc.setFontSize(6);
      doc.setTextColor(148, 163, 184);
      doc.text('Schema Mapping Report — Confidential', mx, H - 5);
      doc.text(`Generated ${dateStr} at ${timeStr}`, W - mx, H - 5, { align: 'right' });
      doc.text(`Page ${p} of ${totalPages}`, W / 2, H - 5, { align: 'center' });
    }

    doc.save('schema_mapping_report.pdf');
  }

  private downloadFile(content: string, fileName: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Stream overlay ──
  openStreamOverlay(): void { this.showStreamOverlay = true; }
  closeStreamOverlay(): void { this.showStreamOverlay = false; }

  // ── Splitters ──
  private initSplitters(): void {
    this.initVSplitter();
    this.initHSplitter();
    this.initTreeSplitters();
  }

  private initVSplitter(): void {
    if (!this.vSplitterRef?.nativeElement) return;
    const el = this.vSplitterRef.nativeElement;
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      const topRow = el.parentElement;
      if (!topRow) return;
      const panels = topRow.querySelectorAll('.file-panel');
      if (panels.length < 2) return;
      const startX = e.clientX;
      const totalW = topRow.clientWidth;
      const leftW = (panels[0] as HTMLElement).offsetWidth;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const newLeft = Math.max(200, Math.min(totalW - 200, leftW + dx));
        const pct = (newLeft / totalW) * 100;
        (panels[0] as HTMLElement).style.flex = `0 0 ${pct}%`;
        (panels[1] as HTMLElement).style.flex = `1 1 auto`;
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', onMouseDown);
    this.cleanupFns.push(() => el.removeEventListener('mousedown', onMouseDown));
  }

  private initHSplitter(): void {
    if (!this.hSplitterRef?.nativeElement) return;
    const el = this.hSplitterRef.nativeElement;
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      const mainEl = el.parentElement;
      if (!mainEl) return;
      const topRow = this.topRowRef?.nativeElement;
      const bottomRow = this.bottomRowRef?.nativeElement;
      if (!topRow || !bottomRow) return;
      const startY = e.clientY;
      const totalH = mainEl.clientHeight;
      const topH = topRow.offsetHeight;
      const onMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startY;
        const newTop = Math.max(100, Math.min(totalH - 100, topH + dy));
        const pct = (newTop / totalH) * 100;
        topRow.style.flex = `0 0 ${pct}%`;
        bottomRow.style.flex = `1 1 auto`;
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    el.addEventListener('mousedown', onMouseDown);
    this.cleanupFns.push(() => el.removeEventListener('mousedown', onMouseDown));
  }

  private initTreeSplitters(): void {
    const splitters = document.querySelectorAll('.tree-splitter');
    splitters.forEach(el => {
      const onMouseDown = (e: Event) => {
        const me = e as MouseEvent;
        me.preventDefault();
        const parent = (el as HTMLElement).parentElement;
        if (!parent) return;
        const tree = parent.querySelector('.fp-tree') as HTMLElement;
        if (!tree) return;
        const startX = me.clientX;
        const startW = tree.offsetWidth;
        el.classList.add('active');
        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          tree.style.width = Math.max(60, startW + dx) + 'px';
          tree.style.flex = 'none';
        };
        const onUp = () => {
          el.classList.remove('active');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      };
      el.addEventListener('mousedown', onMouseDown);
      this.cleanupFns.push(() => el.removeEventListener('mousedown', onMouseDown));
    });
  }

  // ── Helpers ──
  onChatKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  shortCol(col: string): string {
    const parts = col.split('.');
    return parts[parts.length - 1];
  }

  confPercent(score: number): number {
    return score <= 1 ? Math.round(score * 100) : Math.round(score);
  }
}
