import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "VX Converter",
  description: "Inspect public media sources and download clean candidates.",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-vx-bg text-vx-text antialiased">{children}</body>
    </html>
  );
}
