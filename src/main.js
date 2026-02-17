import { parseFilesWithContent, parseDelimited, detectDelimiter } from "./parse-file.js";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
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
const rulesAddDropdown = document.getElementById("rules-add-dropdown");
const rulesAddTrigger = document.getElementById("rules-add-trigger");
const rulesAddMenu = document.getElementById("rules-add-menu");
const rulesToggle = document.getElementById("rules-toggle");
const rulesSection = document.getElementById("rules-section");
const rulesList = document.getElementById("rules-list");
const rulesEmpty = document.getElementById("rules-empty");
const rulesCount = document.getElementById("rules-count");
const rulesPreview = document.getElementById("rules-preview");

const chatStop = document.getElementById("chat-stop");
const sessionSaveBtn = document.getElementById("session-save");
const sessionLoadBtn = document.getElementById("session-load");
const sessionClearBtn = document.getElementById("session-clear");

/* ── State ── */
let sourceFiles = [];
let targetFiles = [];
let activeSource = null;
let activeTarget = null;
let currentMapping = null;
let chatHistory = [];
let rulesFiles = [];
let activeRule = null;
const fileSeparators = {};
let currentAbortController = null;
let isGenerating = false;

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
  if (e.target.closest(".rules-add-dropdown")) return;
  rulesSection.classList.toggle("collapsed");
});

rulesAddTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  rulesAddMenu.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!rulesAddDropdown.contains(e.target)) rulesAddMenu.classList.add("hidden");
});

rulesAddDropdown.addEventListener("click", (e) => e.stopPropagation());

document.getElementById("rules-add-file").addEventListener("click", (e) => {
  e.stopPropagation();
  rulesAddMenu.classList.add("hidden");
  rulesFileInput.click();
});

document.getElementById("rules-add-write").addEventListener("click", (e) => {
  e.stopPropagation();
  rulesAddMenu.classList.add("hidden");
  openRuleEditor();
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

function openRuleEditor(existingRule) {
  const isEdit = !!existingRule;
  const overlay = document.createElement("div");
  overlay.className = "rule-editor-overlay";
  overlay.id = "rule-editor-overlay";
  overlay.innerHTML = `
    <div class="rule-editor-panel">
      <div class="rule-editor-header">
        <span class="rule-editor-title">${isEdit ? "Edit Rule" : "Add Rule"}</span>
        <button type="button" class="stream-overlay-close" id="rule-editor-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="rule-editor-body">
        <div class="rule-editor-field">
          <label class="rule-editor-label" for="rule-editor-name">Name</label>
          <input type="text" class="rule-editor-input" id="rule-editor-name" placeholder="e.g. id-mapping-rules" value="${isEdit ? esc(existingRule.fileName.replace(/\.[^.]+$/, "")) : ""}" />
        </div>
        <div class="rule-editor-field rule-editor-field-grow">
          <label class="rule-editor-label" for="rule-editor-content">Rule content</label>
          <textarea class="rule-editor-textarea" id="rule-editor-content" placeholder="Paste or type your mapping rules here...">${isEdit ? esc(existingRule.content) : ""}</textarea>
        </div>
      </div>
      <div class="rule-editor-footer">
        <button type="button" class="btn-sm btn-ghost" id="rule-editor-cancel">Cancel</button>
        <button type="button" class="btn-sm" id="rule-editor-save">${isEdit ? "Save" : "Add Rule"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector("#rule-editor-name");
  const contentArea = overlay.querySelector("#rule-editor-content");
  const saveBtn = overlay.querySelector("#rule-editor-save");
  const cancelBtn = overlay.querySelector("#rule-editor-cancel");
  const closeBtn = overlay.querySelector("#rule-editor-close");

  nameInput.focus();

  function close() {
    overlay.remove();
  }

  function save() {
    const name = (nameInput.value || "").trim();
    const content = (contentArea.value || "").trim();
    if (!content) {
      contentArea.classList.add("rule-editor-error");
      setTimeout(() => contentArea.classList.remove("rule-editor-error"), 1000);
      return;
    }
    const fileName = (name || `rule-${Date.now()}`) + ".txt";

    if (isEdit) {
      const idx = rulesFiles.findIndex((r) => r.fileName === existingRule.fileName);
      if (idx >= 0) {
        rulesFiles[idx] = { fileName, content };
        if (activeRule === existingRule.fileName) activeRule = fileName;
      }
    } else {
      rulesFiles.push({ fileName, content });
    }
    renderRules();
    close();
  }

  saveBtn.addEventListener("click", save);
  cancelBtn.addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  contentArea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  });
}

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
      <button type="button" class="rule-edit" title="Edit">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button type="button" class="rule-remove" title="Remove">&times;</button>
    `;
    item.querySelector(".rule-edit").addEventListener("click", (e) => {
      e.stopPropagation();
      openRuleEditor(r);
    });
    item.querySelector(".rule-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      rulesFiles = rulesFiles.filter((f) => f.fileName !== r.fileName);
      if (activeRule === r.fileName) { activeRule = null; rulesPreview.classList.remove("visible"); }
      renderRules();
    });
    item.addEventListener("click", (e) => {
      if (e.target.closest(".rule-remove") || e.target.closest(".rule-edit")) return;
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

async function fetchMappingWithProgress(sourceFiles, targetFiles, userInstruction, rules, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      source_files: sourceFiles,
      target_files: targetFiles,
      user_instruction: userInstruction,
      rules: rules,
    });

    fetch("/api/map-schema-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    }).then((res) => {
      if (!res.ok) {
        return res.json().then((d) => resolve({ error: d.error || "Request failed" }));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";

      function processChunk() {
        reader.read().then(({ done, value }) => {
          if (done) {
            reject(new Error("Stream ended without result"));
            return;
          }
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.substring(7).trim();
            } else if (line.startsWith("data: ")) {
              const data = line.substring(6);
              try {
                const parsed = JSON.parse(data);
                if (eventType === "progress") {
                  const phaseIcons = { extracting: "🔍", matching: "🔗", mapping: "📋", done: "✅" };
                  const icon = phaseIcons[parsed.phase] || "▸";
                  appendStreamLine(`${icon} ${parsed.detail}`);
                } else if (eventType === "token") {
                  appendStreamToken(parsed.token);
                } else if (eventType === "result") {
                  resolve(parsed);
                  return;
                } else if (eventType === "error") {
                  resolve({ error: parsed.error });
                  return;
                }
              } catch { /* ignore parse errors in SSE */ }
              eventType = "";
            }
          }
          processChunk();
        }).catch(reject);
      }
      processChunk();
    }).catch(reject);
  });
}

