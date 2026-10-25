import { useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { TaskRecord } from "@shared/admin.ts";
import AdminApi from "../../Api/AdminApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import usePoll from "../../lib/usePoll.ts";
import { formatPercent, timeAgo, timeUntil } from "../../lib/format.ts";
import { serverText, t, type TranslationKey } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import Select from "../../components/Select/Select.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import "./Admin.scss";

const INTERVALS = [1, 3, 6, 12, 24, 48];

/**
 * Background work: what's running, what ran, when libraries are scanned next, and buttons to start things.
 */
export default function TasksSettings() {
  const { data, error, reload, setData } = usePoll(AdminApi.tasks, 2000);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemake, setConfirmRemake] = useState(false);

  async function start(key: string, action: () => Promise<unknown>, done: TranslationKey) {
    setBusy(key);
    try {
      await action();
      toasts.success(t(done));
      reload();
    } catch (e) {
      toasts.error(t("admin.tasks.startFailed"), (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function changeInterval(hours: number) {
    try {
      const result = await AdminApi.setScanInterval(hours);
      if (data) setData({ ...data, scanIntervalHours: result.scanIntervalHours, scheduled: result.scheduled });
      toasts.success(t("admin.tasks.intervalSaved", { count: hours }));
    } catch (e) {
      toasts.error(t("common.couldntSave"), (e as Error).message);
    }
  }

  if (!data) return error ? <p className="cn-settings__row-text"><span>{error}</span></p> : <Spinner size="2rem" />;

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("admin.tasks.title")}</h1>
          <p>{t("admin.tasks.intro")}</p>
        </div>
      </header>

      <section className="cn-settings__card">
        <h2>{t("admin.tasks.running")}</h2>
        {data.running.length === 0 && <p className="cn-settings__row-text"><span>{t("admin.tasks.nothingRunning")}</span></p>}
        {data.running.map((task) => (
          <div key={task.id} className="cn-dashboard__task">
            <div className="cn-dashboard__task-head">
              <span>{serverText(task.label)}</span>
              <span>{serverText(task.status)}{task.progress !== null && ` · ${formatPercent(task.progress)}`}</span>
            </div>
            {task.progress !== null && <span className="cn-meter"><span style={{ width: formatPercent(task.progress) }} /></span>}
          </div>
        ))}
      </section>

      <section className="cn-settings__card">
        <h2>{t("admin.tasks.runNow")}</h2>
        <ActionRow title={t("admin.tasks.actions.scan.title")} text={t("admin.tasks.actions.scan.text")} label={t("admin.tasks.actions.scan.button")} loading={busy === "scan"}
          onClick={() => start("scan", () => AdminApi.scanAll(), "admin.tasks.actions.scan.started")} />
        <div className="cn-settings__divider" />
        <ActionRow title={t("admin.tasks.actions.refresh.title")} text={t("admin.tasks.actions.refresh.text")} label={t("admin.tasks.actions.refresh.button")} loading={busy === "refresh"}
          onClick={() => start("refresh", () => AdminApi.scanAll(true), "admin.tasks.actions.refresh.started")} />
        <div className="cn-settings__divider" />
        <ActionRow title={t("admin.tasks.actions.thumbnails.title")} text={t("admin.tasks.actions.thumbnails.text")} label={t("admin.tasks.actions.thumbnails.button")} loading={busy === "thumbs"}
          onClick={() => start("thumbs", () => AdminApi.thumbnails(), "admin.tasks.actions.thumbnails.started")} />
        <div className="cn-settings__divider" />
        <ActionRow title={t("admin.tasks.actions.markers.title")} text={t("admin.tasks.actions.markers.text")} label={t("admin.tasks.actions.markers.button")} loading={busy === "markers"}
          onClick={() => start("markers", () => AdminApi.markers(true), "admin.tasks.actions.markers.started")} />
        <div className="cn-settings__divider" />
        <ActionRow title={t("admin.tasks.actions.subtitles.title")} text={t("admin.tasks.actions.subtitles.text")} label={t("admin.tasks.actions.subtitles.button")} loading={busy === "subtitles"}
          onClick={() => start("subtitles", () => AdminApi.subtitles(), "admin.tasks.actions.subtitles.started")} />
        <div className="cn-settings__divider" />
        <ActionRow title={t("admin.tasks.actions.remake.title")} text={t("admin.tasks.actions.remake.text")} label={t("admin.tasks.actions.remake.button")} loading={busy === "remake"}
          onClick={() => setConfirmRemake(true)} />
      </section>

      <section className="cn-settings__card">
        <h2>{t("admin.tasks.schedule")}</h2>
        <Select
          label={t("admin.tasks.scanEvery")}
          description={t("admin.tasks.scanEveryDescription")}
          value={String(data.scanIntervalHours)}
          options={[...new Set([...INTERVALS, data.scanIntervalHours])].sort((a, b) => a - b).map((h) => ({ value: String(h), label: t("admin.tasks.hours", { count: h }) }))}
          onChange={(e) => changeInterval(Number(e.target.value))}
        />
        <div className="cn-settings__list">
          {data.scheduled.map((s) => (
            <div key={s.libraryId} className="cn-tasks__row">
              <strong>{s.libraryName}</strong>
              <span>{s.lastScannedAt ? t("admin.tasks.scanned", { ago: timeAgo(s.lastScannedAt), next: timeUntil(s.nextAt) }) : t("admin.tasks.notScanned", { next: timeUntil(s.nextAt) })}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="cn-settings__card">
        <h2>{t("admin.tasks.recentlyFinished")}</h2>
        {data.history.length === 0 && <p className="cn-settings__row-text"><span>{t("admin.tasks.nothingFinished")}</span></p>}
        <div className="cn-settings__list">
          {data.history.map((task, i) => <HistoryRow key={`${task.id}-${task.finishedAt}-${i}`} task={task} />)}
        </div>
      </section>

      <ConfirmDialog
        open={confirmRemake}
        onOpenChange={setConfirmRemake}
        title={t("admin.tasks.actions.remake.confirmTitle")}
        description={t("admin.tasks.actions.remake.confirmDescription")}
        confirmLabel={t("admin.tasks.actions.remake.confirm")}
        onConfirm={async () => {
          setConfirmRemake(false);
          await start("remake", () => AdminApi.thumbnails(true), "admin.tasks.actions.remake.started");
        }}
      />
    </>
  );
}

function ActionRow(props: { title: string; text: string; label: string; loading: boolean; onClick: () => void }) {
  const { title, text, label, loading, onClick } = props;
  return (
    <div className="cn-settings__row">
      <p className="cn-settings__row-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </p>
      <Button size="sm" onClick={onClick} loading={loading}>{label}</Button>
    </div>
  );
}

function duration(task: TaskRecord) {
  const seconds = Math.max(0, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000));
  return seconds < 60 ? t("admin.tasks.history.seconds", { count: seconds }) : t("admin.tasks.history.minutes", { count: Math.round(seconds / 60) });
}

function HistoryRow(props: { task: TaskRecord }) {
  const { task } = props;
  const failed = task.outcome === "failed";
  return (
    <div className="cn-tasks__row">
      {failed ? <CircleAlert className="cn-tasks__icon cn-tasks__icon--failed" aria-label={t("admin.tasks.history.failed")} /> : <CircleCheck className="cn-tasks__icon" aria-label={t("admin.tasks.history.done")} />}
      <strong>{serverText(task.label)}</strong>
      <span>{failed ? t("admin.tasks.history.failedAgo", { error: serverText(task.error) || t("admin.tasks.history.failed"), ago: timeAgo(task.finishedAt) }) : t("admin.tasks.history.tookAgo", { duration: duration(task), ago: timeAgo(task.finishedAt) })}</span>
    </div>
  );
}
