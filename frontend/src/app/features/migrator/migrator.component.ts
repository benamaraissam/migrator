import { Component, ViewEncapsulation, NgZone, ElementRef, ViewChild, AfterViewInit, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MappingApiService, type MappingResultDto, type MappingItemDto, type RawFileDto } from '../../core/services/mapping-api.service';
import { FilePreviewComponent } from '../../shared/components/file-preview/file-preview.component';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ChatMsg { role: 'user' | 'assistant'; content: string; }
interface RuleItem { name: string; content: string; }
interface MappingRow extends MappingItemDto {
  _status: 'pending' | 'validated';
  _original?: MappingItemDto;
}

interface SessionSnapshot {
  id: string; name: string; date: string;
  sourceFiles: RawFileDto[]; targetFiles: RawFileDto[];
  chatHistory: ChatMsg[]; currentMapping: MappingResultDto | null;
  rules: RuleItem[];
}

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
  rulesDropdownOpen = false;
  showRuleEditor = false;
  ruleEditorName = '';
  ruleEditorContent = '';

  // Session
  showSessionPicker = false;
  savedSessions: SessionSnapshot[] = [];

  // Mapping controls
  mappingState: 'normal' | 'minimized' | 'maximized' = 'normal';
  showExportMenu = false;
  showUnmappedOnly = false;
  unmappedCount = 0;

  // Stream overlay
  showStreamOverlay = false;

  // Source picker for changing mapped source
  showSourcePicker = false;
  sourcePickerRowIdx = -1;
  sourcePickerOptions: string[] = [];
  pickerTop = 0;
  pickerLeft = 0;

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

  constructor(private api: MappingApiService, private zone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
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
    if (!this.currentMapping) { this.mappingRows = []; this.unmappedCount = 0; return; }
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
    this.sourcePickerRowIdx = idx;
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
      if (!row.source_columns.includes(col)) {
        row.source_columns = [...row.source_columns, col];
      }
      row.match_type = row.match_type || 'semantic';
      row._status = 'pending';
    }
    this.showSourcePicker = false;
    this.unmappedCount = this.mappingRows.filter(r => !this.isMapped(r)).length;
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

  getConfColor(pct: number): string {
    if (pct >= 80) return 'var(--accent)';
    if (pct >= 50) return 'var(--yellow)';
    return 'var(--red)';
  }

  // ── Rules ──
  toggleRules(): void { this.rulesCollapsed = !this.rulesCollapsed; }
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

  openRuleEditor(): void {
    this.ruleEditorName = '';
    this.ruleEditorContent = '';
    this.showRuleEditor = true;
    this.rulesDropdownOpen = false;
  }

  saveRule(): void {
    if (!this.ruleEditorContent.trim()) return;
    this.rules = [...this.rules, { name: this.ruleEditorName || 'Custom rule', content: this.ruleEditorContent }];
    this.showRuleEditor = false;
  }

  removeRule(idx: number): void { this.rules = this.rules.filter((_, i) => i !== idx); }

  // ── Session ──
  private loadSessionsList(): void {
    try {
      const raw = localStorage.getItem('migrator_sessions');
      this.savedSessions = raw ? JSON.parse(raw) : [];
    } catch { this.savedSessions = []; }
  }

  saveSession(): void {
    const snap: SessionSnapshot = {
      id: Date.now().toString(36),
      name: `Session ${new Date().toLocaleString()}`,
      date: new Date().toISOString(),
      sourceFiles: this.sourceFiles,
      targetFiles: this.targetFiles,
      chatHistory: this.chatHistory,
      currentMapping: this.currentMapping,
      rules: this.rules
    };
    this.savedSessions = [snap, ...this.savedSessions.slice(0, 19)];
    try {
      localStorage.setItem('migrator_sessions', JSON.stringify(this.savedSessions));
      this.showSessionToast('Session saved');
    } catch {
      this.errorMessage = 'Failed to save session — storage may be full.';
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

  loadSession(snap: SessionSnapshot): void {
    this.sourceFiles = snap.sourceFiles;
    this.targetFiles = snap.targetFiles;
    this.chatHistory = snap.chatHistory;
    this.currentMapping = snap.currentMapping;
    this.rules = snap.rules || [];
    this.selectedSourceFile = this.sourceFiles[0] || null;
    this.selectedTargetFile = this.targetFiles[0] || null;
    this.buildMappingRows();
    this.showSessionPicker = false;
  }

  deleteSession(snap: SessionSnapshot): void {
    this.savedSessions = this.savedSessions.filter(s => s.id !== snap.id);
    localStorage.setItem('migrator_sessions', JSON.stringify(this.savedSessions));
  }

  clearSession(): void {
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
    const gc = this.confPercent(this.currentMapping.global_confidence);
    const gcCol = hexToRgb(pdfConfColor(gc));
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const totalMappings = this.currentMapping.mappings?.length ?? 0;
    const totalUnmapped = (this.currentMapping.unmapped_source_columns?.length ?? 0) + (this.currentMapping.unmapped_target_columns?.length ?? 0);

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
    const groups = this.groupedMappings();

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
          tableBody.push(['—', '→', this.shortCol(r.target_column), '—', '—', '—', 'Unmapped']);
        } else {
          const src = (r.source_columns || []).join(', ') || '—';
          const pct = this.confPercent(r.confidence_score);
          const mt = r.match_type || 'semantic';
          const transform = r.transformation_rule || '';
          const status = r._status === 'validated' ? 'Validated' : 'Pending';
          tableBody.push([src, '→', this.shortCol(r.target_column), mt, `${pct.toFixed(0)}%`, transform || 'direct', status]);

          const reasoning = (r.reasoning || '').trim();
          if (reasoning) {
            reasoningRowIndices.add(tableBody.length);
            tableBody.push([{ content: `↳ ${reasoning}`, colSpan: 7 } as any]);
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
          0: { font: 'courier', textColor: [22, 163, 74], fontStyle: 'bold', cellWidth: cw.src },
          1: { halign: 'center', cellWidth: cw.arrow, textColor: [148, 163, 184], font: 'helvetica' },
          2: { font: 'courier', textColor: [37, 99, 246], fontStyle: 'bold', cellWidth: cw.tgt },
          3: { cellWidth: cw.type, fontSize: 6.5, font: 'helvetica' },
          4: { cellWidth: cw.conf, halign: 'center', fontStyle: 'bold', font: 'helvetica' },
          5: { font: 'courier', fontSize: 6, textColor: [161, 98, 7], cellWidth: cw.transform },
          6: { cellWidth: cw.status, halign: 'center', fontSize: 6.5, font: 'helvetica' },
        },
        didParseCell: (hookData: any) => {
          if (hookData.section !== 'body') return;
          const rowIdx = hookData.row.index;

          if (reasoningRowIndices.has(rowIdx)) {
            hookData.cell.styles.font = 'helvetica';
            hookData.cell.styles.fontSize = 6;
            hookData.cell.styles.textColor = [100, 116, 139];
            hookData.cell.styles.fontStyle = 'italic';
            hookData.cell.styles.fillColor = [248, 249, 252];
            hookData.cell.styles.cellPadding = { top: 1.5, bottom: 1.5, left: 6, right: 3 };
            hookData.cell.styles.overflow = 'linebreak';
            return;
          }

          if (hookData.column.index === 3) {
            hookData.cell.styles.textColor = hexToRgb(pdfBadgeColor(hookData.cell.raw));
          }
          if (hookData.column.index === 4) {
            const val = parseFloat(hookData.cell.raw);
            if (!isNaN(val)) hookData.cell.styles.textColor = hexToRgb(pdfConfColor(val));
          }
          if (hookData.column.index === 5 && hookData.cell.raw === 'direct') {
            hookData.cell.styles.textColor = [148, 163, 184];
            hookData.cell.styles.fontStyle = 'italic';
            hookData.cell.styles.font = 'helvetica';
          }
          if (hookData.column.index === 6) {
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
    const uTgt = this.currentMapping.unmapped_target_columns || [];
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
