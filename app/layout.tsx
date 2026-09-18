import type { Metadata } from "next";
import "../web/styles/globals.css";

export const metadata: Metadata = {
  title: "VX Converter",
  description: "Inspect public media sources and download clean candidates.",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
