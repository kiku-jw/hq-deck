(() => {
  "use strict";

  const STORAGE_KEY = "hq-deck-prototype-v2";
  const HOLD_DURATION = 850;
  const SWIPE_THRESHOLD = 92;
  const RUN_PHASE_MS = 2400;

  const proposals = [
    {
      id: "hutmates",
      label: "Hutmates",
      question: "Собрать новый игровой билд Hutmates?",
      support: "Один сценарий. Один репозиторий. Без публикации.",
      art: "hutmates",
      outcome: "Собрать и проверить новый игровой билд Hutmates",
      acceptance: "Билд запускается, ключевой сценарий проходим, проверка зафиксирована",
      pace: "Сначала один игровой сценарий",
      repo: "Hutmates"
    },
    {
      id: "memory",
      label: "Контекстная память",
      question: "Вернуть старым мыслям практическую ценность?",
      support: "Три релевантные заметки. Локально. Без публикации.",
      art: "memory",
      outcome: "Показать релевантные старые заметки в контексте активного проекта",
      acceptance: "Три сохранённые мысли возвращаются в правильном проектном контексте",
      pace: "Сначала три релевантные заметки",
      repo: "Personal Corp"
    },
    {
      id: "time",
      label: "Apple Watch",
      question: "Собрать голосовой учёт времени?",
      support: "Одна голосовая команда. Подтверждение и undo.",
      art: "time",
      outcome: "Записывать время одной голосовой командой с Apple Watch",
      acceptance: "Команда создаёт одну запись, подтверждает итог и поддерживает undo",
      pace: "Сначала одна голосовая команда",
      repo: "Time Ledger"
    }
  ];

  const initialState = () => ({
    mode: "discover",
    proposalIndex: 0,
    selectedProjectId: null,
    history: [],
    nuances: {},
    plan: null,
    run: {
      phaseIndex: 0,
      completedPhases: 0,
      publishDecision: null,
      stopRequested: false
    }
  });

  let state = loadState();
  let runTimer = null;
  let holdTimer = null;
  let holdFrame = null;
  let holdStart = 0;
  let drag = null;

  const stage = document.querySelector("#stage");
  const progress = document.querySelector("#path-progress");
  const template = document.querySelector("#decision-template");
  const historyAction = document.querySelector("#history-action");
  const sheet = document.querySelector("#nuance-sheet");
  const backdrop = document.querySelector("#sheet-backdrop");
  const nuanceInput = document.querySelector("#nuance-input");

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!stored || typeof stored !== "object") return initialState();
      if (stored.mode === "running") stored.mode = "paused";
      const restored = { ...initialState(), ...stored, run: { ...initialState().run, ...stored.run } };
      if (!restored.nuances || typeof restored.nuances !== "object") restored.nuances = {};
      return restored;
    } catch {
      return initialState();
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function snapshot() {
    const { history, ...rest } = state;
    return JSON.parse(JSON.stringify(rest));
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 20) state.history.shift();
  }

  function selectedProject() {
    return proposals.find((proposal) => proposal.id === state.selectedProjectId) || null;
  }

  function currentQuestion() {
    if (state.mode === "discover") {
      const proposal = proposals[state.proposalIndex];
      return proposal ? { type: "proposal", ...proposal } : null;
    }
    return null;
  }

  function questionKey(question = currentQuestion()) {
    if (!question) return null;
    return question.type === "proposal" ? `proposal:${question.id}` : question.key;
  }

  function currentNuance() {
    const key = questionKey();
    return key ? state.nuances[key] || "" : "";
  }

  function renderProgress() {
    progress.replaceChildren();
    const discovering = state.mode === "discover";
    const total = discovering ? proposals.length : 2;
    const done = discovering ? state.proposalIndex : state.mode === "complete" ? 2 : 1;
    const current = discovering ? state.proposalIndex : 1;

    for (let index = 0; index < Math.min(total, 8); index += 1) {
      const dot = document.createElement("span");
      dot.className = "path-dot";
      if (index < done) dot.classList.add("is-done");
      if (index === current) dot.classList.add("is-current");
      progress.append(dot);
    }
  }

  function render() {
    clearTimeout(runTimer);
    runTimer = null;
    renderHistoryAction();
    renderProgress();

    if (state.mode === "discover") renderDecision();
    else if (state.mode === "plan") renderPlan();
    else if (state.mode === "running" || state.mode === "paused") renderRun();
    else if (state.mode === "gate") renderGate();
    else if (state.mode === "complete") renderComplete();
    else renderEmpty();

    persist();
  }

  function renderHistoryAction() {
    const canUndo = state.history.length > 0 && (state.mode === "discover" || state.mode === "plan");
    historyAction.dataset.action = canUndo ? "undo" : "reset";
    const label = canUndo ? "Отменить последний выбор" : "Сбросить прототип";
    historyAction.setAttribute("aria-label", label);
    historyAction.title = label;
  }

  function renderDecision() {
    const question = currentQuestion();
    if (!question) {
      state.mode = "empty";
      render();
      return;
    }

    const fragment = template.content.cloneNode(true);
    const view = document.createElement("div");
    view.className = "decision-view";
    const stack = document.createElement("div");
    stack.className = "card-stack";
    stack.append(fragment.querySelector(".decision-card"));
    view.append(stack, fragment.querySelector(".decision-controls"), fragment.querySelector(".gesture-caption"));
    stage.replaceChildren(view);

    document.querySelector("#card-eyebrow").textContent = question.label || "HQ";
    document.querySelector("#card-question").textContent = question.question;
    document.querySelector("#card-support").textContent = currentNuance()
      ? `${question.support} · Нюанс сохранён`
      : question.support;
    document.querySelector("#project-art").className = `project-art project-art--${question.art}`;
    wireDecisionCard();
  }

  function wireDecisionCard() {
    const card = document.querySelector("#decision-card");
    if (!card) return;

    card.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { pointerId: event.pointerId, startX: event.clientX, currentX: event.clientX };
      card.setPointerCapture(event.pointerId);
      card.classList.add("is-dragging");
    });

    card.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.currentX = event.clientX;
      const delta = drag.currentX - drag.startX;
      const bounded = Math.max(-170, Math.min(170, delta));
      card.style.setProperty("--drag-x", `${bounded}px`);
      card.style.setProperty("--drag-r", `${bounded / 22}deg`);
      updateSwipeFeedback(card, bounded);
    });

    const endDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const delta = drag.currentX - drag.startX;
      drag = null;
      card.classList.remove("is-dragging");
      if (Math.abs(delta) >= SWIPE_THRESHOLD) animateDecision(delta > 0);
      else settleCard(card);
    };

    card.addEventListener("pointerup", endDrag);
    card.addEventListener("pointercancel", endDrag);
  }

  function updateSwipeFeedback(card, delta) {
    const yes = card.querySelector(".swipe-feedback--yes");
    const no = card.querySelector(".swipe-feedback--no");
    const strength = Math.min(1, Math.abs(delta) / SWIPE_THRESHOLD);
    yes.style.opacity = delta > 0 ? strength : 0;
    no.style.opacity = delta < 0 ? strength : 0;
    card.style.borderColor = delta > 0
      ? `rgba(113, 231, 193, ${0.12 + strength * 0.35})`
      : delta < 0
        ? `rgba(255, 141, 121, ${0.12 + strength * 0.35})`
        : "";
  }

  function settleCard(card) {
    card.classList.add("is-settling");
    card.style.setProperty("--drag-x", "0px");
    card.style.setProperty("--drag-r", "0deg");
    card.style.borderColor = "";
    card.querySelectorAll(".swipe-feedback").forEach((item) => { item.style.opacity = 0; });
    setTimeout(() => card.classList.remove("is-settling"), 260);
  }

  function animateDecision(value) {
    const card = document.querySelector("#decision-card");
    if (!card) return;
    card.classList.add("is-leaving");
    card.style.setProperty("--drag-x", value ? "150vw" : "-150vw");
    card.style.setProperty("--drag-r", value ? "18deg" : "-18deg");
    setTimeout(() => applyDecision(value), 190);
  }

  function applyDecision(value) {
    const question = currentQuestion();
    if (!question) return;
    pushHistory();

    if (value) {
      state.selectedProjectId = question.id;
      state.plan = buildPlan();
      state.mode = "plan";
    } else {
      state.proposalIndex += 1;
    }

    render();
  }

  function undo() {
    const previous = state.history.pop();
    if (!previous) return;
    const history = state.history;
    state = { ...initialState(), ...previous, history, run: { ...initialState().run, ...previous.run } };
    render();
  }

  function buildPlan() {
    const project = selectedProject();
    const nuance = state.nuances[`proposal:${project.id}`] || "";

    return {
      project: project.label,
      outcome: project.outcome,
      acceptance: project.acceptance,
      scope: "Один проверяемый результат",
      repo: `Один репозиторий: ${project.repo}`,
      pace: project.pace,
      publication: "Без публикации",
      review: "Проверка обязательна",
      publishRequested: false,
      nuance
    };
  }

  function renderPlan() {
    const plan = state.plan || buildPlan();
    stage.innerHTML = `
      <section class="plan-view" aria-labelledby="plan-title">
        <div class="plan-hero" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M7 7h10M7 12h7M7 17h4"/><circle cx="18" cy="12" r="1.5"/><circle cx="15" cy="17" r="1.5"/></svg>
        </div>
        <p class="eyebrow">${escapeHtml(plan.project)} · план без уточнений</p>
        <h1 class="plan-title" id="plan-title">${escapeHtml(plan.outcome)}</h1>
        <p class="plan-meta">${escapeHtml(plan.pace)}${plan.nuance ? ` · ${escapeHtml(plan.nuance)}` : ""}</p>
        <dl class="plan-facts">
          <div class="plan-fact"><dt>Границы</dt><dd>${escapeHtml(plan.scope)}. ${escapeHtml(plan.repo)}.</dd></div>
          <div class="plan-fact"><dt>Готово</dt><dd>${escapeHtml(plan.acceptance)}.</dd></div>
          <div class="plan-fact"><dt>Контроль</dt><dd>${escapeHtml(plan.review)}. ${escapeHtml(plan.publication)}.</dd></div>
        </dl>
        <button class="plan-option ${plan.publishRequested ? "is-active" : ""}" type="button" data-action="toggle-publish" aria-pressed="${plan.publishRequested}">
          ${plan.publishRequested ? "✓ Публикация — после отдельного подтверждения" : "+ Нужна публикация"}
        </button>
        <div class="plan-actions">
          <button class="button secondary" type="button" data-action="undo">Другая идея</button>
          <button class="button primary hold-button" type="button" data-action="hold-launch">Удерживай запуск</button>
          <p class="hold-hint">Свайпы собрали план, но не дали полномочий на запуск</p>
        </div>
      </section>`;
    wireHoldButton(document.querySelector("[data-action='hold-launch']"), startRun);
  }

  function togglePublication() {
    state.plan.publishRequested = !state.plan.publishRequested;
    state.plan.publication = state.plan.publishRequested
      ? "Публикация только через отдельный гейт"
      : "Без публикации";
    state.run.publishDecision = null;
    render();
  }

  function wireHoldButton(button, callback) {
    if (!button || button.disabled) return;

    const begin = (event) => {
      if (event.type === "pointerdown" && event.button !== 0) return;
      event.preventDefault();
      holdStart = performance.now();
      clearTimeout(holdTimer);
      cancelAnimationFrame(holdFrame);
      const tick = (now) => {
        const ratio = Math.min(1, (now - holdStart) / HOLD_DURATION);
        button.style.setProperty("--hold-progress", `${ratio * 100}%`);
        if (ratio < 1) holdFrame = requestAnimationFrame(tick);
      };
      holdFrame = requestAnimationFrame(tick);
      holdTimer = setTimeout(() => {
        button.style.setProperty("--hold-progress", "100%");
        callback();
      }, HOLD_DURATION);
    };

    const cancel = () => {
      clearTimeout(holdTimer);
      cancelAnimationFrame(holdFrame);
      button.style.setProperty("--hold-progress", "0%");
    };

    button.addEventListener("pointerdown", begin);
    button.addEventListener("pointerup", cancel);
    button.addEventListener("pointerleave", cancel);
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("keydown", (event) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat) begin(event);
    });
    button.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") cancel();
    });
  }

  function startRun() {
    state.mode = "running";
    state.run = { ...initialState().run };
    render();
  }

  const phases = ["Контекст", "План", "Реализация", "Проверка", "Receipt"];

  function renderRun() {
    const paused = state.mode === "paused";
    const activeIndex = state.run.phaseIndex;
    const progressPercent = Math.round((state.run.completedPhases / phases.length) * 100);
    const phaseItems = phases.map((phase, index) => {
      const done = index < state.run.completedPhases;
      const active = !paused && index === activeIndex;
      const pausedCurrent = paused && index === activeIndex;
      const status = done ? "Готово" : active ? "В работе" : paused && index === activeIndex ? "Пауза" : "Ожидает";
      return `<li class="phase-item ${done ? "is-done" : ""} ${active ? "is-active" : ""} ${pausedCurrent ? "is-paused" : ""}" style="--phase-delay: ${100 + index * 34}ms">
        <span class="phase-index">
          <span class="phase-number">${index + 1}</span>
          <svg class="phase-check" viewBox="0 0 16 16" aria-hidden="true"><path pathLength="1" d="m3.5 8.2 2.8 2.8 6.2-6.2"/></svg>
        </span>
        <span>${phase}</span>
        <span class="phase-status">${status}</span>
      </li>`;
    }).join("");

    stage.innerHTML = `
      <section class="run-view ${paused ? "is-paused" : "is-running"}" aria-labelledby="run-title" style="--run-progress: ${progressPercent}%">
        <div class="run-instrument" aria-hidden="true">
          <div class="run-orbit-aura"></div>
          <div class="run-orbit">
            <span class="run-orbit-inner"></span>
            ${paused ? "" : '<span class="run-orbit-dot"></span>'}
            <span class="run-orbit-core">
              <strong class="run-orbit-label">${progressPercent}%</strong>
              <span class="run-orbit-step">${paused ? "пауза" : `${activeIndex + 1} / ${phases.length}`}</span>
            </span>
          </div>
          <span class="run-state"><i></i>${paused ? "Остановлено" : "Выполняется"}</span>
        </div>
        <p class="eyebrow">${escapeHtml(state.plan.project)} · mock run</p>
        <h1 class="run-title" id="run-title">${paused ? "Выполнение приостановлено" : phases[activeIndex]}</h1>
        <p class="run-meta">${paused ? "После обновления страницы работа не продолжает исполняться молча." : "Один ограниченный этап. Следующий начнётся только после его завершения."}</p>
        <ol class="phase-list">${phaseItems}</ol>
        <div class="run-controls">
          <button class="text-button" type="button" data-action="${paused ? "resume" : "pause"}">${paused ? "Продолжить" : "Остановить после этапа"}</button>
        </div>
      </section>`;

    if (!paused) runTimer = setTimeout(advanceRun, RUN_PHASE_MS);
  }

  function advanceRun() {
    const completed = state.run.phaseIndex + 1;
    state.run.completedPhases = completed;

    if (state.run.stopRequested) {
      state.run.stopRequested = false;
      state.run.phaseIndex = Math.min(completed, phases.length - 1);
      state.mode = "paused";
      render();
      return;
    }

    if (completed === 4 && state.plan.publishRequested && state.run.publishDecision === null) {
      state.mode = "gate";
      render();
      return;
    }

    if (completed >= phases.length) {
      state.mode = "complete";
      render();
      return;
    }

    state.run.phaseIndex = completed;
    render();
  }

  function renderGate() {
    stage.innerHTML = `
      <section class="gate-card" aria-labelledby="gate-title">
        <div class="gate-icon" aria-hidden="true">
          <span></span>
          <svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.2c0 4.6 3.1 8.8 7.5 9.8 4.4-1 7.5-5.2 7.5-9.8V6L12 3Z"/><path d="M12 8v4M12 16h.01"/></svg>
        </div>
        <p class="eyebrow">Новое полномочие</p>
        <h1 class="gate-title" id="gate-title">Разрешить публикацию?</h1>
        <p class="gate-copy">Предыдущие ответы сформировали план, но не разрешали внешние действия. В демо ничего реально не отправляется.</p>
        <div class="gate-scope" aria-label="Область разрешения">
          <span class="scope-pill">один push</span>
          <span class="scope-pill">существующий deploy</span>
          <span class="scope-pill">без миграций</span>
        </div>
        <div class="gate-actions">
          <button class="button danger" type="button" data-action="deny-gate">Не публиковать</button>
          <button class="button success hold-button" type="button" data-action="approve-gate">Удерживай</button>
        </div>
      </section>`;
    wireHoldButton(document.querySelector("[data-action='approve-gate']"), () => resolveGate(true));
  }

  function resolveGate(approved) {
    state.run.publishDecision = approved;
    state.mode = "running";
    state.run.phaseIndex = 4;
    render();
  }

  function renderComplete() {
    const published = state.run.publishDecision === true;
    const withheld = state.plan.publishRequested && state.run.publishDecision === false;
    stage.innerHTML = `
      <section class="completion-view" aria-labelledby="completion-title">
        <div class="completion-symbol" aria-hidden="true">
          <span class="completion-aura"></span>
          <svg viewBox="0 0 24 24"><path pathLength="1" d="m5 12 4 4L19 6"/></svg>
        </div>
        <p class="eyebrow">Проверенный результат</p>
        <h1 class="completion-title" id="completion-title">Готово без скрытых действий</h1>
        <p class="completion-meta">${escapeHtml(state.plan.outcome)}</p>
        <ul class="evidence-list">
          <li class="evidence-item"><span class="evidence-check">✓</span><span>Границы задачи прочитаны перед исполнением</span></li>
          <li class="evidence-item"><span class="evidence-check">✓</span><span>Детерминированные проверки завершились успешно</span></li>
          <li class="evidence-item"><span class="evidence-check">✓</span><span>${published ? "Публикация отдельно разрешена" : withheld ? "Публикация явно отклонена" : "Публикация не входила в план"}</span></li>
          <li class="evidence-item"><span class="evidence-check">✓</span><span>Receipt сформирован из состояний прототипа, не из отчёта модели</span></li>
        </ul>
        <div class="completion-actions">
          <button class="button secondary" type="button" data-action="reset">Новый выбор</button>
          <button class="button primary" type="button" data-action="view-plan">Посмотреть план</button>
        </div>
      </section>`;
  }

  function renderEmpty() {
    stage.innerHTML = `
      <section class="empty-view">
        <p class="eyebrow">Deck завершён</p>
        <h1 class="completion-title">Сегодня ничего не запускаем</h1>
        <p>Отказ от всех идей — тоже корректное решение. Лента не будет бесконечной.</p>
        <div class="completion-actions">
          <button class="button secondary" type="button" data-action="reset">Начать заново</button>
          <button class="button primary" type="button" data-action="revisit">Вернуть последнюю</button>
        </div>
      </section>`;
  }

  function openNuance() {
    nuanceInput.value = currentNuance();
    backdrop.hidden = false;
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => nuanceInput.focus(), 0);
  }

  function closeNuance() {
    backdrop.hidden = true;
    sheet.hidden = true;
    document.body.style.overflow = "";
    document.querySelector("[data-action='open-nuance']")?.focus();
  }

  function saveNuance() {
    const key = questionKey();
    const value = nuanceInput.value.trim();
    if (key && value) state.nuances[key] = value;
    else if (key) delete state.nuances[key];
    closeNuance();
    render();
  }

  function reset() {
    clearTimeout(runTimer);
    localStorage.removeItem(STORAGE_KEY);
    state = initialState();
    render();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  document.addEventListener("click", (event) => {
    const answer = event.target.closest("[data-answer]");
    if (answer) {
      animateDecision(answer.dataset.answer === "yes");
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;

    if (action === "reset" || action === "home") reset();
    else if (action === "undo" || action === "revisit") undo();
    else if (action === "open-nuance") openNuance();
    else if (action === "close-nuance") closeNuance();
    else if (action === "save-nuance") saveNuance();
    else if (action === "toggle-publish") togglePublication();
    else if (action === "pause") {
      state.run.stopRequested = true;
      persist();
      event.target.textContent = "Остановится после этапа";
    }
    else if (action === "resume") {
      state.mode = "running";
      render();
    }
    else if (action === "deny-gate") resolveGate(false);
    else if (action === "view-plan") {
      state.mode = "plan";
      render();
    }
  });

  backdrop.addEventListener("click", closeNuance);

  document.addEventListener("keydown", (event) => {
    if (!sheet.hidden && event.key === "Escape") {
      closeNuance();
      return;
    }
    if (sheet.hidden && state.mode === "discover") {
      if (event.key === "ArrowLeft") animateDecision(false);
      if (event.key === "ArrowRight") animateDecision(true);
      if (event.key.toLowerCase() === "n") openNuance();
    }
  });

  render();
})();
