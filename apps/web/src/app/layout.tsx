import type { Metadata } from 'next';
import './globals.css';
import { DirectionProvider, ToastProvider, ErrorBoundary } from '../components/ui';

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