function setGenerating(on) {
  isGenerating = on;
  chatSend.classList.toggle("hidden", on);
  chatStop.classList.toggle("hidden", !on);
  chatSend.disabled = on;
}

function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  setGenerating(false);
  removeThinking();
  chatHistory.push({ role: "assistant", content: "Generation stopped by user." });
  renderChat();
}

chatStop.addEventListener("click", stopGeneration);

async function sendChatMessage() {
  const text = (chatInput.value || "").trim();
  if (!text) return;

  chatInput.value = "";
  setGenerating(true);
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;
  chatHistory.push({ role: "user", content: text });
  renderChat();

  const isFirstMessage = !currentMapping;

  const rawSourceFiles = sourceFiles.map((f) => ({ fileName: f.fileName, content: f.rawContent }));
  const rawTargetFiles = targetFiles.map((f) => ({ fileName: f.fileName, content: f.rawContent }));

  if (isFirstMessage) {
    if (!sourceFiles.length || !targetFiles.length) {
      showError("Add at least one file to Source and Target first.");
      chatHistory.pop(); renderChat(); setGenerating(false);
      return;
    }

    try {
      addThinking();
      const data = await fetchMappingWithProgress(rawSourceFiles, rawTargetFiles, text, getRulesText(), signal);
      removeThinking();
      if (signal.aborted) return;
      if (data.error) { showError(data.error); chatHistory.pop(); renderChat(); return; }
      currentMapping = data;
      chatHistory.push({ role: "assistant", content: data.analysis_summary || "Mapping generated. See results below." });
      renderResult(data);
      renderChat();
    } catch (err) {
      removeThinking();
      if (signal.aborted) return;
      showError(err.message || "Network error");
      chatHistory.pop(); renderChat();
    } finally { setGenerating(false); currentAbortController = null; }
  } else {
    try {
      addThinking();
      const res = await fetch("/api/refine-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_files: rawSourceFiles,
          target_files: rawTargetFiles,
          current_mapping: currentMapping,
          messages: chatHistory.slice(0, -1),
          user_message: text,
          rules: getRulesText(),
        }),
        signal,
      });
      const data = await res.json();
      removeThinking();
      if (signal.aborted) return;
      if (!res.ok) { showError(data.error || "Request failed"); chatHistory.pop(); renderChat(); return; }
      currentMapping = data.mapping;
      chatHistory.push({ role: "assistant", content: data.message || "Mapping updated." });
      renderResult(data.mapping);
      renderChat();
    } catch (err) {
      removeThinking();
      if (signal.aborted) return;
      showError(err.message || "Network error");
      chatHistory.pop(); renderChat();
    } finally { setGenerating(false); currentAbortController = null; }
  }
}

