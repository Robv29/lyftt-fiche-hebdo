import { describe, expect, it } from "vitest";
import {
  draftReconciliation,
  expectsContentThisWeek,
  hasMonthlyCadence,
  isActionableOverdue,
  reconcileWeekItems,
  rescheduleItems,
  planningBucketForPeriod,
  planningWeekRange,
  hashtagSeed,
  hashtagsForSlot,
  hasWrittenCaption,
  selectHashtags,
  satisfactionPercentage,
  satisfactionSummary,
  sheetCompletion,
  weeklyFormatsForCadence,
  publicationDatesForWeek,
  normalizeWeekdays,
} from "../../src/lib/domain/planning";
import type { MediaFormat } from "../../src/lib/domain/types";
import { planningHrefForBucket } from "../../src/app/(internal)/fiches/planning-tab";

describe("planning hebdomadaire", () => {
  const now = new Date("2026-08-04T10:00:00Z");

  it("calcule la semaine courante et la suivante", () => {
    expect(planningWeekRange(now)).toMatchObject({
      currentStart: "2026-08-03",
      currentEnd: "2026-08-09",
      nextStart: "2026-08-10",
      nextEnd: "2026-08-16",
      nextIsoYear: 2026,
      nextIsoWeek: 33,
    });
  });

  it("range les fiches dans les trois périodes utiles", () => {
    expect(planningBucketForPeriod("2026-07-27", "2026-08-02", now)).toBe("past");
    expect(planningBucketForPeriod("2026-08-03", "2026-08-09", now)).toBe("current");
    expect(planningBucketForPeriod("2026-08-10", "2026-08-16", now)).toBe("next");
    expect(planningBucketForPeriod("2026-08-17", "2026-08-23", now)).toBe("later");
  });

  it("compte texte, hashtags et média dans la progression", () => {
    expect(sheetCompletion([
      { caption: "Texte", hashtags: ["#Local"], format: "photo", mediaAssetId: "media" },
      { caption: "", hashtags: ["#Local"], format: "video", mediaAssetId: null },
    ])).toEqual({ completed: 4, total: 6, percentage: 67 });
  });

  it("ne demande pas de média pour un texte seul", () => {
    expect(sheetCompletion([
      { caption: "Texte", hashtags: "#Local", format: "texte_seul" },
    ])).toEqual({ completed: 2, total: 2, percentage: 100 });
  });

  /*
   * Une story n'a pas de légende : le texte est incrusté à l'image au montage.
   * La compter comme manquante bloquait la fiche à 66 % pour toujours.
   */
  it("ne demande pas de texte pour une story", () => {
    expect(sheetCompletion([
      { caption: "", hashtags: "#Local", format: "story", mediaAssetId: "media" },
    ])).toEqual({ completed: 2, total: 2, percentage: 100 });
  });

  it("ne crédite pas un texte écrit par erreur sur une story", () => {
    expect(sheetCompletion([
      { caption: "Texte inutile", hashtags: "#Local", format: "story", mediaAssetId: "media" },
    ])).toEqual({ completed: 2, total: 2, percentage: 100 });
  });

  it("répartit les formats selon la cadence mensuelle", () => {
    const fourWeeks = [33, 34, 35, 36].flatMap((week) =>
      weeklyFormatsForCadence({ photo: 4, video: 2, story: 6, visual: 2 }, week),
    );
    expect(fourWeeks.filter((format) => format === "photo")).toHaveLength(4);
    expect(fourWeeks.filter((format) => format === "video")).toHaveLength(2);
    expect(fourWeeks.filter((format) => format === "story")).toHaveLength(6);
    expect(fourWeeks.filter((format) => format === "visuel")).toHaveLength(2);
  });

  it("ne produit aucune story quand le client n'en a pas vendu", () => {
    const fourWeeks = [33, 34, 35, 36].flatMap((week) =>
      weeklyFormatsForCadence({ photo: 4, video: 2, visual: 2 }, week),
    );
    expect(fourWeeks.filter((format) => format === "story")).toHaveLength(0);
  });

  /*
   * FIX C — la frontière de « légende rédigée ».
   *
   * La signature du client est préremplie en bas de chaque légende à la
   * création de la fiche. Une légende restée réduite à cette signature n'est
   * pas un texte : 28 publications sont parties chez un client dans cet état
   * parce que le verrou des 100 % se contentait d'une chaîne non vide.
   */
  const signature = "LYFTT · 05 61 00 00 00";

  it("ne compte pas une légende réduite à la signature préremplie", () => {
    expect(sheetCompletion([
      { caption: `\n\n${signature}`, hashtags: ["#Local"], format: "photo", mediaAssetId: "media" },
    ], { signature })).toEqual({ completed: 2, total: 3, percentage: 67 });
  });

  it("compte une légende rédigée au-dessus de la signature", () => {
    expect(sheetCompletion([
      { caption: `Notre terrasse ouvre samedi.\n\n${signature}`, hashtags: ["#Local"], format: "photo", mediaAssetId: "media" },
    ], { signature })).toEqual({ completed: 3, total: 3, percentage: 100 });
  });

  /*
   * Fiche déjà partie : l'appelant n'envoie pas la signature, et le calcul est
   * celui d'avant, à l'octet près. Onze fiches envoyées ou validées — dont
   * trois en cours de correction — retomberaient sinon sous les 100 %, et le
   * verrou leur refuserait le renvoi de la correction au client.
   */
  it("retombe sur l’ancienne règle quand la signature n’est pas fournie", () => {
    expect(sheetCompletion([
      { caption: `\n\n${signature}`, hashtags: ["#Local"], format: "photo", mediaAssetId: "media" },
    ])).toEqual({ completed: 3, total: 3, percentage: 100 });
  });

  it("ne change rien pour un client sans signature", () => {
    expect(sheetCompletion([
      { caption: "Un texte", hashtags: ["#Local"], format: "photo", mediaAssetId: "media" },
    ], { signature: null })).toEqual({ completed: 3, total: 3, percentage: 100 });
  });

  it("laisse la story hors du calcul, signature ou non", () => {
    expect(sheetCompletion([
      { caption: `\n\n${signature}`, hashtags: "#Local", format: "story", mediaAssetId: "media" },
    ], { signature })).toEqual({ completed: 2, total: 2, percentage: 100 });
  });

  /*
   * `replace` ne retire que la première occurrence : une légende qui répète la
   * signature contient autre chose qu'elle. Sémantique conservée en déplaçant
   * la règle depuis le constructeur de fiche.
   */
  it("ne retire que la première occurrence de la signature", () => {
    expect(hasWrittenCaption(`${signature} ${signature}`, signature)).toBe(true);
    expect(hasWrittenCaption(`  ${signature}  `, signature)).toBe(false);
    expect(hasWrittenCaption("", signature)).toBe(false);
    expect(hasWrittenCaption(null, signature)).toBe(false);
    // Signature vide ou absente : ancienne règle.
    expect(hasWrittenCaption("   ", "")).toBe(false);
    expect(hasWrittenCaption("Texte")).toBe(true);
  });

  /*
   * FIX C bis — la signature du client a changé depuis la création de la fiche.
   *
   * La comparaison porte sur la signature *actuelle*, alors que la légende en
   * porte une copie figée : retirer une ligne vide de la signature du client
   * rouvrait le verrou des 100 % en silence sur toutes les fiches en cours.
   * Variante relevée en production.
   */
  const pause = "__\n\nEt si vous faisiez une pause ?";

  it("ne compte pas une légende réduite à une variante d’espacement de la signature", () => {
    expect(hasWrittenCaption("__\nEt si vous faisiez une pause ?", pause)).toBe(false);
    expect(hasWrittenCaption("__ Et si vous faisiez une pause ?", pause)).toBe(false);
  });

  /*
   * Le rattrapage ne vaut que pour la signature entière : une vraie légende
   * courte, même contenue dans le bloc, reste un texte écrit.
   */
  it("garde une légende courte qui se trouve figurer dans le bloc", () => {
    expect(hasWrittenCaption("une pause ?", pause)).toBe(true);
    expect(hasWrittenCaption(`Notre terrasse ouvre samedi.\n\n${pause}`, pause)).toBe(true);
  });

  it("sélectionne des hashtags variés mais stables", () => {
    const tags = Array.from({ length: 20 }, (_, index) => `#Tag${index}`);
    const first = selectHashtags(tags, "client-33-0");
    const second = selectHashtags(tags, "client-33-0");
    expect(first).toEqual(second);
    expect(first).toHaveLength(8);
    expect(selectHashtags(tags, "client-33-1")).not.toEqual(first);
  });

  /*
   * FIX B — le tirage ne bouge plus d'une semaine sur l'autre.
   *
   * La graine contenait l'année et la semaine ISO : chaque fiche redistribuait
   * un autre sous-ensemble de la bibliothèque, donc une liste corrigée à la
   * main ne survivait pas à la semaine suivante. AUDIOPTIC a redemandé la même
   * correction treize fois, et le hashtag retiré en semaine 35 revenait en 41,
   * 43 et 45.
   */
  it("tire les mêmes hashtags pour un client et une place, semaine après semaine", () => {
    const tags = Array.from({ length: 20 }, (_, index) => `#Tag${index}`);
    const client = "370100d4-0870-4a1d-b71e-ad567490fef2";

    expect(hashtagSeed(client, 0)).toBe(`${client}-0`);
    // La semaine n'entre pas dans la graine : il n'y a qu'une liste par place.
    expect(selectHashtags(tags, hashtagSeed(client, 0)))
      .toEqual(selectHashtags(tags, hashtagSeed(client, 0)));
    // Deux publications de la même semaine ne sont pas un copier-coller.
    expect(selectHashtags(tags, hashtagSeed(client, 1)))
      .not.toEqual(selectHashtags(tags, hashtagSeed(client, 0)));
    // Deux clients ne reçoivent pas la même liste.
    expect(selectHashtags(tags, hashtagSeed("autre-client", 0)))
      .not.toEqual(selectHashtags(tags, hashtagSeed(client, 0)));
  });

  /*
   * Liste retenue sur la fiche client : le tirage la rend telle quelle, dans un
   * ordre stable. C'est ce qui fait tenir « les mêmes que d'habitude ».
   */
  it("rend intégralement une liste retenue de huit hashtags ou moins", () => {
    const pinned = ["#Opticien", "#OpticienIndependant", "#Audioptic", "#Lunettes"];
    const drawn = selectHashtags(pinned, hashtagSeed("client", 0));
    expect([...drawn].sort()).toEqual([...pinned].sort());
    expect(selectHashtags(pinned, hashtagSeed("client", 0))).toEqual(drawn);
  });

  /*
   * FIX B bis — une liste retenue plus longue que le tirage.
   *
   * Le tirage s'arrête à huit, et pas au même endroit d'une place à l'autre :
   * une liste de douze hashtags validée par le client revenait tronquée, et
   * différemment sur chaque publication de la fiche. Une liste validée part
   * telle quelle.
   */
  it("rend une liste retenue de douze hashtags entière, identique à chaque place", () => {
    const pinned = Array.from({ length: 12 }, (_, index) => `#Retenu${index}`);
    const slot0 = hashtagsForSlot(pinned, { clientId: "client", slotIndex: 0, pinned: true });
    const slot1 = hashtagsForSlot(pinned, { clientId: "client", slotIndex: 1, pinned: true });

    expect(slot0).toEqual(pinned);
    expect(slot1).toEqual(pinned);
  });

  it("dédoublonne une liste retenue sans en changer l’ordre", () => {
    expect(hashtagsForSlot(["#A", "", "#B", "#A"], { clientId: "client", slotIndex: 0, pinned: true }))
      .toEqual(["#A", "#B"]);
  });

  it("tire toujours huit hashtags dans une bibliothèque non validée", () => {
    const library = Array.from({ length: 20 }, (_, index) => `#Tag${index}`);
    const slot0 = hashtagsForSlot(library, { clientId: "client", slotIndex: 0, pinned: false });

    expect(slot0).toHaveLength(8);
    // Le tirage d'avant, à l'identique : la graine ne bouge pas.
    expect(slot0).toEqual(selectHashtags(library, hashtagSeed("client", 0)));
    expect(hashtagsForSlot(library, { clientId: "client", slotIndex: 1, pinned: false }))
      .not.toEqual(slot0);
  });
});

