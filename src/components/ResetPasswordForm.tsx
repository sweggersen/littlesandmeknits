import { useState, type FormEvent } from 'react';
import { createBrowserSupabase } from '../lib/supabase';

export default function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Passordet må være minst 8 tegn.');
    if (password !== confirm) return setError('Passordene stemmer ikke overens.');
    setStatus('saving');
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;
      setStatus('done');
      setTimeout(() => { window.location.href = '/studio'; }, 1500);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Kunne ikke oppdatere passordet.');
    }
  }

  if (status === 'done') {
    return (
      <div className="text-center py-6">
        <div className="w-12 h-12 rounded-full bg-sage-100 mx-auto mb-5 flex items-center justify-center text-sage-700 text-xl">✓</div>
        <h2 className="font-serif text-2xl mb-2">Passord oppdatert</h2>
        <p className="text-charcoal/60 text-sm">Tar deg videre …</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="block text-xs font-medium uppercase tracking-wider text-charcoal/50 mb-2">Nytt passord</span>
        <input
          type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password" disabled={status === 'saving'}
          className="w-full bg-white rounded-2xl px-5 py-3 text-base border border-sage-500/20 focus:outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 disabled:opacity-50"
        />
        <span className="block text-xs text-charcoal/45 mt-1.5">Minst 8 tegn.</span>
      </label>
      <label className="block">
        <span className="block text-xs font-medium uppercase tracking-wider text-charcoal/50 mb-2">Bekreft passord</span>
        <input
          type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password" disabled={status === 'saving'}
          className="w-full bg-white rounded-2xl px-5 py-3 text-base border border-sage-500/20 focus:outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 disabled:opacity-50"
        />
      </label>
      <button type="submit" disabled={status === 'saving'}
        className="w-full bg-charcoal text-linen py-3 rounded-2xl font-medium hover:bg-terracotta-500 transition-colors disabled:opacity-50">
        {status === 'saving' ? 'Lagrer …' : 'Lagre nytt passord'}
      </button>
      {error && <p className="text-sm text-terracotta-700 text-center">{error}</p>}
    </form>
  );
}
