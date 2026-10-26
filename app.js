"use strict";

const state = { categories: [], components: [], selection: {}, ramCount: 0, buildId: null };
const $ = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function specifications(component) {
  const fields = {
    socket: ["Сокет", ""], base_tdp: ["TDP", " Вт"],
    supported_memory_type: ["Память", ""], form_factor: ["Форм-фактор", ""],
    ram_type: ["Память", ""], ram_slots_count: ["Слотов RAM", ""],
    length_mm: ["Длина", " мм"], tdp: ["TDP", " Вт"],
    recommended_psu_wattage: ["Рекомендуемый БП", " Вт"],
    memory_type: ["Тип", ""], capacity_gb: ["Объём модуля", " ГиБ"],
    height_mm: ["Высота", " мм"], wattage: ["Мощность", " Вт"],
    efficiency_certificate: ["Сертификат", ""],
    supported_motherboard_formats: ["Платы", ""],
    max_gpu_length_mm: ["Макс. длина GPU", " мм"],
    max_cooler_height_mm: ["Макс. высота кулера", " мм"],
    max_tdp_dissipation: ["Отвод тепла", " Вт"], supported_sockets: ["Сокеты", ""],
  };
  return Object.entries(fields)
    .filter(([key]) => component[key] !== undefined)
    .map(([key, [label, unit]]) => `${label}: ${Array.isArray(component[key]) ? component[key].join(", ") : component[key]}${unit}`)
    .join(" | ");
}

function currentPayload() {
  const payload = { ram_count: state.ramCount };
  for (const category of state.categories) {
    payload[`${category.code_slug}_id`] = state.selection[category.code_slug] ?? null;
  }
  return payload;
}

function renderSlots() {
  const fragment = document.createDocumentFragment();
  for (const category of state.categories) {
    const code = category.code_slug;
    const component = state.components.find((item) => item.id === state.selection[code]);
    const card = element("div", `slot-card ${component ? "filled" : "empty"}`);
    card.dataset.category = code;
    const meta = element("div", "slot-meta");
    meta.append(element("span", "slot-category", category.name));
    meta.append(element("div", `slot-title${component ? "" : " placeholder"}`, component?.name ?? "Компонент не выбран"));
    meta.append(element("div", "slot-specs", component ? specifications(component) : "Выберите модель из каталога"));
    if (code === "ram" && component) {
      const label = element("label", "ram-count", "Количество модулей: ");
      const input = element("input");
      Object.assign(input, { type: "number", min: "1", max: "16", step: "1", value: String(state.ramCount) });
      input.setAttribute("aria-label", "Количество модулей RAM");
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (!input.value || !Number.isInteger(value) || value < 1 || value > 16) {
          input.value = String(state.ramCount);
          return;
        }
        state.ramCount = value;
        runValidation();
      });
      label.append(input);
      meta.append(label);
    }
    const actions = element("div", "slot-actions");
    const choose = element("button", `btn ${component ? "btn-slot" : "btn-primary"}`, component ? "Изменить" : "Выбрать");
    choose.type = "button";
    choose.setAttribute("aria-label", `${component ? "Изменить" : "Выбрать"}: ${category.name}`);
    choose.addEventListener("click", () => openCatalog(code));
    actions.append(choose);
    if (component) {
      const remove = element("button", "btn btn-remove", "Удалить");
      remove.type = "button";
      remove.setAttribute("aria-label", `Удалить: ${category.name}`);
      remove.addEventListener("click", () => {
        state.selection[code] = null;
        if (code === "ram") state.ramCount = 0;
        renderSlots();
        runValidation();
      });
      actions.append(remove);
    }
    card.append(meta, actions);
    fragment.append(card);
  }
  $("slotsContainer").replaceChildren(fragment);
  $("clearBuild").disabled = !Object.values(state.selection).some(Boolean);
}

