import { describe, expect, it } from "vitest";
import { SHEET_STATUS_LABELS, type SheetStatus } from "@/lib/domain/types";
import { PRE_SEND_SHEET_STATUSES } from "@/lib/domain/sheet-status";
import {
  ALERT_HOUR,
  MISSING_REASON_LABELS,
  alertDate,
  isAlertWindow,
  missingCountsByReason,
  missingReasonForStatus,
  missingWeeklySheets,
  type WeeklySheetAlertClient,
} from "@/lib/domain/weekly-sheet-alert";
import {
  buildSheetSendAlertSubject,
  buildSheetSendAlertText,
  sheetSendAlertSummary,
} from "@/lib/notifications/sheet-send-alert";

/*
 * La fiche se prépare le vendredi pour la semaine suivante. L'alerte ne doit
 * partir qu'un vendredi, à 16 h parisiennes, qu'il soit 14 h ou 15 h UTC selon
 * la saison — et ne jamais nommer un client dont personne n'attend de fiche.
 */

function client(
  id: string,
  name: string,
  overrides: Partial<WeeklySheetAlertClient> = {},
  cadence?: object,
  weekdays?: number[],
): WeeklySheetAlertClient {
  const settings = {
    ...(cadence === undefined ? {} : { monthlyCadence: cadence }),
    ...(weekdays === undefined ? {} : { publicationWeekdays: weekdays }),
  };
  return {
    id,
    name,
    is_active: true,
    client_kind: "gestion",
    notes: Object.keys(settings).length ? JSON.stringify(settings) : null,
    contract_start_date: null,
    contract_end_date: null,
    pause_start_date: null,
    pause_end_date: null,
    alertEnabled: true,
    ...overrides,
  };
}

/** Semaine 45 de 2026 : lundi 2 novembre. Semaine impaire : la 39. */
const S45 = "2026-11-02";
const S38 = "2026-09-14";
const S39 = "2026-09-21";

describe("créneau d'alerte", () => {
  it("agit le vendredi à 16 h de Paris, en heure d'été", () => {
    // Vendredi 3 juillet 2026, 14 h UTC = 16 h à Paris (CEST).
    expect(isAlertWindow(new Date("2026-07-03T14:00:00Z"))).toBe(true);
    // La même heure UTC en hiver n'est que 15 h à Paris : ce n'est pas l'heure.
    expect(isAlertWindow(new Date("2026-11-06T14:00:00Z"))).toBe(false);
  });

  it("agit le vendredi à 16 h de Paris, en heure d'hiver", () => {
    // Vendredi 6 novembre 2026, 15 h UTC = 16 h à Paris (CET).
    expect(isAlertWindow(new Date("2026-11-06T15:00:00Z"))).toBe(true);
    // La même heure UTC en été serait 17 h : dans le créneau, mais c'est la
    // ligne de trace en base qui empêchera le second envoi.
    expect(isAlertWindow(new Date("2026-07-03T15:00:00Z"))).toBe(true);
  });

  it("n'agit pas un autre jour, même à 16 h", () => {
    expect(isAlertWindow(new Date("2026-11-05T15:00:00Z"))).toBe(false); // jeudi
    expect(isAlertWindow(new Date("2026-11-07T15:00:00Z"))).toBe(false); // samedi
    expect(isAlertWindow(new Date("2026-11-02T15:00:00Z"))).toBe(false); // lundi
  });

  it("n'agit pas le matin, ni après la journée de travail", () => {
    expect(isAlertWindow(new Date("2026-11-06T08:00:00Z"))).toBe(false); // 9 h
    expect(isAlertWindow(new Date("2026-11-06T14:59:00Z"))).toBe(false); // 15 h 59
    expect(isAlertWindow(new Date("2026-11-06T17:00:00Z"))).toBe(false); // 18 h
  });

  it("rattrape un déclenchement glissé dans l'après-midi", () => {
    // 16 h 45 : la tâche a glissé, l'alerte part quand même.
    expect(isAlertWindow(new Date("2026-11-06T15:45:00Z"))).toBe(true);
  });

  it("date le vendredi sur le calendrier parisien, des deux côtés de l'heure d'été", () => {
    expect(alertDate(new Date("2026-07-03T14:00:00Z"))).toBe("2026-07-03");
    expect(alertDate(new Date("2026-11-06T15:00:00Z"))).toBe("2026-11-06");
  });

  it("garde l'heure demandée dans une seule constante", () => {
    expect(ALERT_HOUR).toBe(16);
  });
});

