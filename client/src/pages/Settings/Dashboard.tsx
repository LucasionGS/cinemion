import { useState } from "react";
import { Pause, RefreshCw } from "lucide-react";
import type { ActivityKind, DashboardInfo, NowPlaying } from "@shared/admin.ts";
import AdminApi from "../../Api/AdminApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { Link } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import usePoll from "../../lib/usePoll.ts";
import { useUpdates } from "../../lib/Updates.ts";
import { formatClock } from "../../lib/playback.ts";
import { formatBitrate, formatBytes, formatPercent, formatSpan, timeAgo, timeUntil } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import { i18n, rich, t } from "../../i18n/I18n.ts";
import Avatar from "../../components/Avatar/Avatar.tsx";
import Button from "../../components/Button/Button.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import { fallbackColor } from "../../components/PosterCard/PosterCard.tsx";
import "./Admin.scss";

/**
 * The server at a glance: what's playing, resource use, tasks and recent activity.
 */
export default function Dashboard() {
  const { data, error, reload } = usePoll(AdminApi.dashboard, 3000);
  const [scanning, setScanning] = useState(false);
  const update = useUpdates().available();

  async function scanAll() {
    setScanning(true);
    try {
      await AdminApi.scanAll();
      toasts.success(t("admin.dashboard.scanStarted"));
      reload();
    } catch (e) {
      toasts.error(t("admin.dashboard.scanFailed"), (e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  if (!data) return error ? <p className="cn-settings__row-text"><span>{error}</span></p> : <Spinner size="2rem" />;
  const { server, streams } = data;

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("admin.dashboard.title")}</h1>
          <p>
            {update
              ? rich("admin.dashboard.serverLineUpdate", {
                name: server.name,
                version: server.version,
                update: <Link href="/settings/about" className="cn-dashboard__update">{t("admin.dashboard.updateOut", { version: update.version })}</Link>,
                uptime: formatSpan(server.startedAt),
              })
              : t("admin.dashboard.serverLine", { name: server.name, version: server.version, uptime: formatSpan(server.startedAt) })}
          </p>
        </div>
        <Button icon={<RefreshCw />} onClick={scanAll} loading={scanning}>{t("admin.dashboard.scanAll")}</Button>
      </header>

      <Stats data={data} />

      <div className="cn-dashboard__columns">
        <section className="cn-dashboard__section cn-dashboard__section--main" aria-labelledby="cn-now-playing">
          <h2 id="cn-now-playing">{t("admin.dashboard.nowPlaying")}</h2>
          {streams.length === 0 && <p className="cn-dashboard__empty">{t("admin.dashboard.nothingPlaying")}</p>}
          {streams.map((s) => <StreamCard key={s.id} stream={s} />)}
        </section>

        <div className="cn-dashboard__side">
          <section className="cn-dashboard__section" aria-labelledby="cn-dashboard-tasks">
            <div className="cn-dashboard__section-head">
              <h2 id="cn-dashboard-tasks">{t("admin.dashboard.tasks")}</h2>
              <Link href="/settings/tasks">{t("admin.dashboard.allTasks")}</Link>
            </div>
            <div className="cn-dashboard__panel">
              {data.tasks.map((task) => (
                <div key={task.id} className="cn-dashboard__task">
                  <div className="cn-dashboard__task-head">
                    <span>{task.label}</span>
                    <span>{task.progress !== null ? formatPercent(task.progress) : task.status}</span>
                  </div>
                  <Meter value={task.progress} />
                </div>
              ))}
              {data.nextScan && (
                <div className="cn-dashboard__task">
                  <div className="cn-dashboard__task-head">
                    <span>{t("admin.dashboard.libraryScan", { library: data.nextScan.libraryName })}</span>
                    <span>{timeUntil(data.nextScan.nextAt)}</span>
                  </div>
                </div>
              )}
              {data.tasks.length === 0 && !data.nextScan && <p className="cn-dashboard__empty">{t("admin.dashboard.nothingRunning")}</p>}
            </div>
          </section>

          <section className="cn-dashboard__section" aria-labelledby="cn-dashboard-activity">
            <h2 id="cn-dashboard-activity">{t("admin.dashboard.activity")}</h2>
            {data.activity.length === 0 && <p className="cn-dashboard__empty">{t("admin.dashboard.noActivity")}</p>}
            <ul className="cn-activity">
              {data.activity.map((a) => (
                <li key={a.id} className="cn-activity__item">
                  <span className={cx("cn-activity__dot", `cn-activity__dot--${dotFor(a.kind)}`)} aria-hidden="true" />
                  <span className="cn-activity__text">{a.message}</span>
                  <time className="cn-activity__time" dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString(i18n.locale)}>{timeAgo(a.createdAt)}</time>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

/**
 * Colour of an activity line's dot.
 */
function dotFor(kind: ActivityKind) {
  switch (kind) {
    case "watched":
      return "success";
    case "signIn":
      return "warning";
    case "delete":
      return "danger";
    case "subtitles":
      return "muted";
    default:
      return "accent";
  }
}

function Meter(props: { value: number | null; label?: string }) {
  const { value, label } = props;
  if (value === null) return null;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className="cn-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

function Tile(props: { label: string; value: string; meter: number | null; sub: string }) {
  const { label, value, meter, sub } = props;
  return (
    <div className="cn-dashboard__tile">
      <span className="cn-dashboard__tile-label">{label}</span>
      <span className="cn-dashboard__tile-value">{value}</span>
      <Meter value={meter ?? 0} label={label} />
      <span className="cn-dashboard__tile-sub">{sub}</span>
    </div>
  );
}

function Stats(props: { data: DashboardInfo }) {
  const { streams, stats, maxConversions } = props.data;
  const converting = streams.filter((s) => s.kind === "converting").length;
  const { cpu, memory, gpu, storage } = stats;

  return (
    <div className="cn-dashboard__stats">
      <Tile
        label={t("admin.dashboard.stats.streams")}
        value={String(streams.length)}
        meter={converting / maxConversions}
        sub={streams.length === 0 ? t("admin.dashboard.stats.maxConversions", { count: maxConversions }) : t("admin.dashboard.stats.streamKinds", { direct: streams.length - converting, converting })}
      />
      <Tile
        label={t("admin.dashboard.stats.cpu")}
        value={cpu.usage !== null ? formatPercent(cpu.usage) : "—"}
        meter={cpu.usage}
        sub={memory ? t("admin.dashboard.stats.coresMemory", { count: cpu.cores, memory: formatPercent(memory.used / memory.total) }) : t("admin.dashboard.stats.cores", { count: cpu.cores })}
      />
      {gpu
        ? (
          <Tile
            label={t("admin.dashboard.stats.gpu", { name: gpu.name })}
            value={gpu.usage !== null ? formatPercent(gpu.usage) : "—"}
            meter={gpu.usage}
            sub={gpu.conversions > 0 ? t("admin.dashboard.stats.hardwareConversions", { count: gpu.conversions }) : gpu.usage === null ? t("admin.dashboard.stats.usageNotReported") : t("admin.dashboard.stats.noConversions")}
          />
        )
        : (
          <Tile
            label={t("admin.dashboard.stats.memory")}
            value={memory ? formatBytes(memory.used) : "—"}
            meter={memory ? memory.used / memory.total : null}
            sub={memory ? t("admin.dashboard.stats.memoryOf", { total: formatBytes(memory.total) }) : t("admin.dashboard.stats.notReported")}
          />
        )}
      <Tile
        label={t("admin.dashboard.stats.storage")}
        value={storage ? formatBytes(storage.used) : "—"}
        meter={storage ? storage.used / storage.total : null}
        sub={storage ? storageText(storage.total, storage.mounts) : t("admin.dashboard.stats.drivesUnreadable")}
      />
    </div>
  );
}

/**
 * What's under the storage tile: the total size and the drive, or how many drives.
 */
function storageText(total: number, mounts: string[]) {
  if (mounts.length === 1) return t("admin.dashboard.stats.storageOnMount", { total: formatBytes(total), mount: mounts[0] });
  return t("admin.dashboard.stats.storageOnDrives", { total: formatBytes(total), count: mounts.length });
}

function StreamCard(props: { stream: NowPlaying }) {
  const { stream } = props;
  const { item, user } = stream;
  const progress = stream.duration > 0 ? stream.position / stream.duration : 0;

  return (
    <article className="cn-stream">
      <span className="cn-stream__poster" style={{ background: item.palette?.base ?? fallbackColor(item.title) }}>
        {item.poster && <img src={ItemsApi.imageUrl(item.poster, 128)} alt="" loading="lazy" />}
      </span>
      <div className="cn-stream__body">
        <div className="cn-stream__head">
          <Avatar profile={user} size={1.5} />
          <strong>{user.name}</strong>
          <span className="cn-stream__device">{stream.isRemote ? t("admin.dashboard.stream.awayFromHome", { device: stream.device }) : stream.device}</span>
          <span className={cx("cn-stream__badge", `cn-stream__badge--${stream.kind}`)}>{stream.label}</span>
        </div>
        <Link href={`/item/${item.id}`} className="cn-stream__title">{item.title}</Link>
        <span className="cn-stream__detail">{stream.detail}</span>
        {stream.reason && <span className="cn-stream__reason">{stream.reason}</span>}
        <div className="cn-stream__progress">
          {stream.paused && <Pause className="cn-stream__paused" aria-label={t("admin.dashboard.stream.paused")} />}
          <span className="cn-stream__bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>
          <span className="cn-stream__time">
            {formatClock(stream.position)} / {formatClock(stream.duration)}{stream.bitrate ? ` · ${formatBitrate(stream.bitrate)}` : ""}
          </span>
        </div>
      </div>
    </article>
  );
}
