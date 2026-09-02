import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BrandLogo } from "@/components/BrandLogo";

/**
 * Choix du mot de passe après une invitation.
 *
 * Hors de l'espace équipe : la navigation et le profil n'ont pas à s'afficher
 * avant que le compte soit utilisable.
 */

/** Longueur minimale, alignée sur le réglage par défaut de Supabase. */
const MIN_LENGTH = 8;

export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { erreur } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Sans session, le lien n'a pas été suivi — ou il a déjà servi.
  if (!user) redirect("/login?erreur=invitation");

  async function setPassword(formData: FormData) {
    "use server";

    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    if (password.length < MIN_LENGTH) redirect("/nouveau-mot-de-passe?erreur=court");
    if (password !== confirmation) redirect("/nouveau-mot-de-passe?erreur=different");

    const client = await createSupabaseServerClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) redirect("/nouveau-mot-de-passe?erreur=refus");

    redirect("/");
  }

  const messages: Record<string, string> = {
    court: `Le mot de passe doit faire au moins ${MIN_LENGTH} caractères.`,
    different: "Les deux saisies ne correspondent pas.",
    refus: "Mot de passe refusé. Choisissez-en un autre.",
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#edf3f9] px-4 py-10 sm:px-6">
      <section
        className="arrive w-full max-w-[420px] rounded-[26px] border border-white bg-white p-6 shadow-[0_28px_70px_rgba(36,76,116,.13)] sm:p-8"
        aria-labelledby="password-title"
      >
        <BrandLogo variant="ink" className="w-[112px]" priority />
        <p className="mt-8 text-[11px] font-bold uppercase tracking-[.14em] text-ink-faint">Espace équipe</p>
        <h1 id="password-title" className="mt-1 text-2xl font-semibold tracking-[-.03em]">Choisissez votre mot de passe</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Vous êtes connecté en tant que {user.email}. Ce mot de passe vous servira à chaque connexion.
        </p>

        {erreur && messages[erreur] && (
          <p role="alert" className="mt-5 rounded-xl border border-state-changes/30 bg-state-changes/5 px-4 py-3 text-sm text-state-changes">
            {messages[erreur]}
          </p>
        )}

        <form action={setPassword} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="password">Mot de passe</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={MIN_LENGTH}
              autoComplete="new-password"
              className="field"
            />
            <p className="mt-1 text-xs text-ink-faint">{MIN_LENGTH} caractères au minimum.</p>
          </div>
          <div>
            <label className="label" htmlFor="confirmation">Confirmation</label>
            <input
              id="confirmation"
              name="confirmation"
              type="password"
              required
              minLength={MIN_LENGTH}
              autoComplete="new-password"
              className="field"
            />
          </div>
          <button type="submit" className="btn-primary mt-2 w-full">Enregistrer et entrer</button>
        </form>
      </section>
    </main>
  );
}
