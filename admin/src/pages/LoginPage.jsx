import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { Card } from "@shared/components/ui/Card.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";

export default function LoginPage() {
  const { login, status } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <div className="text-[17px] font-extrabold text-fg">Control Room</div>
            <div className="text-[12.5px] text-fg/40">Ashkan Medical Idea</div>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-[13px] font-medium text-red-400">{error}</p>}
          {status === "forbidden" && (
            <p className="text-[13px] font-medium text-red-400">
              That account exists but has no staff access.
            </p>
          )}
          <Button type="submit" size="lg" fullWidth loading={loading} disabled={!email || !password}>
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
