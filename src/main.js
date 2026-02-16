import { parseFilesWithContent, parseFiles, parseDelimited, detectDelimiter } from "./parse-file.js";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-csv";
import "prismjs/components/prism-sql";
import "prismjs/themes/prism-tomorrow.css";

/* ── DOM refs ── */
const sourceFileInput = document.getElementById("source-file");
const targetFileInput = document.getElementById("target-file");
const sourceAddBtn = document.getElementById("source-add");
const targetAddBtn = document.getElementById("target-add");
const sourceTree = document.getElementById("source-tree");
const targetTree = document.getElementById("target-tree");
const sourceEmpty = document.getElementById("source-empty");
const targetEmpty = document.getElementById("target-empty");
const sourceContent = document.getElementById("source-content");
const targetContent = document.getElementById("target-content");
const loadExampleBtn = document.getElementById("load-example");
const resultEmpty = document.getElementById("result-empty");
const resultContent = document.getElementById("result-content");
const errorSection = document.getElementById("error-section");
const errorMessage = document.getElementById("error-message");
const errorClose = document.getElementById("error-close");
const globalConfBadge = document.getElementById("global-confidence-badge");
const analysisSummary = document.getElementById("analysis-summary");
const mappingGroups = document.getElementById("mapping-groups");
const unmappedContainer = document.getElementById("unmapped");
const exportTrigger = document.getElementById("export-trigger");
const exportMenu = document.getElementById("export-menu");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const rulesFileInput = document.getElementById("rules-file");
const rulesAddBtn = document.getElementById("rules-add");
const rulesToggle = document.getElementById("rules-toggle");
const rulesSection = document.getElementById("rules-section");
const rulesList = document.getElementById("rules-list");
const rulesEmpty = document.getElementById("rules-empty");
const rulesCount = document.getElementById("rules-count");
const rulesPreview = document.getElementById("rules-preview");

/* ── State ── */
let sourceFiles = [];
let targetFiles = [];
let activeSource = null;
let activeTarget = null;
let currentMapping = null;
let chatHistory = [];
let lastSourceSchema = null;
let lastTargetSchema = null;
let rulesFiles = [];
let activeRule = null;
const fileSeparators = {};

const DELIMITERS = [
  { value: ",",  label: "Comma (,)" },
  { value: ";",  label: "Semicolon (;)" },
  { value: "\t", label: "Tab (\\t)" },
  { value: "|",  label: "Pipe (|)" },
  { value: ":",  label: "Colon (:)" },
  { value: " ",  label: "Space" },
];

