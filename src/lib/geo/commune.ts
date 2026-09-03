/**
 * Extraction de la commune à géocoder depuis une saisie libre.
 *
 * Pur et sans dépendance serveur, pour être éprouvé par des tests : c'est la
 * partie du géocodage qui se trompe en silence. Une commune mal découpée ne
 * lève aucune erreur — elle place simplement le point ailleurs, ou nulle part.
 */

/*
 * Une fiche porte parfois plusieurs villes : « MONT DE MARSAN ET DAX »,
 * « MARSEILLE, NICE, BORDEAUX ET LYON ». On retient la première, celle du
 * siège, pour n'avoir qu'un point par client.
 *
 * Le « et » ne compte que séparé par des espaces. Écrit sans, il appartient au
 * nom : la France compte des centaines de communes en « -et- » — Val-et-
 * Châtillon, Saint-Germain-et-Mons, Villers-Chemin-et-Mont-lès-Étrelles. Une
 * première version coupait dessus et cherchait « Val- », qui n'existe pas.
 */
const SEPARATORS = /\s*[,/]\s*|\s+et\s+/i;

export function primaryCommune(city: string | null | undefined): string {
  return (city ?? "").split(SEPARATORS)[0]?.trim() ?? "";
}
