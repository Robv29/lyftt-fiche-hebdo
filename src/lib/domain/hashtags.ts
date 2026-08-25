/**
 * Référentiel éditorial LYFTT, construit à partir des métiers présentés dans
 * les références publiques de l'agence. Il est volontairement local et fixe :
 * aucune IA ni API externe n'intervient lors de la création d'un client.
 */
export const LYFTT_CLIENT_TYPE_IDS = [
  "restaurant",
  "bar",
  "boucherie",
  "commerce",
  "cuisiniste",
  "design",
  "loisirs",
  "hotel",
  "beaute",
  "paysagiste",
  "artisan",
  "lyftt",
  "automobile",
] as const;

export type LyfttClientType = (typeof LYFTT_CLIENT_TYPE_IDS)[number];

export const LYFTT_CLIENT_TYPES: ReadonlyArray<{
  id: LyfttClientType;
  label: string;
  examples: string;
}> = [
  { id: "restaurant", label: "Restaurant & brasserie", examples: "restaurant, brasserie, traiteur" },
  { id: "bar", label: "Bar & lieu de convivialité", examples: "bar, cave, afterwork" },
  { id: "boucherie", label: "Boucherie & métiers de bouche", examples: "boucherie, charcuterie, épicerie fine" },
  { id: "commerce", label: "Commerce local", examples: "boutique, concept store, commerce de proximité" },
  { id: "cuisiniste", label: "Cuisine & aménagement", examples: "cuisiniste, agencement, intérieur" },
  { id: "design", label: "Design & création", examples: "designer, décoration, création" },
  { id: "loisirs", label: "Loisirs & expérience", examples: "escape game, activité, événement" },
  { id: "hotel", label: "Hôtel, gîte & tourisme", examples: "hôtel, gîte, hébergement" },
  { id: "beaute", label: "Beauté & bien-être", examples: "institut, spa, soins" },
  { id: "paysagiste", label: "Paysage & extérieur", examples: "paysagiste, jardin, terrasse" },
  { id: "artisan", label: "Artisan & entreprise locale", examples: "bâtiment, atelier, savoir-faire" },
  // La communication de l'agence elle-même, traitée comme un dossier client.
  { id: "automobile", label: "Automobile & nettoyage", examples: "nettoyage auto, detailing, préparation esthétique" },
  { id: "lyftt", label: "LYFTT — communication de l’agence", examples: "agence, social media, coulisses" },
];

/*
 * Hashtags de métier, communs à tous les clients d'une même typologie.
 *
 * Aucun n'y porte de nom propre géographique — ni commune, ni département,
 * ni région, ni cours d'eau. Ces listes servent des clients répartis sur des
 * territoires différents : un hashtag de lieu erroné coûte plus qu'il ne
 * rapporte, et « Occitanie » y figurait encore alors qu'il ne dit rien du
 * métier. L'ancrage local, s'il est voulu, passe par les cinq hashtags propres
 * au client, saisis sur sa fiche.
 */
