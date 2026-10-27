/* World Clock — all time-zone math uses the browser's own Intl data (no network). */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var LOCAL = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
  var FALLBACK = ["UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Istanbul", "Europe/Moscow", "Asia/Amman", "Asia/Riyadh", "Asia/Dubai",
    "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
    "Africa/Cairo", "Africa/Lagos", "Africa/Johannesburg", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Mexico_City"];
  var ZONES = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : FALLBACK).slice();
  if (ZONES.indexOf("UTC") < 0) ZONES.unshift("UTC");
  // Well-known cities whose name is not in the IANA zone id.
  var ALIAS = { "Mecca": "Asia/Riyadh", "Makkah": "Asia/Riyadh", "Medina": "Asia/Riyadh", "Jeddah": "Asia/Riyadh", "Abu Dhabi": "Asia/Dubai", "Doha": "Asia/Qatar",
    "San Francisco": "America/Los_Angeles", "Seattle": "America/Los_Angeles", "Washington DC": "America/New_York", "Boston": "America/New_York", "Miami": "America/New_York",
    "Houston": "America/Chicago", "Dallas": "America/Chicago", "Montreal": "America/Toronto", "Delhi": "Asia/Kolkata", "Mumbai": "Asia/Kolkata", "Bangalore": "Asia/Kolkata",
    "Beijing": "Asia/Shanghai", "Shenzhen": "Asia/Shanghai", "Osaka": "Asia/Tokyo", "Irbid": "Asia/Amman", "Aqaba": "Asia/Amman", "Alexandria": "Africa/Cairo",
    "Ankara": "Europe/Istanbul", "Milan": "Europe/Rome", "Barcelona": "Europe/Madrid", "Munich": "Europe/Berlin", "Manchester": "Europe/London", "Edinburgh": "Europe/London",
    "Melbourne": "Australia/Melbourne", "Gaza": "Asia/Gaza", "Jerusalem": "Asia/Jerusalem", "Ramallah": "Asia/Hebron", "Kuwait City": "Asia/Kuwait", "Manama": "Asia/Bahrain",
    "Muscat": "Asia/Muscat", "Sanaa": "Asia/Aden", "Tunis": "Africa/Tunis", "Algiers": "Africa/Algiers", "Casablanca": "Africa/Casablanca", "Khartoum": "Africa/Khartoum" };

  var zones = (S3.store("wc.zones") || ["Europe/London", "America/New_York", "Asia/Dubai", "Asia/Tokyo"]).filter(valid);
  var h12 = S3.store("wc.h12");
  if (h12 === undefined) h12 = /h12|h11/.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle || "");
  var pinned = null; // null = live, otherwise a timestamp (ms)

  function valid(tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; } }

  // ---------- zone math ----------
  var fmtCache = {};
  function parts(tz, date) {
    var f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" }));
    var o = {};
    f.formatToParts(date).forEach(function (p) { if (p.type !== "literal") o[p.type] = p.type === "weekday" ? p.value : +p.value; });
    o.hour = o.hour % 24;
    return o;
  }
  function offsetMin(tz, date) {
    var p = parts(tz, date), t = Math.floor(date.getTime() / 1000) * 1000;
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t) / 60000);
  }
  function fmtOffset(min) {
    var s = min < 0 ? "−" : "+", a = Math.abs(min);
    return "UTC" + (min === 0 ? "" : s + Math.floor(a / 60) + (a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""));
  }
  function fmtDiff(min) {
    if (min === 0) return "same time";
    var a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
    return (min > 0 ? "+" : "−") + (h ? h + "h" : "") + (m ? (h ? " " : "") + m + "m" : "");
  }
  // hour as a fraction (9.5 = 09:30) -> working / awake / night
  function kind(hf) { return hf >= 9 && hf < 17 ? "work" : hf >= 7 && hf < 22 ? "awake" : "night"; }
  // Which of the 24 hourly moments starting at startMs fall inside working hours in every zone?
  function workingOverlap(list, startMs) {
    var out = [];
    for (var i = 0; i < 24; i++) {
      var d = new Date(startMs + i * 3600000);
      if (list.every(function (tz) { var p = parts(tz, d); return kind(p.hour + p.minute / 60) === "work"; })) out.push(i);
    }
    return out;
  }
  function label(tz) {
    if (tz === "UTC") return { city: "UTC", region: "Coordinated Universal Time" };
    var bits = tz.split("/");
    return { city: bits[bits.length - 1].replace(/_/g, " "), region: bits.slice(0, -1).join(" / ").replace(/_/g, " ") };
  }
  function timeStr(p, withSec) {
    var h = p.hour, suf = "";
    if (h12) { suf = h < 12 ? "AM" : "PM"; h = h % 12 || 12; }
    return { t: (h12 ? h : String(h).padStart(2, "0")) + ":" + String(p.minute).padStart(2, "0") + (withSec ? ":" + String(p.second).padStart(2, "0") : ""), suf: suf };
  }
  function shortHour(p) {
    if (!h12) return String(p.hour) + (p.minute ? ":" + String(p.minute).padStart(2, "0") : "");
    var h = p.hour % 12 || 12;
    return h + (p.minute ? ":" + String(p.minute).padStart(2, "0") : "") + (p.hour < 12 ? "a" : "p");
  }

  // ---------- search ----------
  var options = [];
  ZONES.forEach(function (tz) { var l = label(tz); options.push({ text: l.city + " (" + tz + ")", tz: tz }); });
  Object.keys(ALIAS).forEach(function (c) { if (valid(ALIAS[c])) options.push({ text: c + " (" + ALIAS[c] + ")", tz: ALIAS[c] }); });
  options.sort(function (a, b) { return a.text.localeCompare(b.text); });
  var dl = $("#zones");
  options.forEach(function (o) { dl.appendChild(S3.h("option", { value: o.text })); });
  function resolve(q) {
    q = q.trim().toLowerCase(); if (!q) return null;
    var m = /\(([^)]+)\)$/.exec(q);
    if (m) q = m[1];
    var exact = options.filter(function (o) { return o.tz.toLowerCase() === q || o.text.toLowerCase() === q || o.text.toLowerCase().split(" (")[0] === q; })[0];
    if (exact) return exact.tz;
    var part = options.filter(function (o) { return o.text.toLowerCase().indexOf(q) >= 0; });
    return part.length ? part[0].tz : null;
  }
  $("#addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var tz = resolve($("#search").value);
    if (!tz) { S3.toast("No time zone matches that", "error"); return; }
    if (tz === LOCAL || zones.indexOf(tz) >= 0) { S3.toast(label(tz).city + " is already on the board"); $("#search").value = ""; return; }
    zones.push(tz); S3.store("wc.zones", zones); $("#search").value = "";
    buildClocks(); renderPlanner(); S3.done();
  });

  // ---------- clocks ----------
  function allZones() { return [LOCAL].concat(zones.filter(function (z) { return z !== LOCAL; })); }
  function buildClocks() {
    var box = $("#clocks"); box.innerHTML = "";
    allZones().forEach(function (tz, i) {
      var l = label(tz);
      var x = i ? S3.h("button", { "class": "btn ghost icon small c-x", "aria-label": "Remove " + l.city, title: "Remove", html: S3.icon("x") }) : null;
      if (x) x.addEventListener("click", function () { zones = zones.filter(function (z) { return z !== tz; }); S3.store("wc.zones", zones); buildClocks(); renderPlanner(); });
      var card = S3.h("article", { "class": "clock" + (i ? "" : " home"), "data-tz": tz }, [
        S3.h("div", { "class": "c-top" }, [
          S3.h("div", null, [S3.h("div", { "class": "c-name", text: i ? l.city : l.city + " · you" }), S3.h("div", { "class": "c-region", text: l.region })]),
          S3.h("div", { "class": "row c-right" }, [S3.h("span", { "class": "c-icon", "aria-hidden": "true" }), x])
        ]),
        S3.h("div", { "class": "c-time" }),
        S3.h("div", { "class": "c-meta" })
      ]);
      box.appendChild(card);
    });
    tick();
  }
  function now() { return pinned == null ? new Date() : new Date(pinned); }
  function tick() {
    var d = now(), localOff = offsetMin(LOCAL, d);
    $$(".clock").forEach(function (card) {
      var tz = card.dataset.tz, p = parts(tz, d), hf = p.hour + p.minute / 60, off = offsetMin(tz, d), ts = timeStr(p, pinned == null);
      var isDay = hf >= 6 && hf < 18;
      card.classList.toggle("day", isDay); card.classList.toggle("night", !isDay);
      $(".c-icon", card).textContent = isDay ? "☀️" : "🌙";
      $(".c-icon", card).title = isDay ? "Daytime" : "Night";
      var tEl = $(".c-time", card); tEl.textContent = ts.t;
      if (ts.suf) tEl.appendChild(S3.h("small", { text: ts.suf }));
      var dateTxt = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
      var meta = $(".c-meta", card); meta.innerHTML = "";
      meta.appendChild(S3.h("span", { text: dateTxt }));
      meta.appendChild(S3.h("span", { "class": "chip", text: fmtOffset(off) }));
      if (tz !== LOCAL) meta.appendChild(S3.h("span", { "class": "chip", text: fmtDiff(off - localOff) }));
      if (kind(hf) === "work" && p.weekday !== "Sat" && p.weekday !== "Sun") meta.appendChild(S3.h("span", { "class": "chip ok", text: "working hours" }));
    });
  }

  // ---------- slider + planner ----------
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function dayStart() {
    var v = $("#date").value.split("-").map(Number);
    return v.length === 3 && v[0] ? new Date(v[0], v[1] - 1, v[2]).getTime() : new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  }
  function setPinned(ms) {
    pinned = ms;
    var when = $("#when");
    if (ms == null) { when.textContent = "Live"; when.className = "chip accent"; }
    else { when.textContent = new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: h12 }) + " your time"; when.className = "chip"; }
    tick(); markPlanner();
  }
  function syncSliderToNow() {
    var d = new Date(); $("#date").value = ymd(d);
    $("#slider").value = Math.floor((d.getHours() * 60 + d.getMinutes()) / 15) * 15;
  }
  $("#slider").addEventListener("input", function () {
    // Local midnight + N minutes, built from parts so DST days stay correct.
    var s = new Date(dayStart()), m = +$("#slider").value;
    setPinned(new Date(s.getFullYear(), s.getMonth(), s.getDate(), Math.floor(m / 60), m % 60).getTime());
  });
  $("#date").addEventListener("change", function () { renderPlanner(); $("#slider").dispatchEvent(new Event("input")); });
  $("#live").addEventListener("click", function () { syncSliderToNow(); setPinned(null); renderPlanner(); });

  function renderPlanner() {
    var start = dayStart(), list = allZones(), s = new Date(start), hours = [];
    for (var i = 0; i < 24; i++) hours.push(new Date(s.getFullYear(), s.getMonth(), s.getDate(), i).getTime());
    var ov = workingOverlap(list, start);
    $("#plannerDate").textContent = new Date(start).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    $("#overlapText").textContent = list.length < 2 ? "Add another city to compare." :
      ov.length ? "Everyone is in working hours for " + ov.length + " hour" + (ov.length > 1 ? "s" : "") + " (outlined in green)." :
      "No hour where everyone is inside 9–17. Look for the 'awake' (amber) columns instead.";
    var tbl = $("#planner"); tbl.innerHTML = "";
    var head = S3.h("tr", null, [S3.h("th", { "class": "zone", text: "City" })]);
    hours.forEach(function (ms, i) { head.appendChild(S3.h("th", { "data-i": i, text: shortHour(parts(LOCAL, new Date(ms))) })); });
    tbl.appendChild(S3.h("thead", null, [head]));
    var body = S3.h("tbody");
    list.forEach(function (tz) {
      var tr = S3.h("tr", null, [S3.h("td", { "class": "zone", text: label(tz).city })]);
      var baseDay = parts(tz, new Date(hours[0])).day;
      hours.forEach(function (ms, i) {
        var p = parts(tz, new Date(ms)), hf = p.hour + p.minute / 60;
        var td = S3.h("td", { "class": kind(hf) + (ov.indexOf(i) >= 0 ? " ov" : ""), "data-i": i, text: shortHour(p), title: label(tz).city + ": " + timeStr(p).t + " " + timeStr(p).suf });
        if (p.day !== baseDay && p.hour === 0) td.textContent = p.month + "/" + p.day;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    tbl.appendChild(body);
    markPlanner();
  }
  function markPlanner() {
    $$("#planner .sel").forEach(function (c) { c.classList.remove("sel"); });
    if (pinned == null) return;
    var i = Math.floor((pinned - dayStart()) / 3600000);
    $$('#planner [data-i="' + i + '"]').forEach(function (c) { c.classList.add("sel"); });
  }
  $("#planner").addEventListener("click", function (e) {
    var c = e.target.closest("[data-i]"); if (!c) return;
    $("#slider").value = +c.dataset.i * 60; $("#slider").dispatchEvent(new Event("input"));
  });

  // ---------- format toggle ----------
  $$("#h12 button").forEach(function (b) {
    b.setAttribute("aria-pressed", String((b.dataset.v === "12") === !!h12));
    b.addEventListener("click", function () {
      h12 = b.dataset.v === "12"; S3.store("wc.h12", h12);
      $$("#h12 button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      setPinned(pinned); renderPlanner();
    });
  });

  syncSliderToNow();
  buildClocks();
  renderPlanner();
  // Display refresh only: each tick reads the real clock.
  setInterval(function () { if (pinned == null) tick(); }, 1000);

  window.S3_DEMO = function () {
    zones = ["Europe/London", "America/New_York", "Asia/Dubai", "Asia/Tokyo", "Australia/Sydney"].filter(function (z) { return z !== LOCAL; });
    buildClocks(); renderPlanner();
  };

  window.S3_SELFTEST = function () {
    var jan = new Date(Date.UTC(2026, 0, 15, 12)), jul = new Date(Date.UTC(2026, 6, 15, 12));
    var a = offsetMin("Asia/Tokyo", jan) === 540 && offsetMin("UTC", jan) === 0 && offsetMin("Asia/Kolkata", jan) === 330;
    var b = offsetMin("America/New_York", jan) === -300 && offsetMin("America/New_York", jul) === -240 && offsetMin("Europe/London", jul) === 60;
    var p = parts("Asia/Tokyo", jan), c = p.hour === 21 && p.day === 15 && p.minute === 0;
    // London 09-17 UTC and New York 14-22 UTC in January overlap 14:00, 15:00, 16:00 UTC.
    var ov = workingOverlap(["Europe/London", "America/New_York"], Date.UTC(2026, 0, 15, 0)), d = ov.join(",") === "14,15,16";
    var e = fmtOffset(330) === "UTC+5:30" && fmtOffset(-300) === "UTC−5" && fmtDiff(-90) === "−1h 30m" && kind(9) === "work" && kind(17) === "awake" && kind(23) === "night";
    var f = resolve("Mecca") === "Asia/Riyadh" && resolve("america/chicago") === "America/Chicago";
    return a && b && c && d && e && f;
  };
})();
