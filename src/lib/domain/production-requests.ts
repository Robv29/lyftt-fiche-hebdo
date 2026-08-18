/**
 * Ponctualité des commandes de production internes.
 *
 * Une commande interne porte une date limite convenue entre collègues. Tenir
 * cette date est ce qui permet au community manager de préparer sa fiche à
 * temps ; la manquer décale toute la semaine, sans que rien ne le signale
 * aujourd'hui. L'indicateur mesure donc ce qui a été **livré**, à la date de
 * livraison — pas ce qui traîne encore, qui se lit sur l'écran de production.
 */

export interface DeliveredRequest {
  /** Date limite convenue à la commande. */
  dueOn: string;
  /** Instant de la livraison du fichier. */
  deliveredAt: string;
}

export interface ProductionPunctuality {
  /** Part des commandes livrées dans les temps, en pourcentage. Null sans livraison. */
  percentage: number | null;
  delivered: number;
  onTime: number;
  late: number;
  /** Retard moyen des livraisons en retard, en jours. Null s'il n'y en a aucune. */
  averageDelayDays: number | null;
}

/**
 * Une livraison est à l'heure jusqu'à la fin du jour de l'échéance.
 *
 * L'échéance est une date, pas un instant : livrer à 18 h le jour dit, c'est
 * tenir sa parole. Comparer à minuit aurait compté en retard presque toutes
 * les livraisons du dernier jour.
 */
export function productionPunctuality(
  requests: readonly DeliveredRequest[],
): ProductionPunctuality {
  const delivered = requests.length;
  if (delivered === 0) {
    return { percentage: null, delivered: 0, onTime: 0, late: 0, averageDelayDays: null };
  }

  const delays = requests.map((request) => {
    const deadline = new Date(`${request.dueOn}T23:59:59Z`).getTime();
    const done = new Date(request.deliveredAt).getTime();
    return (done - deadline) / 86_400_000;
  });

  const lateDelays = delays.filter((delay) => delay > 0);
  const onTime = delivered - lateDelays.length;

  return {
    percentage: Math.round((onTime / delivered) * 100),
    delivered,
    onTime,
    late: lateDelays.length,
    averageDelayDays: lateDelays.length === 0
      ? null
      : Math.round((lateDelays.reduce((total, delay) => total + delay, 0) / lateDelays.length) * 10) / 10,
  };
}
