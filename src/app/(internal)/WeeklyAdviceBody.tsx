import {
  ADVICE_NOTHING_TO_SAY,
  type WeeklyAdviceEntry,
  type WeeklyAdviceView,
} from "@/lib/domain/weekly-advice";

/**
 * Le corps des conseils de la semaine, sans coquille.
 *
 * Aucune directive : le même composant sert la pop-up (module client) et
 * l'onglet Conseils (composant serveur). Rien ici ne lit la base, ne tient
 * d'état et n'écoute le clavier — tout le contenu arrive en propriétés, déjà
 * calculé par la tâche du lundi et déjà résolu par la lecture sous RLS. C'est
 * ce qui permet de l'afficher aux deux endroits sans écrire deux fois les mêmes
 * phrases, et sans qu'un des deux dérive.
 */

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "long", timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * Les dossiers d'un conseil, nommés.
 *
 * Ceux que la personne ne peut pas voir sont comptés et non nommés : la ligne
 * en base ne porte que des identifiants, et `can_access_client` décide du
 * reste. Sans ce repli, un community manager lirait « 4 dossiers » et n'en
 * verrait que deux, sans savoir si les deux autres existent.
 */
function ClientList({ advice }: { advice: WeeklyAdviceEntry }) {
  if (advice.clients.length === 0 && advice.hiddenClients === 0) return null;
  const named = advice.clients.map((client) =>
    client.count > 1 ? `${client.label} ${client.count}` : client.label);
  const hidden = advice.hiddenClients > 0
    ? [`et ${advice.hiddenClients} autre${advice.hiddenClients > 1 ? "s" : ""} dossier${advice.hiddenClients > 1 ? "s" : ""}`]
    : [];
  return (
    <p className="mt-1.5 text-xs text-ink-faint">
      {[...named, ...hidden].join(" · ")}
    </p>
  );
}

export function WeeklyAdviceBody({ advice }: { advice: WeeklyAdviceView }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-faint">
        {/*
          La note et l'objectif côte à côte : un score nu ne se corrige pas, et
          l'écart est précisément ce que les conseils en dessous expliquent.
          Les gains ne sont pas additionnés — les mesures déjà au-dessus de
          l'objectif ne sont pas écrêtées, et la somme promettrait plus que
          l'écart réel.
        */}
        {advice.score === null
          ? "Pas encore assez de données pour noter la semaine."
          : `Note ${advice.score} / ${advice.target} visé`}
        {" · "}
        mesuré depuis le {dayLabel(advice.windowSince)}
      </p>

      {advice.advices.length === 0 ? (
        <p className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-ink-soft">
          {ADVICE_NOTHING_TO_SAY}
        </p>
      ) : (
        <ol className="space-y-3">
          {advice.advices.map((item, index) => (
            <li key={item.key} className="rounded-2xl border border-line bg-canvas px-4 py-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e8f2ff] text-[11px] font-bold text-[#0b4f88]"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug">{item.statement}</p>
                  <p className="mt-1 text-sm text-ink-soft">{item.action}</p>
                  <ClientList advice={item}/>
                </div>
                {/* Ce que la mesure rapporte, quand elle est adossée au score. */}
                {item.gain !== null && item.gain > 0 && (
                  <span className="badge shrink-0 bg-[#e8f2ff] text-[#0b4f88]">+{item.gain} pts</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
