"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, setToken, removeToken } from "@/lib/api";

interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signin: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  signout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
  });

  useEffect(() => {
    api<User>("/api/v1/auth/me")
      .then((user) => setState({ user, loading: false }))
      .catch(() => {
        removeToken();
        setState({ user: null, loading: false });
      });
  }, []);

  const signin = useCallback(async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>(
      "/api/v1/auth/signin",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );
    setToken(res.access_token);
    setState({ user: res.user, loading: false });
  }, []);

  const signup = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await api<{ access_token: string; user: User }>(
        "/api/v1/auth/signup",
        {
          method: "POST",
          body: JSON.stringify({ name, email, password }),
        },
      );
      setToken(res.access_token);
      setState({ user: res.user, loading: false });
    },
    [],
  );

  const signout = useCallback(() => {
    removeToken();
    setState({ user: null, loading: false });
  }, []);

  const value = useMemo(
    () => ({ ...state, signin, signup, signout }),
    [state, signin, signup, signout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
