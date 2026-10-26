import { describe, expect, it } from "vitest";
import { healthActions, healthScore } from "@/lib/domain/health-score";
import { TICKET_SLA_HOURS } from "@/lib/domain/ticket-sla";
import {
  ADVICE_CLIENT_NAMES_LIMIT,
  ADVICE_RULES,
  WEEKLY_ADVICE_LIMIT,
  adviceOpensAt,
  adviceWeek,
  isAdviceScanWindow,
  sendCutoffFor,
  tallyOf,
  weeklyAdvice,
  weeklyAdviceFacts,
  type AdviceClientRow,
  type AdviceItemRow,
  type WeeklyAdviceRows,
} from "@/lib/domain/weekly-advice";

/*
 * Deux moments, un seul calcul : le scan du lundi 10 h et la pop-up de 14 h 30.
 * Ce qui est éprouvé ici, c'est qu'aucune des deux heures ne dépend de la
 * saison, qu'aucune phrase ne se compose sans son chiffre, qu'aucun nom de
 * client ne se glisse dans une phrase stockée, et qu'une semaine sans écart le
 * dit platement au lieu de remplir l'encart.
 */

// Lundi 26 octobre 2026, 10 h à Paris — le lundi qui suit la bascule d'hiver.
const MONDAY_10H = new Date("2026-10-26T09:00:00Z");
const WEEK_START = "2026-10-26";
const NEXT_WEEK_START = "2026-11-02";

function client(id: string, overrides: Partial<AdviceClientRow> = {}): AdviceClientRow {
  return {
    id,
    is_active: true,
    client_kind: "gestion",
    // Une photo par mois sur quatre semaines : une publication chaque semaine.
    notes: JSON.stringify({ monthlyCadence: { photo: 4 }, publicationWeekdays: [2, 4] }),
    contract_start_date: "2026-01-01",
    contract_end_date: null,
    pause_start_date: null,
    pause_end_date: null,
    pinnedHashtags: 0,
    ...overrides,
  };
}

function item(clientId: string, overrides: Partial<AdviceItemRow> = {}): AdviceItemRow {
  return {
    clientId,
    format: "photo",
    caption: "Un vrai texte de publication, écrit au-dessus du bloc.",
    isCancelled: false,
    hasMedia: true,
    signature: "__\nLa signature du client",
    ...overrides,
  };
}

/** Un score mesurable mais imparfait, calculé par le vrai module. */
function health(partial: Partial<Parameters<typeof healthScore>[0]> = {}) {
  const score = healthScore({
    satisfactionPercentage: 100,
    satisfactionAnswers: 8,
    viewRate: 98.7,
    noCorrectionRate: 45.8,
    sentBeforeDeadlineRate: 63.3,
    correctionHours: 21.1,
    productionPunctuality: 68,
    budgetsComplete: 82.6,
    shootingsCategorised: 50,
    ticketsOnTime: 82,
    ...partial,
  });
  return { health: score, actions: healthActions(score) };
}

/** Un jeu de lignes vide : chaque test n'allume que ce qu'il veut éprouver. */
function rows(overrides: Partial<WeeklyAdviceRows> = {}): WeeklyAdviceRows {
  const { health: score, actions } = health();
  return {
    windowSince: "2026-07-28",
    now: MONDAY_10H,
    health: score,
    actions,
    clients: [],
    sheets: [],
    tickets: [],
    versions: [],
    requests: [],
    sentItems: [],
    nextWeekSheets: [],
    currentWeekItems: [],
    trackingReportsToFill: 0,
    openServiceRequests: 0,
    unclassifiedShootings: [],
    budgetIssueClientIds: [],
    ...overrides,
  };
}

