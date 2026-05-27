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

type Mode = 'magic' | 'password';
type PwSubmode = 'signin' | 'signup';

export default function LoginForm({ redirectTo, strings }: Props) {
  const [mode, setMode] = useState<Mode>('magic');
  const [pwSubmode, setPwSubmode] = useState<PwSubmode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Signup-only fields — collected on the password-signup path.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  // Marketing default-on per product decision; user can untick before
  // submit, or unsubscribe later from Innstillinger.
  const [marketingOk, setMarketingOk] = useState(true);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error' | 'reset_sent'>(
    'idle'
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Magic link is used for both new + returning users (Supabase auto-creates
  // on first link). Password-signup is the only path we force first/last
  // name on — keeps magic-link a one-tap experience for returners.
  const isPasswordSignup = mode === 'password' && pwSubmode === 'signup';
  // Magic-link still needs the age/terms gate before we send the email,
  // since it might create an account.
  const requiresConsent = mode === 'magic' || isPasswordSignup;
  const consentReady = !requiresConsent
    || (ageOk && termsOk && (!isPasswordSignup || (firstName.trim() && lastName.trim())));

  function signupMetadata() {
    const now = new Date().toISOString();
    const first = firstName.trim();
    const last = lastName.trim();
    return {
      age_confirmed_at: now,
      tos_accepted_at: now,
      // Only set name fields when the user actually filled them in
      // (password-signup path). Undefined keys are dropped by Supabase.
      first_name: first || undefined,
      last_name: last || undefined,
      display_name: first || last ? `${first} ${last}`.trim() : undefined,
      marketing_consent_at: marketingOk ? now : null,
    };
  }

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault();
    if (!consentReady) return setError('Du må bekrefte aldersgrensen, godta vilkårene og fylle inn navn for å opprette konto.');
    setStatus('sending'); setError(null); setInfo(null);
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`,
          data: signupMetadata(),
        },
      });
      if (authError) throw authError;
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : strings.errorGeneric);
    }
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    if (!consentReady) return setError('Du må bekrefte aldersgrensen, godta vilkårene og fylle inn navn for å opprette konto.');
    setStatus('sending'); setError(null); setInfo(null);
    try {
      const supabase = createBrowserSupabase();
      if (pwSubmode === 'signup') {
        const { error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`,
            data: signupMetadata(),
          },
        });
        if (authError) throw authError;
        setStatus('sent');
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        window.location.href = redirectTo;
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : strings.errorGeneric);
    }
  }

  async function handleForgotPassword() {
    if (!email) return setError('Skriv inn e-postadressen din først.');
    setStatus('sending'); setError(null); setInfo(null);
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent('/reset-password')}`,
      });
      if (authError) throw authError;
      setStatus('reset_sent');
      setInfo('Vi har sendt en lenke for å tilbakestille passordet til ' + email + '.');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : strings.errorGeneric);
    }
  }

  async function handleGoogle() {
    if (!consentReady) return setError('Du må bekrefte aldersgrensen, godta vilkårene og fylle inn navn for å opprette konto.');
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`,
          queryParams: { prompt: 'consent' },
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
        <div className="w-12 h-12 rounded-full bg-sage-100 mx-auto mb-5 flex items-center justify-center text-sage-700 text-xl">✓</div>
        <h2 className="font-serif text-2xl mb-2">{strings.successHeading}</h2>
        <p className="text-charcoal/60 text-sm">{strings.successBody}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-oatmeal/40 rounded-2xl text-xs font-medium">
        <button type="button" onClick={() => { setMode('magic'); setError(null); setInfo(null); }}
          className={`flex-1 py-2 rounded-xl transition-colors ${mode === 'magic' ? 'bg-white text-charcoal shadow-sm' : 'text-charcoal/55'}`}>
          Magisk lenke
        </button>
        <button type="button" onClick={() => { setMode('password'); setError(null); setInfo(null); }}
          className={`flex-1 py-2 rounded-xl transition-colors ${mode === 'password' ? 'bg-white text-charcoal shadow-sm' : 'text-charcoal/55'}`}>
          Passord
        </button>
      </div>

      <form onSubmit={mode === 'magic' ? handleMagicLink : handlePassword} className="space-y-3">
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wider text-charcoal/50 mb-2">
            {strings.emailLabel}
          </span>
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={strings.emailPlaceholder} disabled={status === 'sending'}
            className="w-full bg-white rounded-2xl px-5 py-3 text-base placeholder:text-charcoal/40 border border-sage-500/20 focus:outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 disabled:opacity-50"
          />
        </label>

        {mode === 'password' && (
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wider text-charcoal/50 mb-2">Passord</span>
            <input
              type="password" required minLength={pwSubmode === 'signup' ? 8 : undefined}
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={pwSubmode === 'signup' ? 'new-password' : 'current-password'}
              disabled={status === 'sending'}
              className="w-full bg-white rounded-2xl px-5 py-3 text-base placeholder:text-charcoal/40 border border-sage-500/20 focus:outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 disabled:opacity-50"
            />
            {pwSubmode === 'signup' && (
              <span className="block text-xs text-charcoal/45 mt-1.5">Minst 8 tegn.</span>
            )}
          </label>
        )}

        {isPasswordSignup && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wider text-charcoal/50 mb-2">Fornavn</span>
              <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name" disabled={status === 'sending'}
                className="w-full bg-white rounded-2xl px-4 py-3 text-base border border-sage-500/20 focus:outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 disabled:opacity-50" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wider text-charcoal/50 mb-2">Etternavn</span>
              <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name" disabled={status === 'sending'}
                className="w-full bg-white rounded-2xl px-4 py-3 text-base border border-sage-500/20 focus:outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-500/20 disabled:opacity-50" />
            </label>
          </div>
        )}

        {requiresConsent && (
          <div className="space-y-2.5 text-xs text-charcoal/70 pt-1">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} className="mt-0.5 shrink-0" />
              <span>
                Jeg bekrefter at jeg er minst <strong>18 år gammel</strong>.
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={termsOk} onChange={(e) => setTermsOk(e.target.checked)} className="mt-0.5 shrink-0" />
              <span>
                Jeg godtar <a href="/terms" className="text-terracotta-500 hover:underline">brukervilkårene</a>
                {' og '}
                <a href="/privacy" className="text-terracotta-500 hover:underline">personvernerklæringen</a>.
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={marketingOk} onChange={(e) => setMarketingOk(e.target.checked)} className="mt-0.5 shrink-0" />
              <span>
                Send meg nyhetsbrev og oppdateringer fra Strikketorget av og til.
                Du kan melde deg av når som helst.
              </span>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'sending' || !email || (mode === 'password' && !password) || !consentReady}
          className="w-full bg-charcoal text-linen py-3 rounded-2xl font-medium hover:bg-terracotta-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'sending' ? strings.loading : (
            mode === 'magic' ? strings.magicLinkCta :
            pwSubmode === 'signup' ? 'Opprett konto' : 'Logg inn'
          )}
        </button>

        {mode === 'password' && (
          <div className="flex justify-between items-center text-xs pt-1">
            <button type="button" onClick={() => { setPwSubmode(pwSubmode === 'signin' ? 'signup' : 'signin'); setError(null); }}
              className="text-charcoal/55 hover:text-charcoal underline-offset-2 hover:underline">
              {pwSubmode === 'signin' ? 'Ny her? Opprett konto' : 'Har konto allerede? Logg inn'}
            </button>
            {pwSubmode === 'signin' && (
              <button type="button" onClick={handleForgotPassword}
                className="text-charcoal/55 hover:text-charcoal underline-offset-2 hover:underline">
                Glemt passord?
              </button>
            )}
          </div>
        )}
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-charcoal/40">
        <div className="flex-1 h-px bg-sage-500/15" />
        <span>{strings.divider}</span>
        <div className="flex-1 h-px bg-sage-500/15" />
      </div>

      <button
        type="button" onClick={handleGoogle} disabled={!consentReady}
        className="w-full flex items-center justify-center gap-3 bg-white border border-sage-500/20 py-3 rounded-2xl font-medium text-charcoal hover:border-charcoal/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" />
        </svg>
        {strings.google}
      </button>

      {error && <p className="text-sm text-terracotta-700 text-center">{error}</p>}
      {info && <p className="text-sm text-sage-700 text-center">{info}</p>}
    </div>
  );
}