function renderCatalog() {
  const category = $("categoryFilter").value;
  const query = $("componentSearch").value.trim().toLocaleLowerCase("ru");
  const items = state.components.filter((item) =>
    (!category || item.category === category) && item.name.toLocaleLowerCase("ru").includes(query));
  $("catalogCount").textContent = `Найдено моделей: ${items.length}`;
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = element("div", "catalog-item");
    const meta = element("div", "slot-meta");
    meta.append(element("div", "slot-title", item.name), element("p", "slot-specs", specifications(item)));
    const button = element("button", "btn btn-primary", state.selection[item.category] === item.id ? "Выбрано" : "Выбрать");
    button.type = "button";
    button.disabled = state.selection[item.category] === item.id;
    button.addEventListener("click", () => {
      state.selection[item.category] = item.id;
      if (item.category === "ram" && state.ramCount === 0) state.ramCount = 1;
      $("componentDialog").close();
      renderSlots();
      runValidation();
    });
    card.append(meta, button);
    fragment.append(card);
  }
  if (!items.length) fragment.append(element("p", "audit-note", "Подходящих моделей нет. Измените поиск или категорию."));
  $("componentList").replaceChildren(fragment);
}

function openCatalog(category = "") {
  if (!state.categories.length) return;
  $("categoryFilter").value = category;
  $("componentSearch").value = "";
  renderCatalog();
  $("componentDialog").showModal();
  $("componentSearch").focus();
}

function renderValidation(result) {
  const labels = {
    compatible: ["badge-success", "Базовые проверки пройдены"],
    incompatible: ["badge-error", "Есть несовместимые компоненты"],
    incomplete: ["badge-neutral", "Сборка не завершена"],
  };
  const [className, label] = labels[result.status];
  $("validationBadge").className = `badge ${className}`;
  $("validationBadge").textContent = label;
  $("validationNote").textContent = result.status === "compatible"
    ? "Сокеты и память соответствуют друг другу. Мощности БП достаточно для базовой оценки."
    : "Проверьте предупреждения и дополните состав сборки.";
  const warnings = result.issues.map((issue) => issue.message);
  for (const slot of result.missing_slots) {
    const category = state.categories.find((item) => item.code_slug === slot);
    warnings.push(`Не выбран компонент: ${category.name}.`);
  }
  if (!warnings.length) warnings.push("В базовых проверках конфликтов не найдено.");
  $("warningList").replaceChildren(...warnings.map((text) => element("li", "", text)));
  $("tdpValue").textContent = result.total_tdp === null ? "—" : `${result.total_tdp} Вт`;
  $("tdpMax").textContent = result.psu_wattage === null ? "/ БП не выбран" : `/ ${result.psu_wattage} Вт БП`;
  $("tdpStatus").textContent = result.required_psu_wattage === null
    ? "Выберите CPU и GPU для расчёта."
    : `Требуется БП ≥ ${result.required_psu_wattage} Вт${result.headroom_percent === null ? "" : `. Запас выбранного БП: ${result.headroom_percent}%`}.`;
  const percent = result.total_tdp !== null && result.psu_wattage !== null
    ? Math.min(100, result.total_tdp / result.psu_wattage * 100) : 0;
  $("powerBar").style.width = `${percent}%`;
  $("powerBar").classList.toggle("power-danger", result.issues.some((issue) => issue.code === "PSU_POWER_INSUFFICIENT"));
}

function runValidation() {
  try {
    renderValidation(validateBuild(currentPayload(), state));
  } catch (error) {
    $("validationBadge").className = "badge badge-error";
    $("validationBadge").textContent = "Ошибка данных";
    $("validationNote").textContent = error.message;
    $("warningList").replaceChildren(element("li", "", "Проверьте каталог и состав сборки."));
    $("tdpValue").textContent = "—";
    $("tdpMax").textContent = "";
    $("tdpStatus").textContent = "Расчёт недоступен.";
    $("powerBar").style.width = "0%";
  }
}

