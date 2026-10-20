import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import type { SubtitleSearchResult } from "@shared/playback.ts";
import { findLanguage, LANGUAGES } from "@shared/languages.ts";
import SubtitlesApi from "../../Api/SubtitlesApi.ts";
import useController from "../../lib/useController.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
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
      toasts.success("Subtitles added", "They're saved for next time too.");
      onOpenChange(false);
    } catch (e) {
      toasts.error("Couldn't download the subtitles", (e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  const fileName = item.files.find((f) => f.id === fileId)?.path.split(/[\\/]/).pop();
  const title = item.type === "episode" ? `${item.showTitle ?? ""} · ${item.title}` : `${item.title}${item.year ? ` (${item.year})` : ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Find subtitles" description={[title, fileName].filter(Boolean).join(" · ")} size="lg" container={container}>
      <div className="cn-subtitle-search">
        <form
          className="cn-subtitle-search__form"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} />
          <TextField label="Search" type="search" placeholder={item.type === "episode" ? item.showTitle ?? item.title : item.title} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" variant="secondary" icon={<Search />} loading={loading}>Search</Button>
        </form>
        <Switch label="Only subtitles for the hearing impaired" checked={hearingImpaired} onChange={setHearingImpaired} />

        <div className="cn-subtitle-search__results" aria-busy={loading}>
          {loading && !results && <Spinner size="2rem" label="Searching" />}
          {error && <p className="cn-subtitle-search__message cn-subtitle-search__message--error">{error}</p>}
          {results?.length === 0 && !loading && <p className="cn-subtitle-search__message">Nothing found in {findLanguage(language)?.name}. Try another title or language.</p>}
          {results?.map((r) => (
            <div key={`${r.provider}-${r.id}`} className="cn-subtitle-search__row">
              <div className="cn-subtitle-search__text">
                <strong>{r.name}</strong>
                <span className="cn-subtitle-search__meta">
                  {r.matchesFile && <span className="cn-subtitle-search__tag cn-subtitle-search__tag--match">Matches your file</span>}
                  {r.isHearingImpaired && <span className="cn-subtitle-search__tag">SDH</span>}
                  <span>{[SITE_NAMES[r.provider] ?? r.provider, r.downloads ? `${r.downloads.toLocaleString()} downloads` : null, r.rating ? `★ ${r.rating}` : null, ...r.notes].filter(Boolean).join(" · ")}</span>
                </span>
              </div>
              {used.includes(r.id)
                ? <span className="cn-subtitle-search__used"><Check /> In use</span>
                : (
                  <Button size="sm" variant={r.matchesFile ? "primary" : "secondary"} loading={downloading === r.id} disabled={downloading !== null && downloading !== r.id} onClick={() => use(r)}>
                    Use
                  </Button>
                )}
            </div>
          ))}
        </div>
        <p className={cx("cn-subtitle-search__footer")}>Results from the subtitle sites set up in Settings › Subtitles. Downloads are kept with the video, so they're there next time.</p>
      </div>
    </Dialog>
  );
}