describe("jours de publication", () => {
  const monday = new Date("2026-08-10T00:00:00Z"); // lundi

  it("pose les contenus sur les jours choisis, dans l'ordre", () => {
    expect(publicationDatesForWeek(3, [4, 2], monday)).toEqual([
      "2026-08-11", // mardi
      "2026-08-13", // jeudi
      "2026-08-11", // on repasse sur le mardi
    ]);
  });

  it("dédoublonne et écarte les jours hors semaine", () => {
    expect(normalizeWeekdays([3, 3, 0, 8, 1])).toEqual([1, 3]);
  });

  it("ne propose aucune date sans jour renseigné", () => {
    expect(publicationDatesForWeek(2, [], monday)).toEqual(["", ""]);
  });

  it("couvre la semaine entière du lundi au dimanche", () => {
    expect(publicationDatesForWeek(7, [1, 2, 3, 4, 5, 6, 7], monday)).toEqual([
      "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13",
      "2026-08-14", "2026-08-15", "2026-08-16",
    ]);
  });
});

describe("étalement du rythme mensuel", () => {
  it("répartit deux vidéos par mois une semaine sur deux", () => {
    const semaines = [33, 34, 35, 36].map((week) =>
      weeklyFormatsForCadence({ video: 2 }, week).filter((format) => format === "video").length);
    // Deux semaines servies sur quatre, alternées et non groupées.
    expect(semaines.reduce((total, count) => total + count, 0)).toBe(2);
    expect(semaines[0]).not.toBe(semaines[1]);
    expect(semaines[1]).not.toBe(semaines[2]);
    expect(semaines[2]).not.toBe(semaines[3]);
  });

  it("sert une prestation mensuelle une semaine sur quatre", () => {
    const semaines = [33, 34, 35, 36].map((week) =>
      weeklyFormatsForCadence({ video: 1 }, week).filter((format) => format === "video").length);
    expect(semaines.reduce((total, count) => total + count, 0)).toBe(1);
  });

  it("sert chaque semaine dès que le volume atteint quatre", () => {
    for (const week of [33, 34, 35, 36]) {
      expect(weeklyFormatsForCadence({ video: 4 }, week).filter((f) => f === "video")).toHaveLength(1);
    }
  });
});