const EXAMPLE = {
  sourceFiles: [
    {
      fileName: "legacy_customers.csv",
      schema: {
        table_name: "legacy_customers",
        columns: [
          { name: "cust_id", data_type: "string", nullable: false, sample_values: ["C001"] },
          { name: "first_name", data_type: "string", nullable: false, sample_values: ["John"] },
          { name: "last_name", data_type: "string", nullable: false, sample_values: ["Doe"] },
          { name: "email_addr", data_type: "string", nullable: false, sample_values: ["jdoe@email.com"] },
          { name: "phone_num", data_type: "string", nullable: true, sample_values: ["+1-555-0101"] },
          { name: "dob", data_type: "date", nullable: true, sample_values: ["1985-03-12"] },
          { name: "gender", data_type: "string", nullable: true, sample_values: ["M"] },
          { name: "street_address", data_type: "string", nullable: true, sample_values: ["123 Oak St"] },
          { name: "city", data_type: "string", nullable: true, sample_values: ["Springfield"] },
          { name: "state_code", data_type: "string", nullable: true, sample_values: ["IL"] },
          { name: "zip", data_type: "string", nullable: true, sample_values: ["62701"] },
          { name: "country_code", data_type: "string", nullable: true, sample_values: ["US"] },
          { name: "signup_date", data_type: "date", nullable: true, sample_values: ["2019-01-15"] },
          { name: "acct_status", data_type: "string", nullable: true, sample_values: ["active"] },
          { name: "credit_limit", data_type: "number", nullable: true, sample_values: ["5000"] },
        ],
      },
      rawContent: "cust_id,first_name,last_name,email_addr,phone_num,dob,gender,street_address,city,state_code,zip,country_code,signup_date,acct_status,credit_limit\nC001,John,Doe,jdoe@email.com,+1-555-0101,1985-03-12,M,123 Oak St,Springfield,IL,62701,US,2019-01-15,active,5000",
    },
    {
      fileName: "legacy_orders.csv",
      schema: {
        table_name: "legacy_orders",
        columns: [
          { name: "order_id", data_type: "string", nullable: false, sample_values: ["O1001"] },
          { name: "cust_id", data_type: "string", nullable: false, sample_values: ["C001"] },
          { name: "order_date", data_type: "date", nullable: false, sample_values: ["2024-11-15"] },
          { name: "ship_date", data_type: "date", nullable: true, sample_values: ["2024-11-18"] },
          { name: "total_amt", data_type: "number", nullable: false, sample_values: ["299.99"] },
          { name: "tax_amt", data_type: "number", nullable: true, sample_values: ["24.00"] },
          { name: "currency_code", data_type: "string", nullable: true, sample_values: ["USD"] },
          { name: "payment_method", data_type: "string", nullable: true, sample_values: ["credit"] },
          { name: "shipping_method", data_type: "string", nullable: true, sample_values: ["standard"] },
          { name: "promo_code", data_type: "string", nullable: true, sample_values: ["SAVE10"] },
          { name: "order_status", data_type: "string", nullable: true, sample_values: ["shipped"] },
          { name: "bill_to_addr_id", data_type: "string", nullable: true, sample_values: ["A1"] },
          { name: "ship_to_addr_id", data_type: "string", nullable: true, sample_values: ["A1"] },
        ],
      },
      rawContent: "order_id,cust_id,order_date,ship_date,total_amt,tax_amt,currency_code,payment_method,shipping_method,promo_code,order_status,bill_to_addr_id,ship_to_addr_id\nO1001,C001,2024-11-15,2024-11-18,299.99,24.00,USD,credit,standard,SAVE10,shipped,A1,A1",
    },
    {
      fileName: "legacy_order_items.csv",
      schema: {
        table_name: "legacy_order_items",
        columns: [
          { name: "line_id", data_type: "string", nullable: false, sample_values: ["L001"] },
          { name: "order_id", data_type: "string", nullable: false, sample_values: ["O1001"] },
          { name: "product_id", data_type: "string", nullable: false, sample_values: ["P501"] },
          { name: "qty", data_type: "number", nullable: false, sample_values: ["2"] },
          { name: "unit_price", data_type: "number", nullable: false, sample_values: ["99.99"] },
          { name: "discount_pct", data_type: "number", nullable: true, sample_values: ["10"] },
          { name: "extended_amt", data_type: "number", nullable: true, sample_values: ["179.98"] },
        ],
      },
      rawContent: "line_id,order_id,product_id,qty,unit_price,discount_pct,extended_amt\nL001,O1001,P501,2,99.99,10,179.98",
    },
    {
      fileName: "legacy_products.csv",
      schema: {
        table_name: "legacy_products",
        columns: [
          { name: "product_id", data_type: "string", nullable: false, sample_values: ["P501"] },
          { name: "sku", data_type: "string", nullable: false, sample_values: ["WIDGET-X1"] },
          { name: "product_name", data_type: "string", nullable: false, sample_values: ["Premium Widget"] },
          { name: "category_id", data_type: "string", nullable: true, sample_values: ["CAT-A"] },
          { name: "subcategory", data_type: "string", nullable: true, sample_values: ["Electronics"] },
          { name: "brand", data_type: "string", nullable: true, sample_values: ["Acme"] },
          { name: "list_price", data_type: "number", nullable: false, sample_values: ["99.99"] },
          { name: "cost_price", data_type: "number", nullable: true, sample_values: ["45.00"] },
          { name: "weight_kg", data_type: "number", nullable: true, sample_values: ["1.2"] },
          { name: "dimensions", data_type: "string", nullable: true, sample_values: ["10x5x3"] },
          { name: "is_active", data_type: "string", nullable: true, sample_values: ["Y"] },
          { name: "created_dt", data_type: "date", nullable: true, sample_values: ["2020-01-10"] },
        ],
      },
      rawContent: "product_id,sku,product_name,category_id,subcategory,brand,list_price,cost_price,weight_kg,dimensions,is_active,created_dt\nP501,WIDGET-X1,Premium Widget,CAT-A,Electronics,Acme,99.99,45.00,1.2,10x5x3,Y,2020-01-10",
    },
    {
      fileName: "legacy_addresses.csv",
      schema: {
        table_name: "legacy_addresses",
        columns: [
          { name: "addr_id", data_type: "string", nullable: false, sample_values: ["A1"] },
          { name: "cust_id", data_type: "string", nullable: false, sample_values: ["C001"] },
          { name: "addr_type", data_type: "string", nullable: true, sample_values: ["billing"] },
          { name: "street_addr", data_type: "string", nullable: true, sample_values: ["123 Oak St"] },
          { name: "city", data_type: "string", nullable: true, sample_values: ["Springfield"] },
          { name: "state", data_type: "string", nullable: true, sample_values: ["IL"] },
          { name: "postal_code", data_type: "string", nullable: true, sample_values: ["62701"] },
          { name: "country", data_type: "string", nullable: true, sample_values: ["US"] },
          { name: "is_default", data_type: "string", nullable: true, sample_values: ["Y"] },
        ],
      },
      rawContent: "addr_id,cust_id,addr_type,street_addr,city,state,postal_code,country,is_default\nA1,C001,billing,123 Oak St,Springfield,IL,62701,US,Y",
    },
    {
      fileName: "legacy_payments.csv",
      schema: {
        table_name: "legacy_payments",
        columns: [
          { name: "payment_id", data_type: "string", nullable: false, sample_values: ["PAY1"] },
          { name: "order_id", data_type: "string", nullable: false, sample_values: ["O1001"] },
          { name: "payment_dt", data_type: "date", nullable: false, sample_values: ["2024-11-15"] },
          { name: "amount", data_type: "number", nullable: false, sample_values: ["299.99"] },
          { name: "cc_last4", data_type: "string", nullable: true, sample_values: ["4242"] },
          { name: "cc_type", data_type: "string", nullable: true, sample_values: ["visa"] },
          { name: "auth_code", data_type: "string", nullable: true, sample_values: ["AUTH123"] },
          { name: "status", data_type: "string", nullable: true, sample_values: ["approved"] },
        ],
      },
      rawContent: "payment_id,order_id,payment_dt,amount,cc_last4,cc_type,auth_code,status\nPAY1,O1001,2024-11-15,299.99,4242,visa,AUTH123,approved",
    },
  ],
  targetFiles: [
    {
      fileName: "customer_profiles.json",
      schema: {
        table_name: "customer_profiles",
        columns: [
          { name: "id", data_type: "string", nullable: false, sample_values: ["cust-001"] },
          { name: "full_name", data_type: "string", nullable: false, sample_values: ["John Doe"] },
          { name: "email", data_type: "string", nullable: false, sample_values: ["jdoe@email.com"] },
          { name: "phone", data_type: "string", nullable: true, sample_values: ["+1-555-0101"] },
          { name: "birth_date", data_type: "date", nullable: true, sample_values: ["1985-03-12"] },
          { name: "gender", data_type: "string", nullable: true, sample_values: ["M"] },
          { name: "locale", data_type: "string", nullable: true, sample_values: ["en-US"] },
          { name: "created_at", data_type: "datetime", nullable: true, sample_values: ["2019-01-15T00:00:00Z"] },
          { name: "updated_at", data_type: "datetime", nullable: true, sample_values: ["2024-11-01T12:00:00Z"] },
          { name: "status", data_type: "string", nullable: true, sample_values: ["active"] },
          { name: "tier", data_type: "string", nullable: true, sample_values: ["premium"] },
          { name: "credit_limit_usd", data_type: "number", nullable: true, sample_values: ["5000"] },
        ],
      },
      rawContent: '{"id":"cust-001","full_name":"John Doe","email":"jdoe@email.com","phone":"+1-555-0101","birth_date":"1985-03-12","gender":"M","locale":"en-US","created_at":"2019-01-15T00:00:00Z","updated_at":"2024-11-01T12:00:00Z","status":"active","tier":"premium","credit_limit_usd":5000}',
    },
    {
      fileName: "customer_addresses.json",
      schema: {
        table_name: "customer_addresses",
        columns: [
          { name: "id", data_type: "string", nullable: false, sample_values: ["addr-001"] },
          { name: "customer_id", data_type: "string", nullable: false, sample_values: ["cust-001"] },
          { name: "type", data_type: "string", nullable: true, sample_values: ["billing"] },
          { name: "line1", data_type: "string", nullable: true, sample_values: ["123 Oak St"] },
          { name: "city", data_type: "string", nullable: true, sample_values: ["Springfield"] },
          { name: "region", data_type: "string", nullable: true, sample_values: ["IL"] },
          { name: "postal_code", data_type: "string", nullable: true, sample_values: ["62701"] },
          { name: "country_iso", data_type: "string", nullable: true, sample_values: ["US"] },
          { name: "is_default", data_type: "boolean", nullable: true, sample_values: ["true"] },
        ],
      },
      rawContent: '{"id":"addr-001","customer_id":"cust-001","type":"billing","line1":"123 Oak St","city":"Springfield","region":"IL","postal_code":"62701","country_iso":"US","is_default":true}',
    },
    {
      fileName: "transactions.json",
      schema: {
        table_name: "transactions",
        columns: [
          { name: "id", data_type: "string", nullable: false, sample_values: ["txn-1001"] },
          { name: "customer_id", data_type: "string", nullable: false, sample_values: ["cust-001"] },
          { name: "order_ref", data_type: "string", nullable: false, sample_values: ["O1001"] },
          { name: "placed_at", data_type: "datetime", nullable: false, sample_values: ["2024-11-15T10:30:00Z"] },
          { name: "total", data_type: "number", nullable: false, sample_values: ["299.99"] },
          { name: "currency", data_type: "string", nullable: true, sample_values: ["USD"] },
          { name: "payment_type", data_type: "string", nullable: true, sample_values: ["credit_card"] },
          { name: "status", data_type: "string", nullable: true, sample_values: ["completed"] },
          { name: "shipped_at", data_type: "datetime", nullable: true, sample_values: ["2024-11-18T14:00:00Z"] },
          { name: "promo_used", data_type: "string", nullable: true, sample_values: ["SAVE10"] },
        ],
      },
      rawContent: '{"id":"txn-1001","customer_id":"cust-001","order_ref":"O1001","placed_at":"2024-11-15T10:30:00Z","total":299.99,"currency":"USD","payment_type":"credit_card","status":"completed","shipped_at":"2024-11-18T14:00:00Z","promo_used":"SAVE10"}',
    },
    {
      fileName: "transaction_lines.json",
      schema: {
        table_name: "transaction_lines",
        columns: [
          { name: "id", data_type: "string", nullable: false, sample_values: ["line-001"] },
          { name: "transaction_id", data_type: "string", nullable: false, sample_values: ["txn-1001"] },
          { name: "product_ref", data_type: "string", nullable: false, sample_values: ["P501"] },
          { name: "quantity", data_type: "number", nullable: false, sample_values: ["2"] },
          { name: "unit_price", data_type: "number", nullable: false, sample_values: ["99.99"] },
          { name: "discount", data_type: "number", nullable: true, sample_values: ["10"] },
          { name: "line_total", data_type: "number", nullable: true, sample_values: ["179.98"] },
        ],
      },
      rawContent: '{"id":"line-001","transaction_id":"txn-1001","product_ref":"P501","quantity":2,"unit_price":99.99,"discount":10,"line_total":179.98}',
    },
    {
      fileName: "product_catalog.json",
      schema: {
        table_name: "product_catalog",
        columns: [
          { name: "id", data_type: "string", nullable: false, sample_values: ["prod-501"] },
          { name: "sku", data_type: "string", nullable: false, sample_values: ["WIDGET-X1"] },
          { name: "name", data_type: "string", nullable: false, sample_values: ["Premium Widget"] },
          { name: "category", data_type: "string", nullable: true, sample_values: ["Electronics"] },
          { name: "brand", data_type: "string", nullable: true, sample_values: ["Acme"] },
          { name: "price", data_type: "number", nullable: false, sample_values: ["99.99"] },
          { name: "cost", data_type: "number", nullable: true, sample_values: ["45.00"] },
          { name: "weight_kg", data_type: "number", nullable: true, sample_values: ["1.2"] },
          { name: "active", data_type: "boolean", nullable: true, sample_values: ["true"] },
          { name: "created_at", data_type: "datetime", nullable: true, sample_values: ["2020-01-10T00:00:00Z"] },
        ],
      },
      rawContent: '{"id":"prod-501","sku":"WIDGET-X1","name":"Premium Widget","category":"Electronics","brand":"Acme","price":99.99,"cost":45.00,"weight_kg":1.2,"active":true,"created_at":"2020-01-10T00:00:00Z"}',
    },
    {
      fileName: "payment_records.json",
      schema: {
        table_name: "payment_records",
        columns: [
          { name: "id", data_type: "string", nullable: false, sample_values: ["pay-001"] },
          { name: "transaction_id", data_type: "string", nullable: false, sample_values: ["txn-1001"] },
          { name: "paid_at", data_type: "datetime", nullable: false, sample_values: ["2024-11-15T10:31:00Z"] },
          { name: "amount", data_type: "number", nullable: false, sample_values: ["299.99"] },
          { name: "last_four", data_type: "string", nullable: true, sample_values: ["4242"] },
          { name: "card_brand", data_type: "string", nullable: true, sample_values: ["visa"] },
          { name: "reference", data_type: "string", nullable: true, sample_values: ["AUTH123"] },
          { name: "status", data_type: "string", nullable: true, sample_values: ["approved"] },
        ],
      },
      rawContent: '{"id":"pay-001","transaction_id":"txn-1001","paid_at":"2024-11-15T10:31:00Z","amount":299.99,"last_four":"4242","card_brand":"visa","reference":"AUTH123","status":"approved"}',
    },
  ],
};

