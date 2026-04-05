import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BankFlow",
  description: "Personal and group budget tracking with Google Sheets sync",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
