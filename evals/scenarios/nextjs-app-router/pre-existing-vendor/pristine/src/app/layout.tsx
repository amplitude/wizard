'use client';

import { useEffect } from 'react';
import { ensureAmplitude } from '@/lib/amplitude';

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    ensureAmplitude();
  }, []);
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