async function fetchCatalogJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Не удалось получить каталог с сервера.");
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCatalog() {
  $("retryCatalog").disabled = true;
  $("loadExample").disabled = true;
  $("connectionError").hidden = true;
  $("catalogNotice").textContent = "Загружаем каталог…";
  try {
    if (location.protocol === "file:") {
      throw new Error("Откройте сайт через Django: http://127.0.0.1:8000/.");
    }
    const [categories, firstPage] = await Promise.all([
      fetchCatalogJson("/api/categories/"),
      fetchCatalogJson("/api/components/?page_size=100"),
    ]);
    if (!Array.isArray(categories.items) || !Array.isArray(firstPage.items) || !Number.isInteger(firstPage.total)) {
      throw new Error("Сервер вернул неверный формат каталога.");
    }
    const components = [...firstPage.items];
    const pageCount = Math.ceil(firstPage.total / 100);
    for (let page = 2; page <= pageCount; page++) {
      const result = await fetchCatalogJson(`/api/components/?page_size=100&page=${page}`);
      if (!Array.isArray(result.items)) throw new Error("Сервер вернул неверный формат каталога.");
      components.push(...result.items);
    }
    if (!categories.items.length || !components.length) {
      throw new Error("В каталоге пока нет комплектующих. Заполните каталог и повторите загрузку.");
    }
    state.categories = [...categories.items].sort((a, b) => a.display_order - b.display_order);
    state.components = components;
    $("catalogNotice").textContent = `Комплектующих в каталоге: ${state.components.length}.`;
    $("categoryFilter").replaceChildren(
      new Option("Все категории", ""),
      ...state.categories.map((item) => new Option(item.name, item.code_slug))
    );
    $("loadExample").disabled = false;
    $("saveBuild").disabled = !AppAuth.user;
    renderSlots();
    runValidation();
  } catch (error) {
    $("catalogNotice").textContent = "Каталог недоступен.";
    $("connectionMessage").textContent = location.protocol === "file:"
      ? error.message : "Не удалось загрузить каталог. Проверьте подключение и повторите попытку.";
    $("connectionError").hidden = false;
    $("validationBadge").className = "badge badge-error";
    $("validationBadge").textContent = "Каталог недоступен";
    $("validationNote").textContent = "Проверка станет доступна после загрузки каталога.";
  } finally {
    $("retryCatalog").disabled = false;
  }
}

$("openCatalog").addEventListener("click", (event) => { event.preventDefault(); openCatalog(); });
$("closeDialog").addEventListener("click", () => $("componentDialog").close());
$("categoryFilter").addEventListener("change", renderCatalog);
$("componentSearch").addEventListener("input", renderCatalog);
$("clearBuild").addEventListener("click", () => {
  state.buildId = null;
  $("buildMessage").textContent = "";
  state.selection = {};
  state.ramCount = 0;
  renderSlots();
  runValidation();
});
$("loadExample").addEventListener("click", () => {
  state.buildId = null;
  $("buildMessage").textContent = "";
  for (const category of state.categories) {
    state.selection[category.code_slug] = state.components.find((item) => item.category === category.code_slug)?.id ?? null;
  }
  state.ramCount = state.selection.ram ? 2 : 0;
  renderSlots();
  runValidation();
});
$("retryCatalog").addEventListener("click", loadCatalog);
loadCatalog();


let accountPage = 1;
let accountLoading = false;
let accountOwner = null;

window.addEventListener("authchange", (event) => {
  const nextOwner = event.detail?.id || null;
  if (accountOwner !== nextOwner) state.buildId = null;
  accountOwner = nextOwner;
  $("saveBuild").disabled = !event.detail || !state.categories.length;
  $("buildMessage").textContent = event.detail ? "" : "Войдите, чтобы сохранять сборки в личном кабинете.";
});