describe("créneau du scan du lundi", () => {
  it("agit à 10 h de Paris, en heure d'été comme en heure d'hiver", () => {
    // Lundi 6 juillet 2026, 8 h UTC = 10 h à Paris (CEST).
    expect(isAdviceScanWindow(new Date("2026-07-06T08:00:00Z"))).toBe(true);
    // Lundi 26 octobre 2026, 9 h UTC = 10 h à Paris (CET).
    expect(isAdviceScanWindow(new Date("2026-10-26T09:00:00Z"))).toBe(true);
  });

  it("refuse l'heure d'hiver tombée à 8 h UTC, qui ne fait que 9 h à Paris", () => {
    expect(isAdviceScanWindow(new Date("2026-10-26T08:00:00Z"))).toBe(false);
  });

  it("rattrape une exécution en retard, mais s'arrête avant la pop-up", () => {
    // 13 h 29 à Paris : encore dans le créneau, la ligne sera écrite à temps.
    expect(isAdviceScanWindow(new Date("2026-10-26T12:29:00Z"))).toBe(true);
    // 14 h 29 à Paris : dernière minute utile.
    expect(isAdviceScanWindow(new Date("2026-10-26T13:29:00Z"))).toBe(true);
    // 14 h 30 à Paris : la pop-up s'ouvre, calculer n'a plus d'objet.
    expect(isAdviceScanWindow(new Date("2026-10-26T13:30:00Z"))).toBe(false);
  });

  it("ne tourne aucun autre jour", () => {
    // Mardi 27 octobre 2026, 10 h à Paris.
    expect(isAdviceScanWindow(new Date("2026-10-27T09:00:00Z"))).toBe(false);
    // Dimanche 25 octobre 2026, 10 h à Paris.
    expect(isAdviceScanWindow(new Date("2026-10-25T09:00:00Z"))).toBe(false);
  });
});

describe("instant d'ouverture de la pop-up", () => {
  it("vaut 14 h 30 à Paris, soit 12 h 30 UTC en été et 13 h 30 en hiver", () => {
    expect(adviceOpensAt("2026-07-06").toISOString()).toBe("2026-07-06T12:30:00.000Z");
    expect(adviceOpensAt("2026-10-26").toISOString()).toBe("2026-10-26T13:30:00.000Z");
  });
});

describe("semaine du diagnostic", () => {
  it("se lit à l'heure de Paris, et non en UTC", () => {
    /*
     * Lundi 0 h 30 à Paris : il est encore dimanche 23 h 30 en UTC. Lue en UTC,
     * la semaine serait la précédente — donc un `opens_at` déjà passé, donc la
     * pop-up de la semaine dernière qui se rouvre.
     */
    const week = adviceWeek(new Date("2026-10-25T23:30:00Z"));
    expect(week.weekStart).toBe(WEEK_START);
    expect(week.isoWeek).toBe(44);
    expect(week.isoYear).toBe(2026);
  });

  it("donne le lundi civil de la semaine en cours", () => {
    expect(adviceWeek(new Date("2026-10-29T15:00:00Z")).weekStart).toBe(WEEK_START);
  });
});

describe("vendredi 16 h qui précède une semaine", () => {
  it("tombe à 14 h UTC en été et 15 h UTC en hiver", () => {
    // Semaine du 6 juillet 2026 : vendredi 3 juillet, 16 h à Paris (CEST).
    expect(sendCutoffFor("2026-07-06").toISOString()).toBe("2026-07-03T14:00:00.000Z");
    // Semaine du 2 novembre 2026 : vendredi 30 octobre, 16 h à Paris (CET).
    expect(sendCutoffFor("2026-11-02").toISOString()).toBe("2026-10-30T15:00:00.000Z");
  });
});

describe("relevé par dossier", () => {
  it("compte, trie par volume décroissant et reste stable à compte égal", () => {
    const tally = tallyOf(["b", "a", "b", "c", "a", "b"]);
    expect(tally.total).toBe(6);
    expect(tally.byClient).toEqual([
      { clientId: "b", count: 3 },
      { clientId: "a", count: 2 },
      { clientId: "c", count: 1 },
    ]);
  });
});

