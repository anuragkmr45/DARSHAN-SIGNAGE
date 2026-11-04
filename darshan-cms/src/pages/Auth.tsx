import { SiteBrand } from "@/components/appearance/SiteBrand";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Monitor, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { authApi } from "@/api/domains/auth";
import { ApiError } from "@/api/apiClient";
import { useAppDispatch } from "@/store/hooks";
import { setCredentials } from "@/store/authSlice";
import { getCookie } from "@/lib/cookies";
import { isValidEmail } from "@/lib/validation";
import { clearPostLoginRedirect, resolvePostLoginRedirect } from "@/lib/authRedirect";

const signInError = (error: unknown) => {
  if (!(error instanceof ApiError)) return "Sign-in is unavailable. Check your connection and try again.";
  if (error.status === 401) return "Email or password is incorrect. Check both and try again.";
  if (error.status === 403) return "This account cannot sign in. Contact your site administrator.";
  if (error.status === 429) {
    const details = error.details && typeof error.details === "object" ? error.details as { retry_after_seconds?: unknown } : null;
    const seconds = details?.retry_after_seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      const minutes = Math.ceil(seconds / 60);
      return minutes > 1
        ? `Too many sign-in attempts. Try again in about ${minutes} minutes.`
        : `Too many sign-in attempts. Try again in about ${Math.ceil(seconds)} seconds.`;
    }
    return "Too many sign-in attempts. Please wait before trying again.";
  }
  if (error.status === 408 || error.status >= 500) return "Sign-in is temporarily unavailable. Please try again.";
  return error.message;
};

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("login-email") ?? "").trim();
    const password = String(formData.get("login-password") ?? "");

    if (!isValidEmail(email)) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setFormError("Enter your password. It must contain at least 8 characters.");
      return;
    }

    setFormError(null);
    setIsLoading(true);
    try {
      const auth = await authApi.login({ email, password });
      const csrfToken = auth.csrf_token ?? getCookie("csrf_token");
      dispatch(setCredentials({ token: auth.token, user: auth.user, csrfToken }));
      toast({ title: "Signed in", description: "Your DARSHAN workspace is ready." });
      const redirectPath = resolvePostLoginRedirect(location.search, location.state);
      clearPostLoginRedirect();
      navigate(redirectPath || "/dashboard", { replace: true });
    } catch (error) {
      setFormError(signInError(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4 sm:px-8">
          <SiteBrand />
          <span className="ml-auto text-xs text-muted-foreground">Display operations</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-12 px-5 py-12 sm:px-8 sm:py-20 lg:min-h-[calc(100svh-74px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-center lg:gap-20">
        <section className="max-w-md" aria-label="DARSHAN workspace">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Secure site access</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Sign in to DARSHAN</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Your workspace for publishing content and checking the screens that play it.
          </p>
          <div className="mt-8 hidden space-y-4 border-t border-border/70 pt-6 text-sm text-muted-foreground lg:block">
            <p className="flex items-center gap-3"><Monitor aria-hidden="true" className="h-4 w-4 text-primary" /> Monitor screens and current content</p>
            <p className="flex items-center gap-3"><Radio aria-hidden="true" className="h-4 w-4 text-primary" /> Respond to live and urgent events</p>
          </div>
        </section>

        <div className="space-y-5">
        <section aria-label="Sign-in form" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use the account provided by your site administrator.</p>

          <form className="mt-7 space-y-5" onSubmit={handleLogin} onChange={() => setFormError(null)}>
            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <Input id="login-email" name="login-email" type="email" autoComplete="username"
                autoCapitalize="none" spellCheck={false} placeholder="name@company.com"
                required disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <div className="relative">
                <Input id="login-password" name="login-password" type={showPassword ? "text" : "password"}
                  autoComplete="current-password" required disabled={isLoading} className="pr-12" />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {formError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</p>}

            <Button type="submit" className="min-h-11 w-full" disabled={isLoading}>
              {isLoading ? "Signing in…" : "Sign In"}
            </Button>
          </form>

          <p className="mt-6 border-t border-border/70 pt-5 text-sm text-muted-foreground">
            Need an account or password help? Contact your site administrator.
          </p>
        </section>
        <Link to="/" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to introduction
        </Link>
        </div>
      </main>
    </div>
  );
};

export default Auth;
