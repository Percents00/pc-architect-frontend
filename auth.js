"use strict";

window.AppAuth = (() => {
  let access = null;
  let user = null;
  let refreshPending = null;
  const byId = (id) => document.getElementById(id);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("pc-architect-session") : null;

  function updateUser(value) {
    user = value;
    byId("openAuth").hidden = Boolean(user);
    byId("openAccount").hidden = !user;
    byId("logoutButton").hidden = !user;
    byId("authStatus").textContent = user ? user.username : "Гость";
    if (!user) {
      if (byId("accountDialog").open) byId("accountDialog").close();
      byId("accountBuilds").replaceChildren();
    }
    window.dispatchEvent(new CustomEvent("authchange", { detail: user }));
  }

  function csrfToken() {
    const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("csrftoken="));
    return item ? decodeURIComponent(item.slice("csrftoken=".length)) : "";
  }

  async function send(url, options = {}, retryCsrf = true) {
    const method = options.method || "GET";
    const headers = { Accept: "application/json", ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD"].includes(method)) headers["X-CSRFToken"] = csrfToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(url, { ...options, method, headers, credentials: "same-origin", signal: controller.signal });
    } catch {
      throw new Error("Не удалось связаться с сервером. Проверьте подключение и повторите попытку.");
    } finally {
      clearTimeout(timeout);
    }
    const result = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 403 && result?.code === "CSRF_FAILED" && retryCsrf) {
        await send("/api/auth/csrf/", {}, false);
        return send(url, options, false);
      }
      const error = new Error(result?.message || "Не удалось выполнить запрос.");
      error.status = response.status;
      error.code = result?.code;
      error.fields = result?.errors;
      throw error;
    }
    return result;
  }

  function withSessionLock(action) {
    return navigator.locks ? navigator.locks.request("pc-architect-session", action) : action();
  }

  function refreshSession() {
    if (!refreshPending) {
      refreshPending = withSessionLock(async () => {
        try {
          const result = await send("/api/auth/refresh/", { method: "POST", body: "{}" });
          access = result.access_token;
          updateUser(result.user);
          return result;
        } catch (error) {
          access = null;
          updateUser(null);
          throw error;
        }
      }).finally(() => { refreshPending = null; });
    }
    return refreshPending;
  }

  const ready = (async () => {
    if (location.protocol === "file:") {
      updateUser(null);
      return;
    }
    try {
      await send("/api/auth/csrf/");
      await refreshSession();
    } catch (error) {
      updateUser(null);
      if (error.status !== 401) byId("authStatus").textContent = "Сеанс не проверен";
    } finally {
      byId("openAuth").disabled = false;
    }
  })();

  async function request(url, options = {}) {
    await ready;
    if (!access) await refreshSession();
    const previous = access;
    try {
      return await send(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${access}` } });
    } catch (error) {
      if (error.status !== 401) throw error;
      if (access === previous) await refreshSession();
      try {
        return await send(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${access}` } });
      } catch (retryError) {
        if (retryError.status === 401) { access = null; updateUser(null); }
        throw retryError;
      }
    }
  }

  async function login(email, password) {
    await ready;
    return withSessionLock(async () => {
      const result = await send("/api/auth/login/", { method: "POST", body: JSON.stringify({ email, password }) });
      access = result.access_token;
      updateUser(result.user);
      channel?.postMessage("signed-in");
    });
  }

  async function logout() {
    await ready;
    if (refreshPending) await refreshPending.catch(() => {});
    return withSessionLock(async () => {
      await send("/api/auth/logout/", { method: "POST", body: "{}", headers: access ? { Authorization: `Bearer ${access}` } : {} });
      access = null;
      updateUser(null);
      channel?.postMessage("signed-out");
    });
  }

  channel?.addEventListener("message", (event) => {
    if (event.data === "signed-out") { access = null; updateUser(null); }
    if (event.data === "signed-in") refreshSession().catch(() => {});
  });

  return { ready, request, login, logout, get user() { return user; },
    register: (data) => send("/api/auth/register/", { method: "POST", body: JSON.stringify(data) }) };
})();

(() => {
  const byId = (id) => document.getElementById(id);
  function message(error) {
    const fields = Object.values(error.fields || {}).flat();
    return fields.length ? fields.join(" ") : error.message;
  }
  function showTab(register) {
    byId("loginForm").hidden = register;
    byId("registerForm").hidden = !register;
    byId("authDialogTitle").textContent = register ? "Регистрация" : "Вход";
    byId("authMessage").textContent = "";
  }
  byId("openAuth").addEventListener("click", () => {
    showTab(false);
    byId("authDialog").showModal();
  });
  byId("closeAuth").addEventListener("click", () => byId("authDialog").close());
  byId("showRegister").addEventListener("click", () => showTab(true));
  byId("showLogin").addEventListener("click", () => showTab(false));
  byId("closeAccount").addEventListener("click", () => byId("accountDialog").close());
  byId("authDialog").addEventListener("close", () => {
    byId("loginPassword").value = "";
    byId("registerPassword").value = "";
    byId("registerConfirm").value = "";
  });

  byId("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = byId("loginSubmit");
    button.disabled = true;
    byId("authMessage").textContent = "Выполняется вход…";
    try {
      await AppAuth.login(byId("loginEmail").value, byId("loginPassword").value);
      byId("authDialog").close();
      byId("openAccount").click();
    } catch (error) {
      byId("authMessage").textContent = message(error);
    } finally {
      byId("loginPassword").value = "";
      button.disabled = false;
    }
  });

  byId("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (byId("registerPassword").value !== byId("registerConfirm").value) {
      byId("authMessage").textContent = "Пароли не совпадают.";
      return;
    }
    const button = byId("registerSubmit");
    button.disabled = true;
    byId("authMessage").textContent = "Создаём учётную запись…";
    try {
      await AppAuth.register({ username: byId("registerUsername").value, email: byId("registerEmail").value,
        password: byId("registerPassword").value, password_confirm: byId("registerConfirm").value });
      byId("loginEmail").value = byId("registerEmail").value;
      showTab(false);
      byId("authMessage").textContent = "Учётная запись создана. Войдите с указанным email и паролем.";
    } catch (error) {
      byId("authMessage").textContent = message(error);
    } finally {
      byId("registerPassword").value = "";
      byId("registerConfirm").value = "";
      button.disabled = false;
    }
  });

  byId("logoutButton").addEventListener("click", async () => {
    byId("logoutButton").disabled = true;
    try {
      await AppAuth.logout();
    } catch (error) {
      byId("authStatus").textContent = error.message;
    } finally {
      byId("logoutButton").disabled = false;
    }
  });
})();
