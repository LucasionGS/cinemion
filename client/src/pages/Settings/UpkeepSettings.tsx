import { useState } from "react";
import { CircleAlert, Copy, HardDrive, ListX, RefreshCw, SearchCheck, Trash2 } from "lucide-react";
import type { SpaceUsage, UpkeepFile, UpkeepItemRef } from "@shared/upkeep.ts";
import UpkeepApi from "../../Api/UpkeepApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { Link } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import usePoll from "../../lib/usePoll.ts";
import { formatBitrate, formatBytes, formatDate, formatPercent } from "../../lib/format.ts";
import { formatDuration } from "../../lib/playback.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import "./Admin.scss";

type View = "space" | "duplicates" | "broken" | "missing";
const VIEWS: { value: View; label: TranslationKey }[] = [
  { value: "space", label: "upkeep.views.space" },
  { value: "duplicates", label: "upkeep.views.duplicates" },
  { value: "broken", label: "upkeep.views.broken" },
  { value: "missing", label: "upkeep.views.missing" },
];

/**
 * Keeping the libraries tidy: where the space goes, titles that are there more than once, and broken files.
 */
export default function UpkeepSettings() {
  const [view, setView] = useState<View>("space");
  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("upkeep.title")}</h1>
          <p>{t("upkeep.intro")}</p>
        </div>
      </header>
      <SegmentedControl<View> label={t("upkeep.viewLabel")} value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v.value, label: t(v.label) }))} />
      {view === "space" && <SpaceView />}
      {(view === "duplicates" || view === "broken") && <ProblemsView view={view} />}
      {view === "missing" && <MissingView />}
    </>
  );
}

export function ItemLine(props: { item: UpkeepItemRef | null; file?: UpkeepFile; children?: React.ReactNode }) {
  const { item, file, children } = props;
  return (
    <div className="cn-settings__item cn-upkeep__item">
      <span className="cn-upkeep__thumb">{item?.image && <img src={ItemsApi.imageUrl(item.image, 160)} alt="" loading="lazy" />}</span>
      <div className="cn-settings__item-text">
        {item ? <Link href={`/item/${item.id}`} className="cn-upkeep__title">{item.title}</Link> : <strong>{t("upkeep.notInLibrary")}</strong>}
        {file && <span className="cn-upkeep__path" title={file.path}>{`\u200e${file.path}\u200e`}</span>}
        {file && <span>{fileFacts(file)}</span>}
        {file?.problem && <span className="cn-upkeep__problem">{file.problem}</span>}
      </div>
      {children}
    </div>
  );
}

function fileFacts(file: UpkeepFile) {
  return [
    formatBytes(file.size),
    file.resolution,
    file.videoCodec?.toUpperCase(),
    file.hdr,
    file.bitrate ? formatBitrate(file.bitrate) : null,
    file.duration ? formatDuration(file.duration) : null,
    t("upkeep.modified", { date: formatDate(file.modifiedAt.slice(0, 10)) }),
  ].filter(Boolean).join(t("common.dotSeparator"));
}

function SpaceView() {
  const { data, error } = usePoll(UpkeepApi.space, null);
  if (!data) return error ? <p className="cn-settings__row-text"><span>{error}</span></p> : <Spinner size="2rem" />;
  return <Space data={data} />;
}