/* ── Helpers ── */
function esc(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function fileIcon(name) {
  const ext = (name || "").split(".").pop()?.toLowerCase();
  if (ext === "json") return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V8l-5-5z"/></svg>';
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function fmtConf(v) {
  const n = Number(v ?? 0);
  return n > 1 ? n.toFixed(0) : (n * 100).toFixed(0);
}

function confColor(v) {
  const n = Number(v ?? 0);
  const pct = n > 1 ? n : n * 100;
  if (pct >= 80) return "var(--accent)";
  if (pct >= 50) return "var(--yellow)";
  return "var(--red)";
}

function confPct(v) {
  const n = Number(v ?? 0);
  return n > 1 ? n : n * 100;
}

const COL_PALETTE = [
  { bg: "rgba(34,197,94,0.12)",  border: "#22c55e", text: "#4ade80"  },  // green
  { bg: "rgba(59,130,246,0.12)", border: "#3b82f6", text: "#60a5fa"  },  // blue
  { bg: "rgba(168,85,247,0.12)", border: "#a855f7", text: "#c084fc"  },  // purple
  { bg: "rgba(234,179,8,0.12)",  border: "#eab308", text: "#facc15"  },  // yellow
  { bg: "rgba(239,68,68,0.12)",  border: "#ef4444", text: "#f87171"  },  // red
  { bg: "rgba(236,72,153,0.12)", border: "#ec4899", text: "#f472b6"  },  // pink
  { bg: "rgba(20,184,166,0.12)", border: "#14b8a6", text: "#2dd4bf"  },  // teal
  { bg: "rgba(249,115,22,0.12)", border: "#f97316", text: "#fb923c"  },  // orange
  { bg: "rgba(99,102,241,0.12)", border: "#6366f1", text: "#818cf8"  },  // indigo
  { bg: "rgba(6,182,212,0.12)",  border: "#06b6d4", text: "#22d3ee"  },  // cyan
  { bg: "rgba(132,204,22,0.12)", border: "#84cc16", text: "#a3e635"  },  // lime
  { bg: "rgba(244,63,94,0.12)",  border: "#f43f5e", text: "#fb7185"  },  // rose
];

/* ── File tree ── */
function renderTree(container, emptyEl, files, activeKey, side) {
  emptyEl.style.display = files.length ? "none" : "block";
  container.querySelectorAll(".tree-item").forEach((el) => el.remove());

  for (const f of files) {
    const item = document.createElement("div");
    item.className = "tree-item" + (activeKey === f.fileName ? " active" : "");
    item.innerHTML = `
      <span class="icon">${fileIcon(f.fileName)}</span>
      <span class="tree-item-label" title="${esc(f.fileName)}">${esc(f.fileName)}</span>
      <button type="button" class="tree-item-remove" title="Remove file">&times;</button>
    `;
    item.querySelector(".tree-item-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      removeFile(side, f.fileName);
    });
    item.addEventListener("click", (e) => {
      if (!e.target.closest(".tree-item-remove")) selectFile(side, f.fileName);
    });
    container.appendChild(item);
  }
}

function removeFile(side, fileName) {
  if (side === "source") {
    sourceFiles = sourceFiles.filter((f) => f.fileName !== fileName);
    if (activeSource === fileName) {
      activeSource = sourceFiles.length ? sourceFiles[0].fileName : null;
      if (activeSource) selectFile("source", activeSource);
      else {
        sourceContent.innerHTML = '<div class="placeholder-text">Select a file to preview</div>';
        renderTree(sourceTree, sourceEmpty, sourceFiles, null, "source");
      }
    } else {
      renderTree(sourceTree, sourceEmpty, sourceFiles, activeSource, "source");
    }
  } else {
    targetFiles = targetFiles.filter((f) => f.fileName !== fileName);
    if (activeTarget === fileName) {
      activeTarget = targetFiles.length ? targetFiles[0].fileName : null;
      if (activeTarget) selectFile("target", activeTarget);
      else {
        targetContent.innerHTML = '<div class="placeholder-text">Select a file to preview</div>';
        renderTree(targetTree, targetEmpty, targetFiles, null, "target");
      }
    } else {
      renderTree(targetTree, targetEmpty, targetFiles, activeTarget, "target");
    }
  }
}

/* ── Collapsible JSON tree builder ── */
function buildJsonTree(data, key, isLast, depth) {
  const maxDepth = 20;
  if (depth > maxDepth) return `<div class="jt-row"><span class="jt-spacer"></span><span class="jt-collapsed-preview">...</span></div>`;

  const comma = isLast ? "" : '<span class="jt-comma">,</span>';
  const keyHtml = key !== null ? `<span class="jt-key">"${esc(String(key))}"</span><span class="jt-colon">:</span>` : "";

  if (data === null) {
    return `<div class="jt-row"><span class="jt-spacer"></span>${keyHtml}<span class="jt-null">null</span>${comma}</div>`;
  }
  if (typeof data === "boolean") {
    return `<div class="jt-row"><span class="jt-spacer"></span>${keyHtml}<span class="jt-boolean">${data}</span>${comma}</div>`;
  }
  if (typeof data === "number") {
    return `<div class="jt-row"><span class="jt-spacer"></span>${keyHtml}<span class="jt-number">${data}</span>${comma}</div>`;
  }
  if (typeof data === "string") {
    return `<div class="jt-row"><span class="jt-spacer"></span>${keyHtml}<span class="jt-string">"${esc(data)}"</span>${comma}</div>`;
  }

  const isArr = Array.isArray(data);
  const open = isArr ? "[" : "{";
  const close = isArr ? "]" : "}";
  const entries = isArr ? data.map((v, i) => [i, v]) : Object.entries(data);
  const count = entries.length;
  const preview = isArr ? `${count} item${count !== 1 ? "s" : ""}` : `${count} key${count !== 1 ? "s" : ""}`;
  const id = `jt-${depth}-${key ?? "root"}-${Math.random().toString(36).slice(2, 8)}`;

  let html = `<div class="jt-row">`;
  html += `<button class="jt-toggle" data-target="${id}" title="Toggle">▼</button>`;
  html += `${keyHtml}<span class="jt-bracket">${open}</span>`;
  html += `<span class="jt-collapsed-preview" id="${id}-preview" style="display:none"> ${esc(preview)} </span>`;
  html += `</div>`;
  html += `<div class="jt-children" id="${id}">`;

  entries.forEach(([k, v], i) => {
    html += buildJsonTree(v, isArr ? null : k, i === count - 1, depth + 1);
  });

  html += `</div>`;
  html += `<div class="jt-row"><span class="jt-spacer"></span><span class="jt-bracket">${close}</span>${comma}</div>`;

  return html;
}

function attachJsonTreeListeners(container) {
  container.querySelectorAll(".jt-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const children = document.getElementById(targetId);
      const preview = document.getElementById(targetId + "-preview");
      if (!children) return;
      const isCollapsed = children.classList.toggle("collapsed");
      btn.textContent = isCollapsed ? "▶" : "▼";
      if (preview) preview.style.display = isCollapsed ? "inline" : "none";
    });
  });
}

