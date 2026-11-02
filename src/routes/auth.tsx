import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { signInMessage } from "@/lib/auth-messages";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in to Stepwise" },
      {
        name: "description",
        content: "Sign in to save your goals and pick up where you left off.",
      },
      { property: "og:title", content: "Sign in to Stepwise" },
      {
        property: "og:description",
        content: "Sign in to save your goals and pick up where you left off.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(signInMessage(error.message));
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) setError(signInMessage(error.message));
        else if (!data.session) setSent(true);
      }
    } catch (e) {
      setError(signInMessage(e instanceof Error ? e.message : "network"));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) setError("Google sign-in didn't work. Try again.");
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="font-semibold tracking-tight">Stepwise</div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            {mode === "signin" ? "Sign in to continue" : "Create your account"}
          </h1>
        </div>

        {sent ? (
          <div className="rounded-2xl border bg-card p-5 text-center text-sm shadow-card">
            Check your email to confirm your account, then sign in.
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
            <Button variant="outline" className="w-full" onClick={google}>
              Continue with Google
            </Button>
            <div className="text-center font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              or
            </div>
            <form onSubmit={submit} className="space-y-3">
              <label className="block text-sm">
                Email
                <Input
                  className="mt-1"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Password
                <Input
                  className="mt-1"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          {mode === "signin" ? "New here? " : "Already have an account? "}
          <button
            className="font-medium text-foreground underline underline-offset-4"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setSent(false);
              setError(null);
            }}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
