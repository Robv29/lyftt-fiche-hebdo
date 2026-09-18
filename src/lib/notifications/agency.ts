/**
 * Identité des messages envoyés aux clients.
 *
 * Les rendez-vous de suivi se prennent dans l'agenda de Théo, et c'est lui qui
 * lit les réponses : un client qui répond à un message automatique doit
 * tomber sur une personne, pas sur l'adresse technique d'envoi. Une seule
 * définition pour tous les envois, sans quoi chaque campagne finirait par
 * répondre à quelqu'un d'autre.
 */
export const AGENCY_REPLY_TO = "theo.simbert@lyftt.fr";
export const AGENCY_DISPLAY_NAME = "Lyftt";
