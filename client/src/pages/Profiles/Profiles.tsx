import { type FormEvent, useEffect, useState } from "react";
import { Lock, Plus } from "lucide-react";
import type { ProfileSummary } from "@shared/api.ts";
import { PROFILE_COLORS } from "@shared/profiles.ts";
import AuthApi from "../../Api/AuthApi.ts";
import { session } from "../../Session.ts";
import { Link, router } from "../../lib/Router.tsx";
import { applyAmbient } from "../../lib/ambient.ts";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import Logo from "../../components/Logo/Logo.tsx";
import Avatar from "../../components/Avatar/Avatar.tsx";
import PinPad from "../../components/PinPad/PinPad.tsx";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "./Profiles.scss";

/**
 * "Who's watching?": pick a profile, then enter its PIN (or password, for admins without one).
 */
export default function Profiles() {
  const { user } = useController(session);
  const profiles = useProfiles();
  const [selected, setSelected] = useState<ProfileSummary | null>(null);

  // Tint the screen with the chosen profile's colour
  useEffect(() => {
    if (!selected) {
      applyAmbient(null);
      return;
    }
    const colors = PROFILE_COLORS[selected.color];
    applyAmbient({ accent: colors.bg, onAccent: colors.fg, base: "#08090B" });
    return () => applyAmbient(null);
  }, [selected]);

  // Nobody shows on the picker: sign in with a password instead
  useEffect(() => {
    if (profiles && profiles.length === 0) router.navigate("/sign-in", { replace: true });
  }, [profiles]);

  async function pick(profile: ProfileSummary) {
    if (profile.hasPin || profile.isAdmin) {
      setSelected(profile);
      return;
    }
    try {
      session.signIn(await AuthApi.profileLogin(profile.id));
      router.navigate("/", { replace: true });
    } catch (error) {
      toasts.error("Couldn't open that profile", (error as Error).message);
    }
  }

  return (
    <div className="cn-profiles">
      <div className="cn-ambient-glow cn-profiles__glow" aria-hidden="true" />
      <header className="cn-profiles__header"><Logo /></header>

      {!profiles && <div className="cn-profiles__center"><Spinner size="2rem" label="Loading profiles" /></div>}

      {profiles && !selected && (
        <div className="cn-profiles__center">
          <h1 className="cn-profiles__title">Who's watching?</h1>
          <div className="cn-profiles__grid">
            {profiles.map((profile, i) => (
              <button key={profile.id} type="button" className="cn-profiles__tile" onClick={() => pick(profile)} data-autofocus={i === 0 || undefined}>
                <Avatar profile={profile} size={10.5} className="cn-profiles__avatar" />
                <span className="cn-profiles__name">
                  {profile.name}
                  {(profile.hasPin || profile.isAdmin) && <Lock aria-label={profile.hasPin ? "PIN protected" : "Password protected"} />}
                </span>
                {(profile.isAdmin || profile.maxRating) && <span className="cn-profiles__tag">{profile.isAdmin ? "Admin" : `Up to ${profile.maxRating}`}</span>}
              </button>
            ))}
            {session.can("USERS_MANAGE") && user && (
              <Link href="/settings/users?new=1" className="cn-profiles__tile cn-profiles__tile--add">
                <span className="cn-profiles__add"><Plus /></span>
                <span className="cn-profiles__name">Add profile</span>
              </Link>
            )}
          </div>
          <Link href="/sign-in" className="cn-profiles__alt">Sign in with a password instead</Link>
        </div>
      )}

      {selected && (selected.hasPin ? <PinEntry profile={selected} onBack={() => setSelected(null)} /> : <PasswordEntry profile={selected} onBack={() => setSelected(null)} />)}
    </div>
  );
}

function PinEntry(props: { profile: ProfileSummary; onBack: () => void }) {
  const { profile, onBack } = props;
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(value: string) {
    setBusy(true);
    try {
      session.signIn(await AuthApi.profileLogin(profile.id, { pin: value }));
      router.navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setPin("");
      }, 450);
    } finally {
      setBusy(false);
    }
  }

  function addDigit(digit: string) {
    if (busy || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setError(null);
    if (next.length === 4) submit(next);
  }

  // Number keys on keyboards and TV remotes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) addDigit(e.key);
      else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  return (
    <div className="cn-profiles__center cn-profiles__entry">
      <Avatar profile={profile} size={7.5} />
      <div className="cn-profiles__entry-text">
        <h1>Enter {profile.name}'s PIN</h1>
        <p className={error ? "cn-profiles__error" : undefined} role={error ? "alert" : undefined}>{error ?? "You can also type it on your keyboard."}</p>
      </div>
      <PinPad value={pin} onDigit={addDigit} onDelete={() => setPin(pin.slice(0, -1))} error={shake} disabled={busy} />
      <Button variant="ghost" onClick={onBack}>Back to profiles</Button>
    </div>
  );
}

function PasswordEntry(props: { profile: ProfileSummary; onBack: () => void }) {
  const { profile, onBack } = props;
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      session.signIn(await AuthApi.profileLogin(profile.id, { password }));
      router.navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="cn-profiles__center cn-profiles__entry" onSubmit={submit}>
      <Avatar profile={profile} size={7.5} />
      <div className="cn-profiles__entry-text">
        <h1>Enter {profile.name}'s password</h1>
        <p>Admin profiles without a PIN need their password.</p>
      </div>
      <div className="cn-profiles__password">
        <TextField label="Password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!password}>Sign in</Button>
      </div>
      <Button variant="ghost" onClick={onBack}>Back to profiles</Button>
    </form>
  );
}

function useProfiles() {
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  useEffect(() => {
    AuthApi.getProfiles().then(setProfiles).catch((e: Error) => {
      toasts.error("Couldn't load profiles", e.message);
      setProfiles([]);
    });
  }, []);
  return profiles;
}
