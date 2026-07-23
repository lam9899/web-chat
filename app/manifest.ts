import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Talk Cùng Lâm DZ",
    short_name: "Talk Lâm DZ",
    description:
      "Nền tảng trò chuyện cộng đồng theo thời gian thực.",
    start_url: "/",
    display: "standalone",
    background_color: "#1e1f22",
    theme_color: "#5865f2",
    lang: "vi",
    icons: [
      {
        src: "/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}