import React, { createContext, useState, useContext, useEffect } from 'react';
import { localAuth } from '@/api/localClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    localAuth.me()
      .then(u => { setUser(u); setIsLoadingAuth(false); })
      .catch(e => {
        const type = e.type === 'auth_required' ? 'auth_required' : 'unknown';
        setAuthError({ type, message: e.message });
        setIsLoadingAuth(false);
      });
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      appPublicSettings: null,
      logout: localAuth.logout,
      navigateToLogin: localAuth.redirectToLogin,
      checkAppState: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
