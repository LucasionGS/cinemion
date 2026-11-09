"use strict";

// The server list. It talks to the app through window.CinemionList, a private channel that only this page has: it sends
// { method, args, id } and gets { type: "response", id, result } back, plus { type: "event", detail } for answers that take
// a while (probing, scanning, updating).
(function () {
  const tv = globalThis.CinemionTV;
  const channel = globalThis.CinemionList;
  const $ = (id) => document.getElementById(id);

  const els = {
    status: $("status"),
    grid: $("serverGrid"),
    foundSection: $("foundSection"),
    foundGrid: $("foundGrid"),
    addPanel: $("addPanel"),
    addInput: $("addressInput"),
    addCancel: $("addCancel"),
    connecting: $("connecting"),
    connectingText: $("connectingText"),
    trustModal: $("trustModal"),
    trustText: $("trustText"),
    trustFingerprint: $("trustFingerprint"),
    trustYes: $("trustYes"),
    trustNo: $("trustNo"),
    banner: $("updateBanner"),
    updateTitle: $("updateTitle"),
    updateSub: $("updateSub"),
    updateButton: $("updateButton"),
  };

  const TINTS = ["#5B9DFF", "#3DDC97", "#F5C46B", "#FF6B5A", "#B58CFF", "#4FD1E0"];

  const state = {
    servers: [],
    found: [],
    scanning: false,
    openAfterAdd: false, // An address added from here is opened right away
    retry: null, // What to run again once a certificate is trusted
    certificate: null,
    confirmRemove: null,
    redrawing: false,
    updating: false,
  };

  if (!tv || !channel) {
    els.status.textContent = "This page is part of the Cinemion TV app. Open it from the app.";
    return;
  }

  //#region Talking to the app
  let nextRequest = 1;
  const requests = new Map();

  function send(method, args, id) {
    channel.postMessage(JSON.stringify({ method, args, id }));
  }

  // Calls that answer straight away
  function ask(method) {
    return new Promise((resolve) => {
      const id = nextRequest++;
      requests.set(id, resolve);
      send(method, [], id);
    });
  }

  const native = {
    getServers: () => ask("getServers"),
    addServer: (address) => send("addServer", [address]),
    removeServer: (id) => send("removeServer", [id]),
    openServer: (id) => send("openServer", [id]),
    scan: () => send("scan", []),
    trustCertificate: (hostPort, sha256) => send("trustCertificate", [hostPort, sha256]),
    checkUpdate: () => send("checkUpdate", []),
    installUpdate: () => send("installUpdate", []),
  };

  channel.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "response") {
      const resolve = requests.get(message.id);
      requests.delete(message.id);
      if (resolve) resolve(message.result);
    }
    else if (message.type === "event") {
      onEvent(message.detail);
    }
  };
  //#endregion

  //#region Helpers
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function tintFor(text) {
    let hash = 0;
    for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    const hex = TINTS[hash % TINTS.length];
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return { background: `rgba(${r}, ${g}, ${b}, 0.18)`, text: hex };
  }

  function whenUsed(ms) {
    if (!ms) return "Not opened yet";
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days < 1) return "Opened today";
    if (days === 1) return "Opened yesterday";
    return `Opened ${days} days ago`;
  }

  function displayAddress(url) {
    return url.replace(/^http:\/\//, "");
  }

  function nameOf(address) {
    const saved = state.servers.find((server) => server.url === address);
    return saved ? saved.name : displayAddress(address);
  }

  function setStatus(text, kind, spinner) {
    els.status.className = "status" + (kind ? ` status--${kind}` : "");
    els.status.textContent = "";
    if (spinner) els.status.append(element("span", "spinner"));
    els.status.append(text);
  }

  function showConnecting(text) {
    els.connectingText.textContent = text;
    els.connecting.hidden = false;
    if (document.activeElement) document.activeElement.blur();
  }

  function hideConnecting() {
    els.connecting.hidden = true;
  }
  //#endregion

  //#region Rendering
  function tile(key, picture, name, lines, extraClass) {
    const button = element("button", `tile ${extraClass || ""}`);
    button.type = "button";
    button.dataset.focusable = "";
    button.dataset.key = key;
    button.append(picture, element("span", "tile__name", name));
    for (const line of lines) button.append(element("span", line.className, line.text));
    return button;
  }

  function serverPicture(name, url) {
    const picture = element("span", "tile__picture", (name || url).trim().charAt(0).toUpperCase());
    const tint = tintFor(url);
    picture.style.setProperty("--tint", tint.background);
    picture.style.setProperty("--tint-text", tint.text);
    return picture;
  }

  function actionPicture(path) {
    const picture = element("span", "tile__picture");
    picture.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
    return picture;
  }

  function savedCard(server) {
    const card = element("div", "card");
    const open = tile(
      `server:${server.id}`,
      serverPicture(server.name, server.url),
      server.name || displayAddress(server.url),
      [
        { className: "tile__address", text: displayAddress(server.url) },
        { className: "tile__meta", text: server.version ? `Version ${server.version}` : "" },
        { className: "tile__meta", text: whenUsed(server.lastUsed) },
      ],
    );
    open.addEventListener("click", () => openServer(server));

    const remove = element("button", "link link--danger", state.confirmRemove === server.id ? "Press again to remove" : "Remove");
    remove.type = "button";
    remove.dataset.focusable = "";
    remove.dataset.key = `remove:${server.id}`;
    remove.addEventListener("click", () => {
      if (state.confirmRemove !== server.id) {
        state.confirmRemove = server.id;
        render(remove.dataset.key);
        return;
      }
      state.confirmRemove = null;
      native.removeServer(server.id);
      refresh().then(() => render("add"));
    });
    remove.addEventListener("blur", () => {
      // A button replaced by a redraw is blurred too, and mustn't cancel the question
      if (state.redrawing) return;
      if (state.confirmRemove === server.id) {
        state.confirmRemove = null;
        remove.textContent = "Remove";
      }
    });

    card.append(open, remove);
    return card;
  }

  function actionTiles() {
    const scan = tile(
      "scan",
      actionPicture('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
      "Find servers",
      [{ className: "tile__meta", text: "On this network" }],
      "tile--action",
    );
    scan.addEventListener("click", startScan);

    const add = tile(
      "add",
      actionPicture('<path d="M12 5v14M5 12h14"/>'),
      "Add a server",
      [{ className: "tile__meta", text: "Type its address" }],
      "tile--action",
    );
    add.addEventListener("click", openAddPanel);
    return [scan, add];
  }

  function render(focusKey) {
    const sorted = [...state.servers].sort((a, b) => b.lastUsed - a.lastUsed);
    state.redrawing = true;
    els.grid.replaceChildren(...sorted.map(savedCard), ...actionTiles());

    els.foundSection.hidden = state.found.length === 0;
    els.foundGrid.replaceChildren(...state.found.map((server) => {
      const found = tile(
        `found:${server.url}`,
        serverPicture(server.name, server.url),
        server.name,
        [
          { className: "tile__address", text: displayAddress(server.url) },
          { className: "tile__meta", text: `Version ${server.version}` },
        ],
      );
      found.addEventListener("click", () => addAndOpen(server.url));
      return found;
    }));

    state.redrawing = false;
    if (focusKey !== undefined) focusByKey(focusKey);
  }

  function focusByKey(key) {
    const target = [...document.querySelectorAll("[data-focusable]")].find((node) => node.dataset.key === key);
    focusElement(target || firstFocusable());
  }

  async function refresh() {
    state.servers = (await native.getServers()) || [];
  }
  //#endregion

  //#region Actions
  function openServer(server) {
    state.retry = () => openServer(server);
    showConnecting(`Opening ${server.name || displayAddress(server.url)}…`);
    native.openServer(server.id);
  }

  function addAndOpen(address) {
    const saved = state.servers.find((server) => server.url === address);
    if (saved) {
      openServer(saved);
      return;
    }
    startAdd(address);
  }

  // Adds a server and opens it as soon as it answers
  function startAdd(address) {
    state.openAfterAdd = true;
    state.retry = () => startAdd(address);
    showConnecting(`Connecting to ${displayAddress(address)}…`);
    native.addServer(address);
  }

  function startScan() {
    if (state.scanning) return;
    state.scanning = true;
    state.found = [];
    setStatus("Looking for servers on this network…", "", true);
    render();
    native.scan();
  }

  function openAddPanel() {
    els.addPanel.hidden = false;
    els.addInput.value = "";
    focusElement(els.addInput);
  }

  function closeAddPanel() {
    els.addPanel.hidden = true;
    focusByKey("add");
  }

  els.addPanel.addEventListener("submit", (event) => {
    event.preventDefault();
    const address = els.addInput.value.trim();
    if (!address) return;
    setStatus("");
    els.addInput.blur();
    els.addPanel.hidden = true;
    startAdd(address);
  });
  els.addCancel.addEventListener("click", closeAddPanel);

  els.trustYes.addEventListener("click", () => {
    const certificate = state.certificate;
    els.trustModal.hidden = true;
    state.certificate = null;
    native.trustCertificate(certificate.hostPort, certificate.fingerprint);
    if (state.retry) state.retry();
  });
  els.trustNo.addEventListener("click", closeTrustModal);

  function closeTrustModal() {
    els.trustModal.hidden = true;
    state.certificate = null;
    focusElement(firstFocusable());
  }

  els.updateButton.addEventListener("click", () => {
    if (state.updating) return;
    state.updating = true;
    els.updateButton.textContent = "Downloading… 0%";
    native.installUpdate();
  });
  //#endregion

  //#region Events from the app
  async function onProbe(detail) {
    hideConnecting();
    if (detail.ok) {
      const added = state.openAfterAdd;
      state.openAfterAdd = false;
      await refresh();
      render();
      if (added && detail.server) openServer(detail.server);
      return;
    }

    state.openAfterAdd = false;
    const name = nameOf(detail.address);
    if (detail.reason === "certificate") {
      state.certificate = { hostPort: detail.hostPort, fingerprint: detail.fingerprint };
      els.trustText.textContent = `${name} didn't use a certificate this device knows. Its fingerprint is:`;
      els.trustFingerprint.textContent = detail.fingerprint;
      els.trustModal.hidden = false;
      focusElement(els.trustNo);
    }
    else if (detail.reason === "notCinemion") {
      setStatus(`${displayAddress(detail.address)} answered, but it isn't a Cinemion server. Check the address and try again.`, "error");
      focusElement(preferredFocus());
    }
    else {
      setStatus(`Couldn't reach ${name} at ${displayAddress(detail.address)}. Check it's running, or pick another server.`, "error");
      focusElement(preferredFocus());
    }
  }

  function onFound(detail) {
    const server = detail.server;
    if (state.found.some((existing) => existing.url === server.url)) return;
    state.found.push(server);
    // The first result is below the buttons, so take the person to it
    render(state.found.length === 1 ? `found:${server.url}` : document.activeElement && document.activeElement.dataset.key);
  }

  function onScanDone() {
    state.scanning = false;
    if (state.found.length === 0) {
      setStatus("No servers found. Make sure your server is on and connected to the same network, or add it by its address.", "error");
    }
    else {
      setStatus(state.found.length === 1 ? "Found 1 server." : `Found ${state.found.length} servers.`, "ok");
    }
  }

  function onUpdate(detail) {
    const mb = detail.size ? ` (${(detail.size / 1048576).toFixed(1)} MB)` : "";
    els.updateTitle.textContent = `A new version of the app is ready: ${detail.version}`;
    els.updateSub.textContent = `You have ${tv.version()}.${mb}`;
    els.banner.hidden = false;
  }

  function onUpdateProgress(detail) {
    if (detail.percent < 100) {
      els.updateButton.textContent = `Downloading… ${detail.percent}%`;
      return;
    }
    // The system installer takes over; if it's cancelled the button is ready again
    els.updateButton.textContent = "Installing…";
    setTimeout(() => {
      state.updating = false;
      els.updateButton.textContent = "Update now";
    }, 8000);
  }

  function onEvent(detail) {
    switch (detail.type) {
      case "probe": onProbe(detail); break;
      case "found": onFound(detail); break;
      case "scanDone": onScanDone(); break;
      case "update": onUpdate(detail); break;
      case "updateProgress": onUpdateProgress(detail); break;
      case "error":
        state.scanning = false;
        state.updating = false;
        hideConnecting();
        els.updateButton.textContent = "Update now";
        setStatus(detail.message, "error");
        break;
    }
  }
  //#endregion

  //#region Remote control focus
  function visible(node) {
    return node.getClientRects().length > 0;
  }

  function scope() {
    if (!els.trustModal.hidden) return els.trustModal;
    if (!els.addPanel.hidden) return els.addPanel;
    if (!els.connecting.hidden) return null;
    return document;
  }

  function focusables() {
    const root = scope();
    return root ? [...root.querySelectorAll("[data-focusable]")].filter(visible) : [];
  }

  function firstFocusable() {
    return focusables()[0];
  }

  // A saved server is the likeliest next move, so it comes before the update banner and the add buttons
  function preferredFocus() {
    return focusables().find((node) => node.dataset.key && node.dataset.key.startsWith("server:")) || firstFocusable();
  }

  function focusElement(node) {
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function center(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // The gap between two ranges on one axis, 0 when they overlap
  function gap(aStart, aEnd, bStart, bEnd) {
    return Math.max(0, bStart - aEnd, aStart - bEnd);
  }

  // The nearest focusable in a direction. Candidates that sit in line (overlapping on the other axis) win over ones that
  // are off to the side, so a wide field leads to the first button under it (the first in page order wins a tie) and rows and columns stay lined up.
  function neighbour(from, direction) {
    const fromRect = from.getBoundingClientRect();
    const a = center(fromRect);
    const horizontal = direction === "left" || direction === "right";
    let best = null;
    let bestScore = Infinity;
    for (const node of focusables()) {
      if (node === from) continue;
      const rect = node.getBoundingClientRect();
      const b = center(rect);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const primary = { left: -dx, right: dx, up: -dy, down: dy }[direction];
      if (primary <= 1) continue;
      const aside = horizontal
        ? gap(fromRect.top, fromRect.bottom, rect.top, rect.bottom)
        : gap(fromRect.left, fromRect.right, rect.left, rect.right);
      const score = primary + aside * 3;
      if (score < bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  const ARROWS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      // Back closes whatever is open on top first; the app exits only when nothing handles it
      if (!els.trustModal.hidden) {
        closeTrustModal();
        event.preventDefault();
      }
      else if (!els.addPanel.hidden) {
        closeAddPanel();
        event.preventDefault();
      }
      return;
    }

    const direction = ARROWS[event.key];
    if (!direction) return;
    const active = document.activeElement;
    if (active === els.addInput && (direction === "left" || direction === "right")) {
      const atEdge = direction === "left" ? active.selectionStart === 0 : active.selectionEnd === active.value.length;
      if (!atEdge) return;
    }
    event.preventDefault();

    if (!scope()) return;
    if (!active || !active.dataset || !("focusable" in active.dataset)) {
      focusElement(firstFocusable());
      return;
    }
    focusElement(neighbour(active, direction));
  });
  //#endregion

  //#region Start
  async function start() {
    $("appVersion").textContent = `TV app ${tv.version()}`;
    await refresh();
    render();
    if (state.servers.length === 0) setStatus("No servers yet. Find one on your network, or add its address.");

    const connectingId = new URLSearchParams(location.search).get("connecting");
    const connectingTo = state.servers.find((server) => server.id === connectingId);
    if (connectingTo) {
      showConnecting(`Opening ${connectingTo.name || displayAddress(connectingTo.url)}…`);
    }
    else {
      focusElement(preferredFocus());
    }

    native.checkUpdate();
  }

  start();
  //#endregion
})();