let streamLines = [];
let streamTokens = "";
let streamTokenFlushScheduled = false;
let streamTokenLastFlush = 0;
const STREAM_MAX_DISPLAY_CHARS = 12000; // Cap visible chars to avoid DOM freeze
const STREAM_FLUSH_INTERVAL_MS = 80; // Throttle DOM updates to ~12/sec

function addThinking() {
  streamLines = [];
  streamTokens = "";
  streamTokenFlushScheduled = false;
  streamTokenLastFlush = 0;
  const el = document.createElement("div");
  el.className = "chat-message assistant";
  el.id = "thinking-indicator";
  el.innerHTML = `
    <div class="role">AI
      <button type="button" class="stream-expand-btn" id="stream-expand-btn" title="Expand stream view">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
    </div>
    <div class="thinking-body">
      <div class="stream-log" id="stream-log"></div>
      <div class="stream-tokens" id="stream-tokens"></div>
      <div class="thinking-dots"><div class="dots"><span></span><span></span><span></span></div></div>
    </div>`;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  el.querySelector("#stream-expand-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openStreamOverlay();
  });
}

let streamOverlayOpen = false;

function openStreamOverlay() {
  if (streamOverlayOpen) return;
  streamOverlayOpen = true;

  const overlay = document.createElement("div");
  overlay.className = "stream-overlay";
  overlay.id = "stream-overlay";
  overlay.innerHTML = `
    <div class="stream-overlay-panel">
      <div class="stream-overlay-header">
        <span class="stream-overlay-title">AI Stream</span>
        <div class="thinking-dots"><div class="dots"><span></span><span></span><span></span></div></div>
        <button type="button" class="stream-overlay-close" id="stream-overlay-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="stream-overlay-body">
        <div class="stream-log" id="stream-log-overlay"></div>
        <div class="stream-tokens" id="stream-tokens-overlay"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  /* Copy current content into overlay */
  const srcLog = document.getElementById("stream-log");
  const dstLog = document.getElementById("stream-log-overlay");
  if (srcLog && dstLog) dstLog.innerHTML = srcLog.innerHTML;

  const srcTokens = document.getElementById("stream-tokens");
  const dstTokens = document.getElementById("stream-tokens-overlay");
  if (srcTokens && dstTokens) dstTokens.textContent = srcTokens.textContent;

  overlay.querySelector("#stream-overlay-close").addEventListener("click", closeStreamOverlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeStreamOverlay();
  });
}

function closeStreamOverlay() {
  streamOverlayOpen = false;
  document.getElementById("stream-overlay")?.remove();
}

function appendStreamLine(text) {
  streamLines.push(text);
  const targets = ["stream-log", "stream-log-overlay"];
  for (const id of targets) {
    const log = document.getElementById(id);
    if (log) {
      const line = document.createElement("div");
      line.className = "stream-line";
      line.textContent = text;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }
  }
  streamTokens = "";
  for (const id of ["stream-tokens", "stream-tokens-overlay"]) {
    const tokenEl = document.getElementById(id);
    if (tokenEl) tokenEl.textContent = "";
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function flushStreamTokens() {
  streamTokenFlushScheduled = false;
  streamTokenLastFlush = Date.now();
  let display = streamTokens;
  let truncated = false;
  if (display.length > STREAM_MAX_DISPLAY_CHARS) {
    display = "... " + display.slice(-STREAM_MAX_DISPLAY_CHARS);
    truncated = true;
  }
  for (const id of ["stream-tokens", "stream-tokens-overlay"]) {
    const tokenEl = document.getElementById(id);
    if (!tokenEl) continue;
    tokenEl.textContent = display;
    if (truncated) tokenEl.dataset.truncated = "1";
    tokenEl.scrollTop = tokenEl.scrollHeight;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function scheduleStreamTokenFlush() {
  if (streamTokenFlushScheduled) return;
  const elapsed = Date.now() - streamTokenLastFlush;
  const delay = Math.max(0, STREAM_FLUSH_INTERVAL_MS - elapsed);
  streamTokenFlushScheduled = true;
  if (delay <= 0) {
    requestAnimationFrame(flushStreamTokens);
  } else {
    setTimeout(flushStreamTokens, delay);
  }
}

function appendStreamToken(token) {
  streamTokens += token;
  scheduleStreamTokenFlush();
}

function removeThinking() {
  // Remove just the dots
  const dots = document.querySelector("#thinking-indicator .thinking-dots");
  if (dots) dots.remove();
  // Close the overlay if open
  closeStreamOverlay();
  // Persist the stream lines into chatHistory so they survive re-renders
  if (streamLines.length > 0) {
    chatHistory.push({ role: "assistant", content: streamLines.join("\n"), isStreamLog: true });
  }
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
    if (m.isStreamLog) {
      const logLines = m.content.split("\n").map((l) => `<div class="stream-line">${esc(l)}</div>`).join("");
      el.innerHTML = `<div class="role">AI</div><div class="stream-log">${logLines}</div>`;
    } else {
      el.innerHTML = `<div class="role">${m.role === "user" ? "You" : "AI"}</div><div>${esc(m.content)}</div>`;
    }
    chatMessages.appendChild(el);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* ── Session management (clear / save / load) ── */

function clearSession() {
  if (isGenerating) stopGeneration();
  sourceFiles = [];
  targetFiles = [];
  activeSource = null;
  activeTarget = null;
  currentMapping = null;
  chatHistory = [];
  validatedRows.clear();
  originalMappings.clear();
  renderTree(sourceTree, sourceEmpty, sourceFiles, null, "source");
  renderTree(targetTree, targetEmpty, targetFiles, null, "target");
  sourceContent.innerHTML = '<div class="placeholder-text">Select a file to preview</div>';
  targetContent.innerHTML = '<div class="placeholder-text">Select a file to preview</div>';
  resultContent.classList.add("hidden");
  resultEmpty.classList.remove("hidden");
  mappingGroups.innerHTML = "";
  unmappedContainer.innerHTML = "";
  unmappedContainer.classList.add("hidden");
  analysisSummary.textContent = "";
  globalConfBadge.textContent = "";
  renderChat();
}

function getSessionSnapshot() {
  return {
    sourceFiles: sourceFiles.map((f) => ({ fileName: f.fileName, rawContent: f.rawContent })),
    targetFiles: targetFiles.map((f) => ({ fileName: f.fileName, rawContent: f.rawContent })),
    currentMapping,
    chatHistory,
    rulesFiles: rulesFiles.map((r) => ({ name: r.name, content: r.content })),
    validatedRows: [...validatedRows],
    originalMappings: Object.fromEntries(originalMappings),
    savedAt: new Date().toISOString(),
  };
}

function getSavedSessions() {
  try {
    return JSON.parse(localStorage.getItem("migrator_sessions") || "[]");
  } catch { return []; }
}

function saveSession() {
  const name = prompt("Session name:", `Session ${new Date().toLocaleString()}`);
  if (!name) return;
  const sessions = getSavedSessions();
  sessions.unshift({ id: Date.now().toString(), name, data: getSessionSnapshot() });
  if (sessions.length > 20) sessions.length = 20;
  try {
    localStorage.setItem("migrator_sessions", JSON.stringify(sessions));
    showSessionToast("Session saved");
  } catch (e) {
    showError("Failed to save session — storage may be full.");
  }
}

function loadSession(sessionData) {
  clearSession();
  const d = sessionData;
  if (d.sourceFiles?.length) {
    for (const f of d.sourceFiles) addParsedFile("source", f.fileName, f.rawContent);
  }
  if (d.targetFiles?.length) {
    for (const f of d.targetFiles) addParsedFile("target", f.fileName, f.rawContent);
  }
  if (d.rulesFiles?.length) {
    rulesFiles = d.rulesFiles.map((r) => ({ name: r.name, content: r.content }));
    renderRules();
  }
  chatHistory = d.chatHistory || [];
  renderChat();
  if (d.currentMapping) {
    currentMapping = d.currentMapping;
    if (d.validatedRows) for (const i of d.validatedRows) validatedRows.add(i);
    if (d.originalMappings) {
      for (const [k, v] of Object.entries(d.originalMappings)) originalMappings.set(Number(k), v);
    }
    renderResult(currentMapping);
  }
}

function addParsedFile(side, fileName, rawContent) {
  const existing = side === "source" ? sourceFiles : targetFiles;
  existing.push({ fileName, rawContent });
  if (side === "source") {
    renderTree(sourceTree, sourceEmpty, sourceFiles, activeSource, "source");
  } else {
    renderTree(targetTree, targetEmpty, targetFiles, activeTarget, "target");
  }
}

function showSessionToast(msg) {
  const toast = document.createElement("div");
  toast.className = "session-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add("session-toast-out"); }, 1800);
  setTimeout(() => toast.remove(), 2200);
}

function openSessionPicker() {
  const sessions = getSavedSessions();
  const overlay = document.createElement("div");
  overlay.className = "stream-overlay";
  overlay.id = "session-picker-overlay";
  const empty = sessions.length === 0
    ? '<div class="session-picker-empty">No saved sessions yet</div>'
    : "";
  const items = sessions.map((s) => {
    const date = s.data?.savedAt ? new Date(s.data.savedAt).toLocaleString() : "";
    const fileCount = (s.data?.sourceFiles?.length || 0) + (s.data?.targetFiles?.length || 0);
    const msgCount = s.data?.chatHistory?.filter((m) => !m.isStreamLog)?.length || 0;
    return `<div class="session-picker-item" data-id="${s.id}">
      <div class="session-picker-info">
        <span class="session-picker-name">${esc(s.name)}</span>
        <span class="session-picker-meta">${date} · ${fileCount} files · ${msgCount} messages</span>
      </div>
      <button type="button" class="session-picker-delete" data-id="${s.id}" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </div>`;
  }).join("");
  overlay.innerHTML = `
    <div class="stream-overlay-panel session-picker-panel">
      <div class="stream-overlay-header">
        <span class="stream-overlay-title">Load Session</span>
        <button type="button" class="stream-overlay-close" id="session-picker-close" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="session-picker-body">${empty}${items}</div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#session-picker-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll(".session-picker-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".session-picker-delete")) return;
      const session = sessions.find((s) => s.id === el.dataset.id);
      if (session) { loadSession(session.data); overlay.remove(); showSessionToast("Session loaded"); }
    });
  });

  overlay.querySelectorAll(".session-picker-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const updated = getSavedSessions().filter((s) => s.id !== id);
      localStorage.setItem("migrator_sessions", JSON.stringify(updated));
      btn.closest(".session-picker-item").remove();
      if (!updated.length) {
        overlay.querySelector(".session-picker-body").innerHTML = '<div class="session-picker-empty">No saved sessions yet</div>';
      }
    });
  });
}

