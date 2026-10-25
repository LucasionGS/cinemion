import { useState } from "react";
import { CalendarClock, Download, Hand, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { BackupInfo, BackupKind, BackupSchedule, BackupsOverview, BackupSettingsUpdate } from "@shared/admin.ts";
import BackupsApi from "../../Api/BackupsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import usePoll from "../../lib/usePoll.ts";
import { formatBytes, formatMoment, formatPercent, timeUntil } from "../../lib/format.ts";
import { rich, serverText, t, type TranslationKey } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Select from "../../components/Select/Select.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import Dialog, { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import "./Admin.scss";

const KEEP = [3, 5, 7, 14, 30];
const SCHEDULES: { value: BackupSchedule; label: TranslationKey }[] = [
  { value: "off", label: "backups.schedule.off" },
  { value: "daily", label: "backups.schedule.daily" },
  { value: "weekly", label: "backups.schedule.weekly" },
];
const KINDS: Record<BackupKind, TranslationKey> = {
  manual: "backups.kind.manual",
  scheduled: "backups.kind.scheduled",
  update: "backups.kind.update",
};

/**
 * Backups of the database, settings, profile pictures and artwork: made by hand or on a schedule, downloaded,
 * protected with a password, and how to restore one.
 */
export default function BackupsSettings() {
  const { data, error, setData } = usePoll(BackupsApi.overview, 3000);
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState<BackupInfo | null>(null);

  async function make() {
    setStarting(true);
    try {
      setData(await BackupsApi.make());
    } catch (e) {
      toasts.error(t("backups.makeFailed"), (e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function save(changes: BackupSettingsUpdate, done?: TranslationKey) {
    try {
      setData(await BackupsApi.updateSettings(changes));
      toasts.success(t(done ?? "common.saved"));
      return true;
    } catch (e) {
      toasts.error(t("common.couldntSave"), (e as Error).message);
      return false;
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      setData(await BackupsApi.remove(removing.name));
      setRemoving(null);
      toasts.success(t("backups.deleted"));
    } catch (e) {
      toasts.error(t("backups.deleteFailed"), (e as Error).message);
    }
  }

  async function download(backup: BackupInfo) {
    try {
      await BackupsApi.download(backup.name);
    } catch (e) {
      toasts.error(t("backups.downloadFailed"), (e as Error).message);
    }
  }

  if (!data) return error ? <p className="cn-settings__row-text"><span>{error}</span></p> : <Spinner size="2rem" />;

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("backups.title")}</h1>
          <p>{t("backups.intro")}</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={make} loading={starting} disabled={!!data.running}>{t("backups.makeNow")}</Button>
      </header>

      {data.running && (
        <section className="cn-settings__card" aria-live="polite">
          <div className="cn-dashboard__task">
            <div className="cn-dashboard__task-head">
              <span>{t("backups.making")}</span>
              <span>{serverText(data.running.status)}{data.running.progress !== null && ` · ${formatPercent(data.running.progress)}`}</span>
            </div>
            <span className="cn-meter"><span style={{ width: formatPercent(data.running.progress ?? 0.05) }} /></span>
          </div>
        </section>
      )}

      <section className="cn-settings__card">
        <h2>{t("backups.listTitle")}</h2>
        {data.backups.length === 0 && <p className="cn-settings__row-text"><span>{t("backups.none")}</span></p>}
        {data.backups.length > 0 && (
          <div className="cn-settings__list">
            {data.backups.map((backup) => (
              <div key={backup.name} className="cn-settings__item">
                {backup.kind === "scheduled" ? <CalendarClock /> : backup.kind === "update" ? <RefreshCw /> : <Hand />}
                <div className="cn-settings__item-text">
                  <strong>{formatMoment(backup.createdAt)}</strong>
                  <span>
                    {[t(KINDS[backup.kind]), formatBytes(backup.size), backup.encrypted ? t("backups.protected") : null].filter(Boolean).join(t("common.dotSeparator"))}
                  </span>
                </div>
                <IconButton label={t("backups.downloadOne", { date: formatMoment(backup.createdAt) })} icon={<Download />} onClick={() => download(backup)} />
                <IconButton label={t("backups.deleteOne", { date: formatMoment(backup.createdAt) })} icon={<Trash2 />} onClick={() => setRemoving(backup)} />
              </div>
            ))}
          </div>
        )}
        <p className="cn-settings__row-text">
          <span>
            {data.freeSpace !== null ? t("backups.folderWithSpace", { folder: data.folder, free: formatBytes(data.freeSpace) }) : t("backups.folderOnly", { folder: data.folder })}
          </span>
        </p>
      </section>

      <ScheduleCard data={data} onSave={save} />
      <ContentsCard data={data} onSave={save} />

      <section className="cn-settings__card">
        <h2>{t("backups.restore.title")}</h2>
        <p className="cn-settings__row-text">
          <span>{t("backups.restore.text")}</span>
        </p>
        <ul className="cn-backups__steps">
          <li>{t("backups.restore.wizard")}</li>
          <li>{rich("backups.restore.cli", { command: <code>cinemion restore &lt;file&gt;</code> })}</li>
        </ul>
      </section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("backups.confirmDeleteTitle")}
        description={t("backups.confirmDeleteDescription", { date: removing ? formatMoment(removing.createdAt) : "" })}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={remove}
      />
    </>
  );
}

interface CardProps {
  data: BackupsOverview;
  onSave: (changes: BackupSettingsUpdate, done?: TranslationKey) => Promise<boolean>;
}

/**
 * How often backups are made by themselves, and how many are kept.
 */
function ScheduleCard(props: CardProps) {
  const { data, onSave } = props;
  const { settings } = data;
  return (
    <section className="cn-settings__card">
      <h2>{t("backups.schedule.title")}</h2>
      <div className="cn-backups__fields">
        <Select
          label={t("backups.schedule.label")}
          value={settings.schedule}
          options={SCHEDULES.map((s) => ({ value: s.value, label: t(s.label) }))}
          onChange={(e) => onSave({ schedule: e.target.value as BackupSchedule })}
        />
        <Select
          label={t("backups.schedule.keep")}
          description={t("backups.schedule.keepDescription")}
          value={String(settings.keep)}
          disabled={settings.schedule === "off"}
          options={[...new Set([...KEEP, settings.keep])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: t("backups.schedule.keepCount", { count: n }) }))}
          onChange={(e) => onSave({ keep: Number(e.target.value) })}
        />
      </div>
      {settings.schedule !== "off" && data.nextAt && (
        <p className="cn-settings__row-text">
          <span>{t("backups.schedule.next", { when: timeUntil(data.nextAt) })}</span>
        </p>
      )}
      {data.lastError && <p className="cn-backups__error" role="alert">{t("backups.schedule.lastFailed", { error: serverText(data.lastError) })}</p>}
      <p className="cn-settings__row-text">
        <span>{t("backups.schedule.beforeUpdates")}</span>
      </p>
    </section>
  );
}

