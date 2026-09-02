import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  contactFullName,
  escapeLikePattern,
  formatMontantCa,
  parisDateTimeLocalValue,
  parisDateTimeToIso,
  telHref,
} from "@/lib/domain/crm-transmission";
import {
  parseCalendlySignature,
  verifyCalendlySignature,
} from "@/lib/security/calendly-signature";

const SECRET = "secret-de-test";

function signature(body: string, timestamp: number, secret = SECRET): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

describe("signature des webhooks Calendly", () => {
  const body = JSON.stringify({ event: "invitee.created", payload: { email: "a@b.fr" } });
  const now = Date.UTC(2026, 8, 2, 10, 0, 0);
  const timestamp = Math.floor(now / 1000);

  it("découpe l’en-tête au format t=…,v1=…", () => {
    expect(parseCalendlySignature("t=1756800000,v1=abcdef")).toEqual({
      timestamp: "1756800000",
      signature: "abcdef",
    });
  });

  it("refuse un en-tête absent ou mal formé", () => {
    expect(parseCalendlySignature(null)).toBeNull();
    expect(parseCalendlySignature("")).toBeNull();
    expect(parseCalendlySignature("v1=abcdef")).toBeNull();
    expect(parseCalendlySignature("t=hier,v1=abcdef")).toBeNull();
    expect(parseCalendlySignature("t=1756800000,v1=pas-de-l-hexa")).toBeNull();
  });

  it("accepte une signature valide", () => {
    expect(
      verifyCalendlySignature({ header: signature(body, timestamp), body, secret: SECRET, now }),
    ).toBe(true);
  });

  it("refuse un corps modifié après signature", () => {
    const header = signature(body, timestamp);
    const falsifie = body.replace("a@b.fr", "attaquant@ailleurs.fr");
    expect(verifyCalendlySignature({ header, body: falsifie, secret: SECRET, now })).toBe(false);
  });

  it("refuse une signature produite avec un autre secret", () => {
    const header = signature(body, timestamp, "autre-secret");
    expect(verifyCalendlySignature({ header, body, secret: SECRET, now })).toBe(false);
  });

  it("refuse un rejeu hors de la fenêtre de tolérance", () => {
    const header = signature(body, timestamp);
    // Une heure plus tard : la signature reste mathématiquement bonne, mais
    // l'horodatage la périme.
    expect(
      verifyCalendlySignature({ header, body, secret: SECRET, now: now + 3_600_000 }),
    ).toBe(false);
  });

  it("tolère une horloge légèrement décalée", () => {
    const header = signature(body, timestamp);
    expect(
      verifyCalendlySignature({ header, body, secret: SECRET, now: now + 60_000 }),
    ).toBe(true);
  });
});

describe("fiches transmises par le CRM", () => {
  it("assemble le nom du contact, même partiel", () => {
    expect(contactFullName("Jean", "Dupont")).toBe("Jean Dupont");
    expect(contactFullName("Jean", null)).toBe("Jean");
    expect(contactFullName(null, "  Dupont ")).toBe("Dupont");
    expect(contactFullName(null, null)).toBeNull();
    expect(contactFullName("   ", "")).toBeNull();
  });

  it("nettoie le numéro pour le lien tel:", () => {
    expect(telHref("06 12 34 56 78")).toBe("0612345678");
    expect(telHref("+33 6.12.34.56.78")).toBe("+33612345678");
    expect(telHref(" 01-23-45-67-89 ")).toBe("0123456789");
  });

  it("neutralise les jokers d’une adresse cherchée en ilike", () => {
    // Sans échappement, le souligné rapprocherait le rendez-vous d'une
    // adresse voisine — donc d'un autre client.
    expect(escapeLikePattern("jean_dupont@exemple.fr")).toBe("jean\\_dupont@exemple.fr");
    expect(escapeLikePattern("100%@exemple.fr")).toBe("100\\%@exemple.fr");
    expect(escapeLikePattern("simple@exemple.fr")).toBe("simple@exemple.fr");
  });

  it("formate le montant du contrat", () => {
    expect(formatMontantCa(1500)?.replace(/ | /g, " ")).toBe("1 500 €");
    expect(formatMontantCa(null)).toBeNull();
  });

  it("lit et réécrit le rendez-vous à l’heure de Paris", () => {
    // Heure d'été : Paris est à UTC+2.
    expect(parisDateTimeToIso("2026-09-10T16:00")).toBe("2026-09-10T14:00:00.000Z");
    expect(parisDateTimeLocalValue("2026-09-10T14:00:00.000Z")).toBe("2026-09-10T16:00");

    // Heure d'hiver : UTC+1. Un aller-retour naïf décalerait le rendez-vous
    // d'une heure deux fois par an.
    expect(parisDateTimeToIso("2026-12-10T16:00")).toBe("2026-12-10T15:00:00.000Z");
    expect(parisDateTimeLocalValue("2026-12-10T15:00:00.000Z")).toBe("2026-12-10T16:00");

    expect(parisDateTimeToIso("pas une date")).toBeNull();
    expect(parisDateTimeLocalValue(null)).toBe("");
  });
});
