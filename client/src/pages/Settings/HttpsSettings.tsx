import { useEffect, useState } from "react";
import { Download, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import type { CertificateKind, HttpsSettingsUpdate, HttpsStatus } from "@shared/https.ts";
import HttpsApi from "../../Api/HttpsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import usePoll from "../../lib/usePoll.ts";
import { formatMoment } from "../../lib/format.ts";
import { rich, serverText, t, type TranslationKey } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import "./Admin.scss";

const KINDS: { value: CertificateKind; label: TranslationKey }[] = [
  { value: "cinemion", label: "https.kind.cinemion" },
  { value: "letsencrypt", label: "https.kind.letsencrypt" },
  { value: "own", label: "https.kind.own" },
];

/**
 * The devices people trust Cinemion's certificate authority on, each with its own steps.
 */
const TRUST_GUIDES: { title: TranslationKey; steps: TranslationKey }[] = [
  { title: "https.trust.windows.title", steps: "https.trust.windows.steps" },
  { title: "https.trust.mac.title", steps: "https.trust.mac.steps" },
  { title: "https.trust.iphone.title", steps: "https.trust.iphone.steps" },
  { title: "https.trust.android.title", steps: "https.trust.android.steps" },
  { title: "https.trust.linux.title", steps: "https.trust.linux.steps" },
  { title: "https.trust.firefox.title", steps: "https.trust.firefox.steps" },
];

/**
 * Built-in https: on or off, where the certificate comes from, how to trust Cinemion's own, and sending plain http
 * visitors over.
 */
export default function HttpsSettings() {
  const { data, error, setData, reload } = usePoll(HttpsApi.status, 3000);
  const [saving, setSaving] = useState<string | null>(null);

  async function save(key: string, changes: HttpsSettingsUpdate, done?: TranslationKey) {
    setSaving(key);
    try {
      const result = await HttpsApi.update(changes);
      setData(result);
      if (result.settings.enabled && !result.running && result.error) toasts.error(t("https.notStarted"), serverText(result.error));
      else if (done) toasts.success(t(done));
      return true;
    } catch (e) {
      toasts.error(t("common.couldntSave"), (e as Error).message);
      reload();
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function renew() {
    setSaving("renew");
    try {
      const result = await HttpsApi.renew();
      setData(result);
      if (result.error) toasts.error(t("https.renewFailed"), serverText(result.error));
      else toasts.success(t("https.renewed"));
    } catch (e) {
      toasts.error(t("https.renewFailed"), (e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  if (!data) return error ? <p className="cn-settings__row-text"><span>{error}</span></p> : <Spinner size="2rem" />;
  const { settings } = data;

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("https.title")}</h1>
          <p>{t("https.intro")}</p>
        </div>
      </header>

      <section className="cn-settings__card">
        <h2>{t("https.address.title")}</h2>
        <Switch
          label={t("https.address.switch")}
          description={t("https.address.switchDescription")}
          checked={settings.enabled}
          disabled={saving !== null}
          onChange={(enabled) => save("enabled", { enabled }, enabled ? "https.address.turnedOn" : "https.address.turnedOff")}
        />
        <PortField port={settings.port} saving={saving === "port"} onSave={(port) => save("port", { port }, "common.saved")} />
        {data.step && (
          <p className="cn-https__step" aria-live="polite"><Spinner size="1em" /> {serverText(data.step)}</p>
        )}
        {settings.enabled && data.running && data.addresses.length > 0 && (
          <div className="cn-https__addresses">
            <span>{t("https.address.openAt")}</span>
            {data.addresses.map((address) => <a key={address} href={address} target="_blank" rel="noreferrer">{address} <ExternalLink aria-hidden="true" /></a>)}
          </div>
        )}
        {data.error && <p className={settings.enabled && !data.running ? "cn-backups__error" : "cn-https__warning"} role="alert">{serverText(data.error)}</p>}
        {data.certificate && (
          <p className="cn-settings__row-text">
            <span>
              {t("https.certificate.facts", { issuer: data.certificate.issuer ?? t("common.unknown"), date: formatMoment(data.certificate.notAfter) })}
            </span>
          </p>
        )}
      </section>

      <CertificateCard data={data} saving={saving} onSave={save} onRenew={renew} />

      <section className="cn-settings__card">
        <h2>{t("https.redirect.title")}</h2>
        <Switch
          label={t("https.redirect.switch")}
          description={t("https.redirect.description")}
          checked={settings.redirect}
          disabled={saving !== null || !settings.enabled}
          onChange={(redirect) => save("redirect", { redirect }, "common.saved")}
        />
      </section>
    </>
  );
}

function PortField(props: { port: number; saving: boolean; onSave: (port: number) => void }) {
  const { port, saving, onSave } = props;
  const [value, setValue] = useState(String(port));
  useEffect(() => setValue(String(port)), [port]);
  const number = Number(value);
  return (
    <div className="cn-backups__folder">
      <TextField
        label={t("https.address.port")}
        description={t("https.address.portDescription")}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        className="cn-https__port"
      />
      <Button onClick={() => onSave(number)} loading={saving} disabled={!number || number === port}>{t("common.save")}</Button>
    </div>
  );
}

interface CertificateCardProps {
  data: HttpsStatus;
  saving: string | null;
  onSave: (key: string, changes: HttpsSettingsUpdate, done?: TranslationKey) => Promise<boolean>;
  onRenew: () => void;
}

/**
 * Where the certificate comes from. Picking another kind only shows its fields; "Use this" switches over.
 */
function CertificateCard(props: CertificateCardProps) {
  const { data, saving, onSave, onRenew } = props;
  const { settings } = data;
  const [kind, setKind] = useState<CertificateKind>(settings.kind);
  const inUse = kind === settings.kind;

  return (
    <section className="cn-settings__card">
      <h2>{t("https.certificate.title")}</h2>
      <SegmentedControl<CertificateKind> label={t("https.certificate.kind")} value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: t(k.label) }))} />
      {kind === "cinemion" && <CinemionFields data={data} inUse={inUse} saving={saving} onSave={onSave} onRenew={onRenew} />}
      {kind === "letsencrypt" && <LetsEncryptFields data={data} inUse={inUse} saving={saving} onSave={onSave} onRenew={onRenew} />}
      {kind === "own" && <OwnFields inUse={inUse} saving={saving} onSave={onSave} />}
    </section>
  );
}

interface FieldsProps {
  data: HttpsStatus;
  inUse: boolean;
  saving: string | null;
  onSave: CertificateCardProps["onSave"];
  onRenew: () => void;
}

function InUse() {
  return <span className="cn-settings__badge cn-settings__badge--accent cn-https__in-use"><ShieldCheck aria-hidden="true" /> {t("https.certificate.inUse")}</span>;
}

function CinemionFields(props: FieldsProps) {
  const { data, inUse, saving, onSave, onRenew } = props;
  const [names, setNames] = useState(data.settings.extraNames.join(", "));
  const covered = inUse ? data.certificate?.names ?? [] : [];
  const here = location.hostname;
  const missing = inUse && data.running && here && !covered.includes(here) && !data.settings.extraNames.includes(here);
  const list = (text: string) => text.split(/[\s,]+/).map((n) => n.trim()).filter(Boolean);

  return (
    <>
      {inUse && <InUse />}
      <p className="cn-settings__row-text"><span>{t("https.cinemion.text")}</span></p>
      {missing && (
        <div className="cn-https__warning cn-https__missing">
          <span>{t("https.cinemion.notCovered", { host: here })}</span>
          <Button size="sm" loading={saving === "names"} onClick={() => onSave("names", { extraNames: [...data.settings.extraNames, here] }, "https.cinemion.added")}>{t("https.cinemion.add", { host: here })}</Button>
        </div>
      )}
      <div className="cn-backups__folder">
        <TextField
          label={t("https.cinemion.names")}
          description={covered.length ? t("https.cinemion.covers", { names: covered.join(t("common.listSeparator")) }) : t("https.cinemion.namesDescription")}
          value={names}
          placeholder="cinemion.lan, 192.168.1.20"
          spellCheck={false}
          onChange={(e) => setNames(e.target.value)}
          className="cn-backups__folder-field"
        />
        <Button onClick={() => onSave("names", { extraNames: list(names) }, "common.saved")} loading={saving === "names"} disabled={list(names).join(",") === data.settings.extraNames.join(",")}>{t("common.save")}</Button>
      </div>
      <div className="cn-settings__row">
        {!inUse && <Button variant="primary" loading={saving === "kind"} onClick={() => onSave("kind", { kind: "cinemion", enabled: true }, "https.certificate.switched")}>{t("https.certificate.use")}</Button>}
        {inUse && data.certificate && <Button icon={<RefreshCw />} loading={saving === "renew"} onClick={onRenew}>{t("https.cinemion.remake")}</Button>}
      </div>

      {data.authority && (
        <>
          <div className="cn-settings__divider" />
          <h3 className="cn-https__subheading">{t("https.trust.title")}</h3>
          <p className="cn-settings__row-text"><span>{t("https.trust.text")}</span></p>
          <div>
            <a className="cn-button cn-button--secondary cn-https__download" href={HttpsApi.AUTHORITY_URL} download="cinemion-ca.crt"><Download aria-hidden="true" /> {t("https.trust.download")}</a>
          </div>
          <p className="cn-settings__row-text">
            <span>{rich("https.trust.onPhone", { address: <code>{`http://${location.host}${HttpsApi.AUTHORITY_URL}`}</code> })}</span>
          </p>
          <div className="cn-https__guides">
            {TRUST_GUIDES.map((guide) => (
              <details key={guide.title} className="cn-https__guide">
                <summary>{t(guide.title)}</summary>
                <p>{t(guide.steps)}</p>
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function LetsEncryptFields(props: FieldsProps) {
  const { data, inUse, saving, onSave, onRenew } = props;
  const [domain, setDomain] = useState(data.settings.domain ?? "");
  const [email, setEmail] = useState(data.settings.email ?? "");
  const changed = domain.trim() !== (data.settings.domain ?? "") || email.trim() !== (data.settings.email ?? "");

  return (
    <>
      {inUse && <InUse />}
      <p className="cn-settings__row-text"><span>{t("https.letsencrypt.text")}</span></p>
      <ol className="cn-backups__steps cn-https__numbered">
        <li>{t("https.letsencrypt.stepDomain")}</li>
        <li>{rich("https.letsencrypt.stepPort80", { port: <code>{String(data.httpPort)}</code> })}</li>
        <li>{rich("https.letsencrypt.stepPort443", { port: <code>{String(data.settings.port)}</code> })}</li>
      </ol>
      <div className="cn-backups__fields">
        <TextField label={t("https.letsencrypt.domain")} value={domain} placeholder="cinemion.example.com" spellCheck={false} onChange={(e) => setDomain(e.target.value)} />
        <TextField label={t("https.letsencrypt.email")} description={t("https.letsencrypt.emailDescription")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <p className="cn-settings__row-text"><span>{rich("https.letsencrypt.terms", { link: (text) => <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer">{text}</a> })}</span></p>
      <div className="cn-settings__row">
        <Button
          variant="primary"
          loading={saving === "letsencrypt"}
          disabled={!domain.trim() || (inUse && !changed)}
          onClick={() => onSave("letsencrypt", { kind: "letsencrypt", enabled: true, domain: domain.trim(), email: email.trim() || null }, "https.letsencrypt.done")}
        >
          {t("https.letsencrypt.get")}
        </Button>
        {inUse && data.certificate && <Button icon={<RefreshCw />} loading={saving === "renew"} onClick={onRenew}>{t("https.letsencrypt.renew")}</Button>}
      </div>
    </>
  );
}

function OwnFields(props: { inUse: boolean; saving: string | null; onSave: CertificateCardProps["onSave"] }) {
  const { inUse, saving, onSave } = props;
  const [cert, setCert] = useState("");
  const [key, setKey] = useState("");
  return (
    <>
      {inUse && <InUse />}
      <p className="cn-settings__row-text"><span>{t("https.own.text")}</span></p>
      <div className="cn-field">
        <label className="cn-field__label" htmlFor="cn-https-cert">{t("https.own.certificate")}</label>
        <textarea id="cn-https-cert" className="cn-field__input cn-https__pem" rows={6} spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----" value={cert} onChange={(e) => setCert(e.target.value)} />
        <span className="cn-field__description">{t("https.own.certificateDescription")}</span>
      </div>
      <div className="cn-field">
        <label className="cn-field__label" htmlFor="cn-https-key">{t("https.own.key")}</label>
        <textarea id="cn-https-key" className="cn-field__input cn-https__pem" rows={4} spellCheck={false} placeholder="-----BEGIN PRIVATE KEY-----" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <div className="cn-settings__row">
        <Button
          variant="primary"
          loading={saving === "own"}
          disabled={!cert.trim() || !key.trim()}
          onClick={async () => {
            if (await onSave("own", { kind: "own", enabled: true, ownCertificate: cert, ownKey: key }, "https.own.saved")) {
              setCert("");
              setKey("");
            }
          }}
        >
          {inUse ? t("https.own.replace") : t("https.own.use")}
        </Button>
      </div>
    </>
  );
}
