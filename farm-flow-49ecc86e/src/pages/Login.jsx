import { useState, useEffect } from 'react';
import { localAuth } from '@/api/localClient';
import { getBrand } from '@/lib/branding';
import { Eye, EyeOff, Mail, Loader2, CheckCircle2, ArrowRight, Sprout, Bug, FileText, Users2 } from 'lucide-react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const API_ROOT = BASE_URL.replace(/\/api$/, '');

const ERROR_MESSAGES = {
  google_not_configured:  'חיבור Google לא מוגדר במערכת',
  google_cancelled:       'ההתחברות עם Google בוטלה',
  google_token_failed:    'שגיאה בקבלת אישור מ-Google',
  google_no_email:        'לא ניתן לקבל אימייל מ-Google',
  google_state:           'פג תוקף ההתחברות עם Google — נסה שוב',
  registration_disabled:  'ההרשמה סגורה כרגע. פנה למנהל המערכת',
  account_disabled:       'החשבון מושבת. פנה למנהל',
  google_error:           'שגיאה בחיבור Google',
};

// הודעות השרת (קוד או טקסט באנגלית) → עברית
function hebrewError(err) {
  const byCode = {
    invalid_credentials: 'אימייל או סיסמה שגויים',
    email_not_verified: 'יש לאמת את כתובת המייל לפני הכניסה',
    account_disabled: 'החשבון מושבת. פנה למנהל',
    registration_disabled: 'ההרשמה סגורה כרגע. פנה למנהל המערכת',
    email_taken: 'כבר קיים חשבון עם המייל הזה — נסה להתחבר או לאפס סיסמה',
    weak_password: 'הסיסמה חייבת להכיל לפחות 8 תווים, כולל אות ומספר',
    invalid_email: 'כתובת המייל אינה תקינה',
    invalid_token: 'הקישור אינו תקף או שפג תוקפו',
    email_unavailable: 'שליחת מיילים אינה זמינה כרגע. פנה למנהל המערכת',
    rate_limited: 'יותר מדי ניסיונות. נסה שוב מאוחר יותר',
  };
  if (err?.code && byCode[err.code]) return byCode[err.code];
  const m = String(err?.message || '');
  if (/too many/i.test(m)) return byCode.rate_limited;
  if (/invalid email or password/i.test(m)) return byCode.invalid_credentials;
  if (/already exists/i.test(m)) return byCode.email_taken;
  if (/disabled/i.test(m)) return /registration/i.test(m) ? byCode.registration_disabled : byCode.account_disabled;
  if (/failed to fetch|network/i.test(m)) return 'אין חיבור לשרת. בדוק את החיבור לאינטרנט';
  return m || 'שגיאה, נסה שוב';
}

