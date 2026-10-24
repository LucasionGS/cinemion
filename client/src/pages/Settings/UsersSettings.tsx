import { useEffect, useState } from "react";
import { Camera, Pencil, Plus, Trash2 } from "lucide-react";
import type { CreateUserRequest, UpdateUserRequest, UserInfo } from "@shared/api.ts";
import type { ProfileColor } from "@shared/profiles.ts";
import UsersApi from "../../Api/UsersApi.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import { t } from "../../i18n/I18n.ts";
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
import { ratingOptions } from "../../lib/ratings.ts";

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
          <h1>{t("admin.users.title")}</h1>
          <p>{t("admin.users.intro")}</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>{t("admin.users.addProfile")}</Button>
      </header>

      {!users && !error && <Spinner size="2rem" />}
      {error && <p className="cn-settings__row-text"><span>{error}</span></p>}

      {users && (
        <div className="cn-settings__list">
          {users.map((u) => (
            <div key={u.id} className="cn-settings__item">
              <Avatar profile={u} size={3} />
              <div className="cn-settings__item-text">
                <strong>{u.id === session.user?.id ? t("admin.users.you", { name: u.name }) : u.name}</strong>
                <div className="cn-settings__badges">
                  <span className={`cn-settings__badge${u.role === "admin" ? " cn-settings__badge--accent" : ""}`}>{u.role === "admin" ? t("admin.users.roles.admin") : t("admin.users.roles.user")}</span>
                  {u.hasPin && <span className="cn-settings__badge">{t("admin.users.badges.pin")}</span>}
                  {!u.hasPassword && <span className="cn-settings__badge">{t("admin.users.badges.pickerOnly")}</span>}
                  {u.maxRating && <span className="cn-settings__badge">{t("admin.users.badges.upTo", { rating: u.maxRating })}</span>}
                  {!u.showOnPicker && <span className="cn-settings__badge">{t("admin.users.badges.hidden")}</span>}
                </div>
              </div>
              <IconButton label={t("admin.users.edit", { name: u.name })} icon={<Pencil />} onClick={() => setEditing(u)} />
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
        toasts.success(t("admin.users.added", { name: name.trim() }));
      }
      else if (existing) {
        const data: UpdateUserRequest = { name, username, color, showOnPicker, maxRating: maxRating || null };
        if (session.isAdmin()) data.role = role;
        if (pin) data.pin = pin;
        if (password) data.password = password;
        const updated = await UsersApi.update(existing.id, data);
        if (updated.id === session.user?.id) session.setUser(updated);
        toasts.success(t("admin.users.saved"));
      }
      onChanged();
      onClose();
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removePin() {
    if (!existing) return;
    try {
      setCurrent(await UsersApi.update(existing.id, { pin: null }));
      onChanged();
      toasts.success(t("admin.users.pinRemoved"));
    } catch (error) {
      toasts.error(t("admin.users.pinRemoveFailed"), (error as Error).message);
    }
  }

  async function remove() {
    if (!existing) return;
    setDeleting(true);
    try {
      await UsersApi.remove(existing.id);
      toasts.success(t("admin.users.removed", { name: existing.name }));
      setConfirmDelete(false);
      onChanged();
      onClose();
    } catch (error) {
      toasts.error(t("admin.users.removeFailed"), (error as Error).message);
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
        title={isNew ? t("admin.users.dialog.addTitle") : t("admin.users.dialog.editTitle", { name: existing?.name ?? "" })}
        description={isNew ? t("admin.users.dialog.addDescription") : undefined}
        size="lg"
        footer={<>
          {existing && existing.id !== session.user?.id && <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>{t("common.remove")}</Button>}
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!name.trim() || !pinValid || !passwordValid}>{isNew ? t("admin.users.dialog.addTitle") : t("admin.users.dialog.saveChanges")}</Button>
        </>}
      >
        {current && (
          <div className="cn-settings__row">
            <Avatar profile={{ ...current, name: name || current.name, color }} size={4.5} />
            <div className="cn-settings__row-text">
              <strong>{t("admin.users.dialog.picture")}</strong>
              <span>{current.avatar ? t("admin.users.dialog.pictureUploaded") : t("admin.users.dialog.pictureInitial")}</span>
            </div>
            <Button icon={<Camera />} onClick={() => setEditorOpen(true)}>{current.avatar ? t("admin.users.dialog.changePicture") : t("common.upload")}</Button>
          </div>
        )}
        <div className="cn-settings__row">
          <TextField label={t("admin.users.dialog.name")} value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 14rem" }} />
          <TextField
            label={t("admin.users.dialog.username")}
            value={username}
            placeholder={isNew ? t("admin.users.dialog.usernamePlaceholder") : undefined}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            style={{ flex: "1 1 14rem" }}
          />
        </div>
        <ColorPicker label={t("admin.users.dialog.colour")} value={color} onChange={setColor} />
        <div className="cn-settings__row">
          {session.isAdmin() && (
            <Select label={t("admin.users.dialog.role")} value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: "user", label: t("admin.users.roles.user") }, { value: "admin", label: t("admin.users.roles.admin") }]} style={{ flex: "1 1 12rem" }} />
          )}
          <Select label={t("admin.users.dialog.ratingLimit")} value={maxRating} onChange={(e) => setMaxRating(e.target.value)} options={[{ value: "", label: t("admin.users.dialog.noLimit") }, ...ratingOptions()]} style={{ flex: "1 1 12rem" }} />
        </div>
        <Switch label={t("admin.users.dialog.showOnPicker")} description={t("admin.users.dialog.showOnPickerDescription")} checked={showOnPicker} onChange={setShowOnPicker} />
        <div className="cn-settings__row">
          <TextField
            label={current?.hasPin ? t("admin.users.dialog.newPin") : t("admin.users.dialog.pin")}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            placeholder={current?.hasPin ? t("admin.users.dialog.keepIt") : t("admin.users.dialog.pinPlaceholder")}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            error={pinValid ? null : t("admin.users.dialog.pinInvalid")}
            style={{ flex: "1 1 12rem" }}
          />
          {current?.hasPin && <Button variant="ghost" onClick={removePin} style={{ alignSelf: "flex-end" }}>{t("admin.users.dialog.removePin")}</Button>}
        </div>
        <TextField
          label={current?.hasPassword ? t("admin.users.dialog.newPassword") : t("admin.users.dialog.password")}
          type="password"
          autoComplete="new-password"
          placeholder={current?.hasPassword ? t("admin.users.dialog.keepIt") : t("admin.users.dialog.passwordPlaceholder")}
          description={current?.hasPassword ? undefined : t("admin.users.dialog.passwordDescription")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordValid ? null : t("admin.users.dialog.passwordInvalid")}
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
        title={t("admin.users.remove.title", { name: existing?.name ?? "" })}
        description={t("admin.users.remove.description")}
        confirmLabel={t("common.remove")}
        danger
        loading={deleting}
        onConfirm={remove}
      />
    </>
  );
}
