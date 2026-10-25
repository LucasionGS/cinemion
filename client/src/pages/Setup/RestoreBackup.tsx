import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, CircleCheck, FileUp } from "lucide-react";
import type { BackupInfo, RestoreStatus } from "@shared/admin.ts";
import BackupsApi from "../../Api/BackupsApi.ts";
import { formatBytes, formatMoment, formatPercent } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import { serverText, t } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";

export interface RestoreBackupProps {
  onCancel: () => void;
}

type Source = { kind: "found"; backup: BackupInfo } | { kind: "file"; file: File };

/**
 * Instead of setting up from scratch: bring a server back from a backup, found in the backup folder or uploaded.
 */
export default function RestoreBackup(props: RestoreBackupProps) {
  const { onCancel } = props;
  const [found, setFound] = useState<{ folder: string; backups: BackupInfo[] } | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    BackupsApi.found().then(setFound).catch(() => setFound({ folder: "", backups: [] }));
  }, []);

  // Follow the restore once it runs
  useEffect(() => {
    if (status?.state !== "running") return;
    const timer = setInterval(() => {
      BackupsApi.restoreStatus().then(setStatus).catch(() => { });
    }, 1000);
    return () => clearInterval(timer);
  }, [status?.state]);

  const encrypted = needsPassword || (source?.kind === "found" ? source.backup.encrypted : source?.kind === "file" ? source.file.name.endsWith(".enc") : false);
  const busy = sending !== null || status?.state === "running";

  function pick(next: Source) {
    setSource(next);
    setError(null);
    setNeedsPassword(false);
  }

  async function start() {
    if (!source) return;
    setError(null);
    try {
      if (source.kind === "found") setStatus(await BackupsApi.restore(source.backup.name, password || null));
      else {
        setSending(0);
        setStatus(await BackupsApi.restoreUpload(source.file, password || null, setSending));
      }
    } catch (e) {
      const failure = e as BackupsApi.RestoreError;
      if (failure.needsPassword) setNeedsPassword(true);
      setError(failure.message);
    } finally {
      setSending(null);
    }
  }

  if (status?.state === "done") {
    return (
      <section className="cn-setup__section cn-setup__section--narrow">
        <header className="cn-setup__header">
          <CircleCheck className="cn-restore__done-icon" aria-hidden="true" />
          <h1>{t("setup.restore.doneTitle")}</h1>
          <p>{status.backup ? t("setup.restore.doneText", { name: status.backup.serverName, date: formatMoment(status.backup.createdAt, false) }) : t("setup.restore.doneTextShort")}</p>
        </header>
        <div className="cn-setup__actions">
          <Button variant="primary" size="lg" className="cn-setup__next" onClick={() => location.assign("/")}>{t("setup.actions.goToCinemion")}</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="cn-setup__section cn-setup__section--narrow">
      <header className="cn-setup__header">
        <h1>{t("setup.restore.title")}</h1>
        <p>{t("setup.restore.intro")}</p>
      </header>

      {found && found.backups.length > 0 && (
        <div className="cn-restore__list" role="radiogroup" aria-label={t("setup.restore.foundLabel")}>
          <span className="cn-setup__muted">{t("setup.restore.found", { folder: found.folder })}</span>
          {found.backups.map((backup) => {
            const selected = source?.kind === "found" && source.backup.name === backup.name;
            return (
              <button
                key={backup.name}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy}
                className={cx("cn-setup__card", "cn-restore__option", selected && "cn-restore__option--selected")}
                onClick={() => pick({ kind: "found", backup })}
              >
                <ArchiveRestore />
                <div>
                  <strong>{formatMoment(backup.createdAt)}</strong>
                  <span>{formatBytes(backup.size)}{backup.encrypted && `${t("common.dotSeparator")}${t("setup.restore.protected")}`}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="cn-restore__upload">
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.enc,application/gzip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick({ kind: "file", file });
            e.target.value = "";
          }}
        />
        {source?.kind === "file" && (
          <div className={cx("cn-setup__card", "cn-restore__option", "cn-restore__option--selected")}>
            <FileUp />
            <div>
              <strong>{source.file.name}</strong>
              <span>{formatBytes(source.file.size)}</span>
            </div>
          </div>
        )}
        <Button icon={<FileUp />} onClick={() => fileInput.current?.click()} disabled={busy}>
          {source?.kind === "file" ? t("setup.restore.otherFile") : t("setup.restore.chooseFile")}
        </Button>
      </div>

      {encrypted && (
        <TextField
          label={t("setup.restore.password")}
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          description={t("setup.restore.passwordDescription")}
        />
      )}

      {error && <p className="cn-restore__error" role="alert">{error}</p>}
      {status?.state === "failed" && status.error && <p className="cn-restore__error" role="alert">{t("setup.restore.failed", { error: serverText(status.error) })}</p>}

      {busy && (
        <div className="cn-restore__progress" aria-live="polite">
          <span>{sending !== null ? t("setup.restore.sending", { percent: formatPercent(sending) }) : serverText(status?.step)}</span>
          <span className="cn-meter"><span style={{ width: formatPercent((sending ?? status?.progress) ?? 0.05) }} /></span>
        </div>
      )}

      <p className="cn-setup__muted">{t("setup.restore.warning")}</p>

      <div className="cn-setup__actions">
        <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>{t("setup.restore.instead")}</Button>
        <Button variant="primary" size="lg" className="cn-setup__next" onClick={start} loading={busy} disabled={!source || (encrypted && !password)}>{t("setup.restore.start")}</Button>
      </div>
    </section>
  );
}
