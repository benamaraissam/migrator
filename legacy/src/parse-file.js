/**
 * Parse CSV, JSON, or text and infer schema
 */

function inferType(values) {
  if (!values.length) return "string";
  const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
  if (!nonEmpty.length) return "string";

  let allNumbers = true;
  let allDates = true;
  const datePattern = /^\d{4}-\d{2}-\d{2}(T|\s|$)/;

  for (const v of nonEmpty.slice(0, 20)) {
    const s = String(v).trim();
    if (s === "" || s.toLowerCase() === "null") continue;
    if (allNumbers && isNaN(Number(s))) allNumbers = false;
    if (allDates && !datePattern.test(s) && isNaN(Date.parse(s))) allDates = false;
  }

  if (allDates && nonEmpty.some((v) => datePattern.test(String(v)))) return "date";
  if (allNumbers) return "number";
  return "string";
}

function parseCSVLine(line, delimiter = ",") {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

export function detectDelimiter(text) {
  const firstLine = text.trim().split(/\r?\n/)[0] || "";
  const candidates = [
    { del: "\t",  label: "Tab",       count: (firstLine.match(/\t/g) || []).length },
    { del: ";",   label: "Semicolon", count: (firstLine.match(/;/g) || []).length },
    { del: "|",   label: "Pipe",      count: (firstLine.match(/\|/g) || []).length },
    { del: ",",   label: "Comma",     count: (firstLine.match(/,/g) || []).length },
  ];
  const best = candidates.reduce((a, b) => (b.count > a.count ? b : a), candidates[3]);
  return best.count > 0 ? best.del : ",";
}

export function parseDelimited(text, delimiter) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  if (!delimiter) delimiter = detectDelimiter(text);

  const headers = parseCSVLine(firstLine(lines), delimiter);
  const rows = lines.slice(1).map((l) => parseCSVLine(l, delimiter));
  return { headers, rows };
}

function firstLine(lines) {
  return lines[0] || "";
}

function inferSchemaFromTable(headers, rows, tableName = "table") {
  const columns = headers.map((name, i) => {
    const values = rows.map((r) => (r[i] != null ? String(r[i]).trim() : "")).filter(Boolean);
    const sampleValues = [...new Set(values)].slice(0, 5);
    return {
      name: name || `column_${i}`,
      data_type: inferType(values),
      nullable: true,
      sample_values: sampleValues,
    };
  });

  return { table_name: tableName, columns };
}

function inferSchemaFromJsonArray(arr, tableName = "table") {
  const allKeys = new Set();
  for (const row of arr.slice(0, 100)) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) allKeys.add(k);
    }
  }

  const columns = Array.from(allKeys).map((name) => {
    const values = arr
      .filter((r) => r && typeof r === "object")
      .map((r) => r[name])
      .filter((v) => v != null && v !== "")
      .slice(0, 20);
    const sampleValues = [...new Set(values.map(String))].slice(0, 5);
    return {
      name,
      data_type: inferType(values.map(String)),
      nullable: true,
      sample_values: sampleValues,
    };
  });

  return { table_name: tableName, columns };
}

function isSchemaObject(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    Array.isArray(obj.columns) &&
    obj.columns.length > 0 &&
    obj.columns.every((c) => c && typeof c.name === "string")
  );
}

export function parseFile(file) {
  return parseFileWithContent(file).then((r) => r.schema);
}

/** Returns { fileName, rawContent, schema } for display and mapping */
export function parseFileWithContent(file) {
  const name = (file.name || "").toLowerCase();
  const ext = name.split(".").pop() || "";

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== "string") {
          reject(new Error("Could not read file as text"));
          return;
        }

        const tableName = file.name.replace(/\.[^.]+$/, "") || "table";

        // JSON
        const trimmed = text.trim();
        if (ext === "json" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
          const parsed = JSON.parse(text);
          let schema;
          if (Array.isArray(parsed)) {
            schema = inferSchemaFromJsonArray(parsed, tableName);
          } else if (isSchemaObject(parsed)) {
            schema = parsed;
          } else if (parsed && typeof parsed === "object") {
            schema = inferSchemaFromJsonArray([parsed], tableName);
          } else {
            reject(new Error("JSON must be a schema, an array of objects, or an object"));
            return;
          }
          resolve({ fileName: file.name, rawContent: text, schema });
          return;
        }

        // CSV, TXT, TSV
        const detected = detectDelimiter(text);
        const { headers, rows } = parseDelimited(text, detected);
        if (!headers.length) {
          reject(new Error("No columns found in file"));
          return;
        }
        const schema = inferSchemaFromTable(headers, rows, tableName);
        resolve({ fileName: file.name, rawContent: text, schema, detectedDelimiter: detected });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file, "UTF-8");
  });
}

/**
 * Parse multiple files, return array of { fileName, rawContent, schema }.
 */
export async function parseFilesWithContent(files) {
  const fileList = Array.from(files || []);
  if (!fileList.length) return [];
  return Promise.all(fileList.map((f) => parseFileWithContent(f)));
}

/**
 * Parse multiple files and merge into one schema for AI analysis.
 * Columns are prefixed with table name when merging to preserve context.
 */
export async function parseFiles(files) {
  const items = await parseFilesWithContent(files);
  if (!items.length) return null;

  const schemas = items.map((i) => i.schema);
  if (schemas.length === 1) return schemas[0];

  const columns = [];
  for (const schema of schemas) {
    const prefix = schema.table_name || "table";
    for (const col of schema.columns || []) {
      const baseName = col.name || "";
      const name = `${prefix}.${baseName}`;
      columns.push({
        ...col,
        name,
        description: col.description || `from ${prefix}`,
      });
    }
  }

  return {
    table_name: schemas.map((s) => s.table_name).join("_"),
    columns,
  };
}
