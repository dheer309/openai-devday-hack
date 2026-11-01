import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Foldable AI — A little character. A real-world companion.",
  description: "Turn a description or pet reference into a personalised paper companion. Preview the exact printable model and export a numbered A4 paper net.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
