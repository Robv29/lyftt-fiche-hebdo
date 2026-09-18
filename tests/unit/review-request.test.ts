import { describe, expect, it } from "vitest";
import {
  REVIEW_URL,
  isReviewRequestDay,
  reviewPeriod,
  reviewQuarter,
  reviewRequestRecipients,
  type ReviewClient,
} from "@/lib/domain/review-request";
import { buildReviewHtml, buildReviewSubject, buildReviewText, formatFirstName } from "@/lib/notifications/review-request";

const today = "2026-10-15";

function client(overrides: Partial<ReviewClient> = {}): ReviewClient {
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
    reviewEnabled: true,
    contacts: [{ firstName: "Jean", email: "jean@muratet.fr", isPrimary: true, receivesPlanning: true }],
    ...overrides,
  };
}

const recipients = (clients: ReviewClient[], alreadySent = new Set<string>()) =>
  reviewRequestRecipients({ clients, today, alreadySent });

describe("calendrier de la demande d'avis", () => {
  it("part le 15 du premier mois de chaque trimestre, avec deux jours de rattrapage", () => {
    expect(isReviewRequestDay("2026-10-14")).toBe(false);
    expect(isReviewRequestDay("2026-10-15")).toBe(true);
    expect(isReviewRequestDay("2026-10-17")).toBe(true);
    expect(isReviewRequestDay("2026-10-18")).toBe(false);
    expect(isReviewRequestDay("2027-01-15")).toBe(true);
    expect(isReviewRequestDay("2026-11-15")).toBe(false);
  });

  it("rattache l'envoi au trimestre", () => {
    expect(reviewPeriod("2026-10-15")).toBe("2026-10-01");
    expect(reviewPeriod("2027-02-03")).toBe("2027-01-01");
    expect(reviewQuarter("2026-07-16")).toBe(3);
  });
});

describe("destinataires de la demande d'avis", () => {
  it("écrit aux clients actifs, en gestion comme en prestation ponctuelle", () => {
    expect(recipients([client()])).toEqual([
      { email: "jean@muratet.fr", firstName: "Jean", clientId: "c1", clientNames: ["Muratet"] },
    ]);
    const ponctuel = client({
      id: "c2", name: "Jeff", kind: "ponctuel", contractStartDate: null,
      contacts: [{ firstName: "Laurent", email: "laurent@jeff.fr", isPrimary: true, receivesPlanning: false }],
    });
    expect(recipients([ponctuel]).map((r) => r.email)).toEqual(["laurent@jeff.fr"]);
  });

  it("n'écrit ni aux archivés, ni aux pauses, ni aux gestions terminées, ni aux dossiers exclus", () => {
    expect(recipients([
      client({ isActive: false }),
      client({ pauseStartDate: "2026-10-01", pauseEndDate: null }),
      client({ contractEndDate: "2026-09-30" }),
      client({ reviewEnabled: false }),
    ])).toEqual([]);
  });

  it("attend trente jours de collaboration", () => {
    expect(recipients([client({ contractStartDate: "2026-10-01" })])).toEqual([]);
    expect(recipients([client({ contractStartDate: "2026-09-15" })])).toHaveLength(1);
  });

  it("une seule demande par adresse, qui nomme ses dossiers, et jamais deux fois le même trimestre", () => {
    const shared = { firstName: "Léa", email: "lea@exemple.fr", isPrimary: true, receivesPlanning: true };
    const found = recipients([
      client({ id: "c2", name: "Zèbre", contacts: [shared] }),
      client({ id: "c1", name: "Abeille", contacts: [{ ...shared, email: "LEA@exemple.fr" }] }),
    ]);
    expect(found).toEqual([{ email: "lea@exemple.fr", firstName: "Léa", clientId: "c1", clientNames: ["Abeille", "Zèbre"] }]);
    expect(recipients([client()], new Set(["jean@muratet.fr"]))).toEqual([]);
  });

  it("salue une boîte partagée par plusieurs personnes sans choisir un prénom au hasard", () => {
    const found = recipients([client({
      contacts: [
        { firstName: "ANNE", email: "boutique@muratet.fr", isPrimary: true, receivesPlanning: true },
        { firstName: "SÉBASTIEN", email: "boutique@muratet.fr", isPrimary: true, receivesPlanning: true },
      ],
    })]);
    expect(found[0]?.firstName).toBeNull();
  });

  it("ignore les contacts ni principaux ni destinataires du planning, et les adresses invalides", () => {
    expect(recipients([client({
      contacts: [
        { firstName: "Paul", email: "paul@muratet.fr", isPrimary: false, receivesPlanning: false },
        { firstName: "X", email: "pas-une-adresse", isPrimary: true, receivesPlanning: true },
      ],
    })])).toEqual([]);
  });
});

describe("e-mail de demande d'avis", () => {
  const input = { firstName: "Jean", clientNames: ["Muratet <&>"], quarter: 4 as const, reviewUrl: REVIEW_URL };

  it("change d'accroche à chaque saison", () => {
    const subjects = ([1, 2, 3, 4] as const).map((quarter) => buildReviewSubject({ ...input, quarter }));
    expect(new Set(subjects).size).toBe(4);
  });

  it("salue, demande un avis honnête et donne le lien", () => {
    const text = buildReviewText(input);
    expect(text).toContain("Bonjour Jean,");
    expect(text).toContain("avis honnête");
    expect(text).toContain(REVIEW_URL);
    expect(buildReviewText({ ...input, firstName: null })).toContain("Bonjour,");
  });

  it("porte un bouton vers la page d'avis et échappe ce qui vient de la base", () => {
    const html = buildReviewHtml(input);
    expect(html).toContain(`href="${REVIEW_URL}"`);
    expect(html).toContain("Laisser mon avis");
    expect(html).not.toContain("Muratet <&>");
  });

  it("remercie ceux qui ont déjà laissé un avis et dit comment ne plus recevoir le message", () => {
    for (const quarter of [1, 2, 3, 4] as const) {
      const text = buildReviewText({ ...input, quarter });
      expect(text).toContain("déjà laissé un avis");
      expect(text).toContain("stop");
      expect(buildReviewHtml({ ...input, quarter })).toContain("stop");
    }
  });

  it("écrit les prénoms comme dans une lettre", () => {
    expect(formatFirstName("GRÉGORY")).toBe("Grégory");
    expect(formatFirstName("jean-pierre")).toBe("Jean-Pierre");
    expect(formatFirstName("McKenzie")).toBe("McKenzie");
    expect(buildReviewText({ ...input, firstName: "SYLVIA" })).toContain("Bonjour Sylvia,");
  });
});

