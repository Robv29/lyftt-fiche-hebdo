/**
 * Facturation des clients au comptant.
 *
 * Un client comptant règle ce qu'il consomme : chaque prestation réalisée est
 * notée au fil du mois, et le mois écoulé donne une facture à établir. Le
 * suivi tient en trois états successifs — reste à faire, facture établie,
 * prélèvement programmé — parce que c'est exactement la chaîne où un dossier
 * se perd : une facture faite mais jamais mise en prélèvement ne se voit pas.
 */

import { lineTotalCents, type BudgetLine } from "./budget";

export type InvoiceStatus = "a_faire" | "faite" | "prelevement_programme";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  a_faire: "Facture à faire",
  faite: "Facture faite",
  prelevement_programme: "Prélèvement programmé",
};

export const INVOICE_STATUS_ORDER: readonly InvoiceStatus[] = [
  "a_faire",
  "faite",
  "prelevement_programme",
];

/** Étape suivante de la chaîne, ou null quand le dossier est bouclé. */
export function nextInvoiceStatus(status: InvoiceStatus): InvoiceStatus | null {
  const index = INVOICE_STATUS_ORDER.indexOf(status);
  return INVOICE_STATUS_ORDER[index + 1] ?? null;
}

/** Un dossier n'est complet que prélèvement programmé. */
export function isInvoiceSettled(status: InvoiceStatus): boolean {
  return status === "prelevement_programme";
}

export interface InvoiceMonth {
  /** Premier jour du mois, qui sert de clé au dossier. */
  month: string;
  label: string;
  lines: BudgetLine[];
  totalCents: number;
  status: InvoiceStatus;
}

export function monthKey(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}T00:00:00Z`));
}

/**
 * Regroupe les prestations par mois de réalisation, du plus récent au plus
 * ancien : c'est le mois en cours qu'on complète, et les précédents qu'on
 * facture.
 */
export function invoiceMonths(
  lines: BudgetLine[],
  statuses: Record<string, InvoiceStatus> = {},
): InvoiceMonth[] {
  const grouped = new Map<string, BudgetLine[]>();

  for (const line of lines) {
    const key = monthKey(line.performedOn);
    const bucket = grouped.get(key) ?? [];
    bucket.push(line);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, monthLines]) => ({
      month,
      label: monthLabel(month),
      lines: [...monthLines].sort((a, b) => b.performedOn.localeCompare(a.performedOn)),
      totalCents: monthLines.reduce((total, line) => total + lineTotalCents(line), 0),
      status: statuses[month] ?? "a_faire",
    }));
}

/** Nombre de mois dont la facturation n'est pas menée à son terme. */
export function pendingInvoiceCount(months: InvoiceMonth[]): number {
  return months.filter((month) => !isInvoiceSettled(month.status)).length;
}
