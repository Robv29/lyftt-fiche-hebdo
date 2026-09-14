import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_BOOKING_URL,
  followUpKey,
  followUpPeriod,
  followUpRecipients,
  isFollowUpDay,
  reviewedMonthName,
  type FollowUpClient,
} from "@/lib/domain/monthly-follow-up";
import {
  buildFollowUpHtml,
  buildFollowUpSubject,
  buildFollowUpText,
} from "@/lib/notifications/monthly-follow-up";

const today = "2026-10-05";

function client(overrides: Partial<FollowUpClient> = {}): FollowUpClient {
  return {
    id: "c1",
    name: "Muratet",
    isActive: true,
    kind: "gestion",
    contractStartDate: "2026-03-01",
    contractEndDate: null,
    pauseStartDate: null,
    pauseEndDate: null,
    createdAt: "2026-02-20T10:00:00Z",
    followUpEnabled: true,
    contacts: [{ firstName: "Jean", email: "jean@muratet.fr", receivesPlanning: true }],
    ...overrides,
  };
}

const recipients = (clients: FollowUpClient[], alreadySent = new Set<string>()) =>
  followUpRecipients({ clients, today, alreadySent });

describe("calendrier du bilan mensuel", () => {
  it("part le 5, avec deux jours de rattrapage", () => {
    expect(isFollowUpDay("2026-10-04")).toBe(false);
    expect(isFollowUpDay("2026-10-05")).toBe(true);
    expect(isFollowUpDay("2026-10-07")).toBe(true);
    expect(isFollowUpDay("2026-10-08")).toBe(false);
  });

  it("rattache l'envoi au mois, et fait le bilan du mois précédent", () => {
    expect(followUpPeriod(today)).toBe("2026-10-01");
    expect(reviewedMonthName(today)).toBe("septembre");
    expect(reviewedMonthName("2027-01-05")).toBe("décembre");
  });
});

describe("destinataires du bilan mensuel", () => {
  it("écrit aux contacts qui reçoivent le planning d'un client en gestion active", () => {
    expect(recipients([client()])).toEqual([
      { email: "jean@muratet.fr", firstName: "Jean", clients: [{ id: "c1", name: "Muratet" }] },
    ]);
  });

  it("n'écrit ni aux archivés, ni aux pauses, ni aux gestions terminées, ni aux ponctuels", () => {
    expect(recipients([
      client({ isActive: false }),
      client({ pauseStartDate: "2026-10-01", pauseEndDate: "2026-10-31" }),
      client({ contractEndDate: "2026-09-30" }),
      client({ kind: "ponctuel" }),
    ])).toEqual([]);
  });

  it("n'écrit pas aux dossiers exclus du bilan, comme l'agence elle-même", () => {
    expect(recipients([client({ followUpEnabled: false })])).toEqual([]);
  });

  it("attend le mois suivant pour un client dont la gestion démarre ce mois-ci", () => {
    expect(recipients([client({ contractStartDate: "2026-10-01" })])).toEqual([]);
    expect(recipients([client({ contractStartDate: null, createdAt: "2026-10-02T08:00:00Z" })])).toEqual([]);
    expect(recipients([client({ contractStartDate: null, createdAt: "2026-09-30T08:00:00Z" })])).toHaveLength(1);
  });

  it("écarte les contacts hors planning, sans adresse valable, ou en double", () => {
    const found = recipients([client({
      contacts: [
        { firstName: "Jean", email: " Jean@Muratet.fr ", receivesPlanning: true },
        { firstName: "Jean bis", email: "jean@muratet.fr", receivesPlanning: true },
        { firstName: "Paul", email: "paul@muratet.fr", receivesPlanning: false },
        { firstName: "Sans", email: "pas-une-adresse", receivesPlanning: true },
        { firstName: null, email: null, receivesPlanning: true },
      ],
    })]);
    expect(found.map((r) => r.email)).toEqual(["jean@muratet.fr"]);
  });

  it("une même boîte suivant deux dossiers reçoit un seul message qui les nomme", () => {
    const shared = { firstName: "Léa", email: "lea@exemple.fr", receivesPlanning: true };
    const found = recipients([
      client({ id: "c2", name: "Zèbre", contacts: [shared] }),
      client({ id: "c1", name: "Abeille", contacts: [{ ...shared, email: "LEA@exemple.fr" }] }),
    ]);
    expect(found).toEqual([{
      email: "lea@exemple.fr",
      firstName: "Léa",
      clients: [{ id: "c1", name: "Abeille" }, { id: "c2", name: "Zèbre" }],
    }]);
  });

  it("ne propose pas le bilan d'un mois passé entièrement en pause", () => {
    // En pause du 1er au 30 septembre : actif le 5 octobre, mais rien à commenter.
    expect(recipients([client({ pauseStartDate: "2026-09-01", pauseEndDate: "2026-09-30" })])).toEqual([]);
    // Pause terminée à la mi-septembre : il y a eu du travail, le bilan a lieu.
    expect(recipients([client({ pauseStartDate: "2026-08-01", pauseEndDate: "2026-09-15" })])).toHaveLength(1);
  });

  it("lit la création du dossier à l'heure de Paris", () => {
    // 30 septembre 22 h 30 UTC = 1er octobre 0 h 30 à Paris : signé en octobre.
    expect(recipients([client({ contractStartDate: null, createdAt: "2026-09-30T22:30:00Z" })])).toEqual([]);
  });

  it("ne réécrit pas à un contact déjà servi ce mois-ci", () => {
    const sent = new Set([followUpKey("c1", "JEAN@muratet.fr")]);
    expect(recipients([client()], sent)).toEqual([]);
  });
});