/*
 * Signalement : « E-MOVE, ça me propose de publier alors que c'est une semaine
 * sur deux ». Deux vidéos par mois, rien d'autre : une semaine creuse renvoyait
 * une photo « par défaut », si bien qu'une publication était proposée chaque
 * semaine.
 */
describe("semaine creuse d'un rythme clairsemé", () => {
  const emove = { photo: 0, video: 2, story: 0, visual: 0 };

  it("donne une vidéo les semaines ISO impaires", () => {
    for (const week of [35, 37, 39, 41, 49]) {
      expect(weeklyFormatsForCadence(emove, week)).toEqual(["video"]);
      expect(expectsContentThisWeek(emove, week)).toBe(true);
    }
  });

  it("ne propose rien les semaines paires, pas même une photo", () => {
    for (const week of [36, 38, 40, 48]) {
      expect(weeklyFormatsForCadence(emove, week)).toEqual([]);
      expect(expectsContentThisWeek(emove, week)).toBe(false);
    }
  });

  it("garde deux vidéos sur quatre semaines consécutives", () => {
    const month = [37, 38, 39, 40].flatMap((week) => weeklyFormatsForCadence(emove, week));
    expect(month).toEqual(["video", "video"]);
  });

  it("vaut aussi pour une prestation mensuelle unique : trois semaines creuses sur quatre", () => {
    const weeks = [33, 34, 35, 36].map((week) => weeklyFormatsForCadence({ visual: 1 }, week));
    expect(weeks.filter((formats) => formats.length === 0)).toHaveLength(3);
    expect(weeks.flat()).toEqual(["visuel"]);
  });

  /*
   * Rythme absent ou tout à zéro : réglage manquant, pas semaine creuse. Le
   * client resterait sinon invisible du planning pour toute la durée de son
   * contrat ; une photo proposée se remarque et se corrige.
   */
  it("garde une photo de repli pour un rythme absent", () => {
    expect(weeklyFormatsForCadence({}, 38)).toEqual(["photo"]);
    expect(weeklyFormatsForCadence({}, 39)).toEqual(["photo"]);
    expect(hasMonthlyCadence({})).toBe(false);
  });

  it("garde une photo de repli pour un rythme entièrement à zéro", () => {
    const zero = { photo: 0, video: 0, story: 0, visual: 0 };
    expect(weeklyFormatsForCadence(zero, 38)).toEqual(["photo"]);
    expect(expectsContentThisWeek(zero, 38)).toBe(true);
    expect(hasMonthlyCadence(zero)).toBe(false);
  });

  it("traite une saisie illisible comme zéro", () => {
    const garbage = { photo: Number.NaN, video: -3 } as const;
    expect(hasMonthlyCadence(garbage)).toBe(false);
    expect(weeklyFormatsForCadence(garbage, 38)).toEqual(["photo"]);
  });

  it("reconnaît un rythme vendu, même clairsemé", () => {
    expect(hasMonthlyCadence(emove)).toBe(true);
    expect(hasMonthlyCadence({ story: 1 })).toBe(true);
  });
});

describe("replanification d'un brouillon en semaine creuse", () => {
  it("ne retire ni n'ajoute rien, même un contenu vide", () => {
    const result = draftReconciliation([
      { id: "rempli", format: "reels", filled: true },
      { id: "vide", format: "photo", filled: false },
    ], []);
    expect(result).toEqual({ kind: "off_week" });
  });

  it("réconcilie normalement une semaine avec publication", () => {
    const result = draftReconciliation([
      { id: "vide", format: "photo", filled: false },
    ], ["video"]);
    expect(result).toEqual({ kind: "reconcile", toAdd: ["video"], toRemove: ["vide"], keptFilled: 0 });
  });

  it("n'insère plus de photo vide dans le brouillon S38 d'E-MOVE", () => {
    const expected = weeklyFormatsForCadence({ photo: 0, video: 2, story: 0, visual: 0 }, 38);
    expect(draftReconciliation([{ id: "reels", format: "reels", filled: true }], expected))
      .toEqual({ kind: "off_week" });
  });
});

describe("visibilité d'une fiche hors gestion", () => {
  /*
   * Le filtre sert à ne pas proposer de travail ; il ne doit pas escamoter un
   * travail réel sur la foi d'une date de contrat mal saisie.
   */
  const estVisible = (statut: string, produit: boolean) =>
    !["draft", "internal_review", "ready_to_send"].includes(statut) || produit;

  it("garde une fiche envoyée ou validée même hors gestion", () => {
    expect(estVisible("sent_to_client", false)).toBe(true);
    expect(estVisible("approved_by_client", false)).toBe(true);
    expect(estVisible("awaiting_revalidation", false)).toBe(true);
  });

  it("écarte un brouillon jamais transmis", () => {
    expect(estVisible("draft", false)).toBe(false);
    expect(estVisible("ready_to_send", false)).toBe(false);
  });

  it("garde tout ce qui relève d'un client en gestion", () => {
    expect(estVisible("draft", true)).toBe(true);
  });
});

