import { useEffect } from 'react';
import { setToken } from '@/api/localClient';

export default function GoogleAuthSuccess() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');
    if (token) {
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
