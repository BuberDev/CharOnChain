import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pakiety workspace dostarczane jako źródła TypeScript.
  transpilePackages: ["@charonchain/ui", "@charonchain/shared"],
  // Next wymaga funkcji asynchronicznej (zwraca Promise); brak `await` jest zamierzony.
  redirects: () => Promise.resolve([{ source: "/", destination: "/pl", permanent: false }]),
};

export default config;
