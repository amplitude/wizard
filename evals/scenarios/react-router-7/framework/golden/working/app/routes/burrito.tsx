import { useState } from 'react';
import { track } from '@amplitude/unified';
import type { Route } from './+types/burrito';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Burrito Consideration - Burrito Consideration App' },
    { name: 'description', content: 'Consider the potential of burritos' },
  ];
}

export default function BurritoPage() {
  const [count, setCount] = useState(0);

  const handleConsideration = () => {
    const next = count + 1;
    setCount(next);
    track('Burrito Considered', { 'consideration count': next });
  };

  return (
    <main>
      <h1>Burrito consideration zone</h1>
      <p>Take a moment to truly consider the potential of burritos.</p>
      <button onClick={handleConsideration}>
        I have considered the burrito potential
      </button>
      <p>Count: {count}</p>
    </main>
  );
}
