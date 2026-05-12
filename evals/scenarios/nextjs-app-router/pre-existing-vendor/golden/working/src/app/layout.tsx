import type { Metadata } from 'next';
import { AmplitudeProvider } from './AmplitudeProvider';

export const metadata: Metadata = {
  title: 'Pre-existing Vendor Migration',
  description: 'Wizard-migrated app',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AmplitudeProvider>{children}</AmplitudeProvider>
      </body>
    </html>
  );
}