function selectFile(side, fileName) {
  const files = side === "source" ? sourceFiles : targetFiles;
  const contentEl = side === "source" ? sourceContent : targetContent;
  const file = files.find((f) => f.fileName === fileName);
  if (!file) return;

  if (side === "source") activeSource = fileName;
  else activeTarget = fileName;

  renderTree(
    side === "source" ? sourceTree : targetTree,
    side === "source" ? sourceEmpty : targetEmpty,
    files, fileName, side
  );

  const ext = (fileName || "").split(".").pop()?.toLowerCase();
  let html = `<div class="content-meta">${esc(fileName)} &middot; ${file.schema?.columns?.length || 0} columns</div>`;

  if (ext === "csv" || ext === "txt") {
    const fileKey = `${side}:${fileName}`;
    if (!fileSeparators[fileKey]) fileSeparators[fileKey] = detectDelimiter(file.rawContent);
    const sep = fileSeparators[fileKey];
    const { headers, rows } = parseDelimited(file.rawContent, sep);

    html += `<div class="csv-sep-bar"><label class="csv-sep-label">Separator</label><select class="csv-sep-select" id="csv-sep-${side}">`;
    for (const d of DELIMITERS) {
      const sel = d.value === sep ? " selected" : "";
      html += `<option value="${esc(d.value)}"${sel}>${esc(d.label)}</option>`;
    }
    html += `</select><span class="csv-sep-info">${headers.length} columns &middot; ${rows.length} row${rows.length !== 1 ? "s" : ""}</span></div>`;

    if (headers.length) {
      html += "<table><thead><tr><th class='csv-row-num'>#</th>";
      headers.forEach((h, i) => {
        const c = COL_PALETTE[i % COL_PALETTE.length];
        html += `<th style="background:${c.bg};color:${c.text};border-bottom:2px solid ${c.border}">${esc(h)}</th>`;
      });
      html += "</tr></thead><tbody>";
      rows.slice(0, 50).forEach((row, ri) => {
        html += `<tr><td class="csv-row-num">${ri + 1}</td>`;
        row.forEach((cell, ci) => {
          const c = COL_PALETTE[ci % COL_PALETTE.length];
          html += `<td style="border-left-color:${c.border}">${esc(cell)}</td>`;
        });
        html += "</tr>";
      });
      html += "</tbody></table>";
      if (rows.length > 50) html += `<div class="content-meta">&hellip; and ${rows.length - 50} more rows</div>`;
      const highlighted = Prism.highlight(file.rawContent, Prism.languages.csv, "csv");
      html += `<details style="margin-top:0.75rem"><summary style="cursor:pointer;font-size:0.75rem;color:var(--muted);user-select:none">Raw content</summary><pre class="language-csv"><code class="language-csv">${highlighted}</code></pre></details>`;
    } else {
      html += `<pre>${esc(file.rawContent)}</pre>`;
    }
  } else if (ext === "json") {
    let parsed = null;
    try { parsed = JSON.parse(file.rawContent); } catch {}
    if (parsed !== null) {
      html += `<div class="json-tree" id="json-tree-${side}">` + buildJsonTree(parsed, null, true, 0) + `</div>`;
    } else {
      html += `<pre>${esc(file.rawContent)}</pre>`;
    }
  } else {
    html += `<pre>${esc(file.rawContent)}</pre>`;
  }

  contentEl.innerHTML = html;

  if (ext === "json") {
    const treeEl = contentEl.querySelector(".json-tree");
    if (treeEl) attachJsonTreeListeners(treeEl);
  }

  const sepSelect = contentEl.querySelector(`#csv-sep-${side}`);
  if (sepSelect) {
    sepSelect.addEventListener("change", () => {
      const fileKey = `${side}:${fileName}`;
      fileSeparators[fileKey] = sepSelect.value;
      selectFile(side, fileName);
    });
  }
}

