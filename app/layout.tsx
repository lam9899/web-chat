import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://talkcunglamdz.vercel.app"),
  title: {
    default: "Talk Cùng Lâm DZ",
    template: "%s | Talk Cùng Lâm DZ",
  },
  description:
    "Nền tảng trò chuyện cộng đồng theo thời gian thực.",
  applicationName: "Talk Cùng Lâm DZ",
  openGraph: {
    title: "Talk Cùng Lâm DZ",
    description:
      "Nền tảng trò chuyện cộng đồng theo thời gian thực.",
    url: "https://talkcunglamdz.vercel.app",
    siteName: "Talk Cùng Lâm DZ",
    locale: "vi_VN",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}