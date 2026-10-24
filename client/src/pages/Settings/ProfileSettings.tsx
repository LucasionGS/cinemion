import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import type { ProfileColor, SubtitleStyle } from "@shared/profiles.ts";
import type { TraktLinkStart, TraktStatus } from "@shared/trakt.ts";
import UsersApi from "../../Api/UsersApi.ts";
import TraktApi from "../../Api/TraktApi.ts";
import { session } from "../../Session.ts";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import Avatar from "../../components/Avatar/Avatar.tsx";
import AvatarEditor from "../../components/AvatarEditor/AvatarEditor.tsx";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import ColorPicker from "../../components/ColorPicker/ColorPicker.tsx";
import Dialog from "../../components/Dialog/Dialog.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import Select from "../../components/Select/Select.tsx";
import cx from "../../lib/cx.ts";
import { I18nController, LANGUAGES, rich, t } from "../../i18n/I18n.ts";
import NotificationsCard from "./NotificationsCard.tsx";
import "../../components/Player/Player.scss";

/**
 * The signed-in user's own name, colour, picture, PIN, password and how subtitles look.
 */
export default function ProfileSettings() {
  const { user } = useController(session);
  const [name, setName] = useState(user?.name ?? "");
  const [color, setColor] = useState<ProfileColor>(user?.color ?? "sky");
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setColor(user.color);
  }, [user?.id]);

  if (!user) return null;
  const changed = name.trim() !== user.name || color !== user.color;

  async function save() {
    setSaving(true);
    try {
      session.setUser(await UsersApi.updateSelf({ name, color }));
      toasts.success(t("settings.profile.saved"));
    } catch (error) {
      toasts.error(t("settings.profile.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removePin() {
    try {
      session.setUser(await UsersApi.updateSelf({ pin: null }));
      toasts.success(t("settings.profile.pin.removed"));
    } catch (error) {
      toasts.error(t("settings.profile.pin.couldntRemove"), (error as Error).message);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("settings.profile.title")}</h1>
          <p>{t("settings.profile.intro")}</p>
        </div>
      </header>

      <section className="cn-settings__card">
        <div className="cn-settings__row">
          <button type="button" className="cn-settings__avatar-button" onClick={() => setEditorOpen(true)} aria-label={t("settings.profile.changePicture")}>
            <Avatar profile={{ ...user, name: name || user.name, color }} size={6} />
          </button>
          <div className="cn-settings__row-text">
            <strong>{t("settings.profile.picture")}</strong>
            <span>{user.avatar ? t("settings.profile.pictureShown") : t("settings.profile.pictureNone")}</span>
          </div>
          <Button icon={<Camera />} onClick={() => setEditorOpen(true)}>{user.avatar ? t("settings.profile.changePictureButton") : t("settings.profile.uploadPicture")}</Button>
        </div>
        <div className="cn-settings__divider" />
        <TextField label={t("settings.profile.name")} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <ColorPicker label={user.avatar ? t("settings.profile.colourWithPicture") : t("settings.profile.colour")} value={color} onChange={setColor} />
        <div>
          <Button variant="primary" onClick={save} loading={saving} disabled={!changed || !name.trim()}>{t("settings.profile.saveChanges")}</Button>
        </div>
      </section>

      <section className="cn-settings__card">
        <h2>{t("settings.profile.signIn")}</h2>
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>{t("settings.profile.pin.title")}</strong>
            <span>{user.hasPin ? t("settings.profile.pin.on") : t("settings.profile.pin.off")}</span>
          </div>
          {user.hasPin && <Button variant="ghost" onClick={removePin}>{t("common.remove")}</Button>}
          <Button onClick={() => setPinOpen(true)}>{user.hasPin ? t("settings.profile.pin.change") : t("settings.profile.pin.set")}</Button>
        </div>
        <div className="cn-settings__divider" />
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>{t("settings.profile.password.title")}</strong>
            <span>{user.hasPassword ? t("settings.profile.password.on", { username: user.username }) : t("settings.profile.password.off")}</span>
          </div>
          <Button onClick={() => setPasswordOpen(true)}>{user.hasPassword ? t("settings.profile.password.change") : t("settings.profile.password.set")}</Button>
        </div>
      </section>

      <LanguageCard />
      <NotificationsCard />
      <SubtitleStyleCard />
      <TraktCard />

      <AvatarEditor open={editorOpen} onOpenChange={setEditorOpen} user={user} onSaved={(u) => session.setUser(u)} />
      <PinDialog open={pinOpen} onOpenChange={setPinOpen} />
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} hasPassword={user.hasPassword} />
    </>
  );
}

function PinDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange } = props;
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setPin("");
  }, [open]);

  async function save() {
    setSaving(true);
    try {
      session.setUser(await UsersApi.updateSelf({ pin }));
      toasts.success(t("settings.profile.pin.saved"));
      onOpenChange(false);
    } catch (error) {
      toasts.error(t("settings.profile.pin.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("settings.profile.pin.title")}
      description={t("settings.profile.pin.dialogDescription")}
      size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!/^\d{4}$/.test(pin)}>{t("settings.profile.pin.save")}</Button>
      </>}
    >
      <TextField label={t("settings.profile.pin.newPin")} inputMode="numeric" autoComplete="off" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
    </Dialog>
  );
}

function PasswordDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; hasPassword: boolean }) {
  const { open, onOpenChange, hasPassword } = props;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNext("");
    setConfirm("");
  }, [open]);

  const mismatch = confirm.length > 0 && confirm !== next;

  async function save() {
    setSaving(true);
    try {
      session.setUser(await UsersApi.updateSelf({ newPassword: next, currentPassword: hasPassword ? current : undefined }));
      toasts.success(t("settings.profile.password.changed"));
      onOpenChange(false);
    } catch (error) {
      toasts.error(t("settings.profile.password.couldntChange"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={hasPassword ? t("settings.profile.password.change") : t("settings.profile.password.set")}
      size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={next.length < 6 || next !== confirm || (hasPassword && !current)}>{t("settings.profile.password.save")}</Button>
      </>}
    >
      {hasPassword && <TextField label={t("settings.profile.password.current")} type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />}
      <TextField label={t("settings.profile.password.new")} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} description={t("settings.profile.password.newDescription")} />
      <TextField label={t("settings.profile.password.confirm")} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? t("settings.profile.password.mismatch") : null} />
    </Dialog>
  );
}

/**
 * The language of the interface for this profile. Saved as soon as it changes.
 */
function LanguageCard() {
  const { user } = useController(session);
  if (!user) return null;
  const browser = I18nController.fromBrowser();

  async function change(value: string) {
    const previous = user!;
    const preferences = { ...previous.preferences, language: value || null };
    try {
      session.setUser(await UsersApi.updateSelf({ preferences }));
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    }
  }

  return (
    <section className="cn-settings__card">
      <h2>{t("language.title")}</h2>
      <Select
        label={t("language.label")}
        description={t("language.description")}
        value={user.preferences.language ?? ""}
        options={[
          { value: "", label: t("language.automatic", { language: browser.name }) },
          ...LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
        ]}
        onChange={(e) => change(e.target.value)}
      />
      <p className="cn-settings__row-text">
        <span>{rich("language.helpTranslate", { link: (text) => <a href="https://github.com/LucasionGS/cinemion/blob/main/docs/translating.md" target="_blank" rel="noreferrer">{text}</a> })}</span>
      </p>
    </section>
  );
}

/**
 * Size, colour and background of subtitles for this profile, with a preview. Saved as soon as something changes.
 */
function SubtitleStyleCard() {
  const { user } = useController(session);
  if (!user) return null;
  const style = user.preferences.subtitles;

  async function update(patch: Partial<SubtitleStyle>) {
    const previous = user!;
    const next = { ...previous, preferences: { ...previous.preferences, subtitles: { ...style, ...patch } } };
    // Show the change right away; the server's answer replaces it
    session.setUser(next);
    try {
      session.setUser(await UsersApi.updateSelf({ preferences: next.preferences }));
    } catch (error) {
      session.setUser(previous);
      toasts.error(t("common.couldntSave"), (error as Error).message);
    }
  }

  return (
    <section className="cn-settings__card">
      <h2>{t("settings.profile.subtitles.title")}</h2>
      <div className="cn-subtitle-preview" aria-hidden="true">
        <div className={cx("cn-player__subtitles", `cn-player__subtitles--${style.size}`, `cn-player__subtitles--${style.color}`, `cn-player__subtitles--${style.background}`)}>
          <span>{t("settings.profile.subtitles.previewLine1")}<br />{t("settings.profile.subtitles.previewLine2")}</span>
        </div>
      </div>
      <div className="cn-settings__row">
        <p className="cn-settings__row-text"><strong>{t("settings.profile.subtitles.size")}</strong></p>
        <SegmentedControl<SubtitleStyle["size"]>
          label={t("settings.profile.subtitles.size")}
          value={style.size}
          onChange={(size) => update({ size })}
          options={[
            { value: "small", label: t("settings.profile.subtitles.sizes.small") },
            { value: "medium", label: t("settings.profile.subtitles.sizes.medium") },
            { value: "large", label: t("settings.profile.subtitles.sizes.large") },
            { value: "huge", label: t("settings.profile.subtitles.sizes.huge") },
          ]}
        />
      </div>
      <div className="cn-settings__row">
        <p className="cn-settings__row-text"><strong>{t("settings.profile.subtitles.colour")}</strong></p>
        <SegmentedControl<SubtitleStyle["color"]>
          label={t("settings.profile.subtitles.colour")}
          value={style.color}
          onChange={(color) => update({ color })}
          options={[
            { value: "white", label: t("settings.profile.subtitles.colours.white") },
            { value: "yellow", label: t("settings.profile.subtitles.colours.yellow") },
            { value: "cyan", label: t("settings.profile.subtitles.colours.cyan") },
            { value: "green", label: t("settings.profile.subtitles.colours.green") },
          ]}
        />
      </div>
      <div className="cn-settings__row">
        <p className="cn-settings__row-text"><strong>{t("settings.profile.subtitles.background")}</strong></p>
        <SegmentedControl<SubtitleStyle["background"]>
          label={t("settings.profile.subtitles.background")}
          value={style.background}
          onChange={(background) => update({ background })}
          options={[
            { value: "box", label: t("settings.profile.subtitles.backgrounds.box") },
            { value: "shadow", label: t("settings.profile.subtitles.backgrounds.shadow") },
            { value: "none", label: t("common.none") },
          ]}
        />
      </div>
      <div className="cn-settings__divider" />
      <Switch
        label={t("settings.profile.subtitles.keepStyling")}
        description={t("settings.profile.subtitles.keepStylingDescription")}
        checked={style.keepStyling}
        onChange={(keepStyling) => update({ keepStyling })}
      />
    </section>
  );
}