/* ── File add ── */
async function handleFileAdd(fileList, side) {
  if (!fileList?.length) return;
  hideError();
  try {
    const items = await parseFilesWithContent(fileList);
    if (side === "source") {
      sourceFiles = [...sourceFiles, ...items];
      renderTree(sourceTree, sourceEmpty, sourceFiles, activeSource, "source");
      if (!activeSource && sourceFiles.length) selectFile("source", sourceFiles[0].fileName);
    } else {
      targetFiles = [...targetFiles, ...items];
      renderTree(targetTree, targetEmpty, targetFiles, activeTarget, "target");
      if (!activeTarget && targetFiles.length) selectFile("target", targetFiles[0].fileName);
    }
  } catch (err) {
    showError(err.message || "Failed to parse files");
  }
}

/* ── Event: file buttons ── */
sourceAddBtn.addEventListener("click", () => sourceFileInput.click());
targetAddBtn.addEventListener("click", () => targetFileInput.click());

sourceFileInput.addEventListener("change", (e) => {
  if (e.target.files?.length) handleFileAdd(e.target.files, "source");
  e.target.value = "";
});

targetFileInput.addEventListener("change", (e) => {
  if (e.target.files?.length) handleFileAdd(e.target.files, "target");
  e.target.value = "";
});

/* ── Event: load example ── */
loadExampleBtn.addEventListener("click", () => {
  sourceFiles = [...EXAMPLE.sourceFiles];
  targetFiles = [...EXAMPLE.targetFiles];
  activeSource = sourceFiles[0]?.fileName ?? null;
  activeTarget = targetFiles[0]?.fileName ?? null;
  currentMapping = null;
  chatHistory = [];
  lastSourceSchema = null;
  lastTargetSchema = null;
  renderTree(sourceTree, sourceEmpty, sourceFiles, activeSource, "source");
  renderTree(targetTree, targetEmpty, targetFiles, activeTarget, "target");
  if (activeSource) selectFile("source", activeSource);
  if (activeTarget) selectFile("target", activeTarget);
  showResultEmpty();
  renderChat();
  hideError();
});

/* ── Rules files ── */
rulesToggle.addEventListener("click", (e) => {
  if (e.target.closest(".rules-add-btn")) return;
  rulesSection.classList.toggle("collapsed");
});

rulesAddBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  rulesFileInput.click();
});

rulesFileInput.addEventListener("change", async (e) => {
  const files = e.target.files;
  if (!files?.length) return;
  for (const file of files) {
    const text = await file.text();
    rulesFiles.push({ fileName: file.name, content: text });
  }
  e.target.value = "";
  renderRules();
});

function renderRules() {
  rulesEmpty.style.display = rulesFiles.length ? "none" : "block";
  rulesCount.textContent = rulesFiles.length ? `(${rulesFiles.length})` : "";
  rulesList.querySelectorAll(".rule-item").forEach((el) => el.remove());

  for (const r of rulesFiles) {
    const item = document.createElement("div");
    item.className = "rule-item" + (activeRule === r.fileName ? " active" : "");
    item.innerHTML = `
      <svg class="rule-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
      <span class="rule-name">${esc(r.fileName)}</span>
      <button type="button" class="rule-remove" title="Remove">&times;</button>
    `;
    item.querySelector(".rule-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      rulesFiles = rulesFiles.filter((f) => f.fileName !== r.fileName);
      if (activeRule === r.fileName) { activeRule = null; rulesPreview.classList.remove("visible"); }
      renderRules();
    });
    item.addEventListener("click", (e) => {
      if (e.target.closest(".rule-remove")) return;
      if (activeRule === r.fileName) {
        activeRule = null;
        rulesPreview.classList.remove("visible");
      } else {
        activeRule = r.fileName;
        rulesPreview.textContent = r.content;
        rulesPreview.classList.add("visible");
      }
      renderRules();
    });
    rulesList.appendChild(item);
  }

  if (!activeRule) rulesPreview.classList.remove("visible");
}

function getRulesText() {
  if (!rulesFiles.length) return "";
  return rulesFiles.map((r) => `### ${r.fileName}\n${r.content}`).join("\n\n");
}

/* ── Splitters ── */
function initSplitter(el, direction, containerSelector, panelA, panelB) {
  if (!el) return;
  let startPos = 0, startAPct = 0, total = 0;

  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const container = el.parentElement;
    total = direction === "h" ? container.offsetWidth : container.offsetHeight;
    const aSize = direction === "h" ? panelA.offsetWidth : panelA.offsetHeight;
    startAPct = (aSize / total) * 100;
    startPos = direction === "h" ? e.clientX : e.clientY;
    el.classList.add("active");

    const onMove = (ev) => {
      const delta = (direction === "h" ? ev.clientX : ev.clientY) - startPos;
      const pct = (delta / total) * 100;
      const newA = Math.max(15, Math.min(85, startAPct + pct));
      panelA.style.flex = `1 1 ${newA}%`;
      panelB.style.flex = `1 1 ${100 - newA}%`;
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      el.classList.remove("active");
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = direction === "h" ? "col-resize" : "ns-resize";
    document.body.style.userSelect = "none";
  });
}

initSplitter(
  document.getElementById("v-splitter"), "h", null,
  document.getElementById("panel-source"),
  document.getElementById("panel-target")
);

/* ── Tree splitters (resize file tree width) ── */
document.querySelectorAll(".tree-splitter").forEach((splitter) => {
  let startX = 0, startWidth = 0;
  const tree = splitter.previousElementSibling;

  splitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = tree.offsetWidth;
    splitter.classList.add("active");

    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      const newW = Math.max(80, Math.min(400, startWidth + delta));
      tree.style.width = newW + "px";
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      splitter.classList.remove("active");
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
});

initSplitter(
  document.getElementById("h-splitter"), "v", null,
  document.getElementById("top-row"),
  document.getElementById("bottom-row")
);

