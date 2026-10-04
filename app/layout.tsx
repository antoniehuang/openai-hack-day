import type { Metadata } from "next";
import { Cinzel, Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  weight: ["500", "700", "900"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cosplay Mirror · Summoner's Fitting Room",
  description:
    "Pick a League of Legends skin, forge it into a real costume, and wear it live on your webcam.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${cinzel.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
