import type { Metadata } from 'next';
import './globals.css';
import { DirectionProvider, SkipToContent, ToastProvider, ErrorBoundary } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Musaed',
  description: 'Local AI Interface',
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  return (
    <html suppressHydrationWarning>
      <body
        className="bg-background text-foreground flex h-full flex-col overflow-hidden font-sans"
        suppressHydrationWarning
      >
        <SkipToContent />
        <ErrorBoundary>
          <DirectionProvider>
            <ToastProvider />
            {children}
          </DirectionProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
};

export default RootLayout;
