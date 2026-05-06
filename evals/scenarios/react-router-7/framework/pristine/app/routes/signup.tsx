import { useState } from 'react';
import type { Route } from './+types/signup';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Sign Up - Burrito Consideration App' },
    { name: 'description', content: 'Create a new account' },
  ];
}

export default function Signup() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: hook this up to a real auth backend.
  };

  return (
    <main>
      <h1>Create your account</h1>
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
        <button type="submit">Sign up</button>
      </form>
    </main>
  );
}
