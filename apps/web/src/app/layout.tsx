import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { brand } from '@pulsegrid/config';
import { QueryProvider } from '@/lib/query';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: { default: `${brand.productName} — ${brand.tagline}`, template: `%s · ${brand.productName}` },
  description: brand.metaDescription,
  icons: [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
