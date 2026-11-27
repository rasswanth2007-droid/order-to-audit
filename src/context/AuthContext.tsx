import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Role, UserInfo } from "@/types";
import { setAccessToken } from "@/services/api";
import { Toast } from "@/components/ui";
import type { Lang } from "@/utils/i18n";

type AuthContextValue = {
  user: UserInfo | null;
  role: Role | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  setUser: (u: UserInfo | null) => void;
  setPreviewRole: (r: Role) => void;
  signOut: () => void;
  notify: (msg: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserInfo | null>(null);
  const [previewRole, setPreviewRoleState] = useState<Role | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [toast, setToast] = useState<string | null>(null);

  const setUser = useCallback((u: UserInfo | null) => {
    setUserState(u);
    setPreviewRoleState(u ? u.role : null);
  }, []);

  const setPreviewRole = useCallback((r: Role) => {
    setPreviewRoleState(r);
  }, []);

  const signOut = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
    setPreviewRoleState(null);
  }, []);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        role: previewRole,
        lang,
        setLang,
        setUser,
        setPreviewRole,
        signOut,
        notify,
      }}
    >
      {children}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
