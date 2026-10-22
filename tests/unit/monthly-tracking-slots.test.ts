import { describe, expect, it } from "vitest";
import {
  TRACKING_BOOKING_URL,
  TRACKING_SLOT_DAYS,
  dueTrackingSlot,
  isTrackingSlotDay,
  trackingInvitationRecipients,
  trackingSlotDays,
  trackingSlotKey,
  trackingSlotPeriod,
  type TrackingInvitationClient,
} from "@/lib/domain/monthly-tracking-slots";
import { FOLLOW_UP_BOOKING_URL, isFollowUpDay } from "@/lib/domain/monthly-follow-up";
import { isReviewRequestDay } from "@/lib/domain/review-request";
import {
  buildTrackingInvitationHtml,
  buildTrackingInvitationSubject,
  buildTrackingInvitationText,
} from "@/lib/notifications/tracking-invitation";

function client(overrides: Partial<TrackingInvitationClient> = {}): TrackingInvitationClient {
  return {
    id: "c1",
    name: "Muratet",
    isActive: true,
    kind: "gestion",
    contractStartDate: "2026-03-01",
    contractEndDate: null,
    pauseStartDate: null,
    pauseEndDate: null,
    invitationsEnabled: true,
    products: [{ key: "gestion_budget_pub", frequency: 1 }],
    contacts: [{ firstName: "Jean", email: "jean@muratet.fr", receivesPlanning: true }],
    ...overrides,
  };
}

const recipients = (
  clients: TrackingInvitationClient[],
  today: string,
  alreadySent = new Set<string>(),
) => trackingInvitationRecipients({ clients, today, alreadySent });

describe("les créneaux du mois", () => {
  it("répartit les rendez-vous régulièrement selon la fréquence", () => {
    expect(trackingSlotDays(1)).toEqual([10]);
    expect(trackingSlotDays(2)).toEqual([10, 24]);
    expect(trackingSlotDays(3)).toEqual([9, 19, 28]);
  });

  it("espace deux rendez-vous d'environ deux semaines, trois d'une dizaine de jours", () => {
    const gaps = (days: readonly number[]) => days.slice(1).map((day, index) => day - days[index]!);
    expect(gaps(trackingSlotDays(2))).toEqual([14]);
    for (const gap of gaps(trackingSlotDays(3))) {
      expect(gap).toBeGreaterThanOrEqual(9);
      expect(gap).toBeLessThanOrEqual(11);
    }
  });

  it("garde le dernier créneau au 28 : il doit exister en février", () => {
    for (const days of Object.values(TRACKING_SLOT_DAYS)) {
      for (const day of days) expect(day).toBeLessThanOrEqual(28);
    }
  });

  it("n'envoie jamais le même jour que le bilan mensuel ou la demande d'avis", () => {
    // `review-request.ts` le dit en clair : deux messages le même jour, c'est un de trop.
    for (const [frequency, days] of Object.entries(TRACKING_SLOT_DAYS)) {
      for (const day of days) {
        for (let offset = 0; offset <= 2; offset += 1) {
          const date = `2026-01-${String(day + offset).padStart(2, "0")}`;
          expect(isFollowUpDay(date), `${frequency} → ${date}`).toBe(false);
          // Janvier est un mois de demande d'avis : le pire des cas.
          expect(isReviewRequestDay(date), `${frequency} → ${date}`).toBe(false);
        }
      }
    }
  });

  it("sert le créneau le jour dit, et deux jours de rattrapage", () => {
    expect(dueTrackingSlot("2026-10-09", 1)).toBeNull();
    expect(dueTrackingSlot("2026-10-10", 1)).toBe(0);
    expect(dueTrackingSlot("2026-10-12", 1)).toBe(0);
    expect(dueTrackingSlot("2026-10-13", 1)).toBeNull();

    expect(dueTrackingSlot("2026-10-10", 2)).toBe(0);
    expect(dueTrackingSlot("2026-10-24", 2)).toBe(1);
    expect(dueTrackingSlot("2026-10-26", 2)).toBe(1);
    expect(dueTrackingSlot("2026-10-27", 2)).toBeNull();

    expect(dueTrackingSlot("2026-10-09", 3)).toBe(0);
    expect(dueTrackingSlot("2026-10-19", 3)).toBe(1);
    expect(dueTrackingSlot("2026-10-28", 3)).toBe(2);
    expect(dueTrackingSlot("2026-10-13", 3)).toBeNull();
  });

  it("ne laisse jamais deux créneaux se chevaucher", () => {
    for (const frequency of [1, 2, 3]) {
      const served = [...Array(31).keys()]
        .map((index) => dueTrackingSlot(`2026-10-${String(index + 1).padStart(2, "0")}`, frequency))
        .filter((slot): slot is number => slot !== null);
      // Trois jours servis par créneau : le jour dit et ses deux rattrapages.
      expect(served).toHaveLength(frequency * 3);
    }
  });

  it("dit s'il y a un créneau à servir aujourd'hui, toutes fréquences confondues", () => {
    expect(isTrackingSlotDay("2026-10-10")).toBe(true);
    expect(isTrackingSlotDay("2026-10-19")).toBe(true);
    expect(isTrackingSlotDay("2026-10-24")).toBe(true);
    expect(isTrackingSlotDay("2026-10-05")).toBe(false);
    expect(isTrackingSlotDay("2026-10-15")).toBe(false);
  });

  it("rattache l'envoi au mois courant, et ne garde qu'une clé par créneau", () => {
    expect(trackingSlotPeriod("2026-10-24")).toBe("2026-10-01");
    expect(trackingSlotKey("c1", 1, " Jean@Muratet.FR ")).toBe("c1|1|jean@muratet.fr");
  });

  it("réserve le lien de réservation du bilan, et ne le recopie pas", () => {
    // Même rendez-vous, même personne : un seul endroit pour le lien.
    expect(TRACKING_BOOKING_URL).toBe(FOLLOW_UP_BOOKING_URL);
  });
});

