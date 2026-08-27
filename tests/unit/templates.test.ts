import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  isRenderComplete,
  renderTemplate,
  whatsappLink,
} from "@/lib/domain/templates";

const context = {
  contact_first_name: "Brigitte",
  client_name: "Un été à la campagne",
  publication_week: "du 10 au 16 août",
  publication_start_date: "10/08/2026",
  publication_end_date: "16/08/2026",
  validation_deadline: "mardi 11 août à 10 h",
  review_link: "https://app.lyftt.fr/client-review/abc",
  request_link: "https://app.lyftt.fr/client-review/abc/demandes",
  community_manager_name: "Élena",
};

describe("§4 — message d'accompagnement", () => {
  it("remplace toutes les variables du modèle standard", () => {
    const result = renderTemplate(DEFAULT_TEMPLATES.standard, context);

    expect(isRenderComplete(result)).toBe(true);
    expect(result.body).toContain("Bonjour Brigitte,");
    expect(result.body).toContain("du 10 au 16 août");
    expect(result.body).toContain("mardi 11 août à 10 h");
    expect(result.body).toContain("https://app.lyftt.fr/client-review/abc");
    expect(result.body).not.toContain("{{");
  });

  it("signale une variable manquante plutôt que d'écrire « Bonjour , »", () => {
    const result = renderTemplate(DEFAULT_TEMPLATES.standard, {
      ...context,
      contact_first_name: "",
    });

    expect(result.missing).toContain("contact_first_name");
    expect(isRenderComplete(result)).toBe(false);
    expect(result.body).toContain("{{contact_first_name}}");
  });

  it("signale une variable inconnue sans la remplacer", () => {
    const result = renderTemplate("Bonjour {{prenom_du_contact}}", context);

    expect(result.unknown).toEqual(["prenom_du_contact"]);
    expect(isRenderComplete(result)).toBe(false);
  });

  it("tolère les espaces dans les accolades", () => {
    const result = renderTemplate("Bonjour {{ contact_first_name }} !", context);
    expect(result.body).toBe("Bonjour Brigitte !");
  });

  it("annonce explicitement la règle tacite dans le modèle dédié", () => {
    const result = renderTemplate(DEFAULT_TEMPLATES.tacit_approval, context);

    expect(isRenderComplete(result)).toBe(true);
    expect(result.body).toContain("considérés comme validés");
    expect(result.body).toContain("mardi 11 août à 10 h");
  });

  it("ne promet jamais de validation tacite dans le modèle explicite", () => {
    const result = renderTemplate(DEFAULT_TEMPLATES.explicit_approval, context);
    expect(result.body).not.toContain("considérés comme validés");
    expect(result.body).toContain("ne seront pas publiés");
  });

  it("fournit les huit modèles prévus par la spec", () => {
    const types = Object.keys(DEFAULT_TEMPLATES);
    expect(types).toHaveLength(8);

    for (const [type, body] of Object.entries(DEFAULT_TEMPLATES)) {
      const result = renderTemplate(body, context);
      expect(isRenderComplete(result), `modèle ${type}`).toBe(true);
      expect(result.body, `modèle ${type}`).toContain("client-review");
    }
  });

  it("construit un lien WhatsApp avec le message encodé", () => {
    const link = whatsappLink("Bonjour Brigitte, voici le planning.", "+33 6 12 34 56 78");

    expect(link).toContain("https://wa.me/33612345678?text=");
    expect(link).toContain("Bonjour%20Brigitte");
  });

  it("construit un lien WhatsApp sans destinataire pour un envoi en groupe", () => {
    expect(whatsappLink("Coucou")).toBe("https://wa.me/?text=Coucou");
  });
});

/*
 * Les deux liens, dans tous les tons.
 *
 * Seul le modèle « standard » portait le lien des demandes spéciales : changer
 * de ton le faisait disparaître du message, et le client n'avait plus par où
 * passer pour un devis ou une date de shooting. Rien ne le signalait, la
 * vérification existante ne portant que sur les variables employées par un
 * modèle, jamais sur celles qui lui manquaient.
 *
 * Ce test porte sur `DEFAULT_TEMPLATES` en entier : un ton ajouté plus tard
 * sans le second lien échouera ici.
 */
describe("liens présents dans tous les modèles", () => {
  const tons = Object.entries(DEFAULT_TEMPLATES);

  it.each(tons)("le modèle « %s » porte le lien de validation", (_ton, body) => {
    expect(body).toContain("{{review_link}}");
  });

  it.each(tons)("le modèle « %s » porte le lien des demandes spéciales", (_ton, body) => {
    expect(body).toContain("{{request_link}}");
  });

  it("place le second lien avant la formule de politesse, pas après", () => {
    // On ne prend pas congé avant de donner une information : le lien qui suit
    // « Très belle journée » ne serait plus lu.
    for (const [ton, body] of tons) {
      const lien = body.lastIndexOf("{{request_link}}");
      const signature = body.lastIndexOf("{{community_manager_name}}");
      expect(lien, `${ton} : le lien doit précéder la signature`).toBeLessThan(signature);
    }
  });

  it("rend les deux liens dans le message final, quel que soit le ton", () => {
    for (const [ton, body] of tons) {
      const rendu = renderTemplate(body, {
        ...context,
        review_link: "https://exemple.test/r/abc",
        request_link: "https://exemple.test/r/abc/demandes",
      });
      expect(rendu.body, `${ton}`).toContain("https://exemple.test/r/abc/demandes");
      expect(rendu.missing, `${ton}`).toEqual([]);
    }
  });
});
