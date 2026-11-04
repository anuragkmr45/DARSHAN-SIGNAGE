import { SiteBrand } from "@/components/appearance/SiteBrand";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usersApi } from "@/api/domains/users";
import { ApiError } from "@/api/apiClient";

const passwordIssue = (password: string) => {
  if (password.length < 8) return "Use at least eight characters.";
  return null;
};

export default function ActivateInvitation() {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const normalizedCode = code.trim();
    const issue = passwordIssue(password);
    if (!normalizedCode) { setError("Enter the invitation code."); return; }
    if (issue) { setError(issue); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setError(null);
    setPending(true);
    try {
      await usersApi.activate({ token: normalizedCode, password });
      setCode(""); setPassword(""); setConfirm(""); setComplete(true);
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 400 || failure.status === 404)) {
        setError("This invitation code is invalid, expired, or already used. Ask your administrator for a new invitation.");
      } else if (failure instanceof ApiError && failure.status === 422) {
        const details = Array.isArray(failure.details) ? failure.details as Array<{ field?: unknown; message?: unknown }> : [];
        const policyMessage = details.find((item) => item.field === "password" && typeof item.message === "string")?.message;
        setError(typeof policyMessage === "string" ? policyMessage : "Password does not meet this site's policy. Choose a stronger password.");
      } else {
        setError("Could not activate your account. Check the connection and try again.");
      }
    } finally {
      setPending(false);
    }
  };

  return <div className="min-h-svh bg-background text-foreground">
    <header className="border-b border-border/70"><div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4 sm:px-8"><SiteBrand /><span className="ml-auto text-xs text-muted-foreground">Display operations</span></div></header>
    <main className="mx-auto flex min-h-[calc(100svh-74px)] max-w-lg items-center px-5 py-10 sm:px-8"><div className="w-full space-y-6">
      {complete ? <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8"><CheckCircle2 aria-hidden="true" className="h-7 w-7 text-emerald-600" /><h1 className="mt-4 text-2xl font-semibold">Account activated</h1><p className="mt-2 text-sm text-muted-foreground">Your password is ready. Sign in with the email address used for the invitation.</p><Button asChild className="mt-6 w-full"><Link to="/login">Go to Sign In</Link></Button></section> : <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8"><h1 className="text-2xl font-semibold">Activate your account</h1><p className="mt-2 text-sm text-muted-foreground">Enter the invitation code provided by your site administrator, then choose your password.</p>
        <form className="mt-6 space-y-4" onSubmit={submit} onChange={() => setError(null)}>
          <div className="space-y-2"><Label htmlFor="invitation-code">Invitation code</Label><Input id="invitation-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={pending} /></div>
          <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required disabled={pending} /><p className="text-xs text-muted-foreground">Use at least eight characters and follow your site's password policy.</p></div>
          <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required disabled={pending} /></div>
          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>{pending ? "Activating…" : "Activate Account"}</Button>
        </form>
      </section>}
      <Link to="/login" className="inline-flex text-sm text-muted-foreground hover:text-foreground">Back to Sign In</Link>
    </div></main>
  </div>;
}