describe("qui reçoit l'invitation", () => {
  it("invite le contact qui reçoit le planning, le jour du créneau", () => {
    const list = recipients([client()], "2026-10-10");
    expect(list).toHaveLength(1);
    expect(list[0]!.email).toBe("jean@muratet.fr");
    expect(list[0]!.firstName).toBe("Jean");
    expect(list[0]!.clients).toEqual([{
      id: "c1",
      name: "Muratet",
      slotIndex: 0,
      slotCount: 1,
      topics: ["votre budget publicitaire"],
    }]);
  });

  it("n'invite personne hors des jours de créneau", () => {
    expect(recipients([client()], "2026-10-13")).toEqual([]);
    // Le 5 est au bilan mensuel, le 15 à la demande d'avis.
    expect(recipients([client()], "2026-10-05")).toEqual([]);
    expect(recipients([client()], "2026-10-15")).toEqual([]);
  });

  it("respecte le réglage du dossier, l'état du client et le choix du contact", () => {
    const day = "2026-10-10";
    expect(recipients([client({ invitationsEnabled: false })], day)).toEqual([]);
    expect(recipients([client({ isActive: false })], day)).toEqual([]);
    expect(recipients([client({ contractEndDate: "2026-09-30" })], day)).toEqual([]);
    expect(recipients([client({ pauseStartDate: "2026-10-01", pauseEndDate: null })], day)).toEqual([]);
    expect(recipients([client({ products: [] })], day)).toEqual([]);
    expect(recipients([client({
      contacts: [{ firstName: "Jean", email: "jean@muratet.fr", receivesPlanning: false }],
    })], day)).toEqual([]);
    expect(recipients([client({
      contacts: [{ firstName: "Jean", email: "pas-une-adresse", receivesPlanning: true }],
    })], day)).toEqual([]);
  });

  it("sert un client en prestation ponctuelle : ces produits se vendent sans gestion RS", () => {
    expect(recipients([client({ kind: "ponctuel" })], "2026-10-10")).toHaveLength(1);
  });

  it("ne resollicite pas un contact déjà servi sur ce créneau", () => {
    const sent = new Set([trackingSlotKey("c1", 0, "jean@muratet.fr")]);
    expect(recipients([client()], "2026-10-10", sent)).toEqual([]);
    // Le créneau suivant, lui, reste dû.
    const twice = client({ products: [{ key: "gestion_budget_pub", frequency: 2 }] });
    expect(recipients([twice], "2026-10-24", sent)).toHaveLength(1);
  });

  it("n'écrit qu'une fois à une boîte qui suit deux dossiers", () => {
    const list = recipients([
      client({ id: "c1", name: "Muratet" }),
      client({ id: "c2", name: "Aneto" }),
    ], "2026-10-10");
    expect(list).toHaveLength(1);
    expect(list[0]!.clients.map((entry) => entry.name)).toEqual(["Aneto", "Muratet"]);
  });
});

