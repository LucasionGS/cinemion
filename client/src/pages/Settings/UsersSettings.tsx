import { useEffect, useState } from "react";
import { Camera, Pencil, Plus, Trash2 } from "lucide-react";
import type { CreateUserRequest, UpdateUserRequest, UserInfo } from "@shared/api.ts";
import type { ProfileColor } from "@shared/profiles.ts";
import UsersApi from "../../Api/UsersApi.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import Avatar from "../../components/Avatar/Avatar.tsx";
import AvatarEditor from "../../components/AvatarEditor/AvatarEditor.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Select from "../../components/Select/Select.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import ColorPicker from "../../components/ColorPicker/ColorPicker.tsx";
import Dialog, { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import { RATINGS } from "../../lib/ratings.ts";

const LIMITS = [{ value: "", label: "No limit" }, ...RATINGS];

/**
 * Everyone who uses this server: create, edit and remove profiles.
 */
export default function UsersSettings() {
  const { users, error, reload } = UsersApi.useUsers();
  const { query } = useController(router);
  // `?new=1` comes from "Add profile" on the profile picker
  const [editing, setEditing] = useState<UserInfo | "new" | null>(query.get("new") ? "new" : null);

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Users</h1>
          <p>Everyone in the household gets their own profile, watch history and settings.</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add profile</Button>
      </header>

      {!users && !error && <Spinner size="2rem" />}
      {error && <p className="cn-settings__row-text"><span>{error}</span></p>}

      {users && (
        <div className="cn-settings__list">
          {users.map((u) => (
            <div key={u.id} className="cn-settings__item">
              <Avatar profile={u} size={3} />
              <div className="cn-settings__item-text">
                <strong>{u.name}{u.id === session.user?.id && " (you)"}</strong>
                <div className="cn-settings__badges">
                  <span className={`cn-settings__badge${u.role === "admin" ? " cn-settings__badge--accent" : ""}`}>{u.role === "admin" ? "Admin" : "Profile"}</span>
                  {u.hasPin && <span className="cn-settings__badge">PIN</span>}
                  {!u.hasPassword && <span className="cn-settings__badge">Picker only</span>}
                  {u.maxRating && <span className="cn-settings__badge">Up to {u.maxRating}</span>}
                  {!u.showOnPicker && <span className="cn-settings__badge">Hidden from picker</span>}
                </div>
              </div>
              <IconButton label={`Edit ${u.name}`} icon={<Pencil />} onClick={() => setEditing(u)} />
            </div>
          ))}
        </div>
      )}

      <UserDialog
        user={editing}
        onClose={() => {
          setEditing(null);
          if (query.get("new")) router.navigate("/settings/users", { replace: true });
        }}
        onChanged={reload}
      />
    </>
  );
}