sessionSaveBtn.addEventListener("click", saveSession);
sessionLoadBtn.addEventListener("click", openSessionPicker);
sessionClearBtn.addEventListener("click", () => {
  if (chatHistory.length === 0 && !currentMapping) return;
  if (!confirm("Clear current session and start fresh?")) return;
  clearSession();
  showSessionToast("Session cleared");
});

/* ── Mapping render (grouped by target table) ── */

/* Track which mapping rows the user has validated */
const validatedRows = new Set();
/* Store original mapping snapshot per row index for rollback */
const originalMappings = new Map();

/* Collect all source columns from loaded source files */
function getAllSourceColumns() {
  const cols = [];
  for (const f of sourceFiles) {
    const tableName = f.schema?.table_name || f.fileName.replace(/\.[^.]+$/, "");
    for (const c of f.schema?.columns || []) {
      cols.push(`${tableName}.${c.name}`);
    }
  }
  return cols;
}

/* Collect all target columns from loaded target files */
function getAllTargetColumns() {
  const cols = [];
  for (const f of targetFiles) {
    const tableName = f.schema?.table_name || f.fileName.replace(/\.[^.]+$/, "");
    for (const c of f.schema?.columns || []) {
      cols.push(`${tableName}.${c.name}`);
    }
  }
  return cols;
}

