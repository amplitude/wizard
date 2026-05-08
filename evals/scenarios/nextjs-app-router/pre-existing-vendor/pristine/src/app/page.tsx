'use client';

import Link from 'next/link';
import { track } from '@/lib/amplitude';

export default function Home() {
  return (
    <div>
      <main>
        <h1>Welcome</h1>
        <ol>
          <li>
            Go to the <Link href="/example">example page</Link>.
          </li>
        </ol>

        <div>
          <button
            onClick={() => track('Sign Up', { 'cta location': 'home' })}
          >
            Sign up
          </button>
          <button
            onClick={() => track('Sign In', { 'cta location': 'home' })}
          >
            Sign in
          </button>
        </div>
      </main>
    </div>
  );
}
