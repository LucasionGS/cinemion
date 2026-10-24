import { useState } from "react";
import { ArchiveRestore, Check, Trash2 } from "lucide-react";
import type { CreateLibraryRequest, LibraryType, MetadataSettings } from "@shared/api.ts";
import ServerApi from "../../Api/ServerApi.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
import Logo from "../../components/Logo/Logo.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import FolderBrowser from "../../components/FolderBrowser/FolderBrowser.tsx";
import MetadataForm, { COUNTRIES } from "../../components/MetadataForm/MetadataForm.tsx";
import LibraryIcon from "../../components/LibraryIcon/LibraryIcon.tsx";
import RestoreBackup from "./RestoreBackup.tsx";
import "./Setup.scss";

const STEPS: { label: TranslationKey; sub: TranslationKey }[] = [
  { label: "setup.steps.account.label", sub: "setup.steps.account.sub" },
  { label: "setup.steps.libraries.label", sub: "setup.steps.libraries.sub" },
  { label: "setup.steps.metadata.label", sub: "setup.steps.metadata.sub" },
  { label: "setup.steps.done.label", sub: "setup.steps.done.sub" },
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
  const [restoring, setRestoring] = useState(false);

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
  const [metadata, setMetadata] = useState<MetadataSettings>({ tmdbApiKey: null, tvdbApiKey: null, tvdbPin: null, omdbApiKey: null, language: "en", country: guessCountry(), providers: ["local", "tmdb", "tvdb"] });

  const accountErrors = {
    name: !name.trim() ? t("setup.account.errors.name") : null,
    username: !/^[a-z0-9._-]{2,32}$/.test(username) ? t("setup.account.errors.username") : null,
    password: password.length < 6 ? t("setup.account.errors.password") : null,
    confirm: confirm !== password ? t("setup.account.errors.confirm") : null,
    pin: pin && !/^\d{4}$/.test(pin) ? t("setup.account.errors.pin") : null,
    serverName: !serverName.trim() ? t("setup.account.errors.serverName") : null,
  };
  const accountValid = Object.values(accountErrors).every((e) => e === null);

  async function finish() {
    setSubmitting(true);
    try {
      const response = await ServerApi.completeSetup({
        serverName: serverName.trim(),
        admin: { name: name.trim(), username, password, pin: pin || null },
        libraries,
        metadata: { ...metadata, tmdbApiKey: metadata.tmdbApiKey?.trim() || null, tvdbApiKey: metadata.tvdbApiKey?.trim() || null, tvdbPin: metadata.tvdbPin?.trim() || null, omdbApiKey: metadata.omdbApiKey?.trim() || null },
      });
      session.signIn(response);
      setStep(3);
    } catch (error) {
      toasts.error(t("setup.failed"), (error as Error).message);
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
        <nav className="cn-setup__steps" aria-label={t("setup.steps.navigation")}>
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
                <strong>{t(s.label)}</strong>
                <span>{t(s.sub)}</span>
              </span>
            </button>
          ))}
        </nav>
        <p className="cn-setup__note">{t("setup.note")}</p>
      </aside>

      <main className="cn-setup__main">
        {restoring && <RestoreBackup onCancel={() => setRestoring(false)} />}

        {!restoring && <span className="cn-setup__progress">{t("setup.progress", { step: step + 1, total: STEPS.length })}</span>}

        {!restoring && step === 0 && (
          <section className="cn-setup__section cn-setup__section--narrow">
            <header className="cn-setup__header">
              <h1>{t("setup.account.title")}</h1>
              <p>{t("setup.account.intro")}</p>
            </header>
            <TextField label={t("setup.account.serverName")} value={serverName} onChange={(e) => setServerName(e.target.value)} description={t("setup.account.serverNameDescription")} error={showErrors ? accountErrors.serverName : null} />
            <TextField
              label={t("setup.account.name")}
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (!usernameEdited) setUsername(usernameFrom(e.target.value));
              }}
              error={showErrors ? accountErrors.name : null}
            />
            <TextField
              label={t("setup.account.username")}
              value={username}
              autoComplete="username"
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase());
                setUsernameEdited(true);
              }}
              description={t("setup.account.usernameDescription")}
              error={showErrors ? accountErrors.username : null}
            />
            <div className="cn-setup__row">
              <TextField label={t("setup.account.password")} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={showErrors ? accountErrors.password : null} />
              <TextField label={t("setup.account.confirmPassword")} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={showErrors ? accountErrors.confirm : null} />
            </div>
            <TextField
              label={rich("setup.account.pin", { optional: (text) => <span className="cn-setup__optional">{text}</span> })}
              className="cn-setup__pin"
              inputMode="numeric"
              maxLength={4}
              placeholder={t("setup.account.pinPlaceholder")}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              description={t("setup.account.pinDescription")}
              error={showErrors ? accountErrors.pin : null}
            />
            <div className="cn-setup__card cn-setup__restore-hint">
              <ArchiveRestore />
              <div>
                <strong>{t("setup.restore.hintTitle")}</strong>
                <span>{t("setup.restore.hint")}</span>
              </div>
              <Button size="sm" onClick={() => setRestoring(true)}>{t("setup.restore.open")}</Button>
            </div>
          </section>
        )}

        {!restoring && step === 1 && <LibrariesStep libraries={libraries} onChange={setLibraries} />}

        {!restoring && step === 2 && <MetadataStep metadata={metadata} onChange={setMetadata} />}

        {!restoring && step === 3 && (
          <section className="cn-setup__section cn-setup__section--narrow">
            <header className="cn-setup__header">
              <h1>{t("setup.done.title")}</h1>
              <p>{t("setup.done.intro")}</p>
            </header>
            <div className="cn-setup__summary">
              {libraries.length === 0 && <p className="cn-setup__muted">{t("setup.done.noLibraries")}</p>}
              {libraries.map((l) => (
                <div key={l.name} className="cn-setup__card">
                  <LibraryIcon type={l.type} />
                  <div>
                    <strong>{l.name}</strong>
                    <span>{l.paths.join(t("common.listSeparator"))}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!restoring && <div className="cn-setup__actions">
          {step > 0 && step < 3 && <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)}>{t("common.back")}</Button>}
          <Button variant="primary" size="lg" className="cn-setup__next" loading={submitting} onClick={next}>
            {step === 2 ? t("setup.actions.finish") : step === 3 ? t("setup.actions.goToCinemion") : step === 1 && libraries.length === 0 ? t("setup.actions.skip") : t("setup.actions.continue")}
          </Button>
        </div>}
      </main>
    </div>
  );
}