describe("statut d'une fiche et motif d'alerte", () => {
  it("décide de chacun des treize statuts", () => {
    const statuses = Object.keys(SHEET_STATUS_LABELS) as SheetStatus[];
    expect(statuses).toHaveLength(13);
    for (const status of statuses) {
      // Aucun statut ne tombe dans un trou : soit un motif, soit « partie ».
      const reason = missingReasonForStatus(status);
      expect(reason === null || reason in MISSING_REASON_LABELS).toBe(true);
    }
  });

  it("alerte sur les statuts d'avant-envoi, et sur eux seuls parmi les statuts vivants", () => {
    for (const status of PRE_SEND_SHEET_STATUSES) {
      expect(missingReasonForStatus(status)).not.toBeNull();
    }
    for (const status of [
      "sent_to_client",
      "partially_approved",
      "changes_requested",
      "corrections_in_progress",
      "awaiting_revalidation",
      "approved_by_client",
      "tacitly_approved",
    ] as SheetStatus[]) {
      expect(missingReasonForStatus(status)).toBeNull();
    }
  });

  it("distingue le brouillon, la fiche prête, la version à renvoyer et la fiche à refaire", () => {
    expect(missingReasonForStatus("draft")).toBe("brouillon");
    expect(missingReasonForStatus("internal_review")).toBe("brouillon");
    expect(missingReasonForStatus("ready_to_send")).toBe("prete_non_envoyee");
    expect(missingReasonForStatus("new_version_to_send")).toBe("a_renvoyer");
    expect(missingReasonForStatus("rejected")).toBe("a_refaire");
    expect(missingReasonForStatus("expired")).toBe("a_refaire");
  });
});

describe("fiches manquantes de la semaine", () => {
  const boucherie = client("boucherie", "BOUCHERIE DU 17");
  const terre = client("terre", "TERRE FAUVE");
  const gites = client("gites", "GÎTES CANAL DU MIDI");

  it("ne signale rien quand tout est parti", () => {
    expect(missingWeeklySheets({
      clients: [boucherie, terre],
      sheets: [
        { clientId: "boucherie", status: "sent_to_client" },
        { clientId: "terre", status: "approved_by_client" },
      ],
      weekStart: S45,
    })).toEqual([]);
  });

  it("signale l'absence de fiche, le brouillon et la version à renvoyer", () => {
    expect(missingWeeklySheets({
      clients: [boucherie, terre, gites],
      sheets: [
        { clientId: "terre", status: "draft" },
        { clientId: "gites", status: "new_version_to_send" },
      ],
      weekStart: S45,
    })).toEqual([
      { clientId: "gites", clientName: "GÎTES CANAL DU MIDI", reason: "a_renvoyer" },
      { clientId: "terre", clientName: "TERRE FAUVE", reason: "brouillon" },
      { clientId: "boucherie", clientName: "BOUCHERIE DU 17", reason: "aucune_fiche" },
    ]);
  });

  it("met en tête ce qui part en un clic, et classe les ex æquo par nom", () => {
    const amande = client("amande", "AMANDE");
    const zephyr = client("zephyr", "ZÉPHYR");
    const result = missingWeeklySheets({
      clients: [zephyr, amande, terre],
      sheets: [
        { clientId: "zephyr", status: "ready_to_send" },
        { clientId: "amande", status: "ready_to_send" },
        { clientId: "terre", status: "draft" },
      ],
      weekStart: S45,
    });
    expect(result.map((sheet) => sheet.clientName)).toEqual(["AMANDE", "ZÉPHYR", "TERRE FAUVE"]);
  });

  it("ignore un client dont le rythme ne prévoit rien cette semaine", () => {
    // Deux vidéos par mois, le mercredi : une semaine sur deux.
    const emove = client("emove", "E-MOVE MANAGEMENT", {}, { photo: 0, video: 2, story: 0, visual: 0 }, [3]);
    expect(missingWeeklySheets({ clients: [emove], sheets: [], weekStart: S38 })).toEqual([]);
    expect(missingWeeklySheets({ clients: [emove], sheets: [], weekStart: S39 })).toEqual([
      { clientId: "emove", clientName: "E-MOVE MANAGEMENT", reason: "aucune_fiche" },
    ]);
  });

  it("ignore un client hors gestion : en pause, terminé, à venir, ponctuel ou archivé", () => {
    const clients = [
      client("pause", "EN PAUSE", { pause_start_date: "2026-10-01", pause_end_date: "2026-12-01" }),
      client("fini", "CONTRAT FINI", { contract_end_date: "2026-09-30" }),
      client("futur", "PAS COMMENCÉ", { contract_start_date: "2027-01-04" }),
      client("ponctuel", "JEFF DE BRUGES", { client_kind: "ponctuel" }),
      client("archive", "LOGE N16", { is_active: false }),
    ];
    expect(missingWeeklySheets({ clients, sheets: [], weekStart: S45 })).toEqual([]);
  });

  it("ignore un dossier sorti de l'alerte — l'agence et le compte d'essai", () => {
    const lyftt = client("lyftt", "LYFTT", { alertEnabled: false });
    expect(missingWeeklySheets({
      clients: [lyftt],
      sheets: [{ clientId: "lyftt", status: "draft" }],
      weekStart: S45,
    })).toEqual([]);
  });

  it("signale un client dont la gestion commence le lundi de la semaine visée", () => {
    const nouveau = client("bcl", "BCL PISCINE", { contract_start_date: S45 });
    expect(missingWeeklySheets({ clients: [nouveau], sheets: [], weekStart: S45 })).toEqual([
      { clientId: "bcl", clientName: "BCL PISCINE", reason: "aucune_fiche" },
    ]);
  });

  it("ne lit que la semaine qu'on lui donne : les fiches d'une autre semaine ne sont pas fournies", () => {
    // La route borne la lecture sur (iso_year, iso_week) : une fiche de la
    // semaine en cours n'entre jamais dans le calcul, et le client est donc
    // bien signalé comme sans fiche pour la semaine prochaine.
    expect(missingWeeklySheets({ clients: [terre], sheets: [], weekStart: S45 })).toEqual([
      { clientId: "terre", clientName: "TERRE FAUVE", reason: "aucune_fiche" },
    ]);
  });

  it("compte par motif, dans l'ordre d'affichage", () => {
    const missing = missingWeeklySheets({
      clients: [boucherie, terre, gites],
      sheets: [
        { clientId: "terre", status: "draft" },
        { clientId: "gites", status: "ready_to_send" },
      ],
      weekStart: S45,
    });
    expect(missingCountsByReason(missing)).toEqual([
      { reason: "prete_non_envoyee", count: 1 },
      { reason: "brouillon", count: 1 },
      { reason: "aucune_fiche", count: 1 },
    ]);
  });
});

