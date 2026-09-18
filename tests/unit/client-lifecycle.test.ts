import { describe, expect, it } from "vitest";
import {
  clientLifecycle,
  clientLifecycleForWeek,
  productionBlockedMessage,
  type ClientWeekLifecycleInput,
} from "@/lib/domain/client-lifecycle";

// Sans jour de publication : la fin de contrat se juge au lundi, comme avant.
const base: ClientWeekLifecycleInput = {
  isActive: true,
  kind: "gestion",
  contractEndDate: null,
  pauseStartDate: null,
  pauseEndDate: null,
  publicationWeekdays: [],
};

const today = "2026-08-10";

describe("fin de gestion", () => {
  it("laisse le client actif sans date de fin", () => {
    expect(clientLifecycle(base, today).state).toBe("active");
    expect(clientLifecycle(base, today).canProduce).toBe(true);
  });

  it("reste actif le dernier jour de gestion", () => {
    // La journée de fin doit rester pleinement exploitable.
    const lifecycle = clientLifecycle({ ...base, contractEndDate: today }, today);
    expect(lifecycle.state).toBe("active");
    expect(lifecycle.canProduce).toBe(true);
  });

  it("archive le lendemain de la fin de gestion", () => {
    const lifecycle = clientLifecycle({ ...base, contractEndDate: "2026-08-09" }, today);
    expect(lifecycle.state).toBe("ended");
    expect(lifecycle.canProduce).toBe(false);
    expect(lifecycle.detail).toContain("9 août 2026");
  });

  it("annonce la fin à venir tant qu'elle n'est pas atteinte", () => {
    expect(clientLifecycle({ ...base, contractEndDate: "2026-12-31" }, today).detail)
      .toContain("31 décembre 2026");
  });
});

describe("pause", () => {
  it("archive pendant la pause, bornes incluses", () => {
    const paused = { ...base, pauseStartDate: "2026-08-10", pauseEndDate: "2026-08-20" };

    expect(clientLifecycle(paused, "2026-08-10").state).toBe("paused");
    expect(clientLifecycle(paused, "2026-08-15").state).toBe("paused");
    expect(clientLifecycle(paused, "2026-08-20").state).toBe("paused");
  });

  it("réactive le lendemain de la fin de pause", () => {
    const lifecycle = clientLifecycle(
      { ...base, pauseStartDate: "2026-08-01", pauseEndDate: "2026-08-09" },
      today,
    );
    expect(lifecycle.state).toBe("active");
    expect(lifecycle.canProduce).toBe(true);
  });

  it("reste actif avant le début de la pause, en l'annonçant", () => {
    const lifecycle = clientLifecycle({ ...base, pauseStartDate: "2026-09-01" }, today);
    expect(lifecycle.state).toBe("active");
    expect(lifecycle.detail).toContain("1 septembre 2026");
  });

  it("gère une pause sans date de reprise", () => {
    const lifecycle = clientLifecycle({ ...base, pauseStartDate: "2026-08-01" }, today);
    expect(lifecycle.state).toBe("paused");
    expect(lifecycle.detail).toContain("sans date de reprise");
  });

  it("annonce la date exacte de reprise", () => {
    const lifecycle = clientLifecycle(
      { ...base, pauseStartDate: "2026-08-01", pauseEndDate: "2026-08-20" },
      today,
    );
    expect(lifecycle.detail).toContain("21 août 2026");
  });
});

describe("priorités entre états", () => {
  it("l'archivage manuel prime sur tout", () => {
    expect(
      clientLifecycle({ ...base, isActive: false, pauseStartDate: "2026-09-01" }, today).state,
    ).toBe("archived");
  });

  it("la fin de gestion prime sur une pause en cours", () => {
    // Inutile d'annoncer une reprise pour un contrat déjà terminé.
    expect(
      clientLifecycle(
        { ...base, contractEndDate: "2026-08-01", pauseStartDate: "2026-08-05" },
        today,
      ).state,
    ).toBe("ended");
  });
});

describe("blocage de la production", () => {
  it("explique pourquoi aucune fiche ne peut être créée", () => {
    const paused = clientLifecycle({ ...base, pauseStartDate: "2026-08-01", pauseEndDate: "2026-08-20" }, today);
    expect(productionBlockedMessage(paused)).toContain("en pause");

    const ended = clientLifecycle({ ...base, contractEndDate: "2026-08-01" }, today);
    expect(productionBlockedMessage(ended)).toContain("terminée");

    const archived = clientLifecycle({ ...base, isActive: false }, today);
    expect(productionBlockedMessage(archived)).toContain("archivé");
  });

  it("ne dit rien pour un client actif", () => {
    expect(productionBlockedMessage(clientLifecycle(base, today))).toBe("");
  });
});