function guessCountry() {
  const region = navigator.language.split("-")[1]?.toUpperCase();
  return COUNTRIES.some((c) => c.value === region) ? region! : "US";
}

const TYPE_NAMES: Record<LibraryType, TranslationKey> = {
  movies: "setup.libraries.types.movies",
  shows: "setup.libraries.types.shows",
  videos: "setup.libraries.types.videos",
  music: "setup.libraries.types.music",
  audiobooks: "setup.libraries.types.audiobooks",
  books: "setup.libraries.types.books",
  photos: "setup.libraries.types.photos",
  clips: "setup.libraries.types.clips",
};

/**
 * The library types in the order the picker shows them.
 */
const TYPE_ORDER: LibraryType[] = ["movies", "shows", "videos", "music", "photos", "clips", "audiobooks", "books"];

/**
 * The kind of library not added yet, in the usual order.
 */
function nextType(libraries: CreateLibraryRequest[]): LibraryType {
  return TYPE_ORDER.find((kind) => !libraries.some((l) => l.type === kind)) ?? "movies";
}

function LibrariesStep(props: { libraries: CreateLibraryRequest[]; onChange: (libraries: CreateLibraryRequest[]) => void }) {
  const { libraries, onChange } = props;
  const [type, setType] = useState<LibraryType>(nextType(libraries));
  const [name, setName] = useState(() => t(TYPE_NAMES[type]));
  const [nameEdited, setNameEdited] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);

  function changeType(value: LibraryType) {
    setType(value);
    if (!nameEdited) setName(t(TYPE_NAMES[value]));
  }

  function add() {
    if (!name.trim() || paths.length === 0) return;
    const added = [...libraries, { name: name.trim(), type, paths }];
    onChange(added);
    setPaths([]);
    setNameEdited(false);
    setType(nextType(added));
    setName(t(TYPE_NAMES[nextType(added)]));
  }

  return (
    <section className="cn-setup__section">
      <header className="cn-setup__header">
        <h1>{t("setup.libraries.title")}</h1>
        <p>{t("setup.libraries.intro")}</p>
      </header>

      {libraries.length > 0 && (
        <div className="cn-setup__added">
          {libraries.map((l, i) => (
            <div key={i} className="cn-setup__card">
              <LibraryIcon type={l.type} />
              <div>
                <strong>{l.name}</strong>
                <span>{l.paths.join(t("common.listSeparator"))}</span>
              </div>
              <IconButton label={t("setup.libraries.remove", { name: l.name })} icon={<Trash2 />} variant="ghost" size="sm" onClick={() => onChange(libraries.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}

      <div className="cn-setup__library">
        <div className="cn-setup__library-head">
          <SegmentedControl<LibraryType> label={t("setup.libraries.type")} value={type} onChange={changeType} options={TYPE_ORDER.map((kind) => ({ value: kind, label: t(TYPE_NAMES[kind]) }))} />
          <TextField
            label={t("setup.libraries.name")}
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
            {paths.length === 0 && <span className="cn-setup__muted">{t("setup.libraries.noFolders")}</span>}
            {paths.map((p) => (
              <span key={p} className="cn-setup__chip">
                {p}
                <button type="button" aria-label={t("setup.libraries.removeFolder", { path: p })} onClick={() => setPaths(paths.filter((x) => x !== p))}>×</button>
              </span>
            ))}
          </div>
          <Button variant="primary" onClick={add} disabled={!name.trim() || paths.length === 0}>{t("setup.libraries.add")}</Button>
        </div>
      </div>
    </section>
  );
}

function MetadataStep(props: { metadata: MetadataSettings; onChange: (metadata: MetadataSettings) => void }) {
  const { metadata, onChange } = props;
  return (
    <section className="cn-setup__section cn-setup__section--narrow">
      <header className="cn-setup__header">
        <h1>{t("setup.metadata.title")}</h1>
        <p>{t("setup.metadata.intro")}</p>
      </header>
      <MetadataForm value={metadata} onChange={onChange} />
    </section>
  );
}
