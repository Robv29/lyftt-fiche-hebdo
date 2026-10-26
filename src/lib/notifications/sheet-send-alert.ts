import {
  MISSING_REASON_LABELS,
  missingCountsByReason,
  type MissingReason,
  type MissingSheet,
} from "@/lib/domain/weekly-sheet-alert";
import { escape } from "./ticket-email";

/**
 * Alerte interne du vendredi : les fiches de la semaine prochaine qui ne sont
 * pas marquées comme envoyées.
 *
 * Elle se lit sur un téléphone, sans ouvrir : combien, lesquelles, pourquoi.
 * Urgente par son objet, factuelle par son corps — un message qui part chaque
 * vendredi et qui fait la morale finit en règle de tri automatique.
 *
 * Logique pure, sans réseau : l'objet et le corps se testent sans rien envoyer.
 */

export interface SheetSendAlertInput {
  missing: readonly MissingSheet[];
  /** Lundi de la semaine visée, en date civile. */
  weekStart: string;
  /** Lien vers l'onglet « Semaine prochaine » du planning. */
  planningUrl: string;
}

const SIGNATURE = "— LYFTT";

/** « 2 novembre » : la semaine se reconnaît à son lundi. */
export function weekLabel(weekStart: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${weekStart}T00:00:00Z`));
}

function countLabel(count: number): string {
  return count === 1 ? "1 fiche n'est pas envoyée" : `${count} fiches ne sont pas envoyées`;
}

/**
 * Objet : il doit tenir dans une notification et dire l'essentiel.
 *
 * Même marqueur « 🚨 URGENT — » que les demandes urgentes des clients : c'est
 * le signal que l'agence reconnaît déjà dans sa messagerie.
 */
export function buildSheetSendAlertSubject(input: SheetSendAlertInput): string {
  const count = input.missing.length;
  const noun = count === 1 ? "fiche pas envoyée" : "fiches pas envoyées";
  return `🚨 URGENT — ${count} ${noun} pour la semaine du ${weekLabel(input.weekStart)}`;
}

/**
 * Formes du résumé, au singulier et au pluriel.
 *
 * Les libellés de ligne — « brouillon », « aucune fiche » — qualifient une
 * fiche et ne s'accordent pas : « 17 brouillon · 2 aucune fiche » se lisait mal
 * dans un message dont on attend qu'il soit pris au sérieux.
 */
const SUMMARY_TERMS: Record<MissingReason, { one: string; many: string }> = {
  prete_non_envoyee: { one: "prête à envoyer", many: "prêtes à envoyer" },
  a_renvoyer: { one: "à renvoyer", many: "à renvoyer" },
  brouillon: { one: "brouillon", many: "brouillons" },
  aucune_fiche: { one: "sans fiche", many: "sans fiche" },
  a_refaire: { one: "à refaire", many: "à refaire" },
};

/** Résumé par motif : « 2 prêtes à envoyer · 17 brouillons ». */
export function sheetSendAlertSummary(input: SheetSendAlertInput): string {
  return missingCountsByReason(input.missing)
    .map((entry) => {
      const term = SUMMARY_TERMS[entry.reason];
      return `${entry.count} ${entry.count === 1 ? term.one : term.many}`;
    })
    .join(" · ");
}

/** Version texte — certains clients de messagerie n'affichent que celle-ci. */
export function buildSheetSendAlertText(input: SheetSendAlertInput): string {
  const lines = [
    `Semaine du ${weekLabel(input.weekStart)} : ${countLabel(input.missing.length)}.`,
    sheetSendAlertSummary(input),
    "",
    ...input.missing.map((sheet) => `- ${sheet.clientName} — ${MISSING_REASON_LABELS[sheet.reason]}`),
    "",
    `Ouvrir le planning : ${input.planningUrl}`,
    "",
    SIGNATURE,
  ];
  return lines.join("\n");
}

function row(sheet: MissingSheet): string {
  return `<tr>
    <td style="padding:6px 0;border-bottom:1px solid #f0f0ef;">${escape(sheet.clientName)}</td>
    <td style="padding:6px 0;border-bottom:1px solid #f0f0ef;color:#b4451f;
        text-align:right;white-space:nowrap;">${escape(MISSING_REASON_LABELS[sheet.reason])}</td>
  </tr>`;
}

export function buildSheetSendAlertHtml(input: SheetSendAlertInput): string {
  const url = escape(input.planningUrl);

  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#fafaf9;
  font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e4;
       border-radius:10px;padding:28px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">lyftt.</p>

    <h1 style="margin:0 0 6px;font-size:18px;line-height:1.4;">
      ${escape(`Semaine du ${weekLabel(input.weekStart)} : ${countLabel(input.missing.length)}`)}
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#8a8a8a;">${escape(sheetSendAlertSummary(input))}</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${input.missing.map(row).join("")}
    </table>

    <p style="margin:24px 0 0;">
      <a href="${url}" style="display:inline-block;background:#111;color:#fff;
         text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px;font-weight:500;">
        Ouvrir le planning
      </a>
    </p>

    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e4;
       font-size:12px;color:#8a8a8a;">
      Alerte automatique du vendredi 16 h — lue sur le statut des fiches.
    </p>
  </div>
</body></html>`;
}
