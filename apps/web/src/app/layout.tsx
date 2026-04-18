import type { Metadata } from "next";
import "./globals.css";
import { DirectionProvider, ToastProvider, ErrorBoundary } from "../features/layout";

export const metadata: Metadata = {
  title: "Musaed",
  description: "Local AI Interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body className="h-full flex flex-col overflow-hidden bg-background text-foreground font-sans" suppressHydrationWarning>
        <ErrorBoundary>
          <DirectionProvider>
            <ToastProvider />
            {children}
          </DirectionProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}