import type { Metadata } from "next";
import { Space_Grotesk, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { TopNav } from "@/components/top-nav";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MerxyLab",
  description: "Local-first learning platform MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {`(() => {
              try {
                const key = "merxylab_theme";
                const saved = localStorage.getItem(key);
                const theme = saved === "dark" || saved === "light"
                  ? saved
                  : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
                document.documentElement.setAttribute("data-theme", theme);
              } catch {}
            })();`}
        </Script>
      </head>
      <body
        className={`${spaceGrotesk.variable} ${sourceSerif.variable} antialiased`}
      >
        <TopNav />
        {children}
      </body>
    </html>
  );
}