/*
 * Satisfaction client : trois niveaux lus en pourcentage, et un taux de réponse
 * affiché aussi visiblement que la note. Un 100 % sur une réponse ne dit rien.
 */
describe("satisfaction client", () => {
  it("traduit les trois niveaux en pourcentage", () => {
    expect(satisfactionPercentage(1)).toBe(0);
    expect(satisfactionPercentage(2)).toBe(50);
    expect(satisfactionPercentage(3)).toBe(100);
  });

  it("borne une note hors échelle plutôt que de produire un taux absurde", () => {
    expect(satisfactionPercentage(0)).toBe(0);
    expect(satisfactionPercentage(9)).toBe(100);
  });

  it("moyenne les réponses et dit combien de fiches ont répondu", () => {
    expect(satisfactionSummary({ scores: [3, 3, 2], eligible: 10 })).toEqual({
      percentage: 83,
      answers: 3,
      eligible: 10,
      responseRate: 30,
      unhappy: 0,
    });
  });

  it("compte les notes basses, qui appellent un geste", () => {
    expect(satisfactionSummary({ scores: [1, 3], eligible: 2 }).unhappy).toBe(1);
  });

  it("n'invente aucun chiffre sans réponse", () => {
    expect(satisfactionSummary({ scores: [], eligible: 4 })).toMatchObject({
      percentage: null,
      answers: 0,
      responseRate: 0,
    });
    // Sans fiche validée, le taux de réponse n'a pas de dénominateur.
    expect(satisfactionSummary({ scores: [], eligible: 0 }).responseRate).toBeNull();
  });
});

