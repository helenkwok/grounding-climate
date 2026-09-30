export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((item) => item.some((value) => value.length > 0));
}

export function csvObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];

  return rows.slice(1).map((values) => {
    const record: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      const key = header[i];
      if (key) record[key] = values[i] ?? "";
    }
    return record;
  });
}
