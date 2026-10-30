import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moni - Dashboard Vista Land",
  description: "Dashboard internal Moni: leads, jadwal kunjungan, dan stok unit",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