const LYFTT_HASHTAG_PRESETS: Record<LyfttClientType, readonly string[]> = {
  /*
   * Nettoyage et préparation esthétique automobile. Le registre mêle le
   * résultat visible — avant/après, brillance — et la caution technique, les
   * deux ressorts de ce métier sur les réseaux.
   */
  automobile: [
    "#NettoyageAuto", "#LavageAuto", "#Detailing", "#DetailingAuto", "#PreparationEsthetique",
    "#RenovationAuto", "#CarCare", "#AvantApres", "#InterieurImpeccable", "#CarrosserieBrillante",
    "#VoitureCommeNeuve", "#LavageAutoPro", "#SavoirFaire", "#SoinAutomobile", "#CommerceLocal",
  ],
  /*
   * Communication de l'agence. Le registre est différent de celui d'un client :
   * on y parle métier, coulisses et preuve de savoir-faire, à destination des
   * commerçants et artisans qu'on cherche à accompagner.
   */
  lyftt: [
    "#LYFTT", "#AgenceCommunication", "#CommunityManager", "#SocialMedia", "#ReseauxSociaux",
    "#CommunicationDigitale", "#StrategieDeContenu", "#CreationDeContenu", "#PhotographiePro", "#VideoMarketing",
    "#StrategieDigitale", "#IdentiteDeMarque", "#CommerceLocal", "#ConseilEnCommunication", "#SavoirFaire",
  ],
  restaurant: [
    "#Restaurant", "#CuisineDuMarche", "#MenuDuJour", "#CuisineMaison", "#FaitMaison",
    "#ProduitsLocaux", "#BonnesAdresses", "#GastronomieLocale", "#TableGourmande", "#ArtisanDuGout",
    "#Terrasse", "#SortirCeSoir", "#CommerceLocal", "#CuisineDeSaison", "#SavoirFaire",
  ],
  bar: [
    "#Bar", "#Brasserie", "#AmbianceConviviale", "#Afterwork", "#Convivialite",
    "#SortirCeSoir", "#Biere", "#BonnesAdresses", "#Apero", "#Cocktails",
    "#Vins", "#VieLocale", "#CommerceLocal", "#SoireeReussie", "#EntreAmis",
  ],
  boucherie: [
    "#Boucherie", "#BoucherieArtisanale", "#ArtisanBoucher", "#MetiersDeBouche", "#ViandeFrancaise",
    "#ProduitsLocaux", "#CircuitCourt", "#QualiteArtisanale", "#SavoirFaire", "#CommerceLocal",
    "#ViandeMaturee", "#ConseilBoucher", "#GastronomieLocale", "#BoucherieTraditionnelle", "#MangerLocal",
  ],
  commerce: [
    "#CommerceLocal", "#AcheterLocal", "#BoutiqueLocale", "#Commercant", "#Proximite",
    "#EntrepriseLocale", "#CommerceDeProximite", "#SoutienAuxCommercants", "#CommerceIndependant", "#BonnesAdresses",
    "#SavoirFaire", "#ConseilClient", "#VieLocale", "#ShoppingLocal", "#ConsommerLocal",
  ],
  cuisiniste: [
    "#Cuisiniste", "#CuisineSurMesure", "#AgencementInterieur", "#AmenagementInterieur", "#ProjetCuisine",
    "#CuisineDesign", "#Maison", "#DecorationInterieure", "#SavoirFaire", "#Artisan",
    "#CuisineEquipee", "#RenovationCuisine", "#EntrepriseLocale", "#CuisineFonctionnelle", "#InspirationMaison",
  ],
  design: [
    "#Design", "#DesignLocal", "#Creation", "#Decoration", "#Inspiration",
    "#SurMesure", "#SavoirFaire", "#CreateurLocal", "#ArtisanCreateur", "#ProjetUnique",
    "#DesignGraphique", "#IdentiteVisuelle", "#EntrepriseLocale", "#CreationOriginale", "#MadeInFrance",
  ],
  loisirs: [
    "#Loisirs", "#EscapeGame", "#Experience", "#SortieEnFamille", "#SortieEntreAmis",
    "#ActiviteEnFamille", "#JeuDEvasion", "#SortieOriginale", "#IdeeCadeau", "#SortieEnGroupe",
    "#Divertissement", "#TeamBuilding", "#IdeeSortie", "#BonPlanLocal", "#Aventure",
  ],
  hotel: [
    "#Hotel", "#Gite", "#Tourisme", "#SejourEnFrance", "#Hospitalite",
    "#Escapade", "#WeekendEnFrance", "#ExperienceClient", "#SejourAuthentique", "#TourismeLocal",
    "#ChambreAvecVue", "#SejourNature", "#VoyageEnFrance", "#ArtDeVivre", "#BonnesAdresses",
  ],
  beaute: [
    "#InstitutDeBeaute", "#Beaute", "#BienEtre", "#PrendreSoinDeSoi", "#SoinsVisage",
    "#SoinsCorps", "#BeauteNaturelle", "#MomentPourSoi", "#ExpertiseBeaute", "#RituelBeaute",
    "#PeauEclatante", "#Spa", "#Detente", "#CommerceLocal", "#SoinSurMesure",
  ],
  paysagiste: [
    "#Paysagiste", "#AmenagementExterieur", "#Jardin", "#CreationJardin", "#EntretienJardin",
    "#Terrasse", "#EspaceVert", "#JardinSurMesure", "#SavoirFaire", "#Artisan",
    "#JardinPaysager", "#AmenagementPaysager", "#EntrepriseLocale", "#JardinEntretenu", "#InspirationJardin",
  ],
  artisan: [
    "#Artisan", "#ArtisanLocal", "#SavoirFaire", "#FaitMain", "#ArtisanatFrancais",
    "#EntrepriseLocale", "#ArtisanDuCoin", "#QualiteArtisanale", "#ArtisanPassionne", "#Proximite",
    "#TravailBienFait", "#SurMesure", "#Expertise", "#MetierPassion", "#ValorisonsNosArtisans",
  ],
};

export function hashtagsForClientType(clientType: LyfttClientType): string[] {
  return [...LYFTT_HASHTAG_PRESETS[clientType]];
}

/** Nettoie une saisie libre en un hashtag partageable, sans changer son sens. */
export function normalizeHashtag(value: string): string {
  const words = value
    .trim()
    .replace(/^#+/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  if (!words.length) return "";
  return `#${words.map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`).join("")}`;
}

export function buildClientHashtagLibrary(
  clientType: LyfttClientType,
  customHashtags: string[],
): string[] {
  const values = [
    ...hashtagsForClientType(clientType),
    ...customHashtags.map(normalizeHashtag),
  ].filter(Boolean);

  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("fr");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
