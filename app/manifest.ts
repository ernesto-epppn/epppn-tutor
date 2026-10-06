import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ernesto — The Pizza Explained",
    short_name: "Ernesto",
    description:
      "Tuteur numérique EPPPN pour la pizza, la panification et l’organisation du travail.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffaf5",
    theme_color: "#fffaf5",
    icons: [
      {
        src: "/logo-ernesto-approved.png",
        sizes: "any",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
