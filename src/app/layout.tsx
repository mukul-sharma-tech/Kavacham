import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project AETHER | Orbital Insight",
  description: "Autonomous Constellation Manager - National Space Hackathon 2026",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