function Space(props: { data: SpaceUsage }) {
  const { data } = props;
  const maxLibrary = Math.max(1, ...data.libraries.map((l) => l.size));
  const maxType = Math.max(1, ...data.types.map((x) => x.size));
  return (
    <>
      <section className="cn-settings__card">
        <h2><HardDrive className="cn-upkeep__heading-icon" aria-hidden="true" /> {t("upkeep.space.total", { size: formatBytes(data.total) })}</h2>
        <div className="cn-stats__people">
          {data.libraries.map((l) => (
            <div key={l.id} className="cn-upkeep__bar">
              <span className="cn-stats__person-name">{l.name}</span>
              <span className="cn-meter"><span style={{ width: formatPercent(l.size / maxLibrary) }} /></span>
              <span className="cn-stats__time">{formatBytes(l.size)}</span>
              <span className="cn-upkeep__sub">{[t("upkeep.space.files", { count: l.files }), l.free !== null ? t("upkeep.space.free", { size: formatBytes(l.free) }) : null].filter(Boolean).join(t("common.dotSeparator"))}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="cn-settings__card">
        <h2>{t("upkeep.space.types")}</h2>
        <div className="cn-stats__people">
          {data.types.slice(0, 12).map((type) => (
            <div key={type.type} className="cn-upkeep__bar">
              <span className="cn-stats__person-name">.{type.type}</span>
              <span className="cn-meter"><span style={{ width: formatPercent(type.size / maxType) }} /></span>
              <span className="cn-stats__time">{formatBytes(type.size)}</span>
              <span className="cn-upkeep__sub">{t("upkeep.space.files", { count: type.files })}</span>
            </div>
          ))}
        </div>
      </section>
      {data.shows.length > 0 && (
        <section className="cn-settings__card">
          <h2>{t("upkeep.space.shows")}</h2>
          <div className="cn-settings__list">
            {data.shows.map((show) => (
              <ItemLine key={show.item.id} item={show.item}>
                <span className="cn-stats__time">{formatBytes(show.size)} · {t("upkeep.space.files", { count: show.files })}</span>
              </ItemLine>
            ))}
          </div>
        </section>
      )}
      <section className="cn-settings__card">
        <h2>{t("upkeep.space.biggest")}</h2>
        <div className="cn-settings__list">
          {data.biggest.map((b) => <ItemLine key={b.file.id} item={b.item} file={b.file} />)}
        </div>
      </section>
    </>
  );
}

function ProblemsView(props: { view: "duplicates" | "broken" }) {
  const { view } = props;
  const { data, error, reload, setData } = usePoll(UpkeepApi.overview, 4000);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<UpkeepFile | null>(null);

  async function removeFile() {
    if (!removing) return;
    setBusy(`delete-${removing.id}`);
    try {
      setData(await UpkeepApi.deleteFile(removing.id));
      toasts.success(t("upkeep.deleted"));
      setRemoving(null);
    } catch (e) {
      toasts.error(t("deleteDialog.failed"), (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const confirmDelete = (
    <ConfirmDialog
      open={removing !== null}
      onOpenChange={(open) => !open && setRemoving(null)}
      title={t("upkeep.deleteTitle")}
      description={t("upkeep.deleteDescription", { path: removing?.path ?? "", size: removing ? formatBytes(removing.size) : "" })}
      confirmLabel={t("deleteDialog.confirm")}
      danger
      loading={busy?.startsWith("delete-")}
      onConfirm={removeFile}
    />
  );
  const deleteButton = (file: UpkeepFile) => data?.canDelete && <IconButton label={t("upkeep.deleteFile", { path: file.path })} icon={<Trash2 />} onClick={() => setRemoving(file)} />;

  async function checkAll() {
    setBusy("all");
    try {
      setData(await UpkeepApi.checkAll());
      toasts.success(t("upkeep.broken.checkStarted"));
    } catch (e) {
      toasts.error(t("upkeep.broken.checkFailed"), (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function checkOne(fileId: number) {
    setBusy(`file-${fileId}`);
    try {
      const { problem } = await UpkeepApi.checkFile(fileId);
      if (problem) toasts.error(t("upkeep.broken.stillBroken"), problem);
      else toasts.success(t("upkeep.broken.fine"));
      reload();
    } catch (e) {
      toasts.error(t("upkeep.broken.checkFailed"), (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return error ? <p className="cn-settings__row-text"><span>{error}</span></p> : <Spinner size="2rem" />;

  if (view === "duplicates") {
    return (
      <section className="cn-settings__card">
        <h2><Copy className="cn-upkeep__heading-icon" aria-hidden="true" /> {t("upkeep.duplicates.title", { count: data.duplicates.length })}</h2>
        <p className="cn-settings__row-text"><span>{t("upkeep.duplicates.text")}</span></p>
        {data.duplicates.length === 0 && <p className="cn-settings__row-text"><strong>{t("upkeep.duplicates.none")}</strong></p>}
        {data.duplicates.map((group) => (
          <div key={group.key} className="cn-upkeep__group">
            <div className="cn-upkeep__group-head">
              <strong>{group.title}</strong>
              <span>{t("upkeep.duplicates.extra", { size: formatBytes(group.extra) })}</span>
            </div>
            <div className="cn-settings__list">
              {group.copies.map((copy) => (
                <ItemLine key={`${copy.item.id}-${copy.file.id}`} item={copy.item} file={copy.file}>
                  {copy.item.type !== "show" && deleteButton(copy.file)}
                </ItemLine>
              ))}
            </div>
          </div>
        ))}
        {confirmDelete}
      </section>
    );
  }

  return (
    <section className="cn-settings__card">
      <h2><CircleAlert className="cn-upkeep__heading-icon" aria-hidden="true" /> {t("upkeep.broken.title", { count: data.broken.length })}</h2>
      <p className="cn-settings__row-text"><span>{t("upkeep.broken.text")}</span></p>
      <div className="cn-settings__row">
        <div className="cn-settings__row-text">
          {data.checking
            ? <strong>{data.checking.status}{data.checking.progress !== null && ` · ${formatPercent(data.checking.progress)}`}</strong>
            : <span>{t("upkeep.broken.unchecked", { count: data.unchecked })}</span>}
        </div>
        <Button icon={<SearchCheck />} loading={busy === "all" || !!data.checking} onClick={checkAll}>{t("upkeep.broken.checkAll")}</Button>
      </div>
      {data.broken.length === 0 && <p className="cn-settings__row-text"><strong>{t("upkeep.broken.none")}</strong></p>}
      <div className="cn-settings__list">
        {data.broken.map((b) => (
          <ItemLine key={b.file.id} item={b.item} file={b.file}>
            <Button size="sm" icon={<RefreshCw />} loading={busy === `file-${b.file.id}`} onClick={() => checkOne(b.file.id)}>{t("upkeep.broken.checkAgain")}</Button>
            {deleteButton(b.file)}
          </ItemLine>
        ))}
      </div>
      {confirmDelete}
    </section>
  );
}

/**
 * Shows with aired episodes that aren't here, from the episode lists looked up so far.
 */
function MissingView() {
  const { data, error, reload } = usePoll(UpkeepApi.missing, 4000);
  const [starting, setStarting] = useState(false);

  async function lookUp() {
    setStarting(true);
    try {
      await UpkeepApi.lookUpMissing();
      toasts.success(t("upkeep.missing.started"));
      reload();
    } catch (e) {
      toasts.error(t("upkeep.missing.failed"), (e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (!data) return error ? <p className="cn-settings__row-text"><span>{error}</span></p> : <Spinner size="2rem" />;
  return (
    <section className="cn-settings__card">
      <h2><ListX className="cn-upkeep__heading-icon" aria-hidden="true" /> {t("upkeep.missing.title", { count: data.shows.length })}</h2>
      <p className="cn-settings__row-text"><span>{t("upkeep.missing.text")}</span></p>
      <div className="cn-settings__row">
        <div className="cn-settings__row-text">
          {data.lookingUp
            ? <strong>{data.lookingUp.status}{data.lookingUp.progress !== null && ` · ${formatPercent(data.lookingUp.progress)}`}</strong>
            : <span>{t("upkeep.missing.lookedUp", { done: data.lookedUp, total: data.total })}</span>}
        </div>
        <Button icon={<RefreshCw />} loading={starting || !!data.lookingUp} onClick={lookUp}>{t("upkeep.missing.lookUp")}</Button>
      </div>
      {data.shows.length === 0 && <p className="cn-settings__row-text"><strong>{t("upkeep.missing.none")}</strong></p>}
      <div className="cn-settings__list">
        {data.shows.map((show) => (
          <ItemLine key={show.id} item={{ id: show.id, title: show.title, type: "show", image: show.image, libraryName: "" }}>
            <span className="cn-stats__time">{t("upkeep.missing.count", { count: show.missing, aired: show.aired })}</span>
          </ItemLine>
        ))}
      </div>
    </section>
  );
}