/*
 * Retour depuis une fiche vers le planning.
 *
 * Le lien pointait sur `/fiches` en dur : revenir d'une fiche ouverte depuis
 * « Semaine prochaine » rebasculait sur « Cette semaine ». Ces cas verrouillent
 * le comportement attendu, y compris pour les périodes sans onglet propre.
 */
describe("onglet de retour au planning", () => {
  it("renvoie sur l'onglet de la période de la fiche", () => {
    expect(planningHrefForBucket("next")).toBe("/fiches?tab=next");
    expect(planningHrefForBucket("past")).toBe("/fiches?tab=past");
  });

  it("ne nomme pas l'onglet par défaut dans l'URL", () => {
    expect(planningHrefForBucket("current")).toBe("/fiches");
  });

  it("rabat une période lointaine sur la semaine prochaine, faute d'onglet à elle", () => {
    expect(planningHrefForBucket("later")).toBe("/fiches?tab=next");
  });

  it("s'accorde avec la période calculée pour une fiche", () => {
    const lundiProchain = "2026-08-31";
    const dimancheProchain = "2026-09-06";
    const bucket = planningBucketForPeriod(lundiProchain, dimancheProchain, new Date("2026-08-26T12:00:00Z"));
    expect(bucket).toBe("next");
    expect(planningHrefForBucket(bucket)).toBe("/fiches?tab=next");
  });
});

/*
 * Retard mis en avant.
 *
 * Une échéance dépassée sur une semaine passée l'est irrémédiablement : la
 * signaler en rouge noyait les retards qu'une relance ou une correction peut
 * encore rattraper. Règle partagée par les fiches en attente, les tickets
 * clients et la vue Production — les trois écrans doivent s'accorder.
 */
describe("retard sur lequel on peut encore agir", () => {
  const maintenant = new Date("2026-08-27T10:00:00Z");
  const semaineEnCours = { periodStart: "2026-08-24", periodEnd: "2026-08-30" };
  const semainePassee = { periodStart: "2026-08-17", periodEnd: "2026-08-23" };
  const semaineAVenir = { periodStart: "2026-08-31", periodEnd: "2026-09-06" };

  it("signale un dépassement sur la semaine en cours", () => {
    expect(isActionableOverdue({ dueAt: "2026-08-25T12:00:00Z", ...semaineEnCours }, maintenant)).toBe(true);
  });

  it("ne signale plus un dépassement sur une semaine passée", () => {
    expect(isActionableOverdue({ dueAt: "2026-08-18T12:00:00Z", ...semainePassee }, maintenant)).toBe(false);
  });

  it("ne signale rien avant l'échéance", () => {
    expect(isActionableOverdue({ dueAt: "2026-09-01T12:00:00Z", ...semaineAVenir }, maintenant)).toBe(false);
  });

  it("ne signale rien sans échéance", () => {
    expect(isActionableOverdue({ dueAt: null, ...semaineEnCours }, maintenant)).toBe(false);
  });

  it("s'en tient à l'échéance quand aucune semaine n'est rattachée", () => {
    // Rien ne permet alors de dire que l'objet appartient à une semaine révolue.
    expect(isActionableOverdue({ dueAt: "2026-08-18T12:00:00Z" }, maintenant)).toBe(true);
  });

  it("s'accorde avec la période calculée pour la même semaine", () => {
    expect(planningBucketForPeriod(semaineEnCours.periodStart, semaineEnCours.periodEnd, maintenant)).toBe("current");
    expect(planningBucketForPeriod(semainePassee.periodStart, semainePassee.periodEnd, maintenant)).toBe("past");
  });
});

/*
 * Recalage des dates sur les jours de publication.
 *
 * Les dates sont posées à la création ; changer les jours du client laissait les
 * fiches déjà créées sur l'ancien rythme. Quarante-sept fiches étaient dans ce
 * cas en production.
 */