const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white';

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete, placeholder = '••••••••' }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${inputCls} pl-10`}
        dir="ltr"
        required
      />
      <button type="button" onClick={() => setShow(s => !s)} tabIndex={-1}
        className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600" aria-label={show ? 'הסתר סיסמה' : 'הצג סיסמה'}>
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function Logo({ brand, size = 'h-14 w-14' }) {
  return brand?.icon192
    ? <img src={brand.icon192} alt={brand.name || 'לוגו'} className={`${size} rounded-2xl object-contain bg-white shadow-sm`} />
    : <img src="/icons/icon-192.png" alt="Farm Flow" className={`${size} rounded-2xl shadow-sm`} />;
}

const FEATURES = [
  { icon: Sprout, text: 'מזרעים, חלקות וקטיף במקום אחד' },
  { icon: Bug, text: 'המלצות הדברה, ריסוסים ומלאי חומרים' },
  { icon: FileText, text: 'סריקת חשבוניות אוטומטית מהמייל' },
  { icon: Users2, text: 'עובדים, נוכחות ומסמכים' },
];

export default function Login() {
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get('reset');
  const verifyToken = params.get('verify');

  const [mode, setMode] = useState(resetToken ? 'reset' : verifyToken ? 'verifying' : params.get('mode') === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [fullName, setFullName] = useState('');
  const [farmName, setFarmName] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({ registration: true, google: false, email: true });
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const brand = getBrand();

  useEffect(() => {
    const err = params.get('error');
    if (err) setError(ERROR_MESSAGES[err] || 'שגיאה בהתחברות עם Google');
    localAuth.authConfig().then(cfg => cfg && setConfig(c => ({ ...c, ...cfg })));
    if (verifyToken) {
      localAuth.verifyEmail(verifyToken)
        .then(res => {
          if (res.token) { window.location.replace('/'); return; }
          setMode('login'); setInfo('כתובת המייל אומתה. אפשר להתחבר');
        })
        .catch(e => { setMode('login'); setError(hebrewError(e)); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (m) => { setMode(m); setError(''); setInfo(''); setUnverifiedEmail(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if ((mode === 'register' || mode === 'reset') && password !== password2) {
      setError('הסיסמאות אינן תואמות'); return;
    }
    if (mode === 'register' && !agree) { setError('יש לאשר את תנאי השימוש ומדיניות הפרטיות'); return; }
    setLoading(true);
    try {
      if (mode === 'login') {
        await localAuth.login(email.trim(), password);
        window.location.href = '/';
      } else if (mode === 'register') {
        const res = await localAuth.register(email.trim(), password, fullName.trim(), farmName.trim());
        if (res.token) { window.location.href = '/'; return; }
        setMode('check-email');
      } else if (mode === 'forgot') {
        await localAuth.forgotPassword(email.trim());
        setMode('forgot-sent');
      } else if (mode === 'reset') {
        await localAuth.resetPassword(resetToken, password);
        window.history.replaceState(null, '', '/login');
        setPassword(''); setPassword2('');
        setMode('login'); setInfo('הסיסמה עודכנה. אפשר להתחבר עם הסיסמה החדשה');
      }
    } catch (err) {
      if (err?.code === 'email_not_verified') setUnverifiedEmail(email.trim());
      setError(hebrewError(err));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setLoading(true);
    try {
      await localAuth.resendVerification(unverifiedEmail || email.trim());
      setError(''); setInfo('שלחנו שוב מייל אימות. בדוק גם בתיקיית הספאם');
    } catch (err) { setError(hebrewError(err)); }
    finally { setLoading(false); }
  };

  const title = {
    login: 'כניסה למערכת', register: 'פתיחת חשבון', forgot: 'שכחתי סיסמה', reset: 'בחירת סיסמה חדשה',
    'check-email': 'בדוק את המייל', 'forgot-sent': 'בדוק את המייל', verifying: 'מאמת…',
  }[mode];

  const submitLabel = { login: 'כניסה', register: 'יצירת חשבון', forgot: 'שלח קישור לאיפוס', reset: 'שמירת סיסמה' }[mode];

  return (
    <div className="min-h-screen bg-gray-50 lg:grid lg:grid-cols-2" dir="rtl">
      {/* פאנל מיתוג — דסקטופ בלבד */}
      <div className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-700 text-white p-12">
        <div className="flex items-center gap-3">
          <Logo brand={brand} size="h-12 w-12" />
          <span className="text-xl font-semibold">{brand?.name || 'Farm Flow'}</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight mb-4">ניהול המשק,<br />מהשטח ועד המשרד</h1>
          <p className="text-emerald-50 text-lg mb-8">כל המידע של המשק במקום אחד — בנייד ובמחשב.</p>
          <ul className="space-y-3">
            {FEATURES.map(f => (
              <li key={f.text} className="flex items-center gap-3 text-emerald-50">
                <span className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center"><f.icon className="w-5 h-5" /></span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-emerald-100/80">Farm Flow · מערכת ניהול משק חקלאי</p>
      </div>

      {/* טופס */}
      <div className="flex min-h-screen lg:min-h-0 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-6 lg:hidden">
            <div className="flex justify-center mb-3"><Logo brand={brand} /></div>
            <h1 className="text-2xl font-bold text-gray-900">{brand?.name || 'Farm Flow'}</h1>
            <p className="text-gray-500 text-sm mt-1">מערכת ניהול משק חקלאי</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border p-6 sm:p-8">
            {(mode === 'login' || mode === 'register') && config.registration && (
              <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg mb-6">
                {[['login', 'כניסה'], ['register', 'הרשמה']].map(([m, l]) => (
                  <button key={m} type="button" onClick={() => go(m)}
                    className={`py-2 rounded-md text-sm font-medium transition-colors ${mode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                    {l}
                  </button>
                ))}
              </div>
            )}

            <h2 className="text-xl font-semibold text-gray-800 mb-1">{title}</h2>
            {mode === 'register' && <p className="text-sm text-gray-500 mb-5">פותחים משק חדש ומתחילים לעבוד. חינם.</p>}
            {mode === 'forgot' && <p className="text-sm text-gray-500 mb-5">נשלח אליך קישור לבחירת סיסמה חדשה.</p>}
            {mode === 'login' && <div className="mb-5" />}
            {mode === 'reset' && <div className="mb-5" />}

            {mode === 'verifying' && (
              <div className="flex items-center justify-center py-8 text-gray-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
            )}

            {(mode === 'check-email' || mode === 'forgot-sent') && (
              <div className="text-center py-4">
                <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                  <Mail className="w-7 h-7 text-emerald-600" />
                </div>
                <p className="text-gray-700 mb-1">
                  {mode === 'check-email' ? 'שלחנו קישור לאימות החשבון אל' : 'אם קיים חשבון עם הכתובת, שלחנו קישור לאיפוס אל'}
                </p>
                <p className="font-medium text-gray-900 mb-4" dir="ltr">{email}</p>
                <p className="text-sm text-gray-500 mb-6">הקישור תקף ל-{mode === 'check-email' ? '48 שעות' : 'שעה'}. לא הגיע? בדוק בתיקיית הספאם.</p>
                {mode === 'check-email' && (
                  <button type="button" onClick={() => { setUnverifiedEmail(email); resend(); }} disabled={loading}
                    className="text-sm text-emerald-700 hover:underline font-medium mb-4 block mx-auto">
                    שלח שוב
                  </button>
                )}
                {info && <p className="text-sm text-emerald-700 mb-3">{info}</p>}
                {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
                <button type="button" onClick={() => go('login')} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
                  <ArrowRight className="w-4 h-4" /> חזרה לכניסה
                </button>
              </div>
            )}

            {['login', 'register', 'forgot', 'reset'].includes(mode) && (
              <>
                {config.google && (mode === 'login' || mode === 'register') && (
                  <div className="mb-5">
                    <a href={`${API_ROOT}/api/auth/google`}
                      className="flex items-center justify-center gap-3 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors">
                      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                        <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                        <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01c-.72.48-1.63.76-2.7.76-2.08 0-3.84-1.4-4.47-3.28H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                        <path fill="#FBBC05" d="M4.51 10.53A4.8 4.8 0 0 1 4.26 9c0-.53.09-1.04.25-1.53V5.4H1.83a8 8 0 0 0 0 7.2l2.68-2.07z"/>
                        <path fill="#EA4335" d="M8.98 4.19c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.51 7.47c.63-1.89 2.39-3.28 4.47-3.28z"/>
                      </svg>
                      {mode === 'login' ? 'כניסה עם Google' : 'הרשמה עם Google'}
                    </a>
                    <div className="flex items-center gap-3 mt-5">
                      <div className="flex-1 border-t border-gray-200" />
                      <span className="text-xs text-gray-400">או עם אימייל</span>
                      <div className="flex-1 border-t border-gray-200" />
                    </div>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
                  {mode === 'register' && (
                    <>
                      <Field label="שם מלא">
                        <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="ישראל ישראלי"
                          autoComplete="name" className={inputCls} required maxLength={80} />
                      </Field>
                      <Field label="שם המשק" hint="אפשר לשנות אחר כך בהגדרות">
                        <input type="text" value={farmName} onChange={e => setFarmName(e.target.value)} placeholder="משק ישראלי"
                          autoComplete="organization" className={inputCls} maxLength={80} />
                      </Field>
                    </>
                  )}

                  {mode !== 'reset' && (
                    <Field label="אימייל">
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com"
                        autoComplete="email" inputMode="email" className={inputCls} required dir="ltr" />
                    </Field>
                  )}

                  {mode !== 'forgot' && (
                    <Field label={mode === 'reset' ? 'סיסמה חדשה' : 'סיסמה'}
                      hint={mode === 'register' || mode === 'reset' ? 'לפחות 8 תווים, כולל אות ומספר' : null}>
                      <PasswordInput value={password} onChange={setPassword}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                    </Field>
                  )}

                  {(mode === 'register' || mode === 'reset') && (
                    <Field label="אימות סיסמה">
                      <PasswordInput value={password2} onChange={setPassword2} autoComplete="new-password" />
                    </Field>
                  )}

                  {mode === 'login' && (
                    <div className="flex justify-start -mt-1">
                      <button type="button" onClick={() => go('forgot')} className="text-sm text-emerald-700 hover:underline">
                        שכחתי סיסמה
                      </button>
                    </div>
                  )}

                  {mode === 'register' && (
                    <label className="flex items-start gap-2 text-sm text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-1 h-4 w-4 accent-emerald-600" />
                      <span>
                        קראתי ואני מסכים/ה ל<a href="/terms.html" target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">תנאי השימוש ומדיניות הפרטיות</a>
                      </span>
                    </label>
                  )}

                  {info && (
                    <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2.5 rounded-lg text-sm">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{info}</span>
                    </div>
                  )}
                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-lg text-sm" role="alert">
                      {error}
                      {unverifiedEmail && (
                        <button type="button" onClick={resend} disabled={loading} className="block mt-1 font-medium underline">
                          שלח שוב מייל אימות
                        </button>
                      )}
                    </div>
                  )}

                  <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors">
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {submitLabel}
                  </button>
                </form>

                {(mode === 'forgot' || mode === 'reset') && (
                  <div className="mt-5 text-center">
                    <button type="button" onClick={() => go('login')} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
                      <ArrowRight className="w-4 h-4" /> חזרה לכניסה
                    </button>
                  </div>
                )}
                {mode === 'login' && !config.registration && (
                  <p className="mt-5 text-center text-xs text-gray-400">ההרשמה למערכת בהזמנה בלבד</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