describe("gestion pas encore commencée", () => {
  it("écarte un client dont la date de début n'est pas atteinte", () => {
    const lifecycle = clientLifecycle({ ...base, contractStartDate: "2026-08-17" }, today);
    expect(lifecycle.state).toBe("not_started");
    expect(lifecycle.canProduce).toBe(false);
    expect(lifecycle.detail).toContain("17 août 2026");
  });

  it("produit dès le premier jour de gestion", () => {
    expect(clientLifecycle({ ...base, contractStartDate: today }, today).canProduce).toBe(true);
  });

  it("ne change rien sans date de début", () => {
    expect(clientLifecycle({ ...base, contractStartDate: null }, today).state).toBe("active");
  });

  it("explique pourquoi aucune fiche ne peut être créée", () => {
    const lifecycle = clientLifecycle({ ...base, contractStartDate: "2026-09-01" }, today);
    expect(productionBlockedMessage(lifecycle)).toContain("pas encore commencé");
  });
});

describe("évaluation à la semaine concernée", () => {
  const semaine34 = "2026-08-17";

  it("écarte une gestion qui s'arrête avant la semaine préparée", () => {
    // Fin le 15 août : rien à produire la semaine du 17.
    const lifecycle = clientLifecycle({ ...base, contractEndDate: "2026-08-15" }, semaine34);
    expect(lifecycle.canProduce).toBe(false);
  });

  it("retient une gestion qui démarre le premier jour de cette semaine", () => {
    const lifecycle = clientLifecycle({ ...base, contractStartDate: semaine34 }, semaine34);
    expect(lifecycle.canProduce).toBe(true);
  });

  it("écarte une pause couvrant la semaine préparée", () => {
    const lifecycle = clientLifecycle(
      { ...base, pauseStartDate: "2026-08-16", pauseEndDate: "2026-08-30" },
      semaine34,
    );
    expect(lifecycle.canProduce).toBe(false);
  });
});

/*
 * La production se fait à la semaine, pas à la journée : une semaine touchée
 * par la pause n'est pas produite, et la reprise a lieu la semaine suivante.
 */
describe("pause jugée à la semaine de production", () => {
  // Semaines ISO commençant les lundis 17 et 24 août 2026.
  const semaine34 = "2026-08-17";
  const semaine35 = "2026-08-24";

  it("laisse préparer la semaine suivante pendant une pause qui s'y termine", () => {
    // Pause du 10 au 21 : la semaine du 24 se prépare dès maintenant.
    const paused = { ...base, pauseStartDate: "2026-08-10", pauseEndDate: "2026-08-21" };
    expect(clientLifecycleForWeek(paused, semaine35).canProduce).toBe(true);
    // Alors qu'au jour présent, le client est bien en pause.
    expect(clientLifecycle(paused, "2026-08-17").canProduce).toBe(false);
  });

  it("écarte la semaine entière quand la pause n'en couvre que la fin", () => {
    // Pause à partir du jeudi 20 : la semaine du 17 n'est pas produite.
    const lifecycle = clientLifecycleForWeek(
      { ...base, pauseStartDate: "2026-08-20", pauseEndDate: "2026-09-05" },
      semaine34,
    );
    expect(lifecycle.canProduce).toBe(false);
    expect(lifecycle.state).toBe("paused");
  });

  it("écarte la semaine entière quand la pause s'y termine en milieu de semaine", () => {
    // Pause jusqu'au mercredi 19 : reprise annoncée la semaine du 24.
    const lifecycle = clientLifecycleForWeek(
      { ...base, pauseStartDate: "2026-08-03", pauseEndDate: "2026-08-19" },
      semaine34,
    );
    expect(lifecycle.canProduce).toBe(false);
    expect(lifecycle.detail).toContain("24 août");
  });

  it("reprend la semaine qui suit une pause finissant un dimanche", () => {
    const paused = { ...base, pauseStartDate: "2026-08-03", pauseEndDate: "2026-08-23" };
    expect(clientLifecycleForWeek(paused, semaine34).canProduce).toBe(false);
    expect(clientLifecycleForWeek(paused, semaine35).canProduce).toBe(true);
  });

  it("ne produit jamais tant que la pause n'a pas de date de reprise", () => {
    const lifecycle = clientLifecycleForWeek(
      { ...base, pauseStartDate: "2026-08-03", pauseEndDate: null },
      semaine35,
    );
    expect(lifecycle.canProduce).toBe(false);
    expect(lifecycle.detail).toBe("Pause sans date de reprise.");
  });

  it("laisse les bornes du contrat primer sur la pause", () => {
    const lifecycle = clientLifecycleForWeek(
      { ...base, contractEndDate: "2026-08-01", pauseStartDate: "2026-08-20", pauseEndDate: null },
      semaine34,
    );
    expect(lifecycle.state).toBe("ended");
  });

  it("laisse produire une semaine qu'aucune pause ne touche", () => {
    const lifecycle = clientLifecycleForWeek(
      { ...base, pauseStartDate: "2026-09-01", pauseEndDate: "2026-09-30" },
      semaine34,
    );
    expect(lifecycle.canProduce).toBe(true);
  });
});


/*
 * La fin du contrat se juge sur les jours de publication de la semaine, pas
 * sur son lundi : une semaine dont toutes les publications tombent après la
 * fin n'est plus en gestion. Le début, lui, reste jugé au lundi.
 */
