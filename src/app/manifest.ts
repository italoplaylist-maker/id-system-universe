import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ID System Universe",
    short_name: "Universe",
    description: "Central de comando da infraestrutura e dos agentes Claude.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0c10",
    theme_color: "#0a0c10",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