describe("recalage des dates de publication", () => {
  const lundi = new Date("2026-08-24T00:00:00Z");
  const item = (id: string, date: string, createdAt = "2026-08-20T09:00:00Z") =>
    ({ id, scheduledDate: date, createdAt });

  it("replace les contenus sur les jours voulus", () => {
    // Deux contenus un lundi et un vendredi, pour un client qui publie mercredi et jeudi.
    const changes = rescheduleItems([item("a", "2026-08-24"), item("b", "2026-08-28")], [3, 4], lundi);
    expect(changes).toEqual([
      { id: "a", scheduledDate: "2026-08-26" },
      { id: "b", scheduledDate: "2026-08-27" },
    ]);
  });

  it("ne renvoie rien quand tout est déjà à sa place", () => {
    const changes = rescheduleItems([item("a", "2026-08-26"), item("b", "2026-08-27")], [3, 4], lundi);
    expect(changes).toEqual([]);
  });

  it("conserve l'ordre des contenus", () => {
    // Le premier reste le premier : l'ordre porte souvent une progression voulue.
    const changes = rescheduleItems(
      [item("tardif", "2026-08-28"), item("precoce", "2026-08-25")],
      [3, 4],
      lundi,
    );
    expect(changes[0]!.id).toBe("precoce");
    expect(changes[0]!.scheduledDate).toBe("2026-08-26");
  });

  it("cycle sur les jours quand il y a plus de contenus que de jours", () => {
    const changes = rescheduleItems(
      [item("a", "2026-08-24"), item("b", "2026-08-25"), item("c", "2026-08-26")],
      [2],
      lundi,
    );
    // Un seul jour vendu : tout tombe le mardi.
    expect(changes.every((c) => c.scheduledDate === "2026-08-25")).toBe(true);
  });

  it("ne touche à rien sans jour renseigné", () => {
    expect(rescheduleItems([item("a", "2026-08-24")], [], lundi)).toEqual([]);
  });

  it("départage deux contenus du même jour par leur création", () => {
    const changes = rescheduleItems(
      [item("second", "2026-08-24", "2026-08-20T15:00:00Z"), item("premier", "2026-08-24", "2026-08-20T09:00:00Z")],
      [3, 4],
      lundi,
    );
    expect(changes.map((c) => c.id)).toEqual(["premier", "second"]);
  });
});

/*
 * Ajustement du nombre de contenus au rythme vendu.
 *
 * Le compte est posé à la création : vendre deux vidéos de plus laissait les
 * fiches déjà créées à l'ancien nombre.
 */
describe("réconciliation des contenus d'une fiche", () => {
  const vide = (id: string, format: MediaFormat) => ({ id, format, filled: false });
  const rempli = (id: string, format: MediaFormat) => ({ id, format, filled: true });

  it("ajoute ce qui manque", () => {
    const result = reconcileWeekItems([vide("a", "photo")], ["photo", "photo", "video"]);
    expect(result.toAdd).toEqual(["photo", "video"]);
    expect(result.toRemove).toEqual([]);
  });

  it("retire les contenus vides en trop", () => {
    const result = reconcileWeekItems([vide("a", "photo"), vide("b", "photo")], ["photo"]);
    expect(result.toRemove).toEqual(["b"]);
    expect(result.toAdd).toEqual([]);
  });

  it("ne retire jamais un contenu déjà travaillé", () => {
    // Supprimer effacerait un texte ou un média sans possibilité de retour.
    const result = reconcileWeekItems([rempli("a", "photo"), rempli("b", "photo")], ["photo"]);
    expect(result.toRemove).toEqual([]);
    expect(result.keptFilled).toBe(1);
  });

  it("sacrifie le vide avant le rempli quand il faut réduire", () => {
    const result = reconcileWeekItems([rempli("plein", "photo"), vide("creux", "photo")], ["photo"]);
    expect(result.toRemove).toEqual(["creux"]);
    expect(result.keptFilled).toBe(0);
  });

  it("compte un reels comme la vidéo vendue, un carrousel comme le visuel", () => {
    const result = reconcileWeekItems([rempli("r", "reels"), vide("c", "carrousel")], ["video", "visuel"]);
    expect(result).toEqual({ toAdd: [], toRemove: [], keptFilled: 0 });
  });

  it("retire un format qui n'est plus vendu", () => {
    const result = reconcileWeekItems([vide("a", "story")], ["photo"]);
    expect(result.toRemove).toEqual(["a"]);
    expect(result.toAdd).toEqual(["photo"]);
  });

  it("ne bouge rien quand le compte est juste", () => {
    const result = reconcileWeekItems([vide("a", "photo"), rempli("b", "video")], ["photo", "video"]);
    expect(result).toEqual({ toAdd: [], toRemove: [], keptFilled: 0 });
  });
});
