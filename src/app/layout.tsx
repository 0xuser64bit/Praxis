import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
export const metadata: Metadata = {
  title: "Better Wallet",
  description: "A better wallet for the crypto space",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Providers>
      <html lang="en">
        <body
          className={`${poppins.className} min-h-screen bg-gradient-to-br from-gray-900 to-black text-white antialiased`}
        >
          {children}
        </body>
      </html>
    </Providers>
  );
}