describe("la semaine à venir", () => {
  it("compte les contenus sans média et les fiches en brouillon", () => {
    const facts = weeklyAdviceFacts(rows({
      clients: [client("c1")],
      nextWeekSheets: [{
        status: "draft",
        clientId: "c1",
        items: [item("c1", { hasMedia: false }), item("c1", { hasMedia: false }), item("c1")],
      }],
    }));

    expect(facts.nextIsoWeek).toBe(45);
    expect(facts.nextWeekStart).toBe(NEXT_WEEK_START);
    expect(facts.nextWeekItems).toBe(3);
    expect(facts.nextWeekItemsWithoutMedia).toBe(2);
    expect(facts.nextWeekDrafts).toBe(1);

    const advice = weeklyAdvice(facts, "equipe").advices.find((entry) => entry.key === "semaine-sans-media");
    expect(advice?.statement).toBe(
      "Semaine 45 : 2 des 3 contenus n'ont pas de média, et 1 fiche est encore en brouillon.",
    );
    expect(advice?.action).toBe("Déposez les fichiers avant vendredi 16 h.");
  });

  it("ne réclame rien à un client dont le rythme ne prévoit pas la semaine", () => {
    const facts = weeklyAdviceFacts(rows({
      clients: [
        client("attendu"),
        // Deux vidéos par mois : une semaine sur deux, et pas celle-ci.
        client("hors-semaine", { notes: JSON.stringify({ monthlyCadence: { video: 1 } }) }),
      ],
    }));
    expect(facts.nextWeekMissingSheets.byClient.map((entry) => entry.clientId)).toEqual(["attendu"]);
  });

  it("ignore un contenu annulé, au numérateur comme au dénominateur", () => {
    const facts = weeklyAdviceFacts(rows({
      clients: [client("c1")],
      nextWeekSheets: [{
        status: "draft",
        clientId: "c1",
        items: [item("c1", { hasMedia: false }), item("c1", { hasMedia: false, isCancelled: true })],
      }],
    }));
    expect(facts.nextWeekItems).toBe(1);
    expect(facts.nextWeekItemsWithoutMedia).toBe(1);
  });
});

describe("légendes réduites au bloc signature", () => {
  const signature = "__\nLa signature du client";

  it("distingue une légende vide d'une légende qui n'a que la signature", () => {
    const facts = weeklyAdviceFacts(rows({
      clients: [client("c1")],
      nextWeekSheets: [{
        status: "draft",
        clientId: "c1",
        items: [
          // Que la signature, aux espaces près : un travail qu'on croit fait.
          item("c1", { caption: "__ La signature du client", signature }),
          // Vide : un travail qui n'a pas commencé, ce n'est pas le même conseil.
          item("c1", { caption: "   ", signature }),
          item("c1", { caption: `Vraie légende.\n${signature}`, signature }),
        ],
      }],
    }));
    expect(facts.nextWeekCaptionsSignatureOnly).toBe(1);
  });

  it("n'attend pas de légende sur une story", () => {
    const facts = weeklyAdviceFacts(rows({
      clients: [client("c1")],
      nextWeekSheets: [{
        status: "draft",
        clientId: "c1",
        items: [item("c1", { format: "story", caption: signature, signature })],
      }],
    }));
    expect(facts.nextWeekCaptionsSignatureOnly).toBe(0);
  });

  it("signale les publications déjà parties chez le client", () => {
    const facts = weeklyAdviceFacts(rows({
      sentItems: [
        item("c1", { caption: signature, signature }),
        item("c1", { caption: signature, signature }),
        item("c2", { caption: signature, signature }),
      ],
    }));
    const advice = weeklyAdvice(facts, "equipe").advices
      .find((entry) => entry.key === "legendes-parties-signature");
    expect(advice?.statement).toBe(
      "3 publications sont parties chez le client avec le bloc signature pour seule légende.",
    );
    expect(advice?.clients).toEqual([{ clientId: "c1", count: 2 }, { clientId: "c2", count: 1 }]);
  });
});

