import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Clapperboard, Trash2, Tv } from "lucide-react";
import type { CreateLibraryRequest, LibraryType, MetadataSettings } from "@shared/api.ts";
import ServerApi from "../../Api/ServerApi.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import Logo from "../../components/Logo/Logo.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Select from "../../components/Select/Select.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import FolderBrowser from "../../components/FolderBrowser/FolderBrowser.tsx";
import "./Setup.scss";

const STEPS = [
  { label: "Your account", sub: "Admin user and server name" },
  { label: "Libraries", sub: "Where your media lives" },
  { label: "Metadata", sub: "Posters, plots and cast" },
  { label: "Done", sub: "Start using Cinemion" },
];

const PROVIDERS: Record<string, { name: string; description: string }> = {
  local: { name: "Your files", description: "NFO files and artwork next to your videos" },
  tmdb: { name: "TMDB", description: "Online database for movies and shows" },
};

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "nl", label: "Dutch" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "sv", label: "Swedish" },
  { value: "da", label: "Danish" },
  { value: "no", label: "Norwegian" },
  { value: "ja", label: "Japanese" },
];

const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "NL", label: "Netherlands" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "ES", label: "Spain" },
  { value: "IT", label: "Italy" },
  { value: "SE", label: "Sweden" },
  { value: "DK", label: "Denmark" },
  { value: "NO", label: "Norway" },
  { value: "JP", label: "Japan" },
];

