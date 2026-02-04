import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, setAuthToken } from "../lib/api.ts";

export interface User {
  id: string;
  email: string;
  role: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refreshMe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<{ accessToken: string; user: User }>("/auth/refresh");
      setUser(data.user);
      setAuthToken(data.accessToken);
    } catch {
      setUser(null);
      setAuthToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const { data } = await api.post<{ accessToken: string; user: User }>("/auth/login", {
        email,
        password,
      });
      setUser(data.user);
      setAuthToken(data.accessToken);
    },
    []
  );

  const logout = useCallback(async () => {
    setError(null);
    setUser(null);
    setAuthToken(null);
    try {
      await api.post("/auth/logout");
    } catch {
      // Cookie may already be cleared
    }
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    error,
    login,
    logout,
    refreshMe,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
