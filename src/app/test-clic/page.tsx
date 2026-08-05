import { ClicProbe } from "./ClicProbe";

/**
 * Page de diagnostic d'interactivité — temporaire.
 *
 * Publique et volontairement sans mise en page ni CSS applicatif : si les
 * boutons répondent ici mais pas dans l'application, le problème vient du
 * style ou de la session ; s'ils ne répondent pas ici non plus, c'est que le
 * JavaScript ne s'exécute pas dans le navigateur (hydratation, cache, blocage).
 */
export const dynamic = "force-dynamic";

export default function TestClicPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>Test d&apos;interactivité</h1>
      <p style={{ color: "#555", fontSize: 14 }}>
        Cette page n&apos;utilise ni la navigation, ni les styles de
        l&apos;application, ni votre session.
      </p>
      <ClicProbe />
    </main>
  );
}