describe("écarts du score", () => {
  it("sépare la validation qui ne vient pas des corrections demandées", () => {
    const sheet = (id: string, clientId: string, status: string, approved: boolean) => ({
      id,
      clientId,
      status: status as never,
      sentToClientAt: "2026-10-05T09:00:00Z",
      approvedAt: approved ? "2026-10-07T09:00:00Z" : null,
      validationDeadlineAt: "2026-10-06T08:00:00Z",
      periodStart: "2026-10-05",
    });
    const facts = weeklyAdviceFacts(rows({
      sheets: [
        sheet("s1", "c1", "sent_to_client", false),
        sheet("s2", "c1", "new_version_to_send", false),
        sheet("s3", "c2", "approved_by_client", true),
      ],
      tickets: [{
        id: "t1",
        clientId: "c2",
        sheetId: "s3",
        type: "text_edit",
        submittedAt: "2026-10-06T09:00:00Z",
        resolvedAt: "2026-10-06T11:00:00Z",
        open: false,
      }],
    }));

    expect(facts.sentSheets).toBe(3);
    expect(facts.unapprovedSheets.total).toBe(2);
    expect(facts.resendPending.total).toBe(1);
    expect(facts.approvedAfterCorrection.total).toBe(1);
    // Validée le 7, échéance le 6 : en retard.
    expect(facts.approvedLate).toBe(1);

    const result = weeklyAdvice(facts, "equipe");
    const jamais = result.advices.find((entry) => entry.key === "fiches-jamais-validees");
    expect(jamais?.statement).toBe(
      "2 des 3 fiches envoyées n'ont jamais été validées, dont 1 attend un renvoi.",
    );
    expect(jamais?.action).toBe("Renvoyez 1 version corrigée cette semaine.");
    // Le gain vient de la mesure du score, pas d'un chiffre inventé ici.
    expect(jamais?.gain).toBeGreaterThan(0);
  });

  it("dit le vrai seuil du délai de retour, pas celui du libellé du score", () => {
    const facts = weeklyAdviceFacts(rows({
      tickets: [{
        id: "t1",
        clientId: "c1",
        sheetId: "s1",
        type: "text_edit",
        // Arrivé le lundi matin, jamais répondu quinze jours plus tard.
        submittedAt: "2026-10-12T08:00:00Z",
        resolvedAt: null,
        open: true,
      }],
    }));
    const advice = weeklyAdvice(facts, "equipe").advices.find((entry) => entry.key === "retours-hors-delai");
    expect(advice?.statement).toContain(`${TICKET_SLA_HOURS} h ouvrées`);
    expect(advice?.statement).not.toContain("20 h");
  });

  it("compte les commandes internes livrées en retard et celles qui le sont encore", () => {
    const facts = weeklyAdviceFacts(rows({
      requests: [
        { clientId: "c1", dueOn: "2026-09-01", deliveredAt: "2026-09-04T09:00:00Z" },
        { clientId: "c1", dueOn: "2026-09-10", deliveredAt: "2026-09-10T17:00:00Z" },
        { clientId: "c2", dueOn: "2026-10-12", deliveredAt: null },
      ],
    }));
    expect(facts.deliveredRequests).toBe(2);
    expect(facts.deliveredLateRequests).toBe(1);
    expect(facts.overdueRequests).toEqual([{ clientId: "c2", days: 14 }]);

    const advice = weeklyAdvice(facts, "equipe").advices.find((entry) => entry.key === "commandes-internes");
    expect(advice?.statement).toBe(
      "1 des 2 commandes internes livrées ont dépassé leur date, et 1 est encore en retard — jusqu'à 14 jours.",
    );
    expect(advice?.action).toBe("Livrez cette commande avant jeudi.");
  });

  it("compte une fiche partie après le vendredi 16 h qui précède sa semaine", () => {
    const facts = weeklyAdviceFacts(rows({
      sheets: [
        // Semaine du 12 octobre : vendredi 9 octobre 16 h Paris = 14 h UTC.
        { id: "a", clientId: "c1", status: "approved_by_client", sentToClientAt: "2026-10-09T13:00:00Z", approvedAt: null, validationDeadlineAt: null, periodStart: "2026-10-12" },
        { id: "b", clientId: "c1", status: "sent_to_client", sentToClientAt: "2026-10-12T07:00:00Z", approvedAt: null, validationDeadlineAt: null, periodStart: "2026-10-12" },
      ],
    }));
    expect(facts.sentAfterCutoff).toBe(1);
    /*
     * 65 h, et non 41 : du vendredi 9 octobre 14 h UTC au lundi 12 octobre
     * 7 h UTC, il y a trois jours moins sept heures. Le chiffre est écrit en
     * entier ici parce qu'une erreur d'un jour s'y glisse sans se voir.
     */
    expect(facts.sentAfterCutoffAverageHours).toBeCloseTo(72 - 7, 0);
  });
});

