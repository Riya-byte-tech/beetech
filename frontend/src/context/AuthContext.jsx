import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const restoreSession = useCallback(async () => {
    setLoading(true);
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null); // 401 is expected when nobody's logged in - not an error to surface
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { restoreSession(); }, [restoreSession]);

  async function login(email, password) {
    const { user } = await api.login(email, password);
    setUser(user);
    return user;
  }

  async function register(body) {
    const { user, message } = await api.register(body);
    setUser(user);
    return { user, message };
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh: restoreSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
