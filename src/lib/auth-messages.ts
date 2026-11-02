/** Plain-language sign-in errors; never show raw system messages. */
export function signInMessage(raw: string | undefined): string {
  const m = (raw ?? "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials"))
    return "Wrong email or password.";
  if (m.includes("not confirmed")) return "Confirm your email first, then sign in.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a minute and try again.";
  if (m.includes("already registered") || m.includes("already exists"))
    return "That email already has an account. Sign in instead.";
  if (m.includes("password should")) return "Use a password with at least 6 characters.";
  if (m.includes("fetch") || m.includes("network"))
    return "No connection. Check your internet and try again.";
  return "Couldn't sign you in. Try again.";
}
