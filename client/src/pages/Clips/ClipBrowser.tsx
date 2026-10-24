import { useCallback, useEffect, useMemo, useState } from "react";
import { Gamepad2, ListChecks, Star, StarOff, X } from "lucide-react";
import type { ClipSort, GameChoice } from "@shared/clips.ts";
import type { ItemSummary } from "@shared/media.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import { session } from "../../Session.ts";
import usePaged from "../../lib/usePaged.ts";
import { toasts } from "../../lib/Toasts.ts";
import { i18n, t, type TranslationKey } from "../../i18n/I18n.ts";
import ClipCard from "../../components/ClipCard/ClipCard.tsx";
import SetGameDialog from "../../components/SetGameDialog/SetGameDialog.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Select from "../../components/Select/Select.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "../Library/Library.scss";
import "../Photos/Photos.scss";
import "./Clips.scss";

const SORTS: { value: ClipSort; label: TranslationKey }[] = [
  { value: "newest", label: "clips.browser.sort.newest" },
  { value: "oldest", label: "clips.browser.sort.oldest" },
  { value: "longest", label: "clips.browser.sort.longest" },
];

export interface ClipBrowserProps {
  libraryId: number;
  /**
   * Only this game's clips, on its page. Left out, the game is picked with a filter.
   */
  game?: number;
  /**
   * The games for the filter.
   */
  games?: { id: number; title: string }[];
  /**
   * The game filter to start with: a game, `none` for clips without one, or `null` for all.
   */
  initialGame?: number | "none" | null;
  /**
   * Called after clips moved to another game, so counts elsewhere on the page can update.
   */
  onChanged?: () => void;
}

/**
 * A library's (or a game's) clips by month, with filters for game, tag and stars, and picking several to give them a
 * game or a star.
 */