describe("un client qui détient les deux produits n'est pas inondé", () => {
  const both = client({
    products: [
      { key: "gestion_budget_pub", frequency: 3 },
      { key: "marketing_externalise", frequency: 1 },
    ],
  });

  it("reçoit une invitation par créneau, pas une par produit", () => {
    const list = recipients([both], "2026-10-09");
    expect(list).toHaveLength(1);
    expect(list[0]!.clients).toHaveLength(1);
    expect(list[0]!.clients[0]!.slotCount).toBe(3);
    // L'ordre du jour nomme les deux : c'est le même rendez-vous.
    expect(list[0]!.clients[0]!.topics).toEqual([
      "votre budget publicitaire",
      "votre accompagnement marketing",
    ]);
  });

  it("ne met un produit à l'ordre du jour que des créneaux qu'il a payés", () => {
    // L'accompagnement marketing est vendu une fois : il n'est à l'ordre du
    // jour que du premier rendez-vous, pas des trois.
    expect(recipients([both], "2026-10-19")[0]!.clients[0]!.topics)
      .toEqual(["votre budget publicitaire"]);
    expect(recipients([both], "2026-10-28")[0]!.clients[0]!.topics)
      .toEqual(["votre budget publicitaire"]);
  });

  it("tient trois rendez-vous dans le mois, et non quatre", () => {
    const days = [...Array(31).keys()].map((index) => `2026-10-${String(index + 1).padStart(2, "0")}`);
    const invited = days.filter((day) => recipients([both], day).length > 0);
    // Trois créneaux × trois jours de rattrapage.
    expect(invited).toHaveLength(9);

    const slots = new Set(days.flatMap((day) =>
      recipients([both], day).flatMap((entry) => entry.clients.map((item) => item.slotIndex))));
    expect([...slots].sort()).toEqual([0, 1, 2]);
  });

  it("suit le plus grand des deux produits, et non leur somme", () => {
    const list = recipients([both], "2026-10-28");
    expect(list[0]!.clients[0]!.slotIndex).toBe(2);
    // Un client au seul accompagnement marketing (fréquence 1) n'a rien ce jour-là.
    expect(recipients([client({ products: [{ key: "marketing_externalise", frequency: 1 }] })], "2026-10-28"))
      .toEqual([]);
  });
});

describe("le message", () => {
  const input = {
    clientNames: ["Muratet"],
    firstName: "Jean",
    topics: ["votre budget publicitaire", "votre accompagnement marketing"],
    slotNumber: 2,
    slotCount: 3,
    bookingUrl: TRACKING_BOOKING_URL,
  };

  it("annonce un point de suivi et nomme le dossier", () => {
    expect(buildTrackingInvitationSubject(input)).toBe("Votre point de suivi — Muratet");
    expect(buildTrackingInvitationSubject({ ...input, clientNames: ["Aneto", "Muratet"] }))
      .toBe("Votre point de suivi — Aneto et Muratet");
  });

  it("dit les sujets, le rang du rendez-vous et le lien", () => {
    const text = buildTrackingInvitationText(input);
    expect(text).toContain("Bonjour Jean,");
    expect(text).toContain("votre budget publicitaire et votre accompagnement marketing");
    expect(text).toContain("2ᵉ des 3 points de suivi prévus ce mois-ci.");
    expect(text).toContain(TRACKING_BOOKING_URL);
  });

  it("n'annonce pas de rang quand il n'y a qu'un rendez-vous dans le mois", () => {
    const text = buildTrackingInvitationText({ ...input, slotNumber: 1, slotCount: 1 });
    expect(text).not.toContain("points de suivi prévus");
    expect(text).toContain("Bonjour Jean,");
  });

  it("dit « Bonjour, » sans prénom, et échappe le contenu en HTML", () => {
    expect(buildTrackingInvitationText({ ...input, firstName: null })).toContain("Bonjour,");
    const html = buildTrackingInvitationHtml({ ...input, firstName: "Jean & Marie" });
    expect(html).toContain("Jean &amp; Marie");
    expect(html).not.toContain("Jean & Marie");
    expect(html).toContain(TRACKING_BOOKING_URL);
  });
});