async function loadAccount(page = 1) {
  if (accountLoading || !AppAuth.user) return;
  accountLoading = true;
  const owner = AppAuth.user.id;
  $("accountProfile").textContent = `${AppAuth.user.username} · ${AppAuth.user.email}`;
  $("accountMessage").textContent = "Загружаем сборки…";
  $("previousBuilds").disabled = true;
  $("nextBuilds").disabled = true;
  try {
    const result = await AppAuth.request(`/api/builds/?page=${page}`);
    if (AppAuth.user?.id !== owner) return;
    accountPage = page;
    const fragment = document.createDocumentFragment();
    for (const build of result.items) {
      const card = element("article", "account-build");
      card.append(element("h3", "", build.title));
      const count = Object.entries(build.selection).filter(([key, value]) => key.endsWith("_id") && value).length;
      card.append(element("p", "audit-note", `Выбрано компонентов: ${count} из 7 · ${new Date(build.updated_at).toLocaleString("ru")}`));
      const actions = element("div", "account-actions");
      const open = element("button", "btn btn-primary", "Открыть в конструкторе");
      open.type = "button";
      open.disabled = !state.categories.length;
      open.addEventListener("click", () => {
        state.selection = {};
        for (const category of state.categories) {
          const id = build.selection[`${category.code_slug}_id`];
          state.selection[category.code_slug] = state.components.some((item) => item.id === id && item.category === category.code_slug) ? id : null;
        }
        state.ramCount = state.selection.ram ? build.selection.ram_count : 0;
        state.buildId = build.id;
        $("buildTitle").value = build.title;
        $("buildMessage").textContent = "Сборка открыта. Сохранение обновит эту сборку.";
        renderSlots();
        runValidation();
        $("accountDialog").close();
      });
      const remove = element("button", "btn btn-remove", "Удалить");
      remove.type = "button";
      let confirmed = false;
      remove.addEventListener("click", async () => {
        if (!confirmed) { confirmed = true; remove.textContent = "Подтвердить удаление"; return; }
        remove.disabled = true;
        try {
          await AppAuth.request(`/api/builds/${build.id}/`, { method: "DELETE" });
          if (state.buildId === build.id) state.buildId = null;
          await loadAccount(result.items.length === 1 && page > 1 ? page - 1 : page);
        } catch (error) {
          $("accountMessage").textContent = error.message;
          remove.disabled = false;
        }
      });
      actions.append(open, remove);
      card.append(actions);
      fragment.append(card);
    }
    $("accountBuilds").replaceChildren(fragment);
    $("accountMessage").textContent = result.total ? "" : "У вас пока нет сохранённых сборок.";
    $("buildsPage").textContent = `Страница ${page} · Всего сборок: ${result.total}`;
    $("previousBuilds").disabled = page <= 1;
    $("nextBuilds").disabled = page * result.page_size >= result.total;
  } catch (error) {
    $("accountMessage").textContent = error.message;
  } finally {
    accountLoading = false;
  }
}

$("openAccount").addEventListener("click", () => {
  if (!AppAuth.user) return;
  $("accountDialog").showModal();
  loadAccount();
});
$("previousBuilds").addEventListener("click", () => loadAccount(accountPage - 1));
$("nextBuilds").addEventListener("click", () => loadAccount(accountPage + 1));
$("saveBuild").addEventListener("click", async () => {
  $("saveBuild").disabled = true;
  $("buildMessage").textContent = "Сохраняем сборку…";
  try {
    const path = state.buildId ? `/api/builds/${state.buildId}/` : "/api/builds/";
    const result = await AppAuth.request(path, { method: state.buildId ? "PATCH" : "POST",
      body: JSON.stringify({ title: $("buildTitle").value, ...currentPayload() }) });
    state.buildId = result.id;
    $("buildMessage").textContent = "Сборка сохранена в личном кабинете.";
  } catch (error) {
    $("buildMessage").textContent = error.message;
    if (error.status === 404) state.buildId = null;
  } finally {
    $("saveBuild").disabled = !AppAuth.user || !state.categories.length;
  }
});
