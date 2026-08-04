import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Les pièces jointes client sont limitées côté serveur (voir ATTACHMENT_MAX_BYTES).
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [
      {
        // Le portail client est public : on durcit les en-têtes et on interdit l'indexation.
        source: "/client-review/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
