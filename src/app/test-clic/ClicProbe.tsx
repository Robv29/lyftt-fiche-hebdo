"use client";

import { useEffect, useState } from "react";

/**
 * Trois signaux, dans l'ordre où ils échouent en général :
 *  1. l'hydratation a-t-elle eu lieu (React s'est-il attaché au HTML) ;
 *  2. un gestionnaire React reçoit-il le clic ;
 *  3. un écouteur DOM natif le reçoit-il — s'il est le seul à répondre,
 *     c'est React qui n'a pas démarré, pas le navigateur qui bloque.
 */
export function ClicProbe() {
  const [hydrated, setHydrated] = useState(false);
  const [reactClicks, setReactClicks] = useState(0);
  const [nativeClicks, setNativeClicks] = useState(0);
  const [details, setDetails] = useState("");

  useEffect(() => {
    setHydrated(true);
    setDetails(
      [
        `Navigateur : ${navigator.userAgent}`,
        `Largeur : ${window.innerWidth} px`,
        `Zoom/densité : ${window.devicePixelRatio}`,
        `Cookies activés : ${navigator.cookieEnabled ? "oui" : "NON"}`,
      ].join("\n"),
    );

    const onNative = () => setNativeClicks((count) => count + 1);
    document.getElementById("sonde-native")?.addEventListener("click", onNative);
    return () =>
      document.getElementById("sonde-native")?.removeEventListener("click", onNative);
  }, []);

  const line = (label: string, value: string, ok: boolean) => (
    <p style={{ margin: "6px 0", fontSize: 15 }}>
      <span style={{ color: ok ? "#1c7c54" : "#b4451f", fontWeight: 700 }}>
        {ok ? "✔" : "✘"}
      </span>{" "}
      {label} : <strong>{value}</strong>
    </p>
  );

  return (
    <section style={{ marginTop: 20 }}>
      {line("JavaScript exécuté (hydratation)", hydrated ? "oui" : "NON", hydrated)}
      {line("Clics reçus par React", String(reactClicks), reactClicks > 0)}
      {line("Clics reçus nativement", String(nativeClicks), nativeClicks > 0)}

      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setReactClicks((count) => count + 1)}
          style={{
            padding: "14px 20px", fontSize: 16, borderRadius: 8,
            border: "none", background: "#2563eb", color: "#fff", cursor: "pointer",
          }}
        >
          Bouton React
        </button>

        <button
          id="sonde-native"
          type="button"
          style={{
            padding: "14px 20px", fontSize: 16, borderRadius: 8,
            border: "1px solid #999", background: "#fff", cursor: "pointer",
          }}
        >
          Bouton natif
        </button>

        <a
          href="/test-clic?relance=1"
          style={{
            padding: "14px 20px", fontSize: 16, borderRadius: 8,
            border: "1px solid #999", textDecoration: "none", color: "#111",
          }}
        >
          Lien simple
        </a>
      </div>

      <pre
        style={{
          marginTop: 20, padding: 12, background: "#f4f4f5", borderRadius: 8,
          fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}
      >
        {details || "…"}
      </pre>
    </section>
  );
}
