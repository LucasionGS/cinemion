import { type FormEvent, useState } from "react";
import AuthApi from "../../Api/AuthApi.ts";
import { session } from "../../Session.ts";
import { Link, router } from "../../lib/Router.tsx";
import Logo from "../../components/Logo/Logo.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Button from "../../components/Button/Button.tsx";
import "./SignIn.scss";

/**
 * Sign in with a username and password, for profiles that aren't on the picker or devices you don't share.
 */
export default function SignIn() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      session.signIn(await AuthApi.login(username, password));
      router.navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cn-signin">
      <div className="cn-ambient-glow" aria-hidden="true" />
      <form className="cn-signin__card" onSubmit={submit}>
        <Logo size={2.25} />
        <div className="cn-signin__text">
          <h1>Sign in</h1>
          <p>{session.server?.name ?? "Cinemion"}</p>
        </div>
        <TextField label="Username" autoComplete="username" autoCapitalize="none" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!username || !password}>Sign in</Button>
        <Link href="/profiles" className="cn-signin__alt">Back to profiles</Link>
      </form>
    </div>
  );
}
