import { useEffect, useState, type ReactNode } from "react";
import { currentUser, type User } from "../lib/auth";
import AuthPage from "../pages/AuthPage";

/** Shows the login screen until someone is signed in, then the page. */
export default function RequireLogin({ children }: { children: (user: User) => ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    currentUser().then(setUser, (err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="error page-body" role="alert">{error}</p>;
  if (user === undefined) return null;
  if (user === null) return <AuthPage onSignedIn={setUser} />;
  return <>{children(user)}</>;
}
