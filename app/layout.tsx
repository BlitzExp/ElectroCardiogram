import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);

  return {
    metadataBase: baseUrl,
    title: "CardioScope — ECG Monitor",
    description: "A real-time USB serial electrocardiogram signal monitor.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "CardioScope — ECG Monitor",
      description: "Monitor newline-delimited ECG samples from an ESP32 over USB serial.",
      images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1731, height: 909, alt: "CardioScope real-time ECG monitor" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "CardioScope — ECG Monitor",
      description: "Monitor newline-delimited ECG samples from an ESP32 over USB serial.",
      images: [new URL("/og.png", baseUrl).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
