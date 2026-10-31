import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { usersApi } from "@/api/domains/users";
import { ApiError } from "@/api/apiClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const activationTokenFromLocation = (hash: string): string =>
  new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("token")?.trim() ?? "";

export default function ActivateInvite() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [token, setToken] = useState(() => activationTokenFromLocation(location.hash));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setToken(activationTokenFromLocation(location.hash));
  }, [location.hash]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!token.trim()) {
      setError("Enter your activation code.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      await usersApi.activate({ token: token.trim(), password });
      setPassword("");
      setConfirmation("");
      setToken("");
      toast({ title: "Account activated", description: "Sign in with your new password." });
      navigate("/login", { replace: true });
    } catch (cause) {
      setPassword("");
      setConfirmation("");
      setError(cause instanceof ApiError ? cause.message : "Unable to activate your account. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="operational-shell flex min-h-screen items-center justify-center px-4 py-6">
      <Card className="operational-card-strong w-full max-w-md">
        <CardHeader>
          <CardTitle>Activate your account</CardTitle>
          <CardDescription>Enter your invitation code and choose a new password before signing in.</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activation-token">Activation code</Label>
              <Input id="activation-token" value={token} onChange={(event) => setToken(event.target.value)}
                autoComplete="off" required disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="activation-password">New password</Label>
              <Input id="activation-password" type="password" value={password}
                onChange={(event) => setPassword(event.target.value)} autoComplete="new-password"
                minLength={8} required disabled={isSubmitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="activation-confirmation">Confirm new password</Label>
              <Input id="activation-confirmation" type="password" value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password"
                minLength={8} required disabled={isSubmitting} />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Activating…" : "Activate account"}
            </Button>
            <Link to="/login" className="text-sm text-muted-foreground underline">Back to sign in</Link>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
