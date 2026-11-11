import type { Metadata, Viewport } from "next";
import { satoshi, sentient, zodiak } from "@ui";
import "../ui/styles/globals.css";

export const metadata: Metadata = {
  title: "Soccer Substitution Manager",
  description:
    "Soccer Substitution Manager — youth soccer substitution manager for a 13-player 7v7 team.",
  // Relative paths (not "/...") so these resolve under the preview
  // subfolder /preview/prism/ as well as at the site root: Next does not
  // prefix metadata manifest/icon URLs with basePath.
  manifest: "manifest.webmanifest",
  icons: {
    icon: "icon-192.png",
    apple: "icon-180.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

// Locked viewport (no double-tap zoom on the sideline) + dark theme color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#242424",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${satoshi.variable} ${sentient.variable} ${zodiak.variable} dark`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