/* Validate a mapping row (snapshot original state for rollback) */
function validateMapping(mappingIndex) {
  if (!currentMapping?.mappings?.[mappingIndex]) return;
  if (!originalMappings.has(mappingIndex)) {
    originalMappings.set(mappingIndex, JSON.parse(JSON.stringify(currentMapping.mappings[mappingIndex])));
  }
  validatedRows.add(mappingIndex);
  renderResult(currentMapping);
}

/* Rollback a mapping row to its original AI-generated state */
function rollbackMapping(mappingIndex) {
  if (!currentMapping?.mappings?.[mappingIndex]) return;
  const original = originalMappings.get(mappingIndex);
  if (original) {
    currentMapping.mappings[mappingIndex] = { ...original, _col: currentMapping.mappings[mappingIndex]._col };
    originalMappings.delete(mappingIndex);
  }
  validatedRows.delete(mappingIndex);
  renderResult(currentMapping);
}

/* Change the source column(s) for a mapping */
function changeSourceColumn(mappingIndex, newSourceCol) {
  if (!currentMapping?.mappings?.[mappingIndex]) return;
  if (!originalMappings.has(mappingIndex)) {
    originalMappings.set(mappingIndex, JSON.parse(JSON.stringify(currentMapping.mappings[mappingIndex])));
  }
  const m = currentMapping.mappings[mappingIndex];
  m.source_columns = newSourceCol ? [newSourceCol] : [];
  m.match_type = "manual";
  m.confidence_score = 100;
  m.confidence = 100;
  m.reasoning = (m.reasoning ? m.reasoning + " | " : "") + "Manually reassigned by user";
  validatedRows.add(mappingIndex);
  renderResult(currentMapping);
}