/* ── Mapping minimize / maximize / restore ── */
const mappingMinimize = document.getElementById("mapping-minimize");
const mappingMaximize = document.getElementById("mapping-maximize");
const mappingRestore = document.getElementById("mapping-restore");
const mainEl = document.querySelector(".main");
const topRow = document.getElementById("top-row");
const bottomRow = document.getElementById("bottom-row");

let mappingState = "normal"; // "normal" | "minimized" | "maximized"

function setMappingState(state) {
  mainEl.classList.remove("mapping-maximized", "mapping-minimized");
  bottomRow.classList.remove("minimized");
  mappingMinimize.classList.remove("hidden");
  mappingMaximize.classList.remove("hidden");
  mappingRestore.classList.add("hidden");

  if (state === "minimized") {
    bottomRow.classList.add("minimized");
    mainEl.classList.add("mapping-minimized");
    mappingMinimize.classList.add("hidden");
    mappingRestore.classList.remove("hidden");
  } else if (state === "maximized") {
    mainEl.classList.add("mapping-maximized");
    mappingMaximize.classList.add("hidden");
    mappingRestore.classList.remove("hidden");
  }

  mappingState = state;
}

mappingMinimize.addEventListener("click", () => {
  setMappingState(mappingState === "minimized" ? "normal" : "minimized");
});

mappingMaximize.addEventListener("click", () => {
  setMappingState(mappingState === "maximized" ? "normal" : "maximized");
});

mappingRestore.addEventListener("click", () => {
  setMappingState("normal");
});

/* ── Chat ── */
chatSend.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

async function sendChatMessage() {
  const text = (chatInput.value || "").trim();
  if (!text) return;

  chatInput.value = "";
  chatSend.disabled = true;
  chatHistory.push({ role: "user", content: text });
  renderChat();

  const isFirstMessage = !currentMapping;

  if (isFirstMessage) {
    if (!sourceFiles.length || !targetFiles.length) {
      showError("Add at least one file to Source and Target first.");
      chatHistory.pop(); renderChat(); chatSend.disabled = false;
      return;
    }
    const srcBlobs = sourceFiles.map((f) => new File([f.rawContent], f.fileName, { type: "text/plain" }));
    const tgtBlobs = targetFiles.map((f) => new File([f.rawContent], f.fileName, { type: "text/plain" }));
    let sourceSchema, targetSchema;
    try {
      sourceSchema = await parseFiles(srcBlobs);
      targetSchema = await parseFiles(tgtBlobs);
    } catch {
      showError("Could not parse files.");
      chatHistory.pop(); renderChat(); chatSend.disabled = false;
      return;
    }
    if (!sourceSchema?.columns?.length || !targetSchema?.columns?.length) {
      showError("Could not infer schemas from files.");
      chatHistory.pop(); renderChat(); chatSend.disabled = false;
      return;
    }
    lastSourceSchema = sourceSchema;
    lastTargetSchema = targetSchema;

    try {
      addThinking();
      const res = await fetch("/api/map-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_schema: sourceSchema, target_schema: targetSchema, user_instruction: text, rules: getRulesText() }),
      });
      const data = await res.json();
      removeThinking();
      if (!res.ok) { showError(data.error || "Request failed"); chatHistory.pop(); renderChat(); return; }
      currentMapping = data;
      chatHistory.push({ role: "assistant", content: data.analysis_summary || "Mapping generated. See results below." });
      renderResult(data);
      renderChat();
    } catch (err) {
      removeThinking();
      showError(err.message || "Network error");
      chatHistory.pop(); renderChat();
    } finally { chatSend.disabled = false; }
  } else {
    try {
      addThinking();
      const res = await fetch("/api/refine-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_schema: lastSourceSchema,
          target_schema: lastTargetSchema,
          current_mapping: currentMapping,
          messages: chatHistory.slice(0, -1),
          user_message: text,
          rules: getRulesText(),
        }),
      });
      const data = await res.json();
      removeThinking();
      if (!res.ok) { showError(data.error || "Request failed"); chatHistory.pop(); renderChat(); return; }
      currentMapping = data.mapping;
      chatHistory.push({ role: "assistant", content: data.message || "Mapping updated." });
      renderResult(data.mapping);
      renderChat();
    } catch (err) {
      removeThinking();
      showError(err.message || "Network error");
      chatHistory.pop(); renderChat();
    } finally { chatSend.disabled = false; }
  }
}