function UserDialog(props: { user: UserInfo | "new" | null; onClose: () => void; onChanged: () => void }) {
  const { user, onClose, onChanged } = props;
  const isNew = user === "new";
  const existing = user && user !== "new" ? user : null;

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [color, setColor] = useState<ProfileColor>("coral");
  const [role, setRole] = useState("user");
  const [maxRating, setMaxRating] = useState("");
  const [showOnPicker, setShowOnPicker] = useState(true);
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [current, setCurrent] = useState<UserInfo | null>(null);

  useEffect(() => {
    if (!user) return;
    setName(existing?.name ?? "");
    setUsername(existing?.username ?? "");
    setColor(existing?.color ?? "coral");
    setRole(existing?.role ?? "user");
    setMaxRating(existing?.maxRating ?? "");
    setShowOnPicker(existing?.showOnPicker ?? true);
    setPin("");
    setPassword("");
    setCurrent(existing);
  }, [user]);

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const data: CreateUserRequest = { name, color, role, showOnPicker, maxRating: maxRating || null, pin: pin || null };
        if (username) data.username = username;
        if (password) data.password = password;
        await UsersApi.create(data);
        toasts.success(`${name.trim()} was added`);
      }
      else if (existing) {
        const data: UpdateUserRequest = { name, username, color, showOnPicker, maxRating: maxRating || null };
        if (session.isAdmin()) data.role = role;
        if (pin) data.pin = pin;
        if (password) data.password = password;
        const updated = await UsersApi.update(existing.id, data);
        if (updated.id === session.user?.id) session.setUser(updated);
        toasts.success("Changes saved");
      }
      onChanged();
      onClose();
    } catch (error) {
      toasts.error("Couldn't save", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removePin() {
    if (!existing) return;
    try {
      setCurrent(await UsersApi.update(existing.id, { pin: null }));
      onChanged();
      toasts.success("PIN removed");
    } catch (error) {
      toasts.error("Couldn't remove the PIN", (error as Error).message);
    }
  }

  async function remove() {
    if (!existing) return;
    setDeleting(true);
    try {
      await UsersApi.remove(existing.id);
      toasts.success(`${existing.name} was removed`);
      setConfirmDelete(false);
      onChanged();
      onClose();
    } catch (error) {
      toasts.error("Couldn't remove the user", (error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  const pinValid = pin === "" || /^\d{4}$/.test(pin);
  const passwordValid = password === "" || password.length >= 6;

  return (
    <>
      <Dialog
        open={!!user}
        onOpenChange={(open) => !open && onClose()}
        title={isNew ? "Add profile" : `Edit ${existing?.name}`}
        description={isNew ? "A profile for someone in the household. They get their own watch history." : undefined}
        size="lg"
        footer={<>
          {existing && existing.id !== session.user?.id && <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Remove</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!name.trim() || !pinValid || !passwordValid}>{isNew ? "Add profile" : "Save changes"}</Button>
        </>}
      >
        {current && (
          <div className="cn-settings__row">
            <Avatar profile={{ ...current, name: name || current.name, color }} size={4.5} />
            <div className="cn-settings__row-text">
              <strong>Profile picture</strong>
              <span>{current.avatar ? "Uploaded picture." : "Initial on their colour."}</span>
            </div>
            <Button icon={<Camera />} onClick={() => setEditorOpen(true)}>{current.avatar ? "Change" : "Upload"}</Button>
          </div>
        )}
        <div className="cn-settings__row">
          <TextField label="Name" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 14rem" }} />
          <TextField
            label="Username"
            value={username}
            placeholder={isNew ? "Made from the name" : undefined}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            style={{ flex: "1 1 14rem" }}
          />
        </div>
        <ColorPicker label="Colour" value={color} onChange={setColor} />
        <div className="cn-settings__row">
          {session.isAdmin() && (
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: "user", label: "Profile" }, { value: "admin", label: "Admin" }]} style={{ flex: "1 1 12rem" }} />
          )}
          <Select label="Age rating limit" value={maxRating} onChange={(e) => setMaxRating(e.target.value)} options={LIMITS} style={{ flex: "1 1 12rem" }} />
        </div>
        <Switch label="Show on the profile picker" description="Hidden profiles sign in with their username and password." checked={showOnPicker} onChange={setShowOnPicker} />
        <div className="cn-settings__row">
          <TextField
            label={current?.hasPin ? "New PIN" : "PIN"}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            placeholder={current?.hasPin ? "Leave empty to keep it" : "Optional, 4 digits"}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            error={pinValid ? null : "The PIN must be exactly 4 digits."}
            style={{ flex: "1 1 12rem" }}
          />
          {current?.hasPin && <Button variant="ghost" onClick={removePin} style={{ alignSelf: "flex-end" }}>Remove PIN</Button>}
        </div>
        <TextField
          label={current?.hasPassword ? "New password" : "Password"}
          type="password"
          autoComplete="new-password"
          placeholder={current?.hasPassword ? "Leave empty to keep it" : "Optional"}
          description={current?.hasPassword ? undefined : "Without a password, this profile can only be opened from the profile picker."}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordValid ? null : "Use at least 6 characters."}
        />
      </Dialog>

      {current && <AvatarEditor open={editorOpen} onOpenChange={setEditorOpen} user={current} onSaved={(u) => {
        setCurrent(u);
        if (u.id === session.user?.id) session.setUser(u);
        onChanged();
      }} />}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Remove ${existing?.name}?`}
        description="Their profile, picture and watch history are deleted. This can't be undone."
        confirmLabel="Remove"
        danger
        loading={deleting}
        onConfirm={remove}
      />
    </>
  );
}
