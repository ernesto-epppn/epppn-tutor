import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ErnestoUiCleanup from "./ErnestoUiCleanup";
import ErnestoV144Enhancer from "./ErnestoV144Enhancer";
import ErnestoSmartClarification from "./ErnestoSmartClarification";
import ErnestoConversationFocus from "./ErnestoConversationFocus";
import "./globals.css";
import "./ernesto-v14-3-responsive.css";
import "./ernesto-v14-4.css";
import "./ernesto-v14-5.css";
import "./ernesto-v14-5-2.css";
import "./ernesto-v14-5-3.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ernesto — The Pizza Explained",
  description: "Tuteur numérique EPPPN pour la pizza, la panification et l’organisation du travail.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ErnestoUiCleanup />
        <ErnestoV144Enhancer />
        <ErnestoSmartClarification />
        <ErnestoConversationFocus />
        {children}
      </body>
    </html>
  );
}
