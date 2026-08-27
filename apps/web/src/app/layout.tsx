import type { Metadata } from 'next';
import './globals.css';
import {
  DirectionProvider,
  SkipToContent,
  ToastProvider,
  ErrorBoundary,
  HydrationProvider,
} from '@/components/ui';

export const metadata: Metadata = {
  title: 'Musaed',
  description: 'Local AI Interface',
  other: {
    'link:preload:jetbrains-mono-bold':
      '<link rel="preload" href="/fonts/jetbrains-mono/JetBrainsMono-Bold.woff2" as="font" type="font/woff2" crossorigin>',
    'link:preload:jetbrains-mono-regular':
      '<link rel="preload" href="/fonts/jetbrains-mono/JetBrainsMono-Regular.woff2" as="font" type="font/woff2" crossorigin>',
    'link:preload:tajawal-regular':
      '<link rel="preload" href="/fonts/tajawal/Tajawal-Regular.ttf" as="font" type="font/ttf" crossorigin>',
    'link:preload:tajawal-bold':
      '<link rel="preload" href="/fonts/tajawal/Tajawal-Bold.ttf" as="font" type="font/ttf" crossorigin>',
  },
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  return (
    <html suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/jetbrains-mono/JetBrainsMono-Bold.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/jetbrains-mono/JetBrainsMono-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/tajawal/Tajawal-Regular.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/tajawal/Tajawal-Bold.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className="bg-background text-foreground flex h-full flex-col overflow-hidden font-sans"
        suppressHydrationWarning
      >
        <SkipToContent />
        <ErrorBoundary>
          <HydrationProvider>
            <DirectionProvider>
              <ToastProvider />
              {children}
            </DirectionProvider>
          </HydrationProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
};

export default RootLayout;
