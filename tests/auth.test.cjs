const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
const user = { id: "owner", username: "owner", email: "owner@example.test" };
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const tick = () => new Promise((resolve) => setImmediate(resolve));

function client(fetch, locks) {
  const elements = new Map();
  const context = {
    document: {
      cookie: "csrftoken=csrf-value",
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { addEventListener() {}, replaceChildren() {}, close() {}, value: "" });
        return elements.get(id);
      },
    },
    location: { protocol: "http:" }, navigator: { locks }, fetch,
    AbortController, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent() {}, addEventListener() {},
  };
  context.window = context;
  Object.defineProperty(context, "localStorage", { get() { throw new Error("Tokens must not use localStorage"); } });
  Object.defineProperty(context, "sessionStorage", { get() { throw new Error("Tokens must not use sessionStorage"); } });
  vm.runInNewContext(source, context, { filename: "auth.js" });
  return context.AppAuth;
}

test("concurrent expired access requests share one refresh", async () => {
  let refreshes = 0;
  const auth = client(async (url, options) => {
    if (url.endsWith("csrf/")) return reply(204);
    if (url.endsWith("refresh/")) {
      refreshes++;
      await tick();
      return reply(200, { access_token: refreshes === 1 ? "old" : "new", user });
    }
    assert.equal(url, "/api/builds/");
    return options.headers.Authorization === "Bearer old"
      ? reply(401, { message: "Expired" }) : reply(200, { items: [] });
  });
  await auth.ready;
  const results = await Promise.all([auth.request("/api/builds/"), auth.request("/api/builds/")]);
  assert.equal(refreshes, 2); // One bootstrap refresh, one refresh for both requests.
  assert.equal(results.length, 2);
  assert.equal(auth.user.id, user.id);
  assert.equal(auth.access_token, undefined);
});

test("a rejected refresh signs out and does not loop", async () => {
  let refreshes = 0;
  const auth = client(async (url) => {
    if (url.endsWith("csrf/")) return reply(204);
    if (url.endsWith("refresh/")) {
      refreshes++;
      await tick();
      return refreshes === 1 ? reply(200, { access_token: "old", user }) : reply(401, { message: "Session ended" });
    }
    return reply(401, { message: "Expired" });
  });
  await auth.ready;
  const results = await Promise.allSettled([auth.request("/api/builds/"), auth.request("/api/builds/")]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(refreshes, 2);
  assert.equal(auth.user, null);
});

test("cross-tab session operations use Web Locks", async () => {
  let tail = Promise.resolve();
  const locks = { request(name, action) {
    assert.equal(name, "pc-architect-session");
    const next = tail.then(action);
    tail = next.catch(() => {});
    return next;
  } };
  let active = 0;
  let maximum = 0;
  const fetch = async (url) => {
    if (url.endsWith("csrf/")) return reply(204);
    assert.ok(url.endsWith("refresh/"));
    active++;
    maximum = Math.max(maximum, active);
    await tick();
    active--;
    return reply(200, { access_token: "access", user });
  };
  const first = client(fetch, locks);
  const second = client(fetch, locks);
  await Promise.all([first.ready, second.ready]);
  assert.equal(maximum, 1);
  assert.equal(first.user.id, user.id);
  assert.equal(second.user.id, user.id);
});

test("logout confirms server revocation before clearing the local user", async () => {
  let fail = true;
  const auth = client(async (url, options) => {
    if (url.endsWith("csrf/")) return reply(204);
    if (url.endsWith("refresh/")) return reply(200, { access_token: "access", user });
    assert.ok(url.endsWith("logout/"));
    assert.equal(options.headers.Authorization, "Bearer access");
    assert.equal(options.headers["X-CSRFToken"], "csrf-value");
    return fail ? reply(503, { message: "Unavailable" }) : reply(204);
  });
  await auth.ready;
  await assert.rejects(auth.logout());
  assert.equal(auth.user.id, user.id);
  fail = false;
  await auth.logout();
  assert.equal(auth.user, null);
});
