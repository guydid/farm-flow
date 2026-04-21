import { useState, useEffect } from 'react';
import { localAuth } from '@/api/localClient';
import { Sprout } from 'lucide-react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const API_ROOT = BASE_URL.replace(/\/api$/, '');

const ERROR_MESSAGES = {
  google_not_configured:  'חיבור Google לא מוגדר במערכת',
  google_cancelled:       'ההתחברות עם Google בוטלה',
  google_token_failed:    'שגיאה בקבלת token מ-Google',
  google_no_email:        'לא ניתן לקבל אימייל מ-Google',
  registration_disabled:  'ההרשמה מושבתת. פנה למנהל המערכת',
  account_disabled:       'החשבון מושבת. פנה למנהל',
  google_error:           'שגיאה בחיבור Google',
};

export default function Login() {
  const [mode, setMode]         = useState('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) setError(ERROR_MESSAGES[err] || 'שגיאה בהתחברות עם Google');
    localAuth.googleConfig().then(cfg => setGoogleEnabled(!!cfg?.enabled));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await localAuth.login(email, password);
      } else {
        await localAuth.register(email, password, fullName);
      }
      window.location.href = '/';
    } catch (err) {
      setError(err.message || 'שגיאה בהתחברות');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-indigo-600 p-3 rounded-2xl">
              <Sprout className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Farm Flow</h1>
          <p className="text-gray-500 mt-1">מערכת ניהול משק חקלאי</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">
            {mode === 'login' ? 'התחברות' : 'הרשמה'}
          </h2>

          {/* Google Sign-In */}
          {googleEnabled && (
            <div className="mb-5">
              <a
                href={`${API_ROOT}/api/auth/google`}
                className="flex items-center justify-center gap-3 w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                  <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01c-.72.48-1.63.76-2.7.76-2.08 0-3.84-1.4-4.47-3.28H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                  <path fill="#FBBC05" d="M4.51 10.53A4.8 4.8 0 0 1 4.26 9c0-.53.09-1.04.25-1.53V5.4H1.83a8 8 0 0 0 0 7.2l2.68-2.07z"/>
                  <path fill="#EA4335" d="M8.98 4.19c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.51 7.47c.63-1.89 2.39-3.28 4.47-3.28z"/>
                </svg>
                {mode === 'login' ? 'התחבר עם Google' : 'הרשם עם Google'}
              </a>

              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs text-gray-400">או</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">שם מלא</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="ישראל ישראלי"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">אימייל</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="example@email.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">סיסמה</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
                minLength={6}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              {loading ? 'טוען...' : mode === 'login' ? 'התחבר' : 'צור חשבון'}
            </button>
          </form>

          <div className="mt-6 text-center">
            {mode === 'login' ? (
              <p className="text-sm text-gray-500">
                אין לך חשבון?{' '}
                <button
                  onClick={() => { setMode('register'); setError(''); }}
                  className="text-indigo-600 hover:underline font-medium"
                >
                  הרשם עכשיו
                </button>
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                כבר יש לך חשבון?{' '}
                <button
                  onClick={() => { setMode('login'); setError(''); }}
                  className="text-indigo-600 hover:underline font-medium"
                >
                  התחבר
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
