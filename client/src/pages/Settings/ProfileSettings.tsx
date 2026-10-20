import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import type { ProfileColor, SubtitleStyle } from "@shared/profiles.ts";
import UsersApi from "../../Api/UsersApi.ts";
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
import cx from "../../lib/cx.ts";
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
      toasts.success("Profile saved");
    } catch (error) {
      toasts.error("Couldn't save your profile", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removePin() {
    try {
      session.setUser(await UsersApi.updateSelf({ pin: null }));
      toasts.success("PIN removed");
    } catch (error) {
      toasts.error("Couldn't remove the PIN", (error as Error).message);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Your profile</h1>
          <p>How you show up on the profile picker and around Cinemion.</p>
        </div>
      </header>

      <section className="cn-settings__card">
        <div className="cn-settings__row">
          <button type="button" className="cn-settings__avatar-button" onClick={() => setEditorOpen(true)} aria-label="Change profile picture">
            <Avatar profile={{ ...user, name: name || user.name, color }} size={6} />
          </button>
          <div className="cn-settings__row-text">
            <strong>Profile picture</strong>
            <span>{user.avatar ? "Shown instead of your initial." : "Upload a photo, or keep your initial on your colour."}</span>
          </div>
          <Button icon={<Camera />} onClick={() => setEditorOpen(true)}>{user.avatar ? "Change picture" : "Upload picture"}</Button>
        </div>
        <div className="cn-settings__divider" />
        <TextField label="Name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <ColorPicker label={user.avatar ? "Colour (used when the picture can't load)" : "Colour"} value={color} onChange={setColor} />
        <div>
          <Button variant="primary" onClick={save} loading={saving} disabled={!changed || !name.trim()}>Save changes</Button>
        </div>
      </section>

      <section className="cn-settings__card">
        <h2>Sign-in</h2>
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>Profile PIN</strong>
            <span>{user.hasPin ? "Asked when you pick your profile on a shared screen." : "Anyone can open your profile from the profile picker."}</span>
          </div>
          {user.hasPin && <Button variant="ghost" onClick={removePin}>Remove</Button>}
          <Button onClick={() => setPinOpen(true)}>{user.hasPin ? "Change PIN" : "Set a PIN"}</Button>
        </div>
        <div className="cn-settings__divider" />
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            <strong>Password</strong>
            <span>{user.hasPassword ? `Sign in as "${user.username}" on new devices.` : "No password yet, so this profile only opens from the profile picker."}</span>
          </div>
          <Button onClick={() => setPasswordOpen(true)}>{user.hasPassword ? "Change password" : "Set a password"}</Button>
        </div>
      </section>

      <SubtitleStyleCard />

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
      toasts.success("PIN saved");
      onOpenChange(false);
    } catch (error) {
      toasts.error("Couldn't save the PIN", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Profile PIN"
      description="Four digits, asked when your profile is picked on a shared screen."
      size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!/^\d{4}$/.test(pin)}>Save PIN</Button>
      </>}
    >
      <TextField label="New PIN" inputMode="numeric" autoComplete="off" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
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
      toasts.success("Password changed");
      onOpenChange(false);
    } catch (error) {
      toasts.error("Couldn't change the password", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={hasPassword ? "Change password" : "Set a password"}
      size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={next.length < 6 || next !== confirm || (hasPassword && !current)}>Save password</Button>
      </>}
    >
      {hasPassword && <TextField label="Current password" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />}
      <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} description="At least 6 characters." />
      <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? "The passwords don't match." : null} />
    </Dialog>
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
      toasts.error("Couldn't save", (error as Error).message);
    }
  }

  return (
    <section className="cn-settings__card">
      <h2>Subtitles</h2>
      <div className="cn-subtitle-preview" aria-hidden="true">
        <div className={cx("cn-player__subtitles", `cn-player__subtitles--${style.size}`, `cn-player__subtitles--${style.color}`, `cn-player__subtitles--${style.background}`)}>
          <span>Did you hear that?<br />Something is out there.</span>
        </div>
      </div>
      <div className="cn-settings__row">
        <p className="cn-settings__row-text"><strong>Size</strong></p>
        <SegmentedControl<SubtitleStyle["size"]>
          label="Size"
          value={style.size}
          onChange={(size) => update({ size })}
          options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }, { value: "huge", label: "Huge" }]}
        />
      </div>
      <div className="cn-settings__row">
        <p className="cn-settings__row-text"><strong>Colour</strong></p>
        <SegmentedControl<SubtitleStyle["color"]>
          label="Colour"
          value={style.color}
          onChange={(color) => update({ color })}
          options={[{ value: "white", label: "White" }, { value: "yellow", label: "Yellow" }, { value: "cyan", label: "Cyan" }, { value: "green", label: "Green" }]}
        />
      </div>
      <div className="cn-settings__row">
        <p className="cn-settings__row-text"><strong>Background</strong></p>
        <SegmentedControl<SubtitleStyle["background"]>
          label="Background"
          value={style.background}
          onChange={(background) => update({ background })}
          options={[{ value: "box", label: "Dark box" }, { value: "shadow", label: "Outline" }, { value: "none", label: "None" }]}
        />
      </div>
      <div className="cn-settings__divider" />
      <Switch
        label="Keep the look of styled subtitles"
        description="ASS subtitles, common for anime, come with their own fonts, colours and positions. Off, they use the style above like all other subtitles."
        checked={style.keepStyling}
        onChange={(keepStyling) => update({ keepStyling })}
      />
    </section>
  );
}
