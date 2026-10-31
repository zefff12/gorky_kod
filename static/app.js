// Клиент ассистента: разделы по макету Figma, голос (Web Speech API), чат и списки записей.
// Распознавание и синтез речи выполняет браузер; сервер получает только текст.
(() => {
  const $ = (id) => document.getElementById(id);
  const ICONS = "/static/icons.svg";
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ------------------------------------------------------------ пользователь
  let me = { authenticated: false };
  let guestId = store.get("userId", "");
  if (!guestId) {
    guestId = "u-" + (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 12);
    store.set("userId", guestId);
  }
  const api = (path, opts = {}) => fetch(path, {
    ...opts, headers: { "Content-Type": "application/json", "X-User-Id": guestId, ...(opts.headers || {}) },
  });
  const getJSON = async (path) => { const r = await api(path); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

  // ------------------------------------------------------------ даты
  let TODAY = new Date();                              // уточняется по времени сервера
  const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const WD_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const WD_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayIso = () => iso(TODAY);
  function dayLabel(s, long = false) {
    const d = parse(s), diff = Math.round((d - parse(todayIso())) / 864e5);
    const base = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${d.getFullYear() !== TODAY.getFullYear() ? " " + d.getFullYear() : ""}`;
    if (diff === 0) return long ? `Сегодня, ${base}` : "Сегодня";
    if (diff === 1) return long ? `Завтра, ${base}` : "Завтра";
    if (diff === -1) return long ? `Вчера, ${base}` : "Вчера";
    return long ? `${WD_LONG[d.getDay()]}, ${base}` : base;
  }
  function timeRange(e) {
    if (!e.time) return e.date ? "Весь день" : "Без срока";
    if (e.type !== "meeting") return e.time;
    const [h, m] = e.time.split(":").map(Number), end = h * 60 + m + (e.duration_min || 60);
    return `${e.time} – ${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
  }
  const TYPE_NAME = { task: "Задача", meeting: "Встреча", reminder: "Напоминание" };
  const isOverdue = (e) => !e.done && e.date && !e.recurrence && e.date < todayIso();

  // ------------------------------------------------------------ мелкие элементы
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(name, cls = "icon") {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
    u.setAttribute("href", `${ICONS}#${name}`);
    s.appendChild(u);
    return s;
  }
  function catImg(e, cls = "cat-icon") {
    if (!e.category) return null;
    const img = el("img", `${cls} blend`);
    img.src = `/static/img/cat-${e.category}.webp`;
    img.alt = "";
    img.loading = "lazy";
    return img;
  }
  let toastTimer;
  function toast(text) {
    let t = document.querySelector(".toast");
    if (!t) { t = el("div", "toast"); document.body.appendChild(t); }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // одно открытое меню за раз; клик мимо закрывает
  let openMenu = null;
  function toggleMenu(menu, fill) {
    const willOpen = menu.hidden;
    closeMenus();
    if (willOpen) { if (fill) fill(menu); menu.hidden = false; openMenu = menu; }
  }
  function closeMenus() { if (openMenu) { openMenu.hidden = true; openMenu = null; } }
  document.addEventListener("click", (e) => {
    if (openMenu && !openMenu.contains(e.target) && !e.target.closest("[data-menu-trigger]")) closeMenus();
  });

  // ------------------------------------------------------------ действия с записями
  // у повторяющейся записи отметка и удаление относятся к одному дню серии
  const occurrenceDay = (e) => (e.recurrence && e.occurrence ? e.date : null);
  async function setDone(e, done) {
    const day = occurrenceDay(e);
    const r = await api(`/api/events/${e.id}`, { method: "PATCH", body: JSON.stringify(day ? { done, date: day } : { done }) });
    const when = e.recurrence ? ` (${dayLabel(day || todayIso()).toLowerCase()})` : "";
    if (r.ok) toast(done ? `«${e.title}»${when} — в разделе «Выполненные»` : `«${e.title}»${when} снова в работе`);
    await refresh();
  }
  async function removeEvent(e, onlyDay = null) {
    const question = onlyDay ? `Удалить «${e.title}» только ${dayLabel(onlyDay, true).toLowerCase()}? В остальные дни запись останется.`
      : e.recurrence ? `Удалить «${e.title}» со всеми повторами?` : `Удалить «${e.title}»?`;
    if (!confirm(question)) return;
    const r = await api(`/api/events/${e.id}${onlyDay ? `?date=${onlyDay}` : ""}`, { method: "DELETE" });
    if (r.ok) toast(onlyDay ? `Убрал «${e.title}» на ${dayLabel(onlyDay).toLowerCase()}` : `Удалил «${e.title}»`);
    await refresh();
  }
  function moreButton(e, host) {
    const btn = el("button", "icon-btn more");
    btn.setAttribute("aria-label", "Действия");
    btn.dataset.menuTrigger = "1";
    btn.appendChild(icon("more"));
    const menu = el("div", "menu");
    menu.hidden = true;
    btn.onclick = (ev) => {
      ev.stopPropagation();
      toggleMenu(menu, (m) => {
        m.replaceChildren();
        const done = el("button");
        done.append(icon(e.done ? "undo" : "check", "icon sm"), e.done ? "Вернуть в работу" : "Отметить выполненной");
        done.onclick = () => { closeMenus(); setDone(e, !e.done); };
        const say = el("button");
        say.append(icon("mic", "icon sm"), "Перенести голосом");
        say.onclick = () => { closeMenus(); go("#/"); prefill(`Перенеси «${e.title}» на `); };
        const dels = [];
        if (occurrenceDay(e)) {
          const one = el("button", "danger");
          one.append(icon("trash", "icon sm"), "Удалить только этот день");
          one.onclick = () => { closeMenus(); removeEvent(e, e.date); };
          dels.push(one);
        }
        const del = el("button", "danger");
        del.append(icon("trash", "icon sm"), e.recurrence ? "Удалить все повторы" : "Удалить");
        del.onclick = () => { closeMenus(); removeEvent(e); };
        dels.push(del);
        const prios = el("div", "note", "Приоритет");
        m.append(done, say, el("hr"), prios);
        for (const [value, name] of [["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"], ["none", "Без приоритета"]]) {
          const b = el("button");
          b.append(el("span", value === "none" ? "prio" : `prio ${value}`, name));
          if ((e.priority || "none") === value) b.append(icon("check", "icon sm"));
          b.onclick = () => { closeMenus(); setPriority(e, value); };
          m.append(b);
        }
        m.append(el("hr"), ...dels);
      });
    };
    host.appendChild(menu);
    return btn;
  }

  const PRIO_NAME = { high: "Высокий", medium: "Средний", low: "Низкий" };
  const KIND_ICON = { task: "doc", meeting: "users", reminder: "bell" };

  // compact — строка как в блоке «Сегодня» макета: приоритет и иконка типа;
  // иначе (страницы-списки) ещё плашка типа и иллюстрация категории
  function rowEl(e, { showDate = false, compact = false } = {}) {
    const row = el("div", `row${e.done ? " done" : ""}`);
    const cb = el("input", "check");
    cb.type = "checkbox";
    cb.checked = e.done;
    cb.setAttribute("aria-label", e.done ? "Снять отметку" : "Отметить выполненной");
    cb.onchange = () => setDone(e, cb.checked);
    const title = el("div", "title");
    title.append(el("span", "t", e.title + (e.recurrence ? " ↻" : "")));
    if (!compact) title.append(el("span", `pill ${e.type}`, TYPE_NAME[e.type]));
    if (isOverdue(e)) title.append(el("span", "pill overdue", "Просрочено"));
    const prio = e.priority ? el("span", `prio ${e.priority}`, PRIO_NAME[e.priority]) : el("span");
    const when = el("div", "when");
    when.append(icon(!e.date ? "calendar" : e.type === "task" && e.time ? "calendar" : "clock", "icon sm"),
      showDate && e.date ? `${dayLabel(e.date)}${e.time ? ", " + timeRange(e) : ""}` : timeRange(e));
    const kind = el("span", "kind");
    kind.title = TYPE_NAME[e.type];
    kind.append(compact ? icon(KIND_ICON[e.type]) : (catImg(e) || icon(KIND_ICON[e.type])));
    row.append(cb, title, prio, when, kind, moreButton(e, row));
    return row;
  }

  async function setPriority(e, priority) {
    await api(`/api/events/${e.id}`, { method: "PATCH", body: JSON.stringify({ priority }) });
    await refresh();
  }

  function meetEl(e) {
    const m = el("div", "meet");
    // в макете: созвоны и обсуждения — красная плитка с камерой, остальные встречи — фиолетовая с людьми
    const video = ["call", "discussion"].includes(e.category);
    const ico = el("div", `ico ${video ? "red" : "purple"}`);
    ico.append(icon(video ? "video" : "users"));
    const info = el("div");
    info.append(el("b", null, e.title), el("small", null, `${e.date ? dayLabel(e.date) : ""}, ${timeRange(e)}`));
    m.append(ico, info, moreButton(e, m));
    return m;
  }

  function emptyEl(text) { return el("p", "empty", text); }

  // ------------------------------------------------------------ чат
  const log = $("log"), input = $("input"), statusEl = $("status"), stopBtn = $("stop"), mic = $("mic");
  let speakOn = store.get("speak", "1") === "1";

  function addMsg(text, who, extra = "") {
    const m = el("div", `msg ${who} ${extra}`.trim(), text);
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text) return;
    stopSpeaking();
    if (location.hash && location.hash !== "#/") go("#/");
    addMsg(text, "user");
    input.value = "";
    statusEl.textContent = "Думаю…";
    try {
      const res = await api("/api/message", { method: "POST", body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const m = addMsg(data.text, "bot", data.awaiting ? "ask" : "");
      m.appendChild(el("span", "tag", replyTag(data)));
      speak(data.speech);
      statusEl.textContent = data.awaiting ? "Жду уточнения — ответьте голосом или текстом" : "";
      await refresh();
      saveBackup();
    } catch {
      addMsg("Не удалось связаться с сервером. Если сайт долго не открывался, подождите минуту — бесплатный хостинг просыпается.", "bot");
      statusEl.textContent = "Ошибка соединения";
    }
  }
  const INTENT_NAMES = { create: "создание записи", list: "список", search: "поиск", reschedule: "перенос",
    complete: "отметка о выполнении", delete: "удаление", rename: "переименование", confirm: "подтверждение",
    reject: "отмена", help: "справка", smalltalk: "разговор", empty: "пустой запрос", error: "ошибка",
    unknown: "не понял запрос" };
  const PARSER_NAMES = { rules: "разбор по правилам", llm: "разбор нейросетью" };
  function replyTag(data) {
    const parts = [INTENT_NAMES[data.intent] || "ответ"];
    if (data.parser) parts.push(PARSER_NAMES[data.parser] || "разбор нейросетью");
    return parts.join(" · ");
  }
  function prefill(text) {
    input.value = text;
    input.focus();
    input.setSelectionRange(text.length, text.length);
  }

  $("form").onsubmit = (e) => { e.preventDefault(); send(input.value); };
  $("chips").onclick = (e) => { const b = e.target.closest("button"); if (b) send(b.textContent); };

  document.querySelectorAll("[data-prefill]").forEach((b) => b.onclick = () => prefill(b.dataset.prefill));
  document.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => go(b.dataset.go));
  document.querySelectorAll("[data-feature]").forEach((b) => b.onclick = () => {
    if (b.dataset.feature === "voice") mic.click();
    if (b.dataset.feature === "search") $("search").focus();
    if (b.dataset.feature === "calendar") go("#/calendar");
  });

  // ---------- синтез речи и «Стоп»
  let ruVoice = null;
  function pickVoice() {
    const voices = window.speechSynthesis?.getVoices() || [];
    ruVoice = voices.find((v) => v.lang?.startsWith("ru") && /google|natural|online/i.test(v.name)) || voices.find((v) => v.lang?.startsWith("ru")) || null;
  }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function stopSpeaking() { if ("speechSynthesis" in window) speechSynthesis.cancel(); stopBtn.hidden = true; }
  function speak(text) {
    if (!speakOn || !("speechSynthesis" in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[«»•]/g, ""));
    u.lang = "ru-RU";
    if (ruVoice) u.voice = ruVoice;
    u.rate = 1.05;
    u.onstart = () => { stopBtn.hidden = false; };
    u.onend = u.onerror = () => { stopBtn.hidden = true; };
    stopBtn.hidden = false;
    speechSynthesis.speak(u);
  }
  stopBtn.onclick = stopSpeaking;

  // ---------- распознавание речи
  // Слушаем непрерывно, без ограничения по длительности. Короткие паузы не обрывают фразу:
  // запрос уходит ассистенту, когда пользователь молчит SILENCE_MS или снова нажимает микрофон.
  const SILENCE_MS = 3000;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, interimEl = null, heard = "", pending = "", silenceTimer = null;
  function showHeard() {
    const text = (heard + " " + pending).trim();
    if (!text) return;
    interimEl = interimEl || addMsg("", "user", "interim");
    interimEl.textContent = text;
    log.scrollTop = log.scrollHeight;
  }
  function finishListening() {
    clearTimeout(silenceTimer);
    const text = (heard + " " + pending).trim();
    listening = false;
    heard = pending = "";
    if (interimEl) { interimEl.remove(); interimEl = null; }
    try { rec.stop(); } catch {}
    mic.classList.remove("recording");
    statusEl.textContent = "";
    if (text) send(text);
  }
  if (!SR) {
    mic.disabled = true;
    mic.title = "Браузер не поддерживает распознавание речи — используйте Chrome, Edge или Safari, либо пишите текстом";
  } else {
    rec = new SR();
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onstart = () => { mic.classList.add("recording"); statusEl.textContent = "Слушаю… Отправлю, когда вы замолчите на 3 секунды"; stopSpeaking(); };
    rec.onend = () => {
      // браузер сам завершает сеанс распознавания (тишина, лимит сервиса) — продолжаем слушать
      if (listening) { try { rec.start(); return; } catch {} }
      mic.classList.remove("recording");
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;      // пауза — не ошибка
      listening = false;
      clearTimeout(silenceTimer);
      statusEl.textContent = { "not-allowed": "Нет доступа к микрофону — разрешите его в настройках браузера",
        "service-not-allowed": "Нет доступа к микрофону — разрешите его в настройках браузера",
        "network": "Распознавание речи недоступно без интернета" }[e.error] || `Ошибка распознавания: ${e.error}`;
    };
    rec.onresult = (e) => {
      pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) heard = `${heard} ${r[0].transcript}`.trim();
        else pending += r[0].transcript;
      }
      showHeard();
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(finishListening, SILENCE_MS);
    };
    mic.onclick = () => {
      if (location.hash && location.hash !== "#/") go("#/");
      if (listening) { finishListening(); return; }
      listening = true;
      heard = pending = "";
      try { rec.start(); } catch {}
    };
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { stopSpeaking(); closeMenus(); }
    if (e.ctrlKey && e.code === "Space" && rec) { e.preventDefault(); mic.click(); }
    // по коду клавиши, а не по символу: в русской раскладке Ctrl+K даёт «л»
    if ((e.ctrlKey || e.metaKey) && (e.code === "KeyK" || ["k", "л"].includes(e.key.toLowerCase()))) {
      e.preventDefault();
      e.stopPropagation();
      $("search").focus();
      $("search").select();
    }
  }, true);

  // ------------------------------------------------------------ главная
  let selectedDay = null;
  async function renderHome() {
    const events = await getJSON("/api/events");                    // сегодня + 6 дней + без срока
    const today = todayIso();
    $("todayLabel").textContent = `${TODAY.getDate()} ${MONTHS_GEN[TODAY.getMonth()]}, ${WD_LONG[TODAY.getDay()]}`;

    // полоса дней
    selectedDay = selectedDay || today;
    const days = $("days");
    days.replaceChildren();
    for (let i = 0; i < 7; i++) {
      const d = addDays(parse(today), i), s = iso(d);
      const b = el("button", "day");
      if ([0, 6].includes(d.getDay())) b.classList.add("weekend");
      if (events.some((e) => e.date === s)) b.classList.add("has");
      if (s === selectedDay) b.classList.add("active");
      b.append(el("small", null, WD_SHORT[d.getDay()]), el("b", null, String(d.getDate())));
      b.setAttribute("aria-label", dayLabel(s, true));
      b.onclick = () => { selectedDay = s; renderHome(); };
      days.appendChild(b);
    }
    const agenda = $("agenda");
    agenda.replaceChildren();
    const dayEvents = events.filter((e) => e.date === selectedDay);
    if (!dayEvents.length) agenda.append(emptyEl(selectedDay === today ? "На сегодня ничего не запланировано." : "На этот день ничего нет."));
    for (const e of dayEvents) {
      const row = el("div", `ag${e.done ? " done" : ""}`);
      const label = el("label");
      const cb = el("input", "check");
      cb.type = "checkbox";
      cb.checked = e.done;
      cb.onchange = () => setDone(e, cb.checked);
      label.append(cb, el("span", null, e.title));
      row.append(el("time", null, e.time || "Весь день"), el("span", `dot ${e.type}`), label);
      agenda.appendChild(row);
    }

    // «Сегодня»: записи на сегодня и задачи без срока
    const todayList = $("todayList");
    todayList.replaceChildren();
    const todays = events.filter((e) => e.date === today || e.date === null);
    if (!todays.length) todayList.append(emptyEl("На сегодня ничего нет. Скажите, например: «Напомни в 18:00 купить хлеб»."));
    todays.slice(0, 6).forEach((e) => todayList.appendChild(rowEl(e, { compact: true })));

    // ближайшие встречи
    const meets = await getJSON(`/api/items?types=meeting&status=active&undated=false&start=${today}&end=${iso(addDays(TODAY, 90))}`);
    const ml = $("meetList");
    ml.replaceChildren();
    if (!meets.length) ml.append(emptyEl("Встреч пока нет. Скажите: «Добавь встречу с командой завтра в 15:00»."));
    meets.slice(0, 4).forEach((e) => ml.appendChild(meetEl(e)));
  }

  // ------------------------------------------------------------ списки с фильтрами
  const LISTS = {
    tasks: { title: "Мои задачи", sub: "Невыполненные записи — выберите период или даты", types: "", prefill: "Поставь задачу ",
      presets: ["all", "today", "week", "month", "overdue", "undated"] },
    meetings: { title: "Встречи", sub: "Предстоящие и прошедшие встречи", types: "meeting", prefill: "Добавь встречу ",
      presets: ["upcoming", "today", "week", "month", "past", "all"] },
    reminders: { title: "Напоминания", sub: "Всё, о чём ассистент должен напомнить", types: "reminder", prefill: "Напомни ",
      presets: ["upcoming", "today", "week", "overdue", "all"] },
    done: { title: "Выполненные", sub: "Задачи, встречи и напоминания, которые вы уже отметили", types: "", status: "done",
      presets: ["all", "lastweek", "lastmonth"], newestFirst: true },
  };
  const PRESET_NAMES = { all: "Все", today: "Сегодня", week: "Неделя", month: "Месяц", overdue: "Просроченные",
    undated: "Без срока", done: "Выполненные", upcoming: "Предстоящие", past: "Прошедшие", custom: "Период",
    lastweek: "За неделю", lastmonth: "За месяц" };
  let listKind = "tasks", listPreset = "all", queryTimer, listSeq = 0, calSeq = 0;

  function presetRange(p) {
    const t = parse(todayIso());
    switch (p) {
      case "today": return [t, t];
      case "week": return [t, addDays(t, 6)];
      case "month": return [t, addDays(t, 30)];
      case "upcoming": return [t, addDays(t, 365)];
      case "past": return [addDays(t, -3650), addDays(t, -1)];
      case "lastweek": return [addDays(t, -6), t];
      case "lastmonth": return [addDays(t, -30), t];
      default: return [null, null];
    }
  }

  function applyPreset(p) {
    listPreset = p;
    const [a, b] = presetRange(p);
    setPicker("from", a);
    setPicker("to", b);
    const cfg = LISTS[listKind];
    // выполненные живут в своём разделе, остальные списки по умолчанию показывают только невыполненное
    $("statusFilter").value = cfg.status || { overdue: "overdue", upcoming: "active" }[p] || (listKind === "meetings" ? "all" : "active");
    renderList();
  }

  function openList(kind, preset) {
    listKind = kind;
    const cfg = LISTS[kind];
    $("listTitle").textContent = cfg.title;
    $("listSub").textContent = cfg.sub;
    $("typeFilter").hidden = !!cfg.types;
    $("typeFilter").value = "";
    $("statusFilter").hidden = !!cfg.status;
    $("listQuery").value = "";
    $("listAdd").hidden = !cfg.prefill;
    $("listAdd").onclick = () => { go("#/"); prefill(cfg.prefill); };
    const seg = $("presets");
    seg.replaceChildren();
    for (const p of cfg.presets) {
      const b = el("button", null, PRESET_NAMES[p]);
      b.dataset.preset = p;
      b.onclick = () => applyPreset(p);
      seg.appendChild(b);
    }
    applyPreset(preset && cfg.presets.includes(preset) ? preset : cfg.presets[0]);
  }

  const pickers = {};
  for (const id of ["from", "to"]) {
    pickers[id] = window.flatpickr ? flatpickr($(id), {
      locale: "ru", dateFormat: "Y-m-d", altInput: true, altFormat: "j M Y", disableMobile: true,
      onChange: () => { listPreset = "custom"; renderList(); },
    }) : null;
    if (!pickers[id]) { $(id).type = "date"; $(id).readOnly = false; }
  }
  function setPicker(id, date) {
    if (pickers[id]) date ? pickers[id].setDate(date, false) : pickers[id].clear(false);
    else $(id).value = date ? iso(date) : "";
  }
  ["from", "to", "typeFilter", "statusFilter"].forEach((id) => $(id).addEventListener("change", () => {
    if (pickers[id]) return;                     // у выбора дат свой обработчик
    if (id === "from" || id === "to") listPreset = "custom";
    renderList();
  }));
  $("listQuery").addEventListener("input", () => { clearTimeout(queryTimer); queryTimer = setTimeout(renderList, 250); });

  async function renderList() {
    const seq = ++listSeq;                       // ответ на устаревший запрос отбрасываем
    document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("on", b.dataset.preset === listPreset));
    const cfg = LISTS[listKind];
    const params = new URLSearchParams();
    const from = $("from").value, to = $("to").value;
    if (from) params.set("start", from);
    if (to) params.set("end", to);
    const types = cfg.types || $("typeFilter").value;
    if (types) params.set("types", types);
    params.set("status", $("statusFilter").value);
    // «без срока» показываем, если период не задан или включает сегодня
    const undatedOnly = listPreset === "undated";
    const includeUndated = undatedOnly || (!from && !to) || (from <= todayIso() && (!to || to >= todayIso()) && listPreset !== "past");
    params.set("undated", includeUndated ? "true" : "false");
    const q = $("listQuery").value.trim();
    if (q) params.set("q", q);

    let events = await getJSON(`/api/items?${params}`);
    if (seq !== listSeq) return;
    if (undatedOnly) events = events.filter((e) => e.date === null);
    if (listPreset === "past" || cfg.newestFirst) events.reverse();

    const body = $("listBody");
    body.replaceChildren();
    const shown = events.slice(0, 400);
    const period = from || to ? ` · ${from ? dayLabel(from) : "…"} — ${to ? dayLabel(to) : "…"}` : "";
    $("listSummary").textContent = `${events.length} ${plural(events.length, "запись", "записи", "записей")}${period}`
      + (events.length > shown.length ? ` · показаны первые ${shown.length}` : "");
    if (!events.length) {
      body.append(emptyEl(q ? "Ничего не нашлось. Попробуйте другое слово."
        : cfg.status === "done" ? "Здесь появятся записи, которые вы отметите выполненными." : "За выбранный период записей нет."));
      return;
    }
    let group = undefined, rows = null;
    for (const e of shown) {
      if (e.date !== group) {
        group = e.date;
        body.append(el("div", "group-title", e.date ? dayLabel(e.date, true) : "Без срока"));
        rows = el("div", "rows");
        body.append(rows);
      }
      rows.appendChild(rowEl(e));
    }
  }

  function plural(n, one, few, many) {
    const a = n % 100, b = n % 10;
    if (a >= 11 && a <= 14) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  // ------------------------------------------------------------ календарь (FullCalendar)
  let calendar = null, calSel = null;
  const calEvents = new Map();                   // id события календаря → запись
  function calendarView() { return window.innerWidth < 640 ? "listMonth" : "dayGridMonth"; }
  function initCalendar() {
    calendar = new FullCalendar.Calendar($("fc"), {
      locale: "ru", firstDay: 1, initialView: calendarView(), initialDate: calSel, height: "auto", dayMaxEvents: 3, nowIndicator: true,
      headerToolbar: { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,listMonth" },
      buttonText: { today: "Сегодня", month: "Месяц", week: "Неделя", list: "Список" },
      moreLinkText: (n) => `ещё ${n}`,
      noEventsText: "В этом месяце записей нет",
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      allDayText: "Весь день",
      events: async (info, ok, fail) => {
        try {
          const items = await getJSON(`/api/items?start=${iso(info.start)}&end=${iso(addDays(info.end, -1))}&undated=false`);
          calEvents.clear();
          ok(items.map((e, k) => {
            const id = `${e.id}-${e.date}-${k}`;
            calEvents.set(id, e);
            const start = e.time ? `${e.date}T${e.time}` : e.date;
            const ev = { id, title: e.title, start, allDay: !e.time, classNames: [`fc-${e.type}`].concat(e.done ? ["fc-done"] : []) };
            if (e.type === "meeting" && e.time) ev.end = new Date(new Date(start).getTime() + (e.duration_min || 60) * 6e4);
            return ev;
          }));
          showCalDay();
        } catch (err) { fail(err); }
      },
      dateClick: (info) => { calSel = info.dateStr.slice(0, 10); highlightCalDay(); showCalDay(); },
      eventClick: (info) => { const e = calEvents.get(info.event.id); if (e) { calSel = e.date; highlightCalDay(); showCalDay(); } },
      datesSet: () => highlightCalDay(),
      windowResize: () => { if (window.innerWidth < 640 && calendar.view.type === "dayGridMonth") calendar.changeView("listMonth"); },
    });
    calendar.render();
  }
  function highlightCalDay() {
    document.querySelectorAll("#fc .fc-daygrid-day").forEach((c) => c.classList.toggle("is-selected", c.dataset.date === calSel));
  }
  function showCalDay() {
    $("calDayTitle").textContent = dayLabel(calSel, true);
    const dayList = $("calDayList");
    dayList.replaceChildren();
    const sel = [...calEvents.values()].filter((e) => e.date === calSel);
    if (!sel.length) dayList.append(emptyEl("В этот день ничего нет."));
    sel.forEach((e) => dayList.appendChild(rowEl(e)));
  }
  async function renderCalendar() {
    calSel = calSel || todayIso();
    if (!window.FullCalendar) { $("fc").replaceChildren(emptyEl("Не удалось загрузить календарь — обновите страницу.")); return; }
    if (!calendar) initCalendar();
    else { calendar.updateSize(); calendar.refetchEvents(); }
    highlightCalDay();
  }

  // ------------------------------------------------------------ история
  async function renderHistory() {
    const items = await getJSON("/api/history?limit=500");
    const box = $("historyBody");
    box.replaceChildren();
    if (!items.length) { box.append(emptyEl("Разговор ещё не начат. Задайте вопрос на главной.")); return; }
    let day = null;
    for (const m of items) {
      const d = (m.created_at || "").slice(0, 10);
      if (d && d !== day) { day = d; box.append(el("time", null, dayLabel(d, true))); }
      box.append(el("div", `msg ${m.role === "user" ? "user" : "bot"}`, m.text));
    }
  }

  // ------------------------------------------------------------ поиск (Ctrl+K)
  let searchTimer;
  const searchBox = $("search"), results = $("searchResults");
  searchBox.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchBox.value.trim();
    if (!q) { results.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      const hits = await getJSON(`/api/search?q=${encodeURIComponent(q)}`);
      results.replaceChildren();
      if (!hits.length) results.append(el("div", "note", "Ничего не нашлось"));
      for (const e of hits) {
        const b = el("button", "r");
        const info = el("span");
        info.append(el("b", null, e.title), el("small", null, ` · ${TYPE_NAME[e.type]}`));
        b.append(catImg(e) || icon(e.type === "meeting" ? "users" : "tasks"), info, el("small", null, e.date ? dayLabel(e.date) : "без срока"));
        b.onclick = () => {
          results.hidden = true;
          searchBox.value = "";
          if (e.date) { calSel = e.date; if (calendar) calendar.gotoDate(e.date); go("#/calendar"); }
          else go("#/tasks?preset=undated");
        };
        results.appendChild(b);
      }
      results.hidden = false;
      openMenu = results;
    }, 200);
  });
  searchBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); const q = searchBox.value.trim(); results.hidden = true; go(`#/tasks?q=${encodeURIComponent(q)}`); }
  });

  // ------------------------------------------------------------ колокольчик
  async function renderBell() {
    const due = await getJSON(`/api/items?types=reminder&status=active&undated=false&start=${iso(addDays(TODAY, -30))}&end=${todayIso()}`);
    $("bellDot").hidden = !due.length;
    $("remindBadge").hidden = !due.length;
    $("remindBadge").textContent = String(due.length);
    $("bell").dataset.menuTrigger = "1";
    $("bell").onclick = (ev) => {
      ev.stopPropagation();
      toggleMenu($("bellMenu"), (m) => {
        m.replaceChildren();
        m.append(el("div", "note", due.length ? "Напоминания на сегодня и просроченные" : "На сегодня напоминаний нет"));
        for (const e of due.slice(0, 8)) {
          const b = el("button");
          b.append(icon("bell", "icon sm"), `${e.time || ""} ${e.title}${e.date !== todayIso() ? " · " + dayLabel(e.date) : ""}`);
          b.onclick = () => { closeMenus(); go("#/reminders?preset=overdue"); };
          m.append(b);
        }
        const all = el("button");
        all.append(icon("arrow-right", "icon sm"), "Все напоминания");
        all.onclick = () => { closeMenus(); go("#/reminders"); };
        m.append(el("hr"), all);
      });
    };
  }

  // ------------------------------------------------------------ профиль
  function renderProfile() {
    const initials = me.authenticated ? me.initials : "Г";
    ["profileAvatar", "topAvatar"].forEach((id) => { $(id).textContent = initials; $(id).dataset.menuTrigger = "1"; });
    $("profileName").textContent = me.authenticated ? me.name : "Гость";
    $("profileRole").textContent = me.authenticated ? "Пользователь" : "Без регистрации";
    const open = (ev) => {
      ev.stopPropagation();
      toggleMenu($("profileMenu"), async (m) => {
        m.replaceChildren();
        const head = el("div", "note");
        head.append(el("b", null, me.authenticated ? me.name : "Гостевой режим"),
          me.authenticated ? me.email : "Записи хранятся только для этого браузера");
        m.append(head, el("hr"));
        const voice = el("button");
        voice.append(icon(speakOn ? "volume" : "x", "icon sm"), speakOn ? "Озвучивание ответов: вкл" : "Озвучивание ответов: выкл");
        voice.onclick = () => { speakOn = !speakOn; store.set("speak", speakOn ? "1" : "0"); if (!speakOn) stopSpeaking(); closeMenus(); toast(speakOn ? "Ответы будут озвучиваться" : "Озвучивание выключено"); };
        const demo = el("button");
        demo.append(icon("database", "icon sm"), "Загрузить тестовые данные (1000)");
        demo.onclick = () => { closeMenus(); loadDemo(); };
        const clear = el("button", "danger");
        clear.append(icon("trash", "icon sm"), "Очистить мои данные");
        clear.onclick = () => { closeMenus(); resetData(); };
        m.append(voice, demo, clear, el("hr"));
        if (me.authenticated) {
          const out = el("button");
          out.append(icon("logout", "icon sm"), "Выйти");
          out.onclick = logout;
          m.append(out);
        } else {
          const login = el("a");
          login.href = "/login";
          login.append(icon("login", "icon sm"), "Войти");
          const reg = el("a");
          reg.href = "/register";
          reg.append(icon("user", "icon sm"), "Зарегистрироваться — записи будут на всех устройствах");
          m.append(login, reg);
        }
      });
    };
    $("profileAvatar").onclick = open;
    $("profileGear").onclick = open;
    $("profileGear").dataset.menuTrigger = "1";
    $("topAvatar").onclick = open;
  }

  async function loadDemo() {
    const total = (await getJSON("/api/stats")).total;
    if (total > 0) {
      toast("Тестовые данные загружаются только в пустой список — сначала очистите данные");
    } else {
      const r = await api("/api/demo-data", { method: "POST" });
      const data = await r.json();
      toast(r.ok ? `Загрузил ${data.imported} записей из задания` : data.detail);
      await refresh();
      saveBackup();
    }
  }
  async function resetData() {
    if (!confirm("Удалить все ваши задачи, встречи, напоминания и историю разговора?")) return;
    await api("/api/reset", { method: "POST" });
    store.set(backupKey(), "");
    log.replaceChildren();
    greet();
    await refresh();
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    store.set("guestOk", "");
    location.replace("/login");
  }

  // ------------------------------------------------------------ резервная копия
  // Бесплатный хостинг теряет базу при перезапуске: браузер хранит копию и возвращает её.
  const backupKey = () => (me.authenticated ? `backup:acc:${me.email}` : `backup:${guestId}`);
  async function saveBackup() {
    try { const r = await api("/api/export"); if (r.ok) store.set(backupKey(), await r.text()); } catch {}
  }
  async function restoreIfNeeded() {
    const raw = store.get(backupKey(), "");
    if (!raw) return false;
    try {
      if ((await getJSON("/api/stats")).total !== 0) return false;
      return (await api("/api/import", { method: "POST", body: raw })).ok;
    } catch { return false; }
  }

  async function loadDialog() {
    try {
      const items = await getJSON("/api/history?limit=20");
      for (const m of items) addMsg(m.text, m.role === "user" ? "user" : "bot", "old");
      return items.length;
    } catch { return 0; }
  }
  function greet() {
    addMsg(me.authenticated ? `Привет, ${me.name.split(" ")[1] || me.name.split(" ")[0]}! Скажите или напишите, что нужно сделать.`
      : "Привет! Я веду задачи, напоминания и встречи. Скажите или напишите, что нужно сделать.", "bot");
  }

  // ------------------------------------------------------------ маршрутизация
  function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
  async function route() {
    closeMenus();
    const [path, query] = (location.hash.replace(/^#/, "") || "/").split("?");
    const params = new URLSearchParams(query || "");
    const view = { "/": "home", "/tasks": "tasks", "/calendar": "calendar", "/meetings": "meetings", "/reminders": "reminders",
      "/done": "done", "/history": "history" }[path] || "home";
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
    $("view-home").hidden = view !== "home";
    $("view-list").hidden = !LISTS[view];
    $("view-calendar").hidden = view !== "calendar";
    $("view-history").hidden = view !== "history";
    window.scrollTo(0, 0);
    try {
      if (view === "home") await renderHome();
      else if (LISTS[view]) {
        openList(view, params.get("preset"));
        if (params.get("q")) { $("listQuery").value = params.get("q"); renderList(); }
      } else if (view === "calendar") await renderCalendar();
      else if (view === "history") await renderHistory();
    } catch { toast("Не удалось загрузить данные — проверьте соединение"); }
  }
  window.addEventListener("hashchange", route);

  // обновить то, что сейчас на экране, и счётчики
  async function refresh() {
    const [path] = (location.hash.replace(/^#/, "") || "/").split("?");
    try {
      if (path === "/" || !path) await renderHome();
      else if (["/tasks", "/meetings", "/reminders", "/done"].includes(path)) await renderList();
      else if (path === "/calendar") await renderCalendar();
      else if (path === "/history") await renderHistory();
      await renderBell();
    } catch {}
  }

  // ------------------------------------------------------------ старт
  async function start() {
    try { me = await (await fetch("/api/auth/me")).json(); } catch {}
    if (!me.authenticated && store.get("guestOk", "") !== "1") { location.replace("/login"); return; }
    try {
      const h = await (await fetch("/api/health")).json();
      const d = new Date(h.now);
      if (!isNaN(d)) TODAY = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    } catch {}
    renderProfile();
    // как в макете: на главной нет старой переписки — она в разделе «История»,
    // лента появляется с первой репликой
    const restored = await restoreIfNeeded();
    if (restored) toast("Восстановил ваши записи и наш разговор после перезапуска сервера");
    const welcome = store.get("welcome", "");
    if (welcome) { toast(welcome); store.set("welcome", ""); }
    await route();
    renderBell();
  }
  start();
})();