describe("fin de contrat jugée sur les jours de publication", () => {
  // Cas réel d'E-MOVE : fin le lundi 30 novembre 2026, publication le mercredi.
  const emove = { ...base, contractStartDate: "2026-09-01", contractEndDate: "2026-11-30", publicationWeekdays: [3] };
  const semaine48 = "2026-11-23";
  const semaine49 = "2026-11-30";

  it("arrête E-MOVE après la semaine 48", () => {
    expect(clientLifecycleForWeek(emove, semaine48).canProduce).toBe(true);
    const s49 = clientLifecycleForWeek(emove, semaine49);
    expect(s49.state).toBe("ended");
    expect(s49.canProduce).toBe(false);
    expect(s49.detail).toBe("Fin de gestion le 30 novembre 2026.");
    expect(productionBlockedMessage(s49)).toContain("terminée");
  });

  it("garde la semaine dont une publication tombe encore dans le contrat", () => {
    // Fin le mercredi 30 septembre, publication lundi et vendredi : le lundi 28 compte.
    const client = { ...base, contractEndDate: "2026-09-30", publicationWeekdays: [1, 5] };
    expect(clientLifecycleForWeek(client, "2026-09-28").canProduce).toBe(true);
    expect(clientLifecycleForWeek(client, "2026-10-05").state).toBe("ended");
  });

  it("retient une publication le jour même de la fin", () => {
    const client = { ...base, contractEndDate: "2026-09-30", publicationWeekdays: [3] };
    expect(clientLifecycleForWeek(client, "2026-09-28").canProduce).toBe(true);
  });

  it("écarte la semaine dont toutes les publications suivent la fin", () => {
    // Fin le mercredi 30 septembre, publication jeudi et vendredi.
    const client = { ...base, contractEndDate: "2026-09-30", publicationWeekdays: [4, 5] };
    expect(clientLifecycleForWeek(client, "2026-09-28").state).toBe("ended");
  });

  it("lit des jours dans le désordre ou en double comme la création de fiche", () => {
    const client = { ...base, contractEndDate: "2026-09-30", publicationWeekdays: [5, 1, 1] };
    expect(clientLifecycleForWeek(client, "2026-09-28").canProduce).toBe(true);
  });

  it("garde la règle du lundi sans jour de publication", () => {
    const client = { ...emove, publicationWeekdays: [] };
    expect(clientLifecycleForWeek(client, semaine49).canProduce).toBe(true);
    expect(clientLifecycleForWeek(client, "2026-12-07").state).toBe("ended");
  });

  it("laisse le début du contrat jugé au lundi", () => {
    // Début le jeudi 24 septembre, publication mercredi et vendredi : la
    // semaine 39 reste hors gestion, même si le vendredi 25 est couvert.
    const client = { ...base, contractStartDate: "2026-09-24", publicationWeekdays: [3, 5] };
    expect(clientLifecycleForWeek(client, "2026-09-21").state).toBe("not_started");
    expect(clientLifecycleForWeek(client, "2026-09-28").canProduce).toBe(true);
  });

  it("ne change rien à la pause", () => {
    const paused = { ...base, pauseStartDate: "2026-08-20", pauseEndDate: "2026-09-05" };
    const withDays = { ...paused, publicationWeekdays: [3] };
    for (const week of ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]) {
      expect(clientLifecycleForWeek(withDays, week)).toEqual(clientLifecycleForWeek(paused, week));
    }
    expect(clientLifecycleForWeek(withDays, "2026-08-31").state).toBe("paused");
    expect(clientLifecycleForWeek(withDays, "2026-09-07").canProduce).toBe(true);
  });

  it("fait primer la fin du contrat sur une pause, comme au jour", () => {
    const client = { ...emove, pauseStartDate: "2026-11-25", pauseEndDate: null };
    expect(clientLifecycleForWeek(client, semaine48).state).toBe("paused");
    expect(clientLifecycleForWeek(client, semaine49).state).toBe("ended");
  });
});

describe("prestation ponctuelle", () => {
  it("ne propose aucune fiche à un client ponctuel", () => {
    /*
     * Sans ce cas, un client venu pour un seul shooting apparaissait dans le
     * planning comme « fiche à préparer », et comptait parmi les clients en
     * gestion au tableau de bord.
     */
    const cycle = clientLifecycle({ ...base, kind: "ponctuel" }, today);
    expect(cycle.state).toBe("one_shot");
    expect(cycle.canProduce).toBe(false);
    expect(cycle.label).toBe("Prestation ponctuelle");
  });

  it("laisse l'archivage primer sur le ponctuel", () => {
    expect(clientLifecycle({ ...base, kind: "ponctuel", isActive: false }, today).state).toBe("archived");
  });

  it("ignore les dates de gestion, sans objet pour un one-shot", () => {
    const cycle = clientLifecycle({
      ...base, kind: "ponctuel",
      pauseStartDate: "2026-08-01", pauseEndDate: "2026-08-31",
    }, today);
    expect(cycle.state).toBe("one_shot");
  });

  it("vaut aussi à la semaine", () => {
    expect(clientLifecycleForWeek({ ...base, kind: "ponctuel" }, "2026-08-10").canProduce).toBe(false);
  });
});
