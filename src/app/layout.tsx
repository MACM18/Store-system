import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Store management",
  description: "A clear daily view of your store's cash, sales, and stock.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
