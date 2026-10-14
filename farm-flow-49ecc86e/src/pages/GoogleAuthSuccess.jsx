import { useEffect } from 'react';
import { setToken } from '@/api/localClient';

export default function GoogleAuthSuccess() {
  useEffect(() => {
    // הטוקן מגיע ב-fragment (#token=) כדי שלא יישלח לשרת/ללוגים; ?token= נתמך לתאימות
    const hash   = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token  = hash.get('token') || new URLSearchParams(window.location.search).get('token');
    if (token) {
      window.history.replaceState(null, '', '/auth/google/success');
      setToken(token);
      window.location.replace('/');
    } else {
      window.location.replace('/login?error=google_error');
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">מתחבר...</p>
      </div>
    </div>
  );
}
