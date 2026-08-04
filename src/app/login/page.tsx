import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <span className="mb-8 text-2xl font-bold tracking-tight">lyftt.</span>
      <h1 className="text-lg font-semibold">Connexion</h1>

      {erreur && (
        <p className="mt-3 rounded-md border border-state-changes/30 bg-state-changes/5 px-3 py-2 text-sm text-state-changes">
          Identifiants incorrects.
        </p>
      )}

      <form action={signIn} className="mt-6 space-y-4">
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
        <button type="submit" className="btn-primary w-full">
          Se connecter
        </button>
      </form>
    </main>
  );
}
