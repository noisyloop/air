import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../stores/auth';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-surface-0 p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-6 rounded-2xl border border-surface-2 bg-surface-1 p-8"
      >
        <div className="text-center">
          <div className="text-2xl font-black">
            <span className="text-accent">◉</span> air
          </div>
          <h1 className="mt-2 text-lg font-bold">{title}</h1>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

const inputClass =
  'w-full rounded-lg bg-surface-2 px-4 py-2.5 text-sm outline-none ring-accent/50 placeholder:text-ink-muted focus:ring-2';

export function Login() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back">
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={busy} className="w-full rounded-full bg-accent py-2.5 font-semibold text-white disabled:opacity-50">
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="text-center text-sm text-ink-muted">
        No account?{' '}
        <Link to="/register" className="text-accent hover:underline">
          Sign up
        </Link>
      </p>
      <p className="rounded-lg bg-surface-2 p-3 text-xs text-ink-muted">
        Demo: <code>listener@air.local</code> · <code>artist@air.local</code> · <code>admin@air.local</code> — password{' '}
        <code>password123</code>
      </p>
    </AuthShell>
  );
}

export function Register() {
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, password, displayName);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account">
      <form onSubmit={submit} className="space-y-3">
        <input required minLength={2} placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={busy} className="w-full rounded-full bg-accent py-2.5 font-semibold text-white disabled:opacity-50">
          {busy ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p className="text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link to="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
