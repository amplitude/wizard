import { useState } from 'react';
import { Link } from 'react-router';
import { track } from '@amplitude/unified';
import type { Route } from './+types/home';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Burrito Consideration App' },
    { name: 'description', content: 'Consider the potential of burritos' },
  ];
}

export default function Home() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Track sign-in attempts at the form-submit boundary, not in
    // useEffect — the skill explicitly forbids effect-driven tracking.
    track('Sign In Submitted', { 'has password': password.length > 0 });
    // TODO: hook this up to a real auth backend.
  };

  return (
    <main>
      <h1>Welcome to the Burrito Consideration App</h1>
      <p>Sign in to begin your burrito journey, or sign up if new.</p>

      <form onSubmit={handleSubmit}>
        <label>
          Username:
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Password:
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit">Sign in</button>
      </form>

      <p>
        New here? <Link to="/signup">Create an account</Link>.
      </p>
    </main>
  );
}