/* Manually map an unmapped column */
function manuallyMapColumn(side, unmappedCol, pairedCol) {
  if (!currentMapping) return;
  const newMapping = {
    source_columns: side === "source" ? [unmappedCol] : [pairedCol],
    target_column: side === "source" ? pairedCol : unmappedCol,
    match_type: "manual",
    confidence_score: 100,
    confidence: 100,
    transformation_rule: "",
    reasoning: "Manually mapped by user",
  };
  currentMapping.mappings.push(newMapping);
  validatedRows.add(currentMapping.mappings.length - 1);

  if (side === "source") {
    currentMapping.unmapped_source_columns = (currentMapping.unmapped_source_columns || []).filter((c) => c !== unmappedCol);
  } else {
    currentMapping.unmapped_target_columns = (currentMapping.unmapped_target_columns || []).filter((c) => c !== unmappedCol);
  }

  renderResult(currentMapping);
}

/* Remove a mapping row and move columns back to unmapped */
function unmapRow(mappingIndex) {
  if (!currentMapping?.mappings?.[mappingIndex]) return;
  const m = currentMapping.mappings[mappingIndex];
  if (m.source_columns?.length) {
    currentMapping.unmapped_source_columns = currentMapping.unmapped_source_columns || [];
    for (const sc of m.source_columns) {
      if (!currentMapping.unmapped_source_columns.includes(sc)) currentMapping.unmapped_source_columns.push(sc);
    }
  }
  if (m.target_column) {
    currentMapping.unmapped_target_columns = currentMapping.unmapped_target_columns || [];
    if (!currentMapping.unmapped_target_columns.includes(m.target_column)) {
      currentMapping.unmapped_target_columns.push(m.target_column);
    }
  }
  currentMapping.mappings.splice(mappingIndex, 1);
  validatedRows.delete(mappingIndex);
  // Re-index validated rows
  const newValidated = new Set();
  for (const idx of validatedRows) {
    if (idx > mappingIndex) newValidated.add(idx - 1);
    else newValidated.add(idx);
  }
  validatedRows.clear();
  for (const idx of newValidated) validatedRows.add(idx);
  renderResult(currentMapping);
}

