import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LYFTT — Fiche hebdomadaire",
  description: "Planning éditorial et validation client",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
