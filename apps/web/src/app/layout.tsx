import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./surfaces.css";

export const metadata: Metadata = {
  title: "Baron",
  description: "Buy with a sentence. Pay with a rule.",
  icons: { icon: "/baron-logo.png", apple: "/baron-logo.png" },
};

/**
 * The root layout stays surface-neutral. Each half of the product sets its own
 * `data-surface`, so the customer store and the merchant console can diverge
 * visually without fighting each other's tokens.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