function groupMappings(mappings) {
  const groups = new Map();
  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i];
    const tgt = m.target_column || "";
    const dotIdx = tgt.indexOf(".");
    const table = dotIdx > 0 ? tgt.substring(0, dotIdx) : "_default";
    const col = dotIdx > 0 ? tgt.substring(dotIdx + 1) : tgt;
    if (!groups.has(table)) groups.set(table, []);
    groups.get(table).push({ ...m, _col: col, _globalIdx: i });
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
  const allSourceCols = getAllSourceColumns();

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
              <th>Source</th><th></th><th>Target</th><th>Type</th><th>Confidence</th><th>Transformation</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
    `;

    for (const m of items) {
      const globalIdx = m._globalIdx;
      const src = (m.source_columns || []).join(", ") || "—";
      const pct = confPct(m.confidence_score ?? m.confidence);
      const color = confColor(m.confidence_score ?? m.confidence);
      const mt = m.match_type || "semantic";
      const transform = m.transformation_rule ?? m.transformation ?? "";
      const isValidated = validatedRows.has(globalIdx);
      const wasEdited = originalMappings.has(globalIdx);
      const rowClass = isValidated ? " validated-row" : "";

      const statusHtml = isValidated
        ? `<span class="status-badge status-validated"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Validated</span>`
        : `<span class="status-badge status-pending">Pending</span>`;

      html += `
        <tr class="${rowClass}" data-mapping-idx="${globalIdx}">
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
          <td class="col-status">${statusHtml}</td>
          <td class="col-actions">
            <div class="mapping-actions">
              ${!isValidated ? `
              <button type="button" class="action-btn validate-btn" data-idx="${globalIdx}" title="Validate mapping">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </button>` : ""}
              <button type="button" class="action-btn change-btn" data-idx="${globalIdx}" title="Change source column">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              ${isValidated || wasEdited ? `
              <button type="button" class="action-btn rollback-btn" data-idx="${globalIdx}" title="Rollback to original">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>
              </button>` : ""}
              <button type="button" class="action-btn unmap-btn" data-idx="${globalIdx}" title="Remove mapping">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </td>
        </tr>
        ${m.reasoning ? `<tr class="reason-row${rowClass}"><td colspan="8">${esc(m.reasoning)}</td></tr>` : ""}
      `;
    }

    html += `</tbody></table></div></div>`;
  }

  mappingGroups.innerHTML = html;

  /* Attach action button listeners */
  mappingGroups.querySelectorAll(".validate-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      validateMapping(Number(btn.dataset.idx));
    });
  });

  mappingGroups.querySelectorAll(".change-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showSourcePicker(btn, Number(btn.dataset.idx), allSourceCols);
    });
  });

  mappingGroups.querySelectorAll(".rollback-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      rollbackMapping(Number(btn.dataset.idx));
    });
  });

  mappingGroups.querySelectorAll(".unmap-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      unmapRow(Number(btn.dataset.idx));
    });
  });

  /* ── Unmapped section ── */
  const allTargetCols = getAllTargetColumns();
  const mappedSourceCols = new Set();
  const mappedTargetCols = new Set();
  for (const m of mappings) {
    for (const sc of m.source_columns || []) mappedSourceCols.add(sc);
    if (m.target_column) mappedTargetCols.add(m.target_column);
  }

  const hasUnmapped = (data.unmapped_target_columns?.length || 0) > 0;

  if (hasUnmapped) {
    unmappedContainer.classList.remove("hidden");
    let uhtml = "";

    /* Helper: group column names by table (split on first dot) */
    function groupByTable(columns) {
      const groups = new Map();
      for (const col of columns) {
        const dotIdx = col.indexOf(".");
        const table = dotIdx > 0 ? col.substring(0, dotIdx) : "_ungrouped";
        if (!groups.has(table)) groups.set(table, []);
        groups.get(table).push(col);
      }
      return groups;
    }

    /* Helper: extract column name after table prefix */
    function colShortName(col) {
      const dotIdx = col.indexOf(".");
      return dotIdx > 0 ? col.substring(dotIdx + 1) : col;
    }

    const unmappedTargetGroups = groupByTable(data.unmapped_target_columns);
    const totalUnmapped = data.unmapped_target_columns.length;
    uhtml += `<h4>Unmapped Target Columns <span class="unmapped-total">${totalUnmapped}</span></h4>`;

    for (const [table, cols] of unmappedTargetGroups) {
      uhtml += `
        <div class="unmapped-group">
          <div class="unmapped-group-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <svg class="group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            <span class="unmapped-group-label">${esc(table === "_ungrouped" ? "Other" : table)}</span>
            <span class="unmapped-group-count">${cols.length} column${cols.length !== 1 ? "s" : ""}</span>
          </div>
          <div class="unmapped-group-body">`;

      for (const col of cols) {
        uhtml += `
            <div class="unmapped-item" data-side="target" data-col="${esc(col)}">
              <button type="button" class="unmapped-picker-trigger" data-side="target" data-col="${esc(col)}" title="Choose source column">
                <span class="unmapped-picker-label">Select source column...</span>
                <svg class="unmapped-picker-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <svg class="unmapped-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
              <span class="unmapped-col-name target">${esc(colShortName(col))}</span>
            </div>`;
      }

      uhtml += `</div></div>`;
    }

    unmappedContainer.innerHTML = uhtml;

    /* Attach unmapped picker: same custom dropdown as mapped columns */
    const availableSourcesForUnmapped = allSourceCols.filter((sc) => !mappedSourceCols.has(sc));
    unmappedContainer.querySelectorAll(".unmapped-picker-trigger").forEach((btn) => {
      const targetCol = btn.dataset.col;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        showUnmappedSourcePicker(btn, targetCol, availableSourcesForUnmapped);
      });
    });
  } else {
    unmappedContainer.classList.add("hidden");
  }
}

/* Show a floating picker to choose a different source column */
function showSourcePicker(anchorBtn, mappingIndex, allSourceCols) {
  document.querySelectorAll(".source-picker-popup").forEach((el) => el.remove());

  const currentSources = currentMapping?.mappings?.[mappingIndex]?.source_columns || [];
  const popup = document.createElement("div");
  popup.className = "source-picker-popup";

  let listHtml = `<div class="picker-header">Choose source column</div><div class="picker-list">`;
  for (const col of allSourceCols) {
    const isCurrent = currentSources.includes(col);
    listHtml += `<button type="button" class="picker-option${isCurrent ? " current" : ""}" data-col="${esc(col)}">${esc(col)}</button>`;
  }
  listHtml += `</div>`;
  popup.innerHTML = listHtml;

  const rect = anchorBtn.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.left = `${rect.left}px`;
  popup.style.zIndex = "100";

  document.body.appendChild(popup);

  /* Reposition if off-screen */
  const popRect = popup.getBoundingClientRect();
  if (popRect.right > window.innerWidth - 8) {
    popup.style.left = `${window.innerWidth - popRect.width - 8}px`;
  }
  if (popRect.bottom > window.innerHeight - 8) {
    popup.style.top = `${rect.top - popRect.height - 4}px`;
  }

  popup.querySelectorAll(".picker-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      changeSourceColumn(mappingIndex, opt.dataset.col);
      popup.remove();
    });
  });

  const closePopup = (e) => {
    if (!popup.contains(e.target) && e.target !== anchorBtn) {
      popup.remove();
      document.removeEventListener("click", closePopup);
    }
  };
  setTimeout(() => document.addEventListener("click", closePopup), 0);
}

/* Same-style picker for unmapped target column: choose source to map from */
function showUnmappedSourcePicker(anchorEl, targetCol, availableSources) {
  document.querySelectorAll(".source-picker-popup").forEach((el) => el.remove());

  if (!availableSources.length) return;

  const popup = document.createElement("div");
  popup.className = "source-picker-popup";

  let listHtml = `<div class="picker-header">Choose source column</div><div class="picker-list">`;
  for (const col of availableSources) {
    listHtml += `<button type="button" class="picker-option" data-col="${esc(col)}">${esc(col)}</button>`;
  }
  listHtml += `</div>`;
  popup.innerHTML = listHtml;

  const rect = anchorEl.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.left = `${rect.left}px`;
  popup.style.zIndex = "100";

  document.body.appendChild(popup);

  const popRect = popup.getBoundingClientRect();
  if (popRect.right > window.innerWidth - 8) {
    popup.style.left = `${window.innerWidth - popRect.width - 8}px`;
  }
  if (popRect.bottom > window.innerHeight - 8) {
    popup.style.top = `${rect.top - popRect.height - 4}px`;
  }

  popup.querySelectorAll(".picker-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      manuallyMapColumn("target", targetCol, opt.dataset.col);
      popup.remove();
    });
  });

  const closePopup = (e) => {
    if (!popup.contains(e.target) && e.target !== anchorEl) {
      popup.remove();
      document.removeEventListener("click", closePopup);
    }
  };
  setTimeout(() => document.addEventListener("click", closePopup), 0);
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
      const status = validatedRows.has(m._globalIdx) ? "Validated" : "Pending";
      return [src, "→", m._col || m.target_column || "", mt, `${pct.toFixed(0)}%`, transform || "direct", status];
    });

    autoTable(doc, {
      startY: y,
      head: [["Source", "", "Target", "Type", "Conf.", "Transformation", "Status"]],
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
        0: { font: "courier", textColor: [22, 163, 74], fontStyle: "bold", cellWidth: 45 },
        1: { halign: "center", cellWidth: 8, textColor: [148, 163, 184] },
        2: { font: "courier", textColor: [37, 99, 246], fontStyle: "bold", cellWidth: 35 },
        3: { cellWidth: 20, fontSize: 6.5 },
        4: { cellWidth: 14, halign: "center", fontStyle: "bold" },
        5: { font: "courier", fontSize: 6, textColor: [161, 98, 7], cellWidth: "auto" },
        6: { cellWidth: 20, halign: "center", fontSize: 6.5 },
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
        if (hookData.section === "body" && hookData.column.index === 6) {
          const status = hookData.cell.raw;
          if (status === "Validated") {
            hookData.cell.styles.textColor = [22, 163, 74];
            hookData.cell.styles.fontStyle = "bold";
          } else {
            hookData.cell.styles.textColor = [161, 98, 7];
          }
        }
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
    });

    y = (doc.lastAutoTable?.finalY ?? y) + 8;
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
