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
 * Mois de facturation d'une prestation.
 *
 * Exportée : l'écran de facturation groupée regroupe lui-même par mois, sans
 * passer par `invoiceMonths`. Deux regroupements écrits séparément avaient
 * déjà divergé — celui-ci continuait de ranger une prestation au mois de sa
 * saisie après que l'autre eut été corrigé.
 *
 * Rien ne se facture avant que la gestion ait commencé. Une prestation
 * préparée en amont — le cas courant : on garnit l'addition d'un client dont
 * la gestion démarre le mois suivant — porte la date du jour de sa saisie, et
 * tombait donc sur le mois en cours. Elle rejoint désormais le mois de
 * démarrage.
 *
 * La date de la ligne reste celle de la prestation : c'est le rattachement
 * comptable qui est décalé, pas la trace de ce qui a été fait.
 */
export function invoiceMonthFor(
  line: BudgetLine,
  contractStartDate: string | null,
  statuses: Record<string, InvoiceStatus>,
): string {
  const month = monthKey(line.performedOn);
  if (!contractStartDate) return month;

  const start = monthKey(contractStartDate);
  if (month >= start) return month;

  /*
   * Une facture partie chez le client ne se recalcule pas.
   *
   * Reporter une prestation déjà facturée en viderait le montant et gonflerait
   * celui d'un autre mois : l'addition ne correspondrait plus au prélèvement.
   * Le report ne vaut donc que tant que le mois d'origine est encore ouvert —
   * même règle que la réconciliation des mois de gestion.
   */
  const settled = statuses[month];
  if (settled === "faite" || settled === "prelevement_programme") return month;

  return start;
}

/**
 * Regroupe les prestations par mois de facturation, du plus récent au plus
 * ancien : c'est le mois en cours qu'on complète, et les précédents qu'on
 * facture.
 */
export function invoiceMonths(
  lines: BudgetLine[],
  statuses: Record<string, InvoiceStatus> = {},
  contractStartDate: string | null = null,
): InvoiceMonth[] {
  const grouped = new Map<string, BudgetLine[]>();

  for (const line of lines) {
    const key = invoiceMonthFor(line, contractStartDate, statuses);
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
