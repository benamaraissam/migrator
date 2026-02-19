import {
  Component,
  Input,
  ViewEncapsulation,
  OnChanges,
  SimpleChanges,
  ElementRef,
  AfterViewChecked,
  ViewChild,
  Output,
  EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface ColColor { bg: string; border: string; text: string; }

const COL_PALETTE: ColColor[] = [
  { bg: 'rgba(34,197,94,0.12)', border: '#22c55e', text: '#4ade80' },
  { bg: 'rgba(59,130,246,0.12)', border: '#3b82f6', text: '#60a5fa' },
  { bg: 'rgba(168,85,247,0.12)', border: '#a855f7', text: '#c084fc' },
  { bg: 'rgba(234,179,8,0.12)', border: '#eab308', text: '#facc15' },
  { bg: 'rgba(239,68,68,0.12)', border: '#ef4444', text: '#f87171' },
  { bg: 'rgba(236,72,153,0.12)', border: '#ec4899', text: '#f472b6' },
  { bg: 'rgba(20,184,166,0.12)', border: '#14b8a6', text: '#2dd4bf' },
  { bg: 'rgba(249,115,22,0.12)', border: '#f97316', text: '#fb923c' },
  { bg: 'rgba(99,102,241,0.12)', border: '#6366f1', text: '#818cf8' },
  { bg: 'rgba(6,182,212,0.12)', border: '#06b6d4', text: '#22d3ee' },
  { bg: 'rgba(132,204,22,0.12)', border: '#84cc16', text: '#a3e635' },
  { bg: 'rgba(244,63,94,0.12)', border: '#f43f5e', text: '#fb7185' },
];

const DELIMITERS = [
  { value: ',', label: 'Comma (,)' },
  { value: ';', label: 'Semicolon (;)' },
  { value: '\t', label: 'Tab (\\t)' },
  { value: '|', label: 'Pipe (|)' },
];

@Component({
  selector: 'app-file-preview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="content-meta" *ngIf="fileName">{{ fileName }}</div>
    <div class="csv-sep-bar" *ngIf="isCsvFile">
      <label class="csv-sep-label">Separator</label>
      <select class="csv-sep-select" [ngModel]="currentDelimiter" (ngModelChange)="onDelimiterChange($event)">
        <option *ngFor="let d of delimiters" [ngValue]="d.value">{{ d.label }}</option>
      </select>
      <span class="csv-sep-info" *ngIf="csvStats">{{ csvStats }}</span>
    </div>
    <div *ngIf="previewHtml" #previewContainer [innerHTML]="previewHtml"></div>
    <pre *ngIf="!previewHtml && content">{{ content }}</pre>
  `
})
export class FilePreviewComponent implements OnChanges, AfterViewChecked {
  @Input() fileName = '';
  @Input() content = '';
  @ViewChild('previewContainer') previewContainer?: ElementRef<HTMLElement>;

  previewHtml: SafeHtml | null = null;
  isCsvFile = false;
  currentDelimiter = ',';
  csvStats = '';
  delimiters = DELIMITERS;

  private needsListenerAttach = false;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['fileName'] || changes['content']) {
      const ext = this.fileName.split('.').pop()?.toLowerCase() ?? '';
      this.isCsvFile = ext === 'csv' || ext === 'txt' || ext === 'tsv';
      if (this.isCsvFile) {
        this.currentDelimiter = this.detectDelimiter(this.content);
      }
      this.render();
    }
  }

  ngAfterViewChecked(): void {
    if (this.needsListenerAttach && this.previewContainer) {
      this.attachJsonTreeListeners(this.previewContainer.nativeElement);
      this.needsListenerAttach = false;
    }
  }

  onDelimiterChange(value: string): void {
    this.currentDelimiter = value;
    this.render();
  }

  private render(): void {
    if (!this.content || !this.fileName) {
      this.previewHtml = null;
      return;
    }
    const ext = this.fileName.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'json') {
      this.renderJson();
    } else if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
      this.renderCsv();
    } else {
      this.previewHtml = null;
    }
  }

  private renderJson(): void {
    let parsed: unknown;
    try { parsed = JSON.parse(this.content); } catch { this.previewHtml = null; return; }
    const html = `<div class="json-tree">${this.buildJsonTree(parsed, null, true, 0)}</div>`;
    this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(html);
    this.needsListenerAttach = true;
  }

  private renderCsv(): void {
    const { headers, rows } = this.parseDelimited(this.content, this.currentDelimiter);
    this.csvStats = headers.length ? `${headers.length} columns \u00b7 ${rows.length} row${rows.length !== 1 ? 's' : ''}` : '';
    if (!headers.length) { this.previewHtml = null; return; }

    let html = '<table><thead><tr><th class="csv-row-num">#</th>';
    headers.forEach((h, i) => {
      const c = COL_PALETTE[i % COL_PALETTE.length];
      html += `<th style="background:${c.bg};color:${c.text};border-bottom:2px solid ${c.border}">${this.esc(h)}</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.slice(0, 50).forEach((row, ri) => {
      html += `<tr><td class="csv-row-num">${ri + 1}</td>`;
      row.forEach((cell, ci) => {
        const c = COL_PALETTE[ci % COL_PALETTE.length];
        html += `<td style="border-left-color:${c.border}">${this.esc(cell)}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    if (rows.length > 50) html += `<div class="content-meta">&hellip; and ${rows.length - 50} more rows</div>`;

    this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private buildJsonTree(data: unknown, key: string | null, isLast: boolean, depth: number): string {
    if (depth > 20) return '<div class="jt-row"><span class="jt-spacer"></span><span class="jt-collapsed-preview">...</span></div>';
    const comma = isLast ? '' : '<span class="jt-comma">,</span>';
    const keyHtml = key !== null ? `<span class="jt-key">"${this.esc(String(key))}"</span><span class="jt-colon">:</span>` : '';

    if (data === null || data === undefined)
      return `<div class="jt-row"><span class="jt-spacer"></span>${keyHtml}<span class="jt-null">null</span>${comma}</div>`;
    if (typeof data === 'boolean')
      return `<div class="jt-row"><span class="jt-spacer"></span>${keyHtml}<span class="jt-boolean">${data}</span>${comma}</div>`;
    if (typeof data === 'number')
      return `<div class="jt-row"><span class="jt-spacer"></span>${keyHtml}<span class="jt-number">${data}</span>${comma}</div>`;
    if (typeof data === 'string')
      return `<div class="jt-row"><span class="jt-spacer"></span>${keyHtml}<span class="jt-string">"${this.esc(data)}"</span>${comma}</div>`;

    const isArr = Array.isArray(data);
    const open = isArr ? '[' : '{';
    const close = isArr ? ']' : '}';
    const entries: [string | number, unknown][] = isArr
      ? (data as unknown[]).map((v, i) => [i, v])
      : Object.entries(data as Record<string, unknown>);
    const count = entries.length;
    const preview = isArr ? `${count} item${count !== 1 ? 's' : ''}` : `${count} key${count !== 1 ? 's' : ''}`;
    const id = `jt-${depth}-${key ?? 'root'}-${Math.random().toString(36).slice(2, 8)}`;

    let html = '<div class="jt-row">';
    html += `<button class="jt-toggle" data-target="${id}" title="Toggle">\u25BC</button>`;
    html += `${keyHtml}<span class="jt-bracket">${open}</span>`;
    html += `<span class="jt-collapsed-preview" id="${id}-preview" style="display:none"> ${this.esc(preview)} </span>`;
    html += '</div>';
    html += `<div class="jt-children" id="${id}">`;
    entries.forEach(([k, v], i) => {
      html += this.buildJsonTree(v, isArr ? null : String(k), i === count - 1, depth + 1);
    });
    html += '</div>';
    html += `<div class="jt-row"><span class="jt-spacer"></span><span class="jt-bracket">${close}</span>${comma}</div>`;
    return html;
  }

  private attachJsonTreeListeners(container: HTMLElement): void {
    container.querySelectorAll('.jt-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = (btn as HTMLElement).dataset['target'];
        if (!targetId) return;
        const children = document.getElementById(targetId);
        const preview = document.getElementById(targetId + '-preview');
        if (!children) return;
        const isCollapsed = children.classList.toggle('collapsed');
        btn.textContent = isCollapsed ? '\u25B6' : '\u25BC';
        if (preview) preview.style.display = isCollapsed ? 'inline' : 'none';
      });
    });
  }

  private detectDelimiter(text: string): string {
    const firstLine = text.trim().split(/\r?\n/)[0] || '';
    const candidates = [
      { del: '\t', count: (firstLine.match(/\t/g) || []).length },
      { del: ';', count: (firstLine.match(/;/g) || []).length },
      { del: '|', count: (firstLine.match(/\|/g) || []).length },
      { del: ',', count: (firstLine.match(/,/g) || []).length },
    ];
    const best = candidates.reduce((a, b) => (b.count > a.count ? b : a), candidates[3]);
    return best.count > 0 ? best.del : ',';
  }

  private parseDelimited(text: string, delimiter: string): { headers: string[]; rows: string[][] } {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { headers: [], rows: [] };
    const headers = this.parseCSVLine(lines[0], delimiter);
    const rows = lines.slice(1).map(l => this.parseCSVLine(l, delimiter));
    return { headers, rows };
  }

  private parseCSVLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === delimiter && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }

  private esc(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
