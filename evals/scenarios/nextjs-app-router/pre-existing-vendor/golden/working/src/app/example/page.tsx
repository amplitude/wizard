'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { track } from '@amplitude/unified';

export default function ExamplePage() {
  useEffect(() => {
    track('Page Viewed', { 'page name': 'example' });
  }, []);
  return (
    <div>
      <main>
        <h1>Example</h1>
        <ol>
          <li>
            Go to the <Link href="/">home page</Link>.
          </li>
        </ol>
      </main>
    </div>
  );
}