function addThinking() {
  const el = document.createElement("div");
  el.className = "chat-message assistant thinking";
  el.id = "thinking-indicator";
  el.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeThinking() {
  document.getElementById("thinking-indicator")?.remove();
}

function renderChat() {
  chatMessages.innerHTML = "";
  if (!chatHistory.length) {
    chatMessages.innerHTML = '<div class="chat-welcome"><p>Add source &amp; target files, then describe what you want to map.</p></div>';
    return;
  }
  for (const m of chatHistory) {
    const el = document.createElement("div");
    el.className = `chat-message ${m.role}`;
    el.innerHTML = `<div class="role">${m.role === "user" ? "You" : "AI"}</div><div>${esc(m.content)}</div>`;
    chatMessages.appendChild(el);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* ── Mapping render (grouped by target table) ── */

function groupMappings(mappings) {
  const groups = new Map();
  for (const m of mappings) {
    const tgt = m.target_column || "";
    const dotIdx = tgt.indexOf(".");
    const table = dotIdx > 0 ? tgt.substring(0, dotIdx) : "_default";
    const col = dotIdx > 0 ? tgt.substring(dotIdx + 1) : tgt;
    if (!groups.has(table)) groups.set(table, []);
    groups.get(table).push({ ...m, _col: col });
  }
  return groups;
}

function inferSourceTable(sourceColumns) {
  const tables = new Set();
  for (const s of sourceColumns) {
    const dotIdx = s.indexOf(".");
    if (dotIdx > 0) tables.add(s.substring(0, dotIdx));
  }
  return [...tables];
}

function renderResult(data) {
  if (!data) return;
  resultEmpty.classList.add("hidden");
  resultContent.classList.remove("hidden");

  const gc = fmtConf(data.global_confidence);
  globalConfBadge.textContent = `${gc}% confidence`;
  globalConfBadge.style.color = confColor(data.global_confidence);

  analysisSummary.textContent = data.analysis_summary || "";

  const mappings = data.mappings || [];
  const groups = groupMappings(mappings);

  let html = "";
  for (const [table, items] of groups) {
    const srcTables = new Set();
    for (const m of items) {
      for (const t of inferSourceTable(m.source_columns || [])) srcTables.add(t);
    }
    const srcLabel = srcTables.size
      ? `<span class="group-source-label">from <span>${esc([...srcTables].join(", "))}</span></span>`
      : "";
    const avgConf = items.reduce((s, m) => s + confPct(m.confidence_score ?? m.confidence), 0) / items.length;
    const confCol = confColor(avgConf > 1 ? avgConf : avgConf / 100);

    html += `
      <div class="mapping-group">
        <div class="mapping-group-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <svg class="group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          <span class="group-label">${esc(table === "_default" ? "Mappings" : table)}</span>
          ${srcLabel}
          <span class="group-count">${items.length} column${items.length !== 1 ? "s" : ""}</span>
          <span class="group-conf" style="color:${confCol}">${avgConf.toFixed(0)}%</span>
        </div>
        <div class="mapping-group-body">
          <table class="mapping-table">
            <thead><tr>
              <th>Source</th><th></th><th>Target</th><th>Type</th><th>Confidence</th><th>Transformation</th>
            </tr></thead>
            <tbody>
    `;

    for (const m of items) {
      const src = (m.source_columns || []).join(", ") || "—";
      const pct = confPct(m.confidence_score ?? m.confidence);
      const color = confColor(m.confidence_score ?? m.confidence);
      const mt = m.match_type || "semantic";
      const transform = m.transformation_rule ?? m.transformation ?? "";

      html += `
        <tr>
          <td class="col-source">${esc(src)}</td>
          <td class="col-arrow">→</td>
          <td class="col-target">${esc(m._col || m.target_column)}</td>
          <td class="col-type"><span class="match-badge ${esc(mt)}">${esc(mt)}</span></td>
          <td>
            <div class="conf-bar">
              <div class="conf-bar-track"><div class="conf-bar-fill" style="width:${pct}%;background:${color}"></div></div>
              <span class="conf-bar-label" style="color:${color}">${pct.toFixed(0)}%</span>
            </div>
          </td>
          <td class="col-transform">${transform ? esc(transform) : '<span class="no-transform">direct</span>'}</td>
        </tr>
        ${m.reasoning ? `<tr class="reason-row"><td colspan="6">${esc(m.reasoning)}</td></tr>` : ""}
      `;
    }

    html += `</tbody></table></div></div>`;
  }

  mappingGroups.innerHTML = html;

  const hasUnmapped =
    (data.unmapped_source_columns?.length || 0) > 0 ||
    (data.unmapped_target_columns?.length || 0) > 0;

  if (hasUnmapped) {
    unmappedContainer.classList.remove("hidden");
    let uhtml = "";
    if (data.unmapped_source_columns?.length) {
      uhtml += `<h4>Unmapped Source</h4><ul>${data.unmapped_source_columns.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
    }
    if (data.unmapped_target_columns?.length) {
      uhtml += `<h4>Unmapped Target</h4><ul>${data.unmapped_target_columns.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
    }
    unmappedContainer.innerHTML = uhtml;
  } else {
    unmappedContainer.classList.add("hidden");
  }
}

function showResultEmpty() {
  resultEmpty.classList.remove("hidden");
  resultContent.classList.add("hidden");
}

/* ── Export ── */
exportTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle("hidden");
});

document.addEventListener("click", () => exportMenu.classList.add("hidden"));

document.querySelectorAll(".export-item").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.classList.add("hidden");
    const fmt = btn.dataset.format;
    if (!currentMapping) return;
    if (fmt === "pdf") exportPDF(currentMapping);
    else if (fmt === "csv") exportCSV(currentMapping);
    else if (fmt === "json") exportJSON(currentMapping);
    else if (fmt === "sql") exportSQL(currentMapping);
    else if (fmt === "databricks") exportDatabricks(currentMapping);
  });
});