describe("textes et visuels", () => {
  const ticket = (id: string, clientId: string, type: string) => ({
    id,
    clientId,
    sheetId: "s1",
    type: type as never,
    submittedAt: "2026-10-05T09:00:00Z",
    resolvedAt: "2026-10-05T11:00:00Z",
    open: false,
  });

  it("compte les retours de texte depuis la typologie, hashtags exclus", () => {
    const facts = weeklyAdviceFacts(rows({
      tickets: [
        ticket("t1", "c1", "text_edit"),
        ticket("t2", "c1", "text_typo"),
        ticket("t3", "c2", "text_information"),
        ticket("t4", "c2", "hashtags"),
        ticket("t5", "c3", "photo_replace"),
      ],
    }));
    // Les hashtags ont leur propre règle : les compter deux fois expliquerait
    // deux fois le même retour.
    expect(facts.textTickets.total).toBe(3);
    expect(facts.hashtagTickets.total).toBe(1);
    expect(facts.totalTickets).toBe(5);
  });

  it("ne parle des hashtags que quand un retour l'explique", () => {
    const sansRetour = weeklyAdviceFacts(rows({ clients: [client("c1")] }));
    expect(weeklyAdvice(sansRetour, "equipe").advices.map((entry) => entry.key))
      .not.toContain("hashtags-sans-liste");

    const avecRetour = weeklyAdviceFacts(rows({
      clients: [client("c1")],
      tickets: [ticket("t1", "c1", "hashtags")],
    }));
    const advice = weeklyAdvice(avecRetour, "equipe").advices
      .find((entry) => entry.key === "hashtags-sans-liste");
    expect(advice?.statement).toBe(
      "1 des 1 dossiers gérés n'ont pas de liste de hashtags validée, "
      + "et les 1 retours « hashtags » viennent de 1 dossier.",
    );
  });
});

describe("partage par audience", () => {
  const withBudget = () => weeklyAdviceFacts(rows({
    clients: [client("c1")],
    unclassifiedShootings: [
      { clientId: "c1", performedOn: "2026-10-09" },
      { clientId: "c2", performedOn: "2026-10-20" },
    ],
    budgetIssueClientIds: ["c1", "c2", "c3"],
  }));

  it("réserve les deux conseils budgétaires à la direction", () => {
    const keys = weeklyAdvice(withBudget(), "direction").advices.map((entry) => entry.key);
    expect(keys).toContain("shootings-a-classer");
    expect(keys).toContain("budgets-en-defaut");
  });

  it("ne les sert jamais à l'équipe, même si les faits les portent", () => {
    const keys = weeklyAdvice(withBudget(), "equipe").advices.map((entry) => entry.key);
    expect(keys).not.toContain("shootings-a-classer");
    expect(keys).not.toContain("budgets-en-defaut");
  });

  it("ne cite aucun montant dans les conseils budgétaires", () => {
    for (const advice of weeklyAdvice(withBudget(), "direction").advices) {
      expect(advice.statement).not.toMatch(/€|euro|cent/i);
      expect(advice.action).not.toMatch(/€|euro|cent/i);
    }
  });
});

describe("qualité des conseils", () => {
  /** Un jeu de lignes qui déclenche largement plus de cinq règles. */
  function loaded() {
    return weeklyAdviceFacts(rows({
      clients: [client("c1"), client("c2"), client("c3"), client("c4"), client("c5")],
      sheets: Array.from({ length: 12 }, (_, index) => ({
        id: `s${index}`,
        clientId: `c${(index % 5) + 1}`,
        status: "sent_to_client" as never,
        sentToClientAt: "2026-10-05T09:00:00Z",
        approvedAt: null,
        validationDeadlineAt: "2026-10-06T08:00:00Z",
        periodStart: "2026-10-05",
      })),
      tickets: Array.from({ length: 9 }, (_, index) => ({
        id: `t${index}`,
        clientId: `c${(index % 5) + 1}`,
        sheetId: `s${index}`,
        type: "text_edit" as never,
        submittedAt: "2026-10-05T09:00:00Z",
        resolvedAt: null,
        open: true,
      })),
      requests: [{ clientId: "c1", dueOn: "2026-10-01", deliveredAt: null }],
      nextWeekSheets: [{
        status: "draft",
        clientId: "c1",
        items: Array.from({ length: 6 }, () => item("c1", { hasMedia: false, caption: "__\nLa signature du client" })),
      }],
      currentWeekItems: Array.from({ length: 4 }, () => item("c2", { hasMedia: false })),
      sentItems: Array.from({ length: 3 }, () => item("c3", { caption: "__\nLa signature du client" })),
      trackingReportsToFill: 2,
      openServiceRequests: 1,
    }));
  }

  it("n'en affiche jamais plus de cinq, triés par volume expliqué", () => {
    const result = weeklyAdvice(loaded(), "equipe");
    expect(result.advices).toHaveLength(WEEKLY_ADVICE_LIMIT);
    const volumes = result.advices.map((entry) => entry.volume);
    expect([...volumes].sort((a, b) => b - a)).toEqual(volumes);
  });

  it("porte un chiffre dans chaque phrase et un seul geste dans chaque action", () => {
    for (const advice of weeklyAdvice(loaded(), "equipe").advices) {
      expect(advice.statement).toMatch(/\d/);
      expect(advice.action.length).toBeGreaterThan(10);
    }
  });

  it("ne stocke jamais de nom de dossier, seulement des identifiants", () => {
    for (const advice of weeklyAdvice(loaded(), "direction").advices) {
      expect(advice.clients.every((entry) => typeof entry.clientId === "string")).toBe(true);
      expect(JSON.stringify(advice.clients)).not.toContain("name");
    }
  });

  it("ne nomme que les premiers dossiers, mais annonce le total", () => {
    const advice = weeklyAdvice(loaded(), "equipe").advices
      .find((entry) => entry.key === "fiches-jamais-validees");
    expect(advice?.clients.length).toBeLessThanOrEqual(ADVICE_CLIENT_NAMES_LIMIT);
    expect(advice?.clientCount).toBe(5);
  });

  it("le dit platement quand il n'y a rien à dire", () => {
    const { health: score, actions } = health({
      noCorrectionRate: 100,
      sentBeforeDeadlineRate: 100,
      productionPunctuality: 100,
      budgetsComplete: 100,
      shootingsCategorised: 100,
      ticketsOnTime: 100,
    });
    const result = weeklyAdvice(weeklyAdviceFacts(rows({ health: score, actions })), "direction");
    expect(result.advices).toHaveLength(0);
    expect(result.nothingToSay).toBe(true);
  });

  it("garde les n de la semaine, que la purge effacera des lignes sources", () => {
    const result = weeklyAdvice(loaded(), "equipe");
    expect(result.sample.fiches_envoyees).toBe(12);
    expect(result.sample.fenetre_depuis).toBe("2026-07-28");
    expect(result.sample.semaine_preparee).toBe(45);
  });
});

