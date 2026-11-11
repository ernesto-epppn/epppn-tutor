import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans } from "next/font/google";
import ErnestoAccountStorageGuard from "./ErnestoAccountStorageGuard";
import ErnestoUiCleanup from "./ErnestoUiCleanup";
import ErnestoV144Enhancer from "./ErnestoV144Enhancer";
import ErnestoSmartClarification from "./ErnestoSmartClarification";
import ErnestoConversationFocus from "./ErnestoConversationFocus";
import ErnestoComposerPolish from "./ErnestoComposerPolish";
import ErnestoAccessTracker from "./ErnestoAccessTracker";
import ErnestoEpppnGrounding from "./ErnestoEpppnGrounding";
import ErnestoRagUsageTracker from "./ErnestoRagUsageTracker";
import ErnestoFooter from "./ErnestoFooter";
import "./globals.css";
import "./ernesto-v14-3-responsive.css";
import "./ernesto-v14-4.css";
import "./ernesto-v14-5.css";
import "./ernesto-v14-5-2.css";
import "./ernesto-v14-5-3.css";
import "./ernesto-ui-polish.css";
import "./ernesto-context-meter.css";
import "./ernesto-mode-override.css";
import "./ernesto-epppn-grounding.css";
import "./ernesto-followup-cleanup.css";
import "./ernesto-recipe-studio.css";
import "./ernesto-activity-studio.css";
import "./ernesto-commercial-studio.css";
import "./ernesto-workspace-navigation.css";
import "./ernesto-home.css";
import "./ernesto-data-visuals.css";
import "./ernesto-visual-refinement.css";
import "./ernesto-experience-carnet.css";
import "./ernesto-workspace-extension.css";
import "./ernesto-editorial-identity.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ibmPlex = IBM_Plex_Sans({
  variable: "--font-ernesto-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});
const approvedErnestoIcon = "/logo-ernesto-approved.png";

export const viewport: Viewport = {
  themeColor: "#f7f7f4",
};

export const metadata: Metadata = {
  title: "Ernesto — The Pizza Explained",
  applicationName: "Ernesto",
  description: "Tuteur numérique EPPPN pour la pizza, la panification et l’organisation du travail.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Ernesto",
    statusBarStyle: "default",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: approvedErnestoIcon,
    shortcut: approvedErnestoIcon,
    apple: approvedErnestoIcon,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable} ${ibmPlex.variable}`}>
        <ErnestoAccountStorageGuard />
        <ErnestoUiCleanup />
        <ErnestoV144Enhancer />
        <ErnestoSmartClarification />
        <ErnestoConversationFocus />
        <ErnestoComposerPolish />
        <ErnestoAccessTracker />
        <ErnestoEpppnGrounding />
        <ErnestoRagUsageTracker />
        {children}
        <ErnestoFooter />
      </body>
    </html>
  );
}
