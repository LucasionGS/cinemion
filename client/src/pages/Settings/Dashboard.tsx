import { useState } from "react";
import { Pause, RefreshCw } from "lucide-react";
import type { ActivityKind, DashboardInfo, NowPlaying } from "@shared/admin.ts";
import AdminApi from "../../Api/AdminApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { Link } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import usePoll from "../../lib/usePoll.ts";
import { formatClock } from "../../lib/playback.ts";
import { formatBitrate, formatBytes, formatPercent, formatSpan, timeAgo, timeUntil } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
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

  async function scanAll() {
    setScanning(true);
    try {
      await AdminApi.scanAll();
      toasts.success("Scanning every library");
      reload();
    } catch (e) {
      toasts.error("Couldn't start the scan", (e as Error).message);
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
          <h1>Dashboard</h1>
          <p>{server.name} · Cinemion {server.version} · up {formatSpan(server.startedAt)}</p>
        </div>
        <Button icon={<RefreshCw />} onClick={scanAll} loading={scanning}>Scan all libraries</Button>
      </header>

      <Stats data={data} />

      <div className="cn-dashboard__columns">
        <section className="cn-dashboard__section cn-dashboard__section--main" aria-labelledby="cn-now-playing">
          <h2 id="cn-now-playing">Now playing</h2>
          {streams.length === 0 && <p className="cn-dashboard__empty">Nothing is playing right now.</p>}
          {streams.map((s) => <StreamCard key={s.id} stream={s} />)}
        </section>

        <div className="cn-dashboard__side">
          <section className="cn-dashboard__section" aria-labelledby="cn-dashboard-tasks">
            <div className="cn-dashboard__section-head">
              <h2 id="cn-dashboard-tasks">Tasks</h2>
              <Link href="/settings/tasks">All tasks</Link>
            </div>
            <div className="cn-dashboard__panel">
              {data.tasks.map((t) => (
                <div key={t.id} className="cn-dashboard__task">
                  <div className="cn-dashboard__task-head">
                    <span>{t.label}</span>
                    <span>{t.progress !== null ? formatPercent(t.progress) : t.status}</span>
                  </div>
                  <Meter value={t.progress} />
                </div>
              ))}
              {data.nextScan && (
                <div className="cn-dashboard__task">
                  <div className="cn-dashboard__task-head">
                    <span>Library scan · {data.nextScan.libraryName}</span>
                    <span>{timeUntil(data.nextScan.nextAt)}</span>
                  </div>
                </div>
              )}
              {data.tasks.length === 0 && !data.nextScan && <p className="cn-dashboard__empty">Nothing running.</p>}
            </div>
          </section>

          <section className="cn-dashboard__section" aria-labelledby="cn-dashboard-activity">
            <h2 id="cn-dashboard-activity">Activity</h2>
            {data.activity.length === 0 && <p className="cn-dashboard__empty">Nothing has happened yet.</p>}
            <ul className="cn-activity">
              {data.activity.map((a) => (
                <li key={a.id} className="cn-activity__item">
                  <span className={cx("cn-activity__dot", `cn-activity__dot--${dotFor(a.kind)}`)} aria-hidden="true" />
                  <span className="cn-activity__text">{a.message}</span>
                  <time className="cn-activity__time" dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>{timeAgo(a.createdAt)}</time>
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
        label="Streams"
        value={String(streams.length)}
        meter={converting / maxConversions}
        sub={streams.length === 0 ? `Up to ${maxConversions} conversions at once` : `${streams.length - converting} direct · ${converting} converting`}
      />
      <Tile
        label="CPU"
        value={cpu.usage !== null ? formatPercent(cpu.usage) : "—"}
        meter={cpu.usage}
        sub={`${cpu.cores} cores${memory ? ` · ${formatPercent(memory.used / memory.total)} memory` : ""}`}
      />
      {gpu
        ? (
          <Tile
            label={`GPU (${gpu.name})`}
            value={gpu.usage !== null ? formatPercent(gpu.usage) : "—"}
            meter={gpu.usage}
            sub={gpu.conversions > 0 ? `${gpu.conversions} hardware ${gpu.conversions === 1 ? "conversion" : "conversions"}` : gpu.usage === null ? "Usage isn't reported" : "No conversions"}
          />
        )
        : (
          <Tile
            label="Memory"
            value={memory ? formatBytes(memory.used) : "—"}
            meter={memory ? memory.used / memory.total : null}
            sub={memory ? `of ${formatBytes(memory.total)}` : "Not reported"}
          />
        )}
      <Tile
        label="Storage"
        value={storage ? formatBytes(storage.used) : "—"}
        meter={storage ? storage.used / storage.total : null}
        sub={storage ? `of ${formatBytes(storage.total)} on ${storage.mounts.length === 1 ? storage.mounts[0] : `${storage.mounts.length} drives`}` : "Couldn't read the drives"}
      />
    </div>
  );
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
          <span className="cn-stream__device">{stream.device}{stream.isRemote && " · away from home"}</span>
          <span className={cx("cn-stream__badge", `cn-stream__badge--${stream.kind}`)}>{stream.label}</span>
        </div>
        <Link href={`/item/${item.id}`} className="cn-stream__title">{item.title}</Link>
        <span className="cn-stream__detail">{stream.detail}</span>
        {stream.reason && <span className="cn-stream__reason">{stream.reason}</span>}
        <div className="cn-stream__progress">
          {stream.paused && <Pause className="cn-stream__paused" aria-label="Paused" />}
          <span className="cn-stream__bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>
          <span className="cn-stream__time">
            {formatClock(stream.position)} / {formatClock(stream.duration)}{stream.bitrate ? ` · ${formatBitrate(stream.bitrate)}` : ""}
          </span>
        </div>
      </div>
    </article>
  );
}
