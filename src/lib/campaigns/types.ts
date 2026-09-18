/** Résultat d'une campagne d'e-mails, rendu tel quel par la tâche planifiée. */
export interface CampaignRun {
  campaign: string;
  /** Code HTTP qui résume la campagne : 200, 500 (lecture), 502 (envoi), 503 (messagerie absente). */
  status: number;
  body: Record<string, unknown>;
}