describe("e-mail du bilan mensuel", () => {
  const input = {
    clientNames: ["Un été <à> la campagne"],
    firstName: "Jean",
    reviewedMonth: "septembre",
    bookingUrl: FOLLOW_UP_BOOKING_URL,
  };

  it("annonce le mois et le client dans l'objet, avec l'élision", () => {
    expect(buildFollowUpSubject(input)).toBe("Votre bilan du mois de septembre — Un été <à> la campagne");
    expect(buildFollowUpSubject({ ...input, reviewedMonth: "août" })).toContain("du mois d’août");
    expect(buildFollowUpSubject({ ...input, reviewedMonth: "octobre" })).toContain("du mois d’octobre");
  });

  it("salue le contact et donne le lien de réservation", () => {
    const text = buildFollowUpText(input);
    expect(text).toContain("Bonjour Jean,");
    expect(text).toContain(FOLLOW_UP_BOOKING_URL);
    expect(buildFollowUpText({ ...input, firstName: null })).toContain("Bonjour,");
  });

  it("nomme tous les dossiers d'un contact qui en suit plusieurs", () => {
    expect(buildFollowUpSubject({ ...input, clientNames: ["A", "B"] })).toContain("— A et B");
    expect(buildFollowUpSubject({ ...input, clientNames: ["A", "B", "C"] })).toContain("— A, B et C");
  });

  it("porte un bouton vers la réservation et échappe ce qui vient de la base", () => {
    const html = buildFollowUpHtml({ ...input, firstName: "<b>Jean</b>" });
    expect(html).toContain(`href="${FOLLOW_UP_BOOKING_URL}"`);
    expect(html).toContain("Choisir mon créneau");
    expect(html).not.toContain("<b>Jean</b>");
  });
});

describe("le bilan suit la vie du client, sans rien à régler", () => {
  const at = (day: string, clients: FollowUpClient[]) =>
    followUpRecipients({ clients, today: day, alreadySent: new Set() });

  it("un client ajouté en cours de mois entre dans le bilan dès le mois suivant", () => {
    // Créé le 14 septembre, sans date de début saisie : un premier bilan le
    // 5 octobre, puis chaque 5 du mois. Signé le 2 octobre : dès novembre.
    const nouveau = client({ contractStartDate: null, createdAt: "2026-09-14T09:00:00Z" });
    expect(at("2026-10-05", [nouveau])).toHaveLength(1);
    expect(at("2026-11-05", [nouveau])).toHaveLength(1);

    const signeCeMois = client({ contractStartDate: null, createdAt: "2026-10-02T09:00:00Z" });
    expect(at("2026-10-05", [signeCeMois])).toEqual([]);
    expect(at("2026-11-05", [signeCeMois])).toHaveLength(1);
  });

  it("un client qui n'est plus actif ne reçoit plus rien, dès le mois où il s'arrête", () => {
    const base = client();
    expect(at("2026-10-05", [base])).toHaveLength(1);

    // Archivé
    expect(at("2026-11-05", [{ ...base, isActive: false }])).toEqual([]);
    // Fin de gestion le 31 octobre
    expect(at("2026-11-05", [{ ...base, contractEndDate: "2026-10-31" }])).toEqual([]);
    // En pause le jour de l'envoi
    expect(at("2026-11-05", [{ ...base, pauseStartDate: "2026-11-01", pauseEndDate: null }])).toEqual([]);
    // Pause terminée à la mi-novembre : novembre a été travaillé, le bilan reprend en décembre
    expect(at("2026-12-05", [{ ...base, pauseStartDate: "2026-11-01", pauseEndDate: "2026-11-15" }])).toHaveLength(1);
    // Pause sur tout novembre : rien à commenter en décembre, le bilan reprend en janvier
    const pauseNovembre = { ...base, pauseStartDate: "2026-11-01", pauseEndDate: "2026-11-30" };
    expect(at("2026-12-05", [pauseNovembre])).toEqual([]);
    expect(at("2027-01-05", [pauseNovembre])).toHaveLength(1);
  });
});