/**
 * This profile's Trakt account: link it with a code, bring its history in, or unlink it.
 */
function TraktCard() {
  const [status, setStatus] = useState<TraktStatus | null>(null);
  const [link, setLink] = useState<TraktLinkStart | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    TraktApi.status().then(setStatus).catch(() => { });
  }, []);

  // While a code is showing, ask now and then whether it was entered
  useEffect(() => {
    if (!link) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const result = await TraktApi.poll();
        if (stopped || result.status === "pending") return;
        setLink(null);
        if (result.status === "linked") {
          setStatus({ available: true, connected: true, username: result.username });
          toasts.success(t("settings.profile.trakt.isLinked"), result.username ? t("settings.profile.trakt.signedInAs", { name: result.username }) : undefined);
        }
        else toasts.error(result.status === "denied" ? t("settings.profile.trakt.declined") : t("settings.profile.trakt.expired"), t("settings.profile.trakt.startAgain"));
      } catch (error) {
        setLink(null);
        toasts.error(t("settings.profile.trakt.couldntLink"), (error as Error).message);
      }
    }, Math.max(1, link.interval) * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [link]);

  async function start() {
    setBusy(true);
    try {
      setLink(await TraktApi.startLink());
    } catch (error) {
      toasts.error(t("settings.profile.trakt.couldntStart"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importHistory() {
    setBusy(true);
    try {
      const result = await TraktApi.importHistory();
      const total = result.movies + result.episodes;
      toasts.success(total
        ? t("settings.profile.trakt.imported", {
          movies: t("settings.profile.trakt.movies", { count: result.movies }),
          episodes: t("settings.profile.trakt.episodes", { count: result.episodes }),
        })
        : t("settings.profile.trakt.upToDate"));
    } catch (error) {
      toasts.error(t("settings.profile.trakt.couldntImport"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await TraktApi.unlink();
      setStatus({ available: true, connected: false, username: null });
    } catch (error) {
      toasts.error(t("settings.profile.trakt.couldntUnlink"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status?.available && !status?.connected) return null;
  return (
    <section className="cn-settings__card">
      <h2>Trakt</h2>
      {status.connected && (
        <>
          <div className="cn-settings__row">
            <div className="cn-settings__row-text">
              <strong>{status.username ? t("settings.profile.trakt.linkedAs", { name: status.username }) : t("settings.profile.trakt.linked")}</strong>
              <span>{t("settings.profile.trakt.linkedDescription")}</span>
            </div>
            <Button variant="ghost" onClick={unlink} disabled={busy}>{t("settings.profile.trakt.unlink")}</Button>
          </div>
          <div className="cn-settings__divider" />
          <div className="cn-settings__row">
            <div className="cn-settings__row-text">
              <strong>{t("settings.profile.trakt.importTitle")}</strong>
              <span>{t("settings.profile.trakt.importDescription")}</span>
            </div>
            <Button onClick={importHistory} loading={busy}>{t("settings.profile.trakt.importButton")}</Button>
          </div>
        </>
      )}
      {!status.connected && !link && (
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>{t("settings.profile.trakt.keepUpToDate")}</strong>
            <span>{t("settings.profile.trakt.linkDescription")}</span>
          </div>
          <Button variant="primary" onClick={start} loading={busy}>{t("settings.profile.trakt.link")}</Button>
        </div>
      )}
      {link && (
        <div className="cn-trakt-code" role="status">
          <span>{rich("settings.profile.trakt.goTo", { url: <a href={link.verificationUrl} target="_blank" rel="noreferrer">{link.verificationUrl.replace(/^https?:\/\//, "")}</a> })}</span>
          <strong>{link.userCode}</strong>
          <span className="cn-trakt-code__wait"><Spinner size="1rem" /> {t("settings.profile.trakt.waiting")}</span>
          <Button variant="ghost" size="sm" onClick={() => setLink(null)}>{t("common.cancel")}</Button>
        </div>
      )}
    </section>
  );
}
