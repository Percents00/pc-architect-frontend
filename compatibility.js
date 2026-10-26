"use strict";

// Проверки локального прототипа. Данные берутся из каталога по ID.
function validateBuild(payload, catalog) {
  const selected = {};
  for (const category of catalog.categories) {
    const code = category.code_slug;
    const id = payload[`${code}_id`];
    const component = id == null ? null : catalog.components.find((item) => item.id === id && item.category === code);
    if (id != null && !component) throw new Error(`Не найден компонент категории ${category.name}.`);
    selected[code] = component;
  }

  const ramCount = payload.ram_count ?? 0;
  if (!Number.isInteger(ramCount) || ramCount < 0 || ramCount > 16) {
    throw new Error("Количество модулей RAM должно быть целым числом от 0 до 16.");
  }
  if ((!selected.ram && ramCount !== 0) || (selected.ram && ramCount === 0)) {
    throw new Error("Укажите количество модулей RAM для выбранной памяти.");
  }

  const issues = [];
  const conflict = (code, message, ...slots) => issues.push({code, message, slots});
  const {cpu, motherboard: board, gpu, ram, psu} = selected;

  if (cpu && board && cpu.socket !== board.socket) {
    conflict("CPU_SOCKET_MISMATCH", `Сокет CPU ${cpu.socket} не совпадает с сокетом платы ${board.socket}.`, "cpu", "motherboard");
  }
  if (cpu && ram && cpu.supported_memory_type !== ram.memory_type) {
    conflict("CPU_MEMORY_MISMATCH", `Процессор поддерживает ${cpu.supported_memory_type}, выбрана память ${ram.memory_type}.`, "cpu", "ram");
  }
  if (board && ram && board.ram_type !== ram.memory_type) {
    conflict("BOARD_MEMORY_MISMATCH", `Плата поддерживает ${board.ram_type}, выбрана память ${ram.memory_type}.`, "motherboard", "ram");
  }
  if (board && ram && ramCount > board.ram_slots_count) {
    conflict("RAM_SLOTS_EXCEEDED", `На плате ${board.ram_slots_count} слота RAM, выбрано модулей: ${ramCount}.`, "motherboard", "ram");
  }

  // Учебная оценка только по CPU и GPU, без остальных узлов и пиковых нагрузок.
  const totalTdp = cpu && gpu ? cpu.base_tdp + gpu.tdp : null;
  const requiredPsu = totalTdp === null ? null : Math.max(Math.ceil(totalTdp * 1.2), gpu.recommended_psu_wattage);
  if (psu && requiredPsu !== null && psu.wattage < requiredPsu) {
    conflict("PSU_POWER_INSUFFICIENT", `БП на ${psu.wattage} Вт недостаточно: требуется минимум ${requiredPsu} Вт.`, "psu");
  }

  const missing = Object.keys(selected).filter((code) => !selected[code]);
  const status = issues.length ? "incompatible" : missing.length ? "incomplete" : "compatible";
  return {
    status,
    is_compatible: status === "compatible",
    issues,
    missing_slots: missing,
    total_tdp: totalTdp,
    required_psu_wattage: requiredPsu,
    psu_wattage: psu ? psu.wattage : null,
    headroom_percent: psu && totalTdp !== null ? Math.round((psu.wattage - totalTdp) / psu.wattage * 1000) / 10 : null,
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = {validateBuild};