/**
 * What goes in a backup, where backups are kept, and the password.
 */
function ContentsCard(props: CardProps) {
  const { data, onSave } = props;
  const { settings } = data;
  const [folder, setFolder] = useState(settings.folder ?? "");
  const [savingFolder, setSavingFolder] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [removingPassword, setRemovingPassword] = useState(false);
  const folderChanged = (folder.trim() || null) !== settings.folder;

  async function saveFolder() {
    setSavingFolder(true);
    await onSave({ folder: folder.trim() || null }, "backups.contents.folderSaved");
    setSavingFolder(false);
  }

  return (
    <section className="cn-settings__card">
      <h2>{t("backups.contents.title")}</h2>
      <p className="cn-settings__row-text">
        <span>{t("backups.contents.text")}</span>
      </p>
      <Switch
        label={t("backups.contents.artwork")}
        description={t("backups.contents.artworkDescription")}
        checked={settings.artwork}
        onChange={(artwork) => onSave({ artwork })}
      />
      <div className="cn-settings__divider" />
      <div className="cn-backups__folder">
        <TextField
          label={t("backups.contents.folder")}
          description={t("backups.contents.folderDescription")}
          value={folder}
          placeholder={data.defaultFolder}
          spellCheck={false}
          onChange={(e) => setFolder(e.target.value)}
          className="cn-backups__folder-field"
        />
        <Button onClick={saveFolder} loading={savingFolder} disabled={!folderChanged}>{t("common.save")}</Button>
      </div>
      <div className="cn-settings__divider" />
      <div className="cn-settings__row">
        <div className="cn-settings__row-text">
          <strong>{settings.hasPassword ? t("backups.password.on") : t("backups.password.off")}</strong>
          <span>{t("backups.password.text")}</span>
        </div>
        {settings.hasPassword && <Button variant="ghost" onClick={() => setRemovingPassword(true)}>{t("backups.password.remove")}</Button>}
        <Button icon={<KeyRound />} onClick={() => setPasswordOpen(true)}>{settings.hasPassword ? t("backups.password.change") : t("backups.password.set")}</Button>
      </div>

      <PasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        onSave={async (password) => {
          if (await onSave({ password }, "backups.password.saved")) setPasswordOpen(false);
        }}
      />
      <ConfirmDialog
        open={removingPassword}
        onOpenChange={setRemovingPassword}
        title={t("backups.password.removeTitle")}
        description={t("backups.password.removeDescription")}
        confirmLabel={t("backups.password.remove")}
        onConfirm={async () => {
          if (await onSave({ password: null }, "backups.password.removed")) setRemovingPassword(false);
        }}
      />
    </section>
  );
}

interface PasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (password: string) => Promise<void>;
}

function PasswordDialog(props: PasswordDialogProps) {
  const { open, onOpenChange, onSave } = props;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const errors = {
    password: password.length < 8 ? t("backups.password.tooShort") : null,
    confirm: confirm !== password ? t("backups.password.mismatch") : null,
  };

  async function submit() {
    if (errors.password || errors.confirm) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await onSave(password);
    setSaving(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) {
          setPassword("");
          setConfirm("");
          setShowErrors(false);
        }
      }}
      title={t("backups.password.dialogTitle")}
      description={t("backups.password.dialogDescription")}
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={saving}>{t("common.save")}</Button>
        </>
      )}
    >
      <form className="cn-backups__password" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <TextField label={t("backups.password.new")} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={showErrors ? errors.password : null} autoFocus />
        <TextField label={t("backups.password.confirm")} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={showErrors ? errors.confirm : null} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
