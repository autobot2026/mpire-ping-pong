import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mpire Ping Pong",
  description: "3D Ping Pong Game",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ background: "#000", width: "100vw", height: "100vh", overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