function usernameFrom(name: string) {
  return name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

/**
 * First-run setup: create the admin, add libraries, choose metadata sources.
 */
export default function Setup() {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Account
  const [serverName, setServerName] = useState("Cinemion");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pin, setPin] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  // Libraries
  const [libraries, setLibraries] = useState<CreateLibraryRequest[]>([]);

  // Metadata
  const [metadata, setMetadata] = useState<MetadataSettings>({ tmdbApiKey: null, language: "en", country: guessCountry(), providers: ["local", "tmdb"] });

  const accountErrors = {
    name: !name.trim() ? "Enter your name." : null,
    username: !/^[a-z0-9._-]{2,32}$/.test(username) ? "Use 2 to 32 lowercase letters, numbers, dots, dashes or underscores." : null,
    password: password.length < 6 ? "Use at least 6 characters." : null,
    confirm: confirm !== password ? "The passwords don't match." : null,
    pin: pin && !/^\d{4}$/.test(pin) ? "The PIN must be exactly 4 digits." : null,
    serverName: !serverName.trim() ? "Give your server a name." : null,
  };
  const accountValid = Object.values(accountErrors).every((e) => e === null);

  async function finish() {
    setSubmitting(true);
    try {
      const response = await ServerApi.completeSetup({
        serverName: serverName.trim(),
        admin: { name: name.trim(), username, password, pin: pin || null },
        libraries,
        metadata: { ...metadata, tmdbApiKey: metadata.tmdbApiKey?.trim() || null },
      });
      session.signIn(response);
      setStep(3);
    } catch (error) {
      toasts.error("Setup didn't finish", (error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (step === 0) {
      if (!accountValid) {
        setShowErrors(true);
        return;
      }
      setStep(1);
    }
    else if (step === 1) setStep(2);
    else if (step === 2) finish();
    else router.navigate("/", { replace: true });
  }

  // Once setup is done there's no going back to change it here
  const canGoTo = (i: number) => step < 3 && (i <= step || (i === 1 && accountValid) || (i === 2 && accountValid));

  return (
    <div className="cn-setup">
      <div className="cn-ambient-glow cn-setup__glow" aria-hidden="true" />
      <aside className="cn-setup__aside">
        <Logo size={1.9} />
        <nav className="cn-setup__steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              className={cx("cn-setup__step", i === step && "cn-setup__step--current", i < step && "cn-setup__step--done")}
              aria-current={i === step ? "step" : undefined}
              disabled={!canGoTo(i)}
              onClick={() => setStep(i)}
            >
              <span className="cn-setup__step-mark">{i < step ? <Check /> : i + 1}</span>
              <span className="cn-setup__step-text">
                <strong>{s.label}</strong>
                <span>{s.sub}</span>
              </span>
            </button>
          ))}
        </nav>
        <p className="cn-setup__note">Everything here can be changed later in Settings.</p>
      </aside>

      <main className="cn-setup__main">
        <span className="cn-setup__progress">Step {step + 1} of {STEPS.length}</span>

        {step === 0 && (
          <section className="cn-setup__section cn-setup__section--narrow">
            <header className="cn-setup__header">
              <h1>Welcome to Cinemion</h1>
              <p>Let's get your server ready. First, create the admin account. You'll use it to manage libraries and add the rest of the household.</p>
            </header>
            <TextField label="Server name" value={serverName} onChange={(e) => setServerName(e.target.value)} description="Shown on devices when they connect to this server." error={showErrors ? accountErrors.serverName : null} />
            <TextField
              label="Your name"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (!usernameEdited) setUsername(usernameFrom(e.target.value));
              }}
              error={showErrors ? accountErrors.name : null}
            />
            <TextField
              label="Username"
              value={username}
              autoComplete="username"
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase());
                setUsernameEdited(true);
              }}
              description="Used to sign in with a password."
              error={showErrors ? accountErrors.username : null}
            />
            <div className="cn-setup__row">
              <TextField label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={showErrors ? accountErrors.password : null} />
              <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={showErrors ? accountErrors.confirm : null} />
            </div>
            <TextField
              label={<>Profile PIN <span className="cn-setup__optional">(optional)</span></>}
              className="cn-setup__pin"
              inputMode="numeric"
              maxLength={4}
              placeholder="4 digits"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              description="Used on shared screens like the TV instead of your password."
              error={showErrors ? accountErrors.pin : null}
            />
          </section>
        )}

        {step === 1 && <LibrariesStep libraries={libraries} onChange={setLibraries} />}

        {step === 2 && <MetadataStep metadata={metadata} onChange={setMetadata} />}

        {step === 3 && (
          <section className="cn-setup__section cn-setup__section--narrow">
            <header className="cn-setup__header">
              <h1>You're all set</h1>
              <p>Cinemion is ready. Your libraries are saved, and the rest of the household can get their own profiles from Settings.</p>
            </header>
            <div className="cn-setup__summary">
              {libraries.length === 0 && <p className="cn-setup__muted">No libraries yet. You can add them later in Settings › Libraries.</p>}
              {libraries.map((l) => (
                <div key={l.name} className="cn-setup__card">
                  {l.type === "shows" ? <Tv /> : <Clapperboard />}
                  <div>
                    <strong>{l.name}</strong>
                    <span>{l.paths.join(", ")}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="cn-setup__actions">
          {step > 0 && step < 3 && <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)}>Back</Button>}
          <Button variant="primary" size="lg" className="cn-setup__next" loading={submitting} onClick={next}>
            {step === 2 ? "Finish setup" : step === 3 ? "Go to Cinemion" : step === 1 && libraries.length === 0 ? "Skip for now" : "Continue"}
          </Button>
        </div>
      </main>
    </div>
  );
}

function guessCountry() {
  const region = navigator.language.split("-")[1]?.toUpperCase();
  return COUNTRIES.some((c) => c.value === region) ? region! : "US";
}

function LibrariesStep(props: { libraries: CreateLibraryRequest[]; onChange: (libraries: CreateLibraryRequest[]) => void }) {
  const { libraries, onChange } = props;
  const [type, setType] = useState<LibraryType>(libraries.some((l) => l.type === "movies") ? "shows" : "movies");
  const [name, setName] = useState(type === "movies" ? "Movies" : "Shows");
  const [nameEdited, setNameEdited] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);

  function changeType(value: LibraryType) {
    setType(value);
    if (!nameEdited) setName(value === "movies" ? "Movies" : "Shows");
  }

  function add() {
    if (!name.trim() || paths.length === 0) return;
    onChange([...libraries, { name: name.trim(), type, paths }]);
    setPaths([]);
    setNameEdited(false);
    const nextType = type === "movies" ? "shows" : "movies";
    setType(nextType);
    setName(nextType === "movies" ? "Movies" : "Shows");
  }

  return (
    <section className="cn-setup__section">
      <header className="cn-setup__header">
        <h1>Add your libraries</h1>
        <p>Point Cinemion at the folders that hold your movies and shows. A library can use several folders.</p>
      </header>

      {libraries.length > 0 && (
        <div className="cn-setup__added">
          {libraries.map((l, i) => (
            <div key={i} className="cn-setup__card">
              {l.type === "shows" ? <Tv /> : <Clapperboard />}
              <div>
                <strong>{l.name}</strong>
                <span>{l.paths.join(", ")}</span>
              </div>
              <IconButton label={`Remove ${l.name}`} icon={<Trash2 />} variant="ghost" size="sm" onClick={() => onChange(libraries.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}

      <div className="cn-setup__library">
        <div className="cn-setup__library-head">
          <SegmentedControl<LibraryType> label="Library type" value={type} onChange={changeType} options={[{ value: "movies", label: "Movies" }, { value: "shows", label: "Shows" }]} />
          <TextField
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
          />
        </div>
        <FolderBrowser key={libraries.length} selected={paths} onSelect={(path) => setPaths([...paths, path])} />
        <div className="cn-setup__library-foot">
          <div className="cn-setup__chips">
            {paths.length === 0 && <span className="cn-setup__muted">Open a folder and choose "Use this folder".</span>}
            {paths.map((p) => (
              <span key={p} className="cn-setup__chip">
                {p}
                <button type="button" aria-label={`Remove ${p}`} onClick={() => setPaths(paths.filter((x) => x !== p))}>×</button>
              </span>
            ))}
          </div>
          <Button variant="primary" onClick={add} disabled={!name.trim() || paths.length === 0}>Add library</Button>
        </div>
      </div>
    </section>
  );
}

function MetadataStep(props: { metadata: MetadataSettings; onChange: (metadata: MetadataSettings) => void }) {
  const { metadata, onChange } = props;

  function moveProvider(index: number, by: number) {
    const providers = [...metadata.providers];
    const [moved] = providers.splice(index, 1);
    providers.splice(index + by, 0, moved);
    onChange({ ...metadata, providers });
  }

  return (
    <section className="cn-setup__section cn-setup__section--narrow">
      <header className="cn-setup__header">
        <h1>Posters, plots and cast</h1>
        <p>Cinemion looks up details for everything it finds. Sources higher in the list win when they disagree.</p>
      </header>
      <ol className="cn-setup__providers" aria-label="Metadata sources, in priority order">
        {metadata.providers.map((id, i) => (
          <li key={id} className="cn-setup__provider">
            <div className="cn-setup__provider-row">
              <span className="cn-setup__provider-rank">{i + 1}</span>
              <div className="cn-setup__provider-text">
                <strong>{PROVIDERS[id]?.name ?? id}</strong>
                <span>{PROVIDERS[id]?.description}</span>
              </div>
              <IconButton label={`Move ${PROVIDERS[id]?.name} up`} icon={<ArrowUp />} size="sm" variant="ghost" disabled={i === 0} onClick={() => moveProvider(i, -1)} />
              <IconButton label={`Move ${PROVIDERS[id]?.name} down`} icon={<ArrowDown />} size="sm" variant="ghost" disabled={i === metadata.providers.length - 1} onClick={() => moveProvider(i, 1)} />
            </div>
            {id === "tmdb" && (
              <TextField
                label="API key"
                className="cn-setup__provider-field"
                placeholder="Paste your TMDB API key"
                value={metadata.tmdbApiKey ?? ""}
                onChange={(e) => onChange({ ...metadata, tmdbApiKey: e.target.value })}
                description={<>Free with a TMDB account. <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">How to get one</a></>}
              />
            )}
          </li>
        ))}
      </ol>
      <div className="cn-setup__row">
        <Select label="Language" value={metadata.language} options={LANGUAGES} onChange={(e) => onChange({ ...metadata, language: e.target.value })} />
        <Select label="Country (for age ratings)" value={metadata.country} options={COUNTRIES} onChange={(e) => onChange({ ...metadata, country: e.target.value })} />
      </div>
    </section>
  );
}
