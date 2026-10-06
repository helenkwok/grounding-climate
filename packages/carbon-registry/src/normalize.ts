import { csvObjects } from "./csv.js";
import type {
  CarbonRegistryId,
  NormalizedRegistryTransaction,
  RegistryTransactionKind,
} from "./types.js";

function number(value: string): number {
  const parsed = Number(value.replaceAll(",", "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Invalid non-negative quantity: " + JSON.stringify(value));
  }
  return parsed;
}

function vintage(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function projectId(registry: CarbonRegistryId, raw: string): string {
  const id = raw.trim();
  if (!id) throw new Error("Registry row has no project identifier.");
  if (registry === "gold-standard" && !id.startsWith("GS")) {
    return "GS" + id;
  }
  return id;
}

export function normalizeRegistryCsv(input: {
  registry: CarbonRegistryId;
  kind: RegistryTransactionKind;
  sourcePath: string;
  csv: string;
}): NormalizedRegistryTransaction[] {
  const rows = csvObjects(input.csv);

  return rows.map((row, index) => {
    const sourceRow = index + 2;

    if (input.registry === "american-carbon-registry") {
      return {
        registry: input.registry,
        kind: input.kind,
        projectId: projectId(input.registry, row["Project ID"] ?? ""),
        ...(vintage(row["Vintage"] ?? "") !== undefined
          ? { vintage: vintage(row["Vintage"] ?? "") }
          : {}),
        quantity: number(
          input.kind === "issuance"
            ? row["Total Credits Issued"] ?? ""
            : row["Quantity of Credits"] ?? "",
        ),
        ...(clean(
          input.kind === "issuance"
            ? row["Date Issued (GMT)"]
            : row["Status Effective (GMT)"],
        )
          ? {
              transactionDate: clean(
                input.kind === "issuance"
                  ? row["Date Issued (GMT)"]
                  : row["Status Effective (GMT)"],
              ),
            }
          : {}),
        ...(input.kind === "retirement" && clean(row["Credit Serial Numbers"])
          ? { serialRange: clean(row["Credit Serial Numbers"]) }
          : {}),
        ...(input.kind === "retirement" && clean(row["Date Issued (GMT)"])
          ? { creditsIssuedAt: clean(row["Date Issued (GMT)"]) }
          : {}),
        ...(input.kind === "retirement" &&
        clean(row["Retired on Behalf of"] || row["Account Holder"])
          ? {
              beneficiary: clean(
                row["Retired on Behalf of"] || row["Account Holder"],
              ),
            }
          : {}),
        sourcePath: input.sourcePath,
        sourceRow,
      } as NormalizedRegistryTransaction;
    }

    if (input.registry === "gold-standard") {
      return {
        registry: input.registry,
        kind: input.kind,
        projectId: projectId(input.registry, row["GSID"] ?? ""),
        ...(vintage(row["Vintage"] ?? "") !== undefined
          ? { vintage: vintage(row["Vintage"] ?? "") }
          : {}),
        quantity: number(row["Quantity"] ?? ""),
        ...(clean(
          input.kind === "issuance"
            ? row["Issuance Date"]
            : row["Retirement Date"],
        )
          ? {
              transactionDate: clean(
                input.kind === "issuance"
                  ? row["Issuance Date"]
                  : row["Retirement Date"],
              ),
            }
          : {}),
        ...(input.kind === "retirement" && clean(row["Serial Number"])
          ? { serialRange: clean(row["Serial Number"]) }
          : {}),
        ...(input.kind === "retirement" && clean(row["Using Entity"])
          ? { beneficiary: clean(row["Using Entity"]) }
          : {}),
        sourcePath: input.sourcePath,
        sourceRow,
      } as NormalizedRegistryTransaction;
    }

    return {
      registry: input.registry,
      kind: input.kind,
      projectId: projectId(input.registry, row["Project ID"] ?? ""),
      ...(vintage(row["Vintage"] ?? "") !== undefined
        ? { vintage: vintage(row["Vintage"] ?? "") }
        : {}),
      quantity: number(
        input.kind === "issuance"
          ? row["Total Offset Credits Issued"] ?? ""
          : row["Quantity of Offset Credits"] ?? "",
      ),
      ...(clean(
        input.kind === "issuance"
          ? row["Date Issued"]
          : row["Status Effective"],
      )
        ? {
            transactionDate: clean(
              input.kind === "issuance"
                ? row["Date Issued"]
                : row["Status Effective"],
            ),
          }
        : {}),
      ...(input.kind === "retirement" &&
      clean(row["Offset Credit Serial Numbers"])
        ? { serialRange: clean(row["Offset Credit Serial Numbers"]) }
        : {}),
      ...(input.kind === "retirement" && clean(row["Account Holder"])
        ? { beneficiary: clean(row["Account Holder"]) }
        : {}),
      sourcePath: input.sourcePath,
      sourceRow,
    } as NormalizedRegistryTransaction;
  });
}
