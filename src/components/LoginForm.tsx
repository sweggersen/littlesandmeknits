import { useState, type FormEvent } from 'react';
import { createBrowserSupabase } from '../lib/supabase';

interface Strings {
  emailLabel: string;
  emailPlaceholder: string;
  magicLinkCta: string;
  divider: string;
  google: string;
  successHeading: string;
  successBody: string;
  errorGeneric: string;
  loading: string;
}

interface Props {
  redirectTo: string;
  strings: Strings;
}

export default function LoginForm({ redirectTo, strings }: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );
  const [error, setError] = useState<string | null>(null);

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`,
        },
      });
      if (authError) throw authError;
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : strings.errorGeneric);
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`,
        },
      });
      if (authError) throw authError;
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : strings.errorGeneric);
    }
  }

  if (status === 'sent') {
    return (
      <div className="text-center py-6">
        <div className="w-12 h-12 rounded-full bg-sage-100 mx-auto mb-5 flex items-center justify-center text-sage-700 text-xl">
          ✓
        </div>
        <h2 className="font-serif text-2xl mb-2">{strings.successHeading}</h2>
        <p className="text-charcoal/60 text-sm">{strings.successBody}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleMagicLink} className="space-y-3">
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wider text-charcoal/50 mb-2">
            {strings.emailLabel}
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={strings.emailPlaceholder}
            disabled={status === 'sending'}
            className="w-full bg-white rounded-2xl px-5 py-3 text-base placeholder:text-charcoal/40 border border-sage-500/20 focus:outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 disabled:opacity-50"
          />
        </label>
        <button
          type="submit"
          disabled={status === 'sending' || !email}
          className="w-full bg-charcoal text-linen py-3 rounded-2xl font-medium hover:bg-terracotta-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'sending' ? strings.loading : strings.magicLinkCta}
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-charcoal/40">
        <div className="flex-1 h-px bg-sage-500/15" />
        <span>{strings.divider}</span>
        <div className="flex-1 h-px bg-sage-500/15" />
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        className="w-full flex items-center justify-center gap-3 bg-white border border-sage-500/20 py-3 rounded-2xl font-medium text-charcoal hover:border-charcoal/40 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" />
        </svg>
        {strings.google}
      </button>

      {error && (
        <p className="text-sm text-terracotta-700 text-center">{error}</p>
      )}
    </div>
  );
}
