import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import type { SubtitleSearchResult } from "@shared/playback.ts";
import { findLanguage, LANGUAGES } from "@shared/languages.ts";
import SubtitlesApi from "../../Api/SubtitlesApi.ts";
import useController from "../../lib/useController.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import { displayLanguage } from "../../lib/playback.ts";
import { t } from "../../i18n/I18n.ts";
import Dialog from "../Dialog/Dialog.tsx";
import Button from "../Button/Button.tsx";
import Select from "../Select/Select.tsx";
import TextField from "../TextField/TextField.tsx";
import Switch from "../Switch/Switch.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import type PlayerController from "./PlayerController.ts";

export interface SubtitleSearchDialogProps {
  controller: PlayerController;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: HTMLElement | null;
}

const LANGUAGE_KEY = "cn-subtitle-language";

/**
 * The language searched last on this device, or the browser's language.
 */
function startLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved && findLanguage(saved)) return saved;
  } catch {
    // No storage
  }
  return findLanguage(navigator.language)?.code ?? findLanguage(navigator.language.split("-")[0])?.code ?? "en";
}

const SITE_NAMES: Record<string, string> = { opensubtitles: "OpenSubtitles", subdl: "SubDL", podnapisi: "Podnapisi" };

/**
 * Search subtitle sites for the playing file and use a result straight away.
 */
export default function SubtitleSearchDialog(props: SubtitleSearchDialogProps) {
  const { controller, open, onOpenChange, container } = props;
  const { item, info } = useController(controller);
  const [language, setLanguage] = useState(startLanguage);
  const [query, setQuery] = useState("");
  const [hearingImpaired, setHearingImpaired] = useState(false);
  const [results, setResults] = useState<SubtitleSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [used, setUsed] = useState<string[]>([]);

  const fileId = info?.fileId ?? item.files[0]?.id;

  async function search(typed = query) {
    if (!fileId) return;
    setLoading(true);
    setError(null);
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // Not remembered
    }
    try {
      setResults(await SubtitlesApi.search(fileId, { language, query: typed.trim() || undefined, hearingImpaired: hearingImpaired ? "only" : "include" }));
    } catch (e) {
      setResults(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Search right away for the matched title; typing a different title is only needed when that finds nothing
  useEffect(() => {
    if (open) search("");
  }, [open, language, hearingImpaired]);

  async function use(result: SubtitleSearchResult) {
    if (!fileId) return;
    setDownloading(result.id);
    try {
      const track = await SubtitlesApi.download({ fileId, provider: result.provider, id: result.id, language: result.language, isHearingImpaired: result.isHearingImpaired });
      setUsed((u) => [...u, result.id]);
      controller.addSubtitle(track);
      toasts.success(t("player.subtitleSearch.added"), t("player.subtitleSearch.addedDescription"));
      onOpenChange(false);
    } catch (e) {
      toasts.error(t("player.subtitleSearch.downloadFailed"), (e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const fileName = item.files.find((f) => f.id === fileId)?.path.split(/[\\/]/).pop();
  const title = item.type === "episode"
    ? t("player.subtitleSearch.episode", { show: item.showTitle ?? "", episode: item.title })
    : item.year ? t("player.subtitleSearch.movieYear", { title: item.title, year: String(item.year) }) : item.title;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("player.subtitleSearch.title")} description={[title, fileName].filter(Boolean).join(t("common.dotSeparator"))} size="lg" container={container}>
      <div className="cn-subtitle-search">
        <form
          className="cn-subtitle-search__form"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <Select label={t("player.subtitleSearch.language")} value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES.map((l) => ({ value: l.code, label: displayLanguage(l.code) ?? l.name }))} />
          <TextField label={t("common.search")} type="search" placeholder={item.type === "episode" ? item.showTitle ?? item.title : item.title} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" variant="secondary" icon={<Search />} loading={loading}>{t("common.search")}</Button>
        </form>
        <Switch label={t("player.subtitleSearch.hearingImpaired")} checked={hearingImpaired} onChange={setHearingImpaired} />

        <div className="cn-subtitle-search__results" aria-busy={loading}>
          {loading && !results && <Spinner size="2rem" label={t("player.subtitleSearch.searching")} />}
          {error && <p className="cn-subtitle-search__message cn-subtitle-search__message--error">{error}</p>}
          {results?.length === 0 && !loading && <p className="cn-subtitle-search__message">{t("player.subtitleSearch.nothingFound", { language: displayLanguage(language) ?? "" })}</p>}
          {results?.map((r) => (
            <div key={`${r.provider}-${r.id}`} className="cn-subtitle-search__row">
              <div className="cn-subtitle-search__text">
                <strong>{r.name}</strong>
                <span className="cn-subtitle-search__meta">
                  {r.matchesFile && <span className="cn-subtitle-search__tag cn-subtitle-search__tag--match">{t("player.subtitleSearch.matchesFile")}</span>}
                  {r.isHearingImpaired && <span className="cn-subtitle-search__tag">{t("player.subtitleSearch.sdh")}</span>}
                  <span>{[SITE_NAMES[r.provider] ?? r.provider, r.downloads ? t("player.subtitleSearch.downloads", { count: r.downloads }) : null, r.rating ? t("player.subtitleSearch.rating", { rating: r.rating }) : null, ...r.notes].filter(Boolean).join(t("common.dotSeparator"))}</span>
                </span>
              </div>
              {used.includes(r.id)
                ? <span className="cn-subtitle-search__used"><Check /> {t("player.subtitleSearch.inUse")}</span>
                : (
                  <Button size="sm" variant={r.matchesFile ? "primary" : "secondary"} loading={downloading === r.id} disabled={downloading !== null && downloading !== r.id} onClick={() => use(r)}>
                    {t("player.subtitleSearch.use")}
                  </Button>
                )}
            </div>
          ))}
        </div>
        <p className={cx("cn-subtitle-search__footer")}>{t("player.subtitleSearch.footer")}</p>
      </div>
    </Dialog>
  );
}
