import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildClientHashtagLibrary,
  hashtagsForClientType,
  LYFTT_CLIENT_TYPE_IDS,
  normalizeHashtag,
} from "../../src/lib/domain/hashtags";

describe("bibliothèque de hashtags LYFTT", () => {
  it.each(LYFTT_CLIENT_TYPE_IDS)("propose exactement 15 hashtags uniques pour %s", (clientType) => {
    const tags = hashtagsForClientType(clientType);

    expect(tags).toHaveLength(15);
    expect(new Set(tags.map((tag) => tag.toLowerCase())).size).toBe(15);
    expect(tags.every((tag) => /^#[A-Za-z0-9]+$/.test(tag))).toBe(true);
  });

  it("nettoie les hashtags saisis manuellement", () => {
    expect(normalizeHashtag("  #été en terrasse  ")).toBe("#EteEnTerrasse");
    expect(normalizeHashtag("nom_du_client")).toBe("#NomDuClient");
  });

  it("réunit les 15 hashtags métier et les 5 hashtags client", () => {
    const tags = buildClientHashtagLibrary("restaurant", [
      "Canal du Midi",
      "Brigitte cuisine",
      "Terrasse du Canal",
      "Menu du Midi",
      "Cassoulet maison",
    ]);

    expect(tags).toHaveLength(20);
    expect(tags.slice(-5)).toEqual([
      "#CanalDuMidi",
      "#BrigitteCuisine",
      "#TerrasseDuCanal",
      "#MenuDuMidi",
      "#CassouletMaison",
    ]);
  });

  it("supprime les doublons sans appel externe", () => {
    const tags = buildClientHashtagLibrary("restaurant", ["Restaurant", "Restaurant", "Maison", "Local", "Canal"]);
    expect(tags.filter((tag) => tag.toLowerCase() === "#restaurant")).toHaveLength(1);
  });
});

describe("hashtags de métier", () => {
  it("ne porte aucun nom propre géographique", () => {
    /*
     * Ces listes servent des clients répartis sur des territoires différents :
     * un hashtag de lieu y serait faux pour la plupart d'entre eux.
     *
     * La règle a longtemps été vérifiée pour les seules **villes**, ce qui a
     * laissé passer « #Occitanie » et « #DestinationOccitanie » dans les treize
     * typologies. Elle couvre désormais les communes, les départements, les
     * régions et les cours d'eau.
     */
    // Le nom doit former un mot entier : « Agencement » n'est pas « Agen »,
    // et « Lotissement » n'est pas « Lot ».
    const lieux =
      /(Toulouse|Montauban|Castres|Albi|Agen|Paris|Bordeaux|Occitanie|Aquitaine|Bretagne|Provence|Garonne|Tarn|Ariege|Aveyron|Gers|Herault|Lot|Aude|Gard|Lozere|Pyrenees|Dordogne|Ariège)(?![a-z])/i;
    for (const type of LYFTT_CLIENT_TYPE_IDS) {
      for (const hashtag of hashtagsForClientType(type)) {
        expect(hashtag, `${type} : ${hashtag}`).not.toMatch(lieux);
      }
    }
  });
});

/*
 * FIX B bis — la liste validée va dans la fiche du client de la demande.
 *
 * `clientId` arrive du formulaire : sans recoupement avec le ticket, la liste
 * retenue sur une demande pouvait être écrite dans la fiche de n'importe quel
 * autre client, par la clé service, sans que la RLS n'ait rien à en dire.
 */
describe("action qui retient la liste de hashtags d’un client", () => {
  const actionsSource = readFileSync(
    fileURLToPath(new URL("../../src/lib/internal/actions.ts", import.meta.url)),
    "utf8",
  );
  const action = actionsSource
    .split("export async function pinClientHashtags")[1]
    ?.split("\n}\n")[0] ?? "";

  it("lit le ticket sous RLS avant d’ouvrir la clé service", () => {
    const ticketRead = action.indexOf('.from("client_tickets")');
    const serviceKey = action.indexOf("createSupabaseAdminClient()");

    expect(ticketRead).toBeGreaterThan(-1);
    expect(serviceKey).toBeGreaterThan(ticketRead);
  });

  it("refuse une demande qui ne porte pas sur le client soumis", () => {
    expect(action).toContain("ticket.client_id !== parsed.data.clientId");
    expect(action).toContain("ACCESS_DENIED_MESSAGE");
  });

  /*
   * Voir le ticket ne veut pas dire avoir le client dans son périmètre :
   * `can_access_ticket` ouvre aussi par affectation personnelle. D'où une
   * seconde lecture sous RLS, sur le client cette fois.
   */
  it("relit le client sous RLS, et non sur la foi du ticket seul", () => {
    expect(action.match(/await scoped/g) ?? []).toHaveLength(2);
    expect(action).toContain('.from("clients")');
  });

  it("écrit sur le client du ticket, jamais sur celui du formulaire", () => {
    expect(action).toContain("const clientId = ticket.client_id as string;");
    expect(action).not.toContain('.eq("id", parsed.data.clientId)');
    expect(action).toContain("revalidatePath(`/clients/${clientId}`)");
  });

  it("ne cache pas l’échec de la trace derrière un succès", () => {
    expect(action).toContain("const { error: commentError }");
    expect(action).toContain("if (commentError)");
  });
});
