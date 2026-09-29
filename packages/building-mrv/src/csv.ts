import type {
  MeterPoint,
  WeatherPoint,
} from "./types.js";

export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

export function parseMeterCsv(csv: string): MeterPoint[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0] ?? "");
  const timestampIndex = header.indexOf("timestamp");
  const valueIndex = header.indexOf("meter_reading");

  if (timestampIndex < 0 || valueIndex < 0) {
    throw new Error(
      "Meter CSV requires timestamp and meter_reading columns.",
    );
  }

  const points: MeterPoint[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const row = parseCsvLine(line);
    const value = Number(row[valueIndex]);
    const timestamp = row[timestampIndex];
    if (!timestamp || !Number.isFinite(value) || value < 0) continue;
    points.push({ timestamp, value });
  }

  return points;
}

export function parseWeatherCsv(csv: string): WeatherPoint[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0] ?? "");
  const timestampIndex = header.indexOf("timestamp");
  const temperatureIndex = header.indexOf("airTemperature");

  if (timestampIndex < 0 || temperatureIndex < 0) {
    throw new Error(
      "Weather CSV requires timestamp and airTemperature columns.",
    );
  }

  const points: WeatherPoint[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const row = parseCsvLine(line);
    const value = Number(row[temperatureIndex]);
    const timestamp = row[timestampIndex];
    if (!timestamp || !Number.isFinite(value)) continue;
    points.push({ timestamp, airTemperature: value });
  }

  return points;
}
