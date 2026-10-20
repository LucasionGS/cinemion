import { useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { TaskRecord } from "@shared/admin.ts";
import AdminApi from "../../Api/AdminApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import usePoll from "../../lib/usePoll.ts";
import { formatPercent, timeAgo, timeUntil } from "../../lib/format.ts";
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

  async function start(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await action();
      toasts.success(done);
      reload();
    } catch (e) {
      toasts.error("Couldn't start that", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function changeInterval(hours: number) {
    try {
      const result = await AdminApi.setScanInterval(hours);
      if (data) setData({ ...data, scanIntervalHours: result.scanIntervalHours, scheduled: result.scheduled });
      toasts.success(`Libraries are scanned every ${hours} ${hours === 1 ? "hour" : "hours"}`);
    } catch (e) {
      toasts.error("Couldn't save", (e as Error).message);
    }
  }

  if (!data) return error ? <p className="cn-settings__row-text"><span>{error}</span></p> : <Spinner size="2rem" />;

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Tasks</h1>
          <p>Work Cinemion does in the background, and when it scans your libraries by itself.</p>
        </div>
      </header>

      <section className="cn-settings__card">
        <h2>Running</h2>
        {data.running.length === 0 && <p className="cn-settings__row-text"><span>Nothing is running right now.</span></p>}
        {data.running.map((t) => (
          <div key={t.id} className="cn-dashboard__task">
            <div className="cn-dashboard__task-head">
              <span>{t.label}</span>
              <span>{t.status}{t.progress !== null && ` · ${formatPercent(t.progress)}`}</span>
            </div>
            {t.progress !== null && <span className="cn-meter"><span style={{ width: formatPercent(t.progress) }} /></span>}
          </div>
        ))}
      </section>

      <section className="cn-settings__card">
        <h2>Run now</h2>
        <ActionRow title="Scan all libraries" text="Look for new, changed and removed files in every library." label="Scan now" loading={busy === "scan"}
          onClick={() => start("scan", () => AdminApi.scanAll(), "Scanning every library")} />
        <div className="cn-settings__divider" />
        <ActionRow title="Refresh all details" text="Fetch details and artwork again for every title. This takes a while on big libraries." label="Refresh" loading={busy === "refresh"}
          onClick={() => start("refresh", () => AdminApi.scanAll(true), "Refreshing every title's details")} />
        <div className="cn-settings__divider" />
        <ActionRow title="Make missing seek thumbnails" text="The pictures that show while you drag through a video. New videos get them by themselves." label="Make thumbnails" loading={busy === "thumbs"}
          onClick={() => start("thumbs", () => AdminApi.thumbnails(), "Making missing seek thumbnails")} />
        <div className="cn-settings__divider" />
        <ActionRow title="Find intros and credits again" text="Compare every season's episodes and read chapters again, for Skip intro and starting the next episode early. New episodes are looked at by themselves." label="Find again" loading={busy === "markers"}
          onClick={() => start("markers", () => AdminApi.markers(true), "Looking for intros and credits")} />
        <div className="cn-settings__divider" />
        <ActionRow title="Remake all seek thumbnails" text="Delete every seek thumbnail and make them again, one video at a time." label="Remake" loading={busy === "remake"}
          onClick={() => setConfirmRemake(true)} />
      </section>

      <section className="cn-settings__card">
        <h2>Schedule</h2>
        <Select
          label="Scan libraries every"
          description="New files usually show up within a minute anyway. Scheduled scans catch what the folder watcher misses, like changes on network shares."
          value={String(data.scanIntervalHours)}
          options={[...new Set([...INTERVALS, data.scanIntervalHours])].sort((a, b) => a - b).map((h) => ({ value: String(h), label: `${h} ${h === 1 ? "hour" : "hours"}` }))}
          onChange={(e) => changeInterval(Number(e.target.value))}
        />
        <div className="cn-settings__list">
          {data.scheduled.map((s) => (
            <div key={s.libraryId} className="cn-tasks__row">
              <strong>{s.libraryName}</strong>
              <span>{s.lastScannedAt ? `Scanned ${timeAgo(s.lastScannedAt)}` : "Not scanned yet"} · next {timeUntil(s.nextAt)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="cn-settings__card">
        <h2>Recently finished</h2>
        {data.history.length === 0 && <p className="cn-settings__row-text"><span>Nothing has finished since the server started.</span></p>}
        <div className="cn-settings__list">
          {data.history.map((t, i) => <HistoryRow key={`${t.id}-${t.finishedAt}-${i}`} task={t} />)}
        </div>
      </section>

      <ConfirmDialog
        open={confirmRemake}
        onOpenChange={setConfirmRemake}
        title="Remake all seek thumbnails?"
        description="Every video gets new thumbnails, one after another. Until a video's turn comes, it has none."
        confirmLabel="Remake thumbnails"
        onConfirm={async () => {
          setConfirmRemake(false);
          await start("remake", () => AdminApi.thumbnails(true), "Remaking all seek thumbnails");
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
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function HistoryRow(props: { task: TaskRecord }) {
  const { task } = props;
  const failed = task.outcome === "failed";
  return (
    <div className="cn-tasks__row">
      {failed ? <CircleAlert className="cn-tasks__icon cn-tasks__icon--failed" aria-label="Failed" /> : <CircleCheck className="cn-tasks__icon" aria-label="Done" />}
      <strong>{task.label}</strong>
      <span>{failed ? task.error ?? "Failed" : `Took ${duration(task)}`} · {timeAgo(task.finishedAt)}</span>
    </div>
  );
}
