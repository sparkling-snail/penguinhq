import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "PenguinHQ",
  title: {
    default: "PenguinHQ — A multi-agent AI system you can watch",
    template: "%s · PenguinHQ",
  },
  description:
    "Watch four autonomous AI agents coordinate jobs, research, interview practice, and portfolio work inside a live virtual office.",
  keywords: [
    "multi-agent AI",
    "autonomous agents",
    "FastAPI",
    "Next.js",
    "WebSockets",
    "Model Context Protocol",
    "software engineering portfolio",
  ],
  creator: "PenguinHQ",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "PenguinHQ",
    title: "PenguinHQ — A multi-agent AI system you can watch",
    description:
      "Four autonomous AI agents coordinate through a real-time virtual office backed by FastAPI, PostgreSQL, Redis, and WebSockets.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "PenguinHQ — a multi-agent AI system you can watch",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PenguinHQ — A multi-agent AI system you can watch",
    description: "Four autonomous AI agents working together in a live virtual office.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b1120",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "PenguinHQ",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description: metadata.description,
    url: siteUrl.toString(),
    codeRepository: "https://github.com/sparkling-snail/penguinhq",
  };

  return (
    <html lang="en" className="dark">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
