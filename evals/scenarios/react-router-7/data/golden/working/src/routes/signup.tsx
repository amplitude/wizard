import { useState } from 'react';
import { track } from '@amplitude/unified';

export function SignUp() {
  const [email, setEmail] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    track('Sign Up Submitted', { 'has email': email.length > 0 });
  }

  return (
    <main>
      <h1>Sign up</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email"
        />
        <button type="submit">Sign up</button>
      </form>
    </main>
  );
}
