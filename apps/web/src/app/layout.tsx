import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VendorLink',
  description: 'One click into any property manager’s approved vendor pool.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