describe("message d'alerte", () => {
  const missing = [
    { clientId: "gites", clientName: "GÎTES CANAL DU MIDI", reason: "prete_non_envoyee" as const },
    { clientId: "terre", clientName: "TERRE FAUVE", reason: "brouillon" as const },
  ];
  const input = { missing, weekStart: S45, planningUrl: "https://app.lyftt.fr/fiches?tab=next" };

  it("met le nombre et la semaine dans l'objet", () => {
    expect(buildSheetSendAlertSubject(input))
      .toBe("🚨 URGENT — 2 fiches pas envoyées pour la semaine du 2 novembre");
  });

  it("accorde l'objet au singulier", () => {
    expect(buildSheetSendAlertSubject({ ...input, missing: [missing[0]] }))
      .toBe("🚨 URGENT — 1 fiche pas envoyée pour la semaine du 2 novembre");
  });

  it("nomme chaque client, son motif, et donne le lien du planning", () => {
    const text = buildSheetSendAlertText(input);
    expect(text).toContain("GÎTES CANAL DU MIDI — prête, pas envoyée");
    expect(text).toContain("TERRE FAUVE — brouillon");
    expect(text).toContain("https://app.lyftt.fr/fiches?tab=next");
  });
});

describe("résumé par motif", () => {
  it("accorde le résumé au pluriel", () => {
    expect(sheetSendAlertSummary({
      weekStart: S45,
      planningUrl: "https://app.lyftt.fr/fiches?tab=next",
      missing: [
        { clientId: "a", clientName: "A", reason: "prete_non_envoyee" },
        { clientId: "b", clientName: "B", reason: "prete_non_envoyee" },
        { clientId: "c", clientName: "C", reason: "brouillon" },
        { clientId: "d", clientName: "D", reason: "brouillon" },
        { clientId: "e", clientName: "E", reason: "aucune_fiche" },
      ],
    })).toBe("2 prêtes à envoyer · 2 brouillons · 1 sans fiche");
  });

  it("accorde le résumé au singulier", () => {
    expect(sheetSendAlertSummary({
      weekStart: S45,
      planningUrl: "https://app.lyftt.fr/fiches?tab=next",
      missing: [{ clientId: "a", clientName: "A", reason: "brouillon" }],
    })).toBe("1 brouillon");
  });
});