export default function ClipBrowser(props: ClipBrowserProps) {
  const { libraryId, game: fixedGame, games, initialGame = null, onChanged } = props;
  const [gameFilter, setGameFilter] = useState<number | "none" | null>(fixedGame ?? initialGame);
  const [tag, setTag] = useState<string | null>(null);
  const [starred, setStarred] = useState(false);
  const [sort, setSort] = useState<ClipSort>("newest");
  const [tags, setTags] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [settingGame, setSettingGame] = useState(false);
  const canManage = session.can("LIBRARY_MANAGE");
  const game = fixedGame ?? gameFilter;

  useEffect(() => setGameFilter(fixedGame ?? initialGame), [fixedGame, initialGame]);

  useEffect(() => {
    ClipsApi.tags(libraryId, game).then(setTags).catch(() => setTags([]));
  }, [libraryId, game, version]);

  const load = useCallback(
    (offset: number) => ClipsApi.clips(libraryId, { game, tag, favorites: starred, sort }, offset),
    [libraryId, game, tag, starred, sort, version],
  );
  const list = usePaged(load);
  const groups = useMemo(() => sort === "longest" ? [{ month: null, items: list.items ?? [] }] : byMonth(list.items ?? []), [list.items, sort]);

  function toggle(id: number) {
    setSelected((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function reload() {
    setSelected(null);
    setVersion((v) => v + 1);
    onChanged?.();
  }

  async function star(favorite: boolean) {
    if (!selected?.size) return;
    try {
      await ClipsApi.setFavorite([...selected], favorite);
      toasts.success(favorite ? t("clips.browser.didStar", { count: selected.size }) : t("clips.browser.didUnstar"));
      reload();
    } catch (error) {
      toasts.error(t("clips.browser.couldntStar"), (error as Error).message);
    }
  }

  async function setGame(choice: GameChoice) {
    if (!selected?.size) return;
    const result = await ClipsApi.setGame(libraryId, [...selected], choice);
    const count = selected.size;
    toasts.success(result.game ? t("clips.browser.inGame", { count, game: result.game.title }) : t("clips.browser.noGameNow", { count }));
    reload();
  }

  const empty = list.items && list.items.length === 0 && !list.loading;

  return (
    <section className="cn-clips__browser" aria-label={t("clips.browser.label")}>
      <div className="cn-library__filters cn-clips__filters">
        {fixedGame === undefined && games && (
          <Select
            label={t("clips.browser.game")}
            value={gameFilter === null ? "" : String(gameFilter)}
            onChange={(e) => setGameFilter(e.target.value === "" ? null : e.target.value === "none" ? "none" : Number(e.target.value))}
            options={[{ value: "", label: t("clips.browser.allGames") }, { value: "none", label: t("clips.browser.noGame") }, ...games.map((g) => ({ value: String(g.id), label: g.title }))]}
            className="cn-library__select"
          />
        )}
        {tags.length > 0 && (
          <Select label={t("clips.browser.tag")} value={tag ?? ""} onChange={(e) => setTag(e.target.value || null)} options={[{ value: "", label: t("clips.browser.allTags") }, ...tags.map((name) => ({ value: name, label: name }))]} className="cn-library__select" />
        )}
        <SegmentedControl<"all" | "starred"> label={t("clips.browser.show")} value={starred ? "starred" : "all"} onChange={(v) => setStarred(v === "starred")} options={[{ value: "all", label: t("clips.browser.all") }, { value: "starred", label: t("clips.browser.starred") }]} />
        <Select label={t("clips.browser.sortBy")} value={sort} options={SORTS.map((s) => ({ value: s.value, label: t(s.label) }))} onChange={(e) => setSort(e.target.value as ClipSort)} className="cn-library__select" />
        {!empty && <Button icon={<ListChecks />} onClick={() => setSelected(selected ? null : new Set())} aria-pressed={!!selected}>{t("common.select")}</Button>}
      </div>

      {!list.items && <div className="cn-library__loading"><Spinner size="2rem" /></div>}
      {empty && (
        <section className="cn-library__empty">
          <h2>{starred ? t("clips.browser.emptyStarred") : t("clips.browser.empty")}</h2>
          <p>{starred ? t("clips.browser.emptyStarredHint") : tag ? t("clips.browser.emptyTag") : t("clips.browser.emptyFilters")}</p>
        </section>
      )}

      <div className="cn-clip-grid">
        {groups.map((group) => (
          <section key={group.month ?? "all"} className="cn-clip-grid__month" aria-label={group.month ? monthLabel(group.month) : t("clips.browser.label")}>
            {group.month && <h2>{monthLabel(group.month)}</h2>}
            <div className="cn-library__grid cn-library__grid--wide">
              {group.items.map((clip) => (
                <ClipCard key={clip.id} item={clip} showGame={fixedGame === undefined} selected={selected ? selected.has(clip.id) : null} onToggle={() => toggle(clip.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <div ref={list.sentinel} />
      {list.loading && list.items && <div className="cn-library__loading"><Spinner size="2rem" /></div>}

      {selected && (
        <div className="cn-photo-selection" role="toolbar" aria-label={t("clips.browser.selectionLabel")}>
          <IconButton label={t("clips.browser.stop")} icon={<X />} variant="ghost" size="sm" onClick={() => setSelected(null)} />
          <span className="cn-photo-selection__count">{selected.size === 0 ? t("clips.browser.pick") : t("clips.browser.selected", { count: selected.size })}</span>
          {canManage && <Button size="sm" variant="primary" icon={<Gamepad2 />} disabled={selected.size === 0} onClick={() => setSettingGame(true)}>{t("clips.browser.setGame")}</Button>}
          <Button size="sm" icon={<Star />} disabled={selected.size === 0} onClick={() => star(true)}>{t("clips.browser.star")}</Button>
          <Button size="sm" icon={<StarOff />} disabled={selected.size === 0} onClick={() => star(false)}>{t("clips.browser.unstar")}</Button>
        </div>
      )}

      <SetGameDialog
        open={settingGame}
        libraryId={libraryId}
        title={t("clips.browser.setGameTitle", { count: selected?.size ?? 0 })}
        description={t("clips.browser.setGameDescription")}
        allowNone
        onPick={setGame}
        onClose={() => setSettingGame(false)}
      />
    </section>
  );
}

/**
 * Clips by the month they were recorded, in the order they came.
 */
function byMonth(items: ItemSummary[]) {
  const groups: { month: string | null; items: ItemSummary[] }[] = [];
  for (const item of items) {
    const month = (item.clip?.takenAt ?? item.releaseDate)?.slice(0, 7) ?? null;
    const last = groups.at(-1);
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

/**
 * "March 2025", from `YYYY-MM`.
 */
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(i18n.locale, { month: "long", year: "numeric" });
}