function downloadFile(content, fileName, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function pdfBadgeColor(type) {
  const map = { exact: "#16a34a", semantic: "#2563eb", derived: "#9333ea", transformed: "#ca8a04", incompatible: "#dc2626" };
  return map[type] || "#6b7280";
}

function pdfBadgeBg(type) {
  const map = { exact: "#dcfce7", semantic: "#dbeafe", derived: "#f3e8ff", transformed: "#fef9c3", incompatible: "#fee2e2" };
  return map[type] || "#f3f4f6";
}

function pdfConfColor(pct) {
  if (pct >= 80) return "#16a34a";
  if (pct >= 50) return "#ca8a04";
  return "#dc2626";
}

function exportPDF(data) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const mx = 14;
  let y = 14;

  const hexToRgb = (h) => {
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    return [r, g, b];
  };

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("Schema Mapping Report", mx, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text("Data Migration Mapping Analysis", mx, 18);

  const gc = confPct(data.global_confidence);
  const gcCol = hexToRgb(pdfConfColor(gc));
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`${dateStr} at ${timeStr}`, W - mx, 12, { align: "right" });

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...gcCol);
  doc.text(`${gc.toFixed(0)}% confidence`, W - mx, 19, { align: "right" });

  y = 36;

  if (data.analysis_summary) {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(mx, y, W - 2 * mx, 14, 2, 2, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(data.analysis_summary, W - 2 * mx - 8);
    doc.text(lines.slice(0, 3), mx + 4, y + 5);
    y += 18;
  }

  const groups = groupMappings(data.mappings || []);

  for (const [table, items] of groups) {
    if (y > H - 40) { doc.addPage(); y = 14; }

    const srcTables = new Set();
    for (const m of items) for (const t of inferSourceTable(m.source_columns || [])) srcTables.add(t);
    const avgConf = items.reduce((s, m) => s + confPct(m.confidence_score ?? m.confidence), 0) / items.length;
    const avgCol = hexToRgb(pdfConfColor(avgConf));

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(mx, y, W - 2 * mx, 9, 1.5, 1.5, "F");
    doc.setFont("courier", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(table === "_default" ? "Mappings" : table, mx + 4, y + 6);

    if (srcTables.size) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      const fromLabel = `from ${[...srcTables].join(", ")}`;
      doc.text(fromLabel, mx + 4 + doc.getTextWidth(table === "_default" ? "Mappings" : table) + 6, y + 6);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...avgCol);
    doc.text(`${avgConf.toFixed(0)}%`, W - mx - 4, y + 6, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(`${items.length} col${items.length !== 1 ? "s" : ""}`, W - mx - 16, y + 6, { align: "right" });

    y += 11;

    const tableBody = items.map((m) => {
      const src = (m.source_columns || []).join(", ") || "—";
      const pct = confPct(m.confidence_score ?? m.confidence);
      const mt = m.match_type || "semantic";
      const transform = m.transformation_rule ?? m.transformation ?? "";
      return [src, "→", m._col || m.target_column || "", mt, `${pct.toFixed(0)}%`, transform || "direct"];
    });

    doc.autoTable({
      startY: y,
      head: [["Source", "", "Target", "Type", "Conf.", "Transformation"]],
      body: tableBody,
      margin: { left: mx, right: mx },
      theme: "grid",
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [71, 85, 105],
        fontStyle: "bold",
        fontSize: 6.5,
        cellPadding: 2.5,
      },
      bodyStyles: { fontSize: 7, cellPadding: 2.5, textColor: [30, 41, 59] },
      columnStyles: {
        0: { font: "courier", textColor: [22, 163, 74], fontStyle: "bold", cellWidth: 50 },
        1: { halign: "center", cellWidth: 8, textColor: [148, 163, 184] },
        2: { font: "courier", textColor: [37, 99, 246], fontStyle: "bold", cellWidth: 40 },
        3: { cellWidth: 22, fontSize: 6.5 },
        4: { cellWidth: 16, halign: "center", fontStyle: "bold" },
        5: { font: "courier", fontSize: 6, textColor: [161, 98, 7], cellWidth: "auto" },
      },
      didParseCell: (hookData) => {
        if (hookData.section === "body" && hookData.column.index === 3) {
          const mt = hookData.cell.raw;
          hookData.cell.styles.textColor = hexToRgb(pdfBadgeColor(mt));
        }
        if (hookData.section === "body" && hookData.column.index === 4) {
          const val = parseFloat(hookData.cell.raw);
          hookData.cell.styles.textColor = hexToRgb(pdfConfColor(val));
        }
        if (hookData.section === "body" && hookData.column.index === 5 && hookData.cell.raw === "direct") {
          hookData.cell.styles.textColor = [148, 163, 184];
          hookData.cell.styles.fontStyle = "italic";
          hookData.cell.styles.font = "helvetica";
        }
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
    });

    y = doc.lastAutoTable.finalY + 8;
  }

  if ((data.unmapped_source_columns?.length || 0) > 0 || (data.unmapped_target_columns?.length || 0) > 0) {
    if (y > H - 30) { doc.addPage(); y = 14; }
    doc.setFillColor(254, 242, 242);
    doc.roundedRect(mx, y, W - 2 * mx, 16, 2, 2, "F");
    doc.setDrawColor(252, 165, 165);
    doc.roundedRect(mx, y, W - 2 * mx, 16, 2, 2, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(153, 27, 27);
    doc.text("Unmapped Columns", mx + 4, y + 5);
    doc.setFont("courier", "normal");
    doc.setFontSize(7);
    doc.setTextColor(185, 28, 28);
    if (data.unmapped_source_columns?.length) {
      doc.text(`Source: ${data.unmapped_source_columns.join(", ")}`, mx + 4, y + 10);
    }
    if (data.unmapped_target_columns?.length) {
      doc.text(`Target: ${data.unmapped_target_columns.join(", ")}`, mx + 4, y + 14);
    }
  }

  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text("Schema Mapping Migrator", mx, H - 6);
  doc.text(dateStr, W - mx, H - 6, { align: "right" });

  doc.save("schema_mapping.pdf");
}

function exportCSV(data) {
  const rows = [["source_columns", "target_column", "match_type", "confidence", "transformation_rule", "reasoning"]];
  for (const m of data.mappings || []) {
    rows.push([
      (m.source_columns || []).join("; "),
      m.target_column || "",
      m.match_type || "",
      String(confPct(m.confidence_score ?? m.confidence).toFixed(0)),
      m.transformation_rule ?? m.transformation ?? "",
      m.reasoning || "",
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile(csv, "schema_mapping.csv", "text/csv");
}

function exportJSON(data) {
  downloadFile(JSON.stringify(data, null, 2), "schema_mapping.json", "application/json");
}

function exportSQL(data) {
  const groups = groupMappings(data.mappings || []);
  let sql = `-- Schema Mapping: SQL Migration Queries\n-- Generated ${new Date().toISOString()}\n-- Global confidence: ${fmtConf(data.global_confidence)}%\n\n`;

  for (const [table, items] of groups) {
    const srcTables = new Set();
    for (const m of items) {
      for (const t of inferSourceTable(m.source_columns || [])) srcTables.add(t);
    }
    const srcTable = [...srcTables][0] || "source_table";

    const selectCols = items.map((m) => {
      const transform = m.transformation_rule ?? m.transformation ?? "";
      const col = m._col || m.target_column;
      if (transform) return `  ${transform} AS ${col}`;
      const src = (m.source_columns || [])[0] || "NULL";
      const srcCol = src.includes(".") ? src.split(".").pop() : src;
      return `  ${srcCol} AS ${col}`;
    });

    sql += `-- Target: ${table === "_default" ? "target_table" : table}\n`;
    sql += `INSERT INTO ${table === "_default" ? "target_table" : table} (\n`;
    sql += items.map((m) => `  ${m._col || m.target_column}`).join(",\n");
    sql += `\n)\nSELECT\n`;
    sql += selectCols.join(",\n");
    sql += `\nFROM ${srcTable};\n\n`;
  }

  if (data.unmapped_source_columns?.length) {
    sql += `-- Unmapped source columns: ${data.unmapped_source_columns.join(", ")}\n`;
  }
  if (data.unmapped_target_columns?.length) {
    sql += `-- Unmapped target columns (need manual mapping): ${data.unmapped_target_columns.join(", ")}\n`;
  }

  downloadFile(sql, "schema_mapping.sql");
}

function exportDatabricks(data) {
  const groups = groupMappings(data.mappings || []);
  let py = `# Schema Mapping: Databricks / PySpark Migration\n# Generated ${new Date().toISOString()}\n# Global confidence: ${fmtConf(data.global_confidence)}%\n\nfrom pyspark.sql import functions as F\n\n`;

  for (const [table, items] of groups) {
    const srcTables = new Set();
    for (const m of items) {
      for (const t of inferSourceTable(m.source_columns || [])) srcTables.add(t);
    }
    const srcTable = [...srcTables][0] || "source_table";
    const tgtTable = table === "_default" ? "target_table" : table;
    const dfVar = `df_${tgtTable.replace(/[^a-zA-Z0-9]/g, "_")}`;

    py += `# ── ${tgtTable} ──\n`;
    py += `${dfVar} = spark.table("${srcTable}")\n`;

    for (const m of items) {
      const col = m._col || m.target_column;
      const transform = m.transformation_rule ?? m.transformation ?? "";
      const src = (m.source_columns || [])[0] || "";
      const srcCol = src.includes(".") ? src.split(".").pop() : src;

      if (transform) {
        py += `${dfVar} = ${dfVar}.withColumn("${col}", F.expr("${transform.replace(/"/g, '\\"')}"))\n`;
      } else if (srcCol && srcCol !== col) {
        py += `${dfVar} = ${dfVar}.withColumnRenamed("${srcCol}", "${col}")\n`;
      }
    }

    const selectCols = items.map((m) => `"${m._col || m.target_column}"`).join(", ");
    py += `${dfVar} = ${dfVar}.select(${selectCols})\n`;
    py += `${dfVar}.write.mode("overwrite").saveAsTable("${tgtTable}")\n\n`;
  }

  if (data.unmapped_source_columns?.length) {
    py += `# Unmapped source columns: ${data.unmapped_source_columns.join(", ")}\n`;
  }
  if (data.unmapped_target_columns?.length) {
    py += `# Unmapped target columns (need manual mapping): ${data.unmapped_target_columns.join(", ")}\n`;
  }

  downloadFile(py, "schema_mapping_databricks.py", "text/x-python");
}

/* ── Error ── */
function showError(msg) {
  errorSection.classList.remove("hidden");
  errorMessage.textContent = msg;
}

function hideError() {
  errorSection.classList.add("hidden");
}

errorClose.addEventListener("click", hideError);
