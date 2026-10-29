import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents/partialPrefetching are intentionally off for now: almost
  // every page in this app is per-user and session-dependent. Revisit in the
  // polish phase once the data-access patterns have settled.
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  // Static security headers. The CSP (which needs a per-request nonce) is set in proxy.ts.
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      // The app never needs these; denying clipboard-read backs the telemetry notice's promise.
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), clipboard-read=(), payment=(), usb=(), interest-cohort=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
    ];
    return [
      { source: "/:path*", headers: security },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
