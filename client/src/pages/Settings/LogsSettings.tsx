import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { LogEntry, LogLevel } from "@shared/admin.ts";
import AdminApi from "../../Api/AdminApi.ts";
import cx from "../../lib/cx.ts";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "./Admin.scss";

type Filter = "all" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_LABELS: Record<LogLevel, string> = { debug: "Debug", info: "Info", warn: "Warning", error: "Error" };
const KEEP = 1000;

/**
 * The server log, newest first, with level filters. New lines come in every few seconds.
 */
export default function LogsSettings() {
  const { entries, error } = useLogTail();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const min = filter === "all" ? 0 : RANK[filter];
    return entries.filter((e) => RANK[e.level] >= min && (!needle || e.message.toLowerCase().includes(needle) || e.data?.toLowerCase().includes(needle))).reverse();
  }, [entries, filter, search]);

  function download() {
    const text = entries.map((e) => `${e.time} ${e.level.toUpperCase().padEnd(5)} ${e.message}${e.data ? " " + e.data : ""}`).join("\n") + "\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `cinemion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Logs</h1>
          <p>The last {KEEP} lines of the server log, newest first. Handy when something doesn't work.</p>
        </div>
        <Button icon={<Download />} onClick={download} disabled={entries.length === 0}>Download</Button>
      </header>

      <div className="cn-logs__toolbar">
        <SegmentedControl<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "info", label: "Info" }, { value: "warn", label: "Warnings" }, { value: "error", label: "Errors" }]}
        />
        <TextField label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Words in the message" className="cn-logs__search" />
      </div>

      {error && <p className="cn-settings__row-text"><span>{error}</span></p>}
      {!error && entries.length === 0 && <Spinner size="2rem" />}
      {entries.length > 0 && shown.length === 0 && <p className="cn-settings__row-text"><span>No lines match.</span></p>}
      {shown.length > 0 && (
        <ol className="cn-logs" aria-label="Log lines">
          {shown.map((e) => (
            <li key={e.id} className={cx("cn-logs__line", `cn-logs__line--${e.level}`)}>
              <time className="cn-logs__time" dateTime={e.time} title={new Date(e.time).toLocaleString()}>{new Date(e.time).toLocaleTimeString(undefined, { hour12: false })}</time>
              <span className="cn-logs__level">{LEVEL_LABELS[e.level]}</span>
              <span className="cn-logs__message">
                {e.message}
                {e.data && <span className="cn-logs__data">{e.data}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * Log lines, fetching only the new ones every few seconds.
 */
function useLogTail() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const lines = await AdminApi.logs(lastId.current);
        if (stopped) return;
        setError(null);
        if (lines.length === 0) return;
        // The server restarted: its numbering starts over
        const restarted = lines[0].id <= lastId.current;
        lastId.current = lines[lines.length - 1].id;
        setEntries((current) => (restarted ? lines : [...current, ...lines]).slice(-KEEP));
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    }
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return { entries, error };
}
