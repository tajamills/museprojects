import { useState } from "react";
import { signIn, signUp } from "../api";
import { handleLinkClick } from "../nav";

/**
 * Email sign-in / account creation. Accounts exist so book purchases can
 * be tied to a buyer and unlocked for them forever (the entitlement is
 * granted by the server when Stripe confirms payment).
 */
export function SignInPage({ search }: { search: string }) {
  const next = new URLSearchParams(search).get("next") || "/";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
      // Full navigation: every page re-reads /api/me with the new cookie.
      window.location.assign(next.startsWith("/") ? next : "/");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <main className="page">
      <section className="card booking-details" aria-label="Sign in">
        <h1 className="page-title">{mode === "signin" ? "Welcome back." : "Create your account."}</h1>
        <p className="lead">
          {mode === "signin"
            ? "Sign in to read every book you've unlocked — yours to keep, forever."
            : "One account for the whole Library. Books you unlock are tied to it and stay yours, forever."}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
        >
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
          </label>
          {mode === "signup" ? <p className="fine-print">At least 8 characters.</p> : null}
          {error ? (
            <p className="fine-print" role="alert">
              {error}
            </p>
          ) : null}
          <div className="cta-row">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </div>
        </form>
        <p className="fine-print">
          {mode === "signin" ? (
            <>
              New to the Library?{" "}
              <a
                href="/signin"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("signup");
                  setError(null);
                }}
              >
                Create an account
              </a>{" "}
              — the free opening chapters are open to everyone, no account needed.
            </>
          ) : (
            <>
              Already have an account?{" "}
              <a
                href="/signin"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("signin");
                  setError(null);
                }}
              >
                Sign in
              </a>
              .
            </>
          )}
        </p>
        <p className="fine-print">
          Bought a book before the Library moved? Sign up with the same email
          you paid with and your unlock will be honored. Questions:{" "}
          <a href="/" onClick={(e) => handleLinkClick(e, "/")}>
            back to the Library
          </a>
          .
        </p>
      </section>
    </main>
  );
}
