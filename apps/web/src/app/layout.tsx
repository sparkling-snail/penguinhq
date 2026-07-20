import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PenguinHQ",
  description: "An interactive AI operating system — your AI agents live in a virtual office.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