describe("table des règles", () => {
  /*
   * Les noms composés, au pluriel.
   *
   * Le pluriel par défaut n'ajoute un `s` qu'au dernier mot : il écrivait
   * « 16 version corrigées », « 2 compte rendus » et « 3 demande hors
   * publications » — trois fautes qu'aucun type ne signale et qu'un test au
   * singulier ne voit pas, puisqu'au singulier la phrase est juste. Le rendu
   * sur les données réelles les a toutes les trois fait sortir d'un coup.
   */
  it("accorde les noms composés au pluriel, et pas seulement leur dernier mot", () => {
    const resend = (id: string) => ({
      id,
      clientId: "c1",
      status: "new_version_to_send" as never,
      sentToClientAt: "2026-10-05T09:00:00Z",
      approvedAt: null,
      validationDeadlineAt: null,
      periodStart: "2026-10-05",
    });
    const facts = weeklyAdviceFacts(rows({
      sheets: [resend("s1"), resend("s2")],
      trackingReportsToFill: 2,
      openServiceRequests: 3,
    }));
    const advices = weeklyAdvice(facts, "equipe").advices;
    const phrase = (key: string) => {
      const entry = advices.find((candidate) => candidate.key === key);
      return `${entry?.statement ?? ""} ${entry?.action ?? ""}`;
    };

    expect(phrase("fiches-jamais-validees")).toContain("2 versions corrigées");
    expect(phrase("comptes-rendus")).toContain("2 comptes rendus");
    expect(phrase("demandes-ouvertes")).toContain("3 demandes hors publication");

    // Aucune des trois fautes, où qu'elle se trouve dans la phrase ou le geste.
    const everything = advices.map((entry) => `${entry.statement} ${entry.action}`).join(" ");
    for (const wrong of ["version corrigées", "compte rendus", "demande hors publications"]) {
      expect(everything, `faute d'accord : « ${wrong} »`).not.toContain(wrong);
    }
  });

  it("ne porte aucune clé en double : la ligne stockée les utilise comme identité", () => {
    const keys = ADVICE_RULES.map((rule) => rule.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("déclare une audience connue pour chaque règle", () => {
    for (const rule of ADVICE_RULES) {
      expect(["equipe", "direction"]).toContain(rule.audience);
      expect(rule.source.length).toBeGreaterThan(0);
    }
  });

  it("ne dit rien sur un jeu de lignes vide : null n'est pas zéro", () => {
    const facts = weeklyAdviceFacts(rows());
    for (const rule of ADVICE_RULES) {
      expect(rule.measure(facts), `règle ${rule.key}`).toBeNull();
    }
  });
});
