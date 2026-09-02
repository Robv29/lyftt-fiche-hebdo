import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BrandLogo } from "@/components/BrandLogo";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; erreur?: string }>;
}) {
  const { next, erreur } = await searchParams;

  async function signIn(formData: FormData) {
    "use server";

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });

    if (error) redirect("/login?erreur=1");
    redirect(String(formData.get("next") || "/"));
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#edf3f9] px-4 py-10 sm:px-6">
      <section className="arrive w-full max-w-[420px] rounded-[26px] border border-white bg-white p-6 shadow-[0_28px_70px_rgba(36,76,116,.13)] sm:p-8" aria-labelledby="login-title">
      <BrandLogo variant="ink" className="w-[112px]" priority />
      <p className="mt-8 text-[11px] font-bold uppercase tracking-[.14em] text-ink-faint">Espace équipe</p>
      <h1 id="login-title" className="mt-1 text-2xl font-semibold tracking-[-.03em]">Heureux de vous revoir</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">Connectez-vous pour retrouver la production et les validations de la semaine.</p>

      {erreur && (
        <p role="alert" className="mt-5 rounded-xl border border-state-changes/30 bg-state-changes/5 px-4 py-3 text-sm text-state-changes">
          {/*
            Un lien d'invitation ne sert qu'une fois : dire « identifiants
            incorrects » enverrait la personne chercher une faute de frappe
            dans un mot de passe qu'elle n'a pas encore choisi.
          */}
          {erreur === "invitation"
            ? "Ce lien d’invitation a déjà servi ou n’est plus valide. Demandez-en un nouveau."
            : "Identifiants incorrects."}
        </p>
      )}

      <form action={signIn} className="mt-7 space-y-4">
        <input type="hidden" name="next" value={next ?? "/"} />
        <div>
          <label className="label" htmlFor="email">
            E-mail
          </label>
          <input id="email" name="email" type="email" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="field"
          />
        </div>
        <button type="submit" className="btn-primary mt-2 w-full">
          Se connecter
        </button>
      </form>
      <p className="mt-6 text-center text-[11px] text-ink-faint">Accès réservé à l’équipe LYFTT</p>
      </section>
    </main>
  );
}
