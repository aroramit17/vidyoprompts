import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Studio — code-driven product films",
  description: "Brief → references → states → deterministic renderer → contact-sheet evidence → package.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
