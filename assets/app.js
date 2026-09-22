/* 安徽大学学生手册 · 下滑式全文查询
   功能：目录跳转 / 关键词检索（显示命中附近内容并跳转）/ 自定义名称书签
   纯静态：数据来自 data/handbook.js，直接打开 index.html 即可使用。 */
(function () {
  "use strict";

  var data = window.HANDBOOK;
  if (!data || !data.paras) {
    document.body.innerHTML = "<p style='padding:40px;font-family:sans-serif'>数据文件 data/handbook.js 未能载入。</p>";
    return;
  }

  var paras = data.paras;
  var tables = data.tables || {};
  var toc = data.toc || [];
  var total = paras.length;

  var RE_CHAPTER = /^第[一二三四五六七八九十百零〇]+章/;
  var RE_ARTICLE = /^第[一二三四五六七八九十百零〇]+条/;
  var RE_SPLIT = /[\s\p{P}\p{S}]/u;
  var MARK_KEY = "ahdx.handbook.marks.v1";

  var el = {
    q: document.getElementById("q"),
    form: document.getElementById("search-form"),
    clear: document.getElementById("clear-btn"),
    count: document.getElementById("search-count"),
    hits: document.getElementById("hits"),
    doc: document.getElementById("doc"),
    meta: document.getElementById("meta-line"),
    footnote: document.getElementById("footnote"),
    paneToc: document.getElementById("pane-toc"),
    paneMarks: document.getElementById("pane-marks"),
    markCount: document.getElementById("mark-count"),
    where: document.getElementById("where"),
    whereText: document.getElementById("where-text"),
    toTop: document.getElementById("to-top"),
    sidebar: document.getElementById("sidebar"),
    scrim: document.getElementById("scrim"),
    menu: document.getElementById("menu-btn"),
    popover: document.getElementById("popover"),
    popoverInput: document.getElementById("popover-input"),
    popoverWhere: document.getElementById("popover-where"),
    popoverSave: document.getElementById("popover-save"),
    popoverCancel: document.getElementById("popover-cancel"),
    help: document.getElementById("help-btn"),
    intro: document.getElementById("intro"),
    introX: document.getElementById("intro-x"),
    introStart: document.getElementById("intro-start"),
    backup: document.getElementById("backup"),
    backupScrim: document.getElementById("backup-scrim"),
    backupText: document.getElementById("backup-text"),
    backupTitle: document.getElementById("backup-title"),
    backupSub: document.getElementById("backup-sub"),
    backupDo: document.getElementById("backup-do"),
    backupX: document.getElementById("backup-x"),
    backupCancel: document.getElementById("backup-cancel")
  };

  /* ------------------------------------------------------------ 位置索引 */
  var docOf = new Array(total).fill("");
  var artOf = new Array(total).fill("");
  var chapOf = new Array(total).fill("");

  (function indexPositions() {
    var d = 0, a = 0, c = 0;
    var docStarts = Object.create(null);
    (data.docs || []).forEach(function (pair) { docStarts[pair[0]] = pair[1]; });
    var artStarts = Object.create(null);
    (data.articles || []).forEach(function (pair) { artStarts[pair[0]] = pair[1]; });
    var chapStarts = Object.create(null);
    (data.chapters || []).forEach(function (pair) { chapStarts[pair[0]] = pair[1]; });
    for (var i = 0; i < total; i++) {
      // 换一份文件时清空章、条上下文，避免上一份的条号串到下一份。
      if (docStarts[i]) { d = docStarts[i]; c = ""; a = ""; }
      if (chapStarts[i]) c = chapStarts[i];
      if (artStarts[i]) a = artStarts[i];
      docOf[i] = d; chapOf[i] = c; artOf[i] = a;
    }
  })();

  var docStarts = (data.docs || []).map(function (pair) { return pair[0]; });

  // 目录里标记为补充录入的文件（正文扫描件缺失，由补充材料补上）。
  var supplementStarts = Object.create(null);
  toc.forEach(function (group) {
    group.children.forEach(function (node) {
      if (node.s && node.p !== undefined) supplementStarts[node.p] = true;
    });
  });

  function whereText(i) {
    var parts = [];
    if (docOf[i]) parts.push(docOf[i]);
    if (artOf[i]) parts.push(artOf[i]);
    return parts.join(" · ") || "正文";
  }

  /* ------------------------------------------------------------ 归一化 */
  function normalize(text) {
    var chars = [];
    var map = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var code = ch.charCodeAt(0);
      if (code >= 0xff01 && code <= 0xff5e) ch = String.fromCharCode(code - 0xfee0);
      else if (code === 0x3000) ch = " ";
      if (RE_SPLIT.test(ch)) continue;
      chars.push(ch.toLowerCase());
      map.push(i);
    }
    return { n: chars.join(""), map: map };
  }

  var blocks = paras.map(function (text) { return normalize(text); });

  /* ------------------------------------------------------------ 检索 */
  function findAll(hay, needle) {
    var out = [];
    if (!needle) return out;
    var pos = hay.indexOf(needle);
    while (pos !== -1) {
      out.push([pos, pos + needle.length]);
      pos = hay.indexOf(needle, pos + 1);
    }
    return out;
  }

  function bigrams(text) {
    var m = Object.create(null);
    for (var i = 0; i < text.length - 1; i++) {
      var g = text.substr(i, 2);
      m[g] = (m[g] || 0) + 1;
    }
    return m;
  }

  function dice(a, b) {
    var shared = 0, total = 0, k;
    for (k in a) { total += a[k]; if (b[k]) shared += Math.min(a[k], b[k]); }
    for (k in b) total += b[k];
    return total ? (2 * shared) / total : 0;
  }

  function bestApprox(hay, term) {
    if (term.length < 3 || hay.length < term.length) return null;
    var grams = bigrams(term);
    var best = { score: 0 };
    for (var len = term.length; len <= Math.min(term.length + 2, hay.length); len++) {
      for (var i = 0; i + len <= hay.length; i++) {
        var s = dice(grams, bigrams(hay.substr(i, len)));
        if (s > best.score) best = { score: s, start: i, end: i + len };
      }
    }
    return best.score > 0 ? best : null;
  }

  function search(rawQuery) {
    var terms = rawQuery.split(/\s+/).map(function (t) { return normalize(t).n; }).filter(Boolean);
    if (!terms.length) return { terms: [], hits: [], exact: 0, approx: 0 };

    var hits = [];
    var used = Object.create(null);

    for (var i = 0; i < total; i++) {
      var spans = [];
      var first = Infinity;
      var ok = true;
      for (var t = 0; t < terms.length; t++) {
        var found = findAll(blocks[i].n, terms[t]);
        if (!found.length) { ok = false; break; }
        spans = spans.concat(found);
        if (found[0][0] < first) first = found[0][0];
      }
      if (!ok) continue;
      used[i] = true;
      // 命中越靠前（越接近条文开头）越靠前展示；标题行额外加权。
      var score = 1000 + terms.length * 8 + (60 - Math.min(60, first));
      if ((RE_ARTICLE.test(paras[i]) || RE_CHAPTER.test(paras[i])) && first < 24) score += 60;
      hits.push({ i: i, spans: spans, score: score, approx: false });
    }

    var exact = hits.length;
    var approx = 0;

    if (exact < 3 && terms.length) {
      var longest = terms.reduce(function (a, b) { return b.length > a.length ? b : a; }, "");
      var fuzzy = [];
      for (var j = 0; j < total; j++) {
        if (used[j]) continue;
        var best = bestApprox(blocks[j].n, longest);
        if (!best || best.score < 0.45) continue;
        fuzzy.push({ i: j, spans: [[best.start, best.end]], score: best.score * 100, approx: true });
      }
      fuzzy.sort(function (a, b) { return b.score - a.score; });
      fuzzy = fuzzy.slice(0, 8);
      approx = fuzzy.length;
      hits = hits.concat(fuzzy);
    }

    hits.sort(function (a, b) { return b.score !== a.score ? b.score - a.score : a.i - b.i; });
    return { terms: terms, hits: hits, exact: exact, approx: approx };
  }

  /* ------------------------------------------------------------ 高亮 */
  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function spansToRanges(i, spans, from, to) {
    var block = blocks[i];
    var ranges = [];
    spans.forEach(function (s) {
      var a = block.map[s[0]];
      var b = block.map[s[1] - 1];
      if (a === undefined || b === undefined) return;
      var start = Math.max(a, from);
      var end = Math.min(b + 1, to);
      if (end > start) ranges.push([start, end]);
    });
    ranges.sort(function (x, y) { return x[0] - y[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    return merged;
  }

  function markup(i, ranges, from, to, cls) {
    cls = cls || "strong";
    var text = paras[i];
    var html = "";
    var cursor = from;
    ranges.forEach(function (r) {
      html += escapeHtml(text.slice(cursor, r[0])) +
        '<mark class="' + cls + '">' + escapeHtml(text.slice(r[0], r[1])) + "</mark>";
      cursor = r[1];
    });
    return html + escapeHtml(text.slice(cursor, to));
  }

  function snippet(i, spans, width, cls) {
    var anchor = blocks[i].map[spans[0][0]];
    if (anchor === undefined) anchor = 0;
    var from = Math.max(0, anchor - Math.floor(width * 0.32));
    var to = Math.min(paras[i].length, from + width);
    var head = from > 0 ? '<span class="lead">…</span>' : "";
    var tail = to < paras[i].length ? '<span class="lead">…</span>' : "";
    return head + markup(i, spansToRanges(i, spans, from, to), from, to, cls) + tail;
  }

  /* ------------------------------------------------------------ 正文渲染 */
  function toolsHtml(i) {
    return '<span class="para-tools">' +
      '<button class="tool" data-mark="' + i + '">书签</button>' +
      '<button class="tool" data-copy="' + i + '">复制</button>' +
      "</span>";
  }

  var chapterStarts = Object.create(null);
  (data.chapters || []).forEach(function (p) { chapterStarts[p[0]] = true; });

  var docStartMap = Object.create(null);
  docStarts.forEach(function (i) { docStartMap[i] = true; });

  function paraClass(i) {
    var cls = "para";
    if (docStartMap[i]) cls += " is-doc";
    else if (chapterStarts[i]) cls += " is-chapter";
    if (RE_ARTICLE.test(paras[i])) cls += " is-article";
    return cls;
  }

  function tableHtml(table, index) {
    var head = table.head.map(function (h) { return "<th>" + escapeHtml(h) + "</th>"; }).join("");
    var rows = table.rows.map(function (r, n) {
      var prev = n > 0 ? table.rows[n - 1][0] : null;
      var cells = r.map(function (c, cIdx) {
        var cls = cIdx === 0 ? ' class="cat"' : (cIdx === 3 ? ' class="score"' : "");
        var value = (cIdx === 0 && c === prev) ? "" : escapeHtml(c);
        return "<td" + cls + ">" + value + "</td>";
      }).join("");
      return "<tr>" + cells + "</tr>";
    }).join("");
    return '<figure class="table-block" id="p' + index + '">' +
      (table.caption ? "<figcaption>" + escapeHtml(table.caption) + "</figcaption>" : "") +
      "<table><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></figure>";
  }

  function renderDoc() {
    var html = [];
    for (var i = 0; i < total; i++) {
      if (tables[String(i)]) { html.push(tableHtml(tables[String(i)], i)); continue; }
      var tag = supplementStarts[i]
        ? '<span class="doc-tag">补充录入</span>'
        : "";
      html.push('<p class="' + paraClass(i) + '" id="p' + i + '">' +
        escapeHtml(paras[i]) + tag + toolsHtml(i) + "</p>");
    }
    el.doc.innerHTML = html.join("");
  }

  function clearHighlights() {
    el.doc.querySelectorAll("mark").forEach(function (m) {
      var parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }

  function highlightResult(result) {
    clearHighlights();
    var map = Object.create(null);
    result.hits.forEach(function (hit) {
      if (!map[hit.i]) map[hit.i] = { spans: [], cls: "strong" };
      map[hit.i].spans = map[hit.i].spans.concat(hit.spans);
      if (hit.approx) map[hit.i].cls = "approx";
    });
    Object.keys(map).forEach(function (key) {
      var i = Number(key);
      var node = document.getElementById("p" + i);
      if (!node) return;
      node.innerHTML = markup(i, spansToRanges(i, map[i].spans, 0, paras[i].length), 0, paras[i].length, map[i].cls) +
        toolsHtml(i);
    });
    refreshMarkButtons();
  }

  /* ------------------------------------------------------------ 跳转 */
  var lastTarget = null;

  function jumpTo(i) {
    var node = document.getElementById("p" + i);
    if (!node) return;
    if (lastTarget) lastTarget.classList.remove("is-target");
    node.classList.add("is-target");
    lastTarget = node;
    node.scrollIntoView({ block: "center" });
    setActiveToc(i);
    updateWhere(i);
  }

  /* ------------------------------------------------------------ 目录 */
  function renderToc() {
    el.paneToc.innerHTML = toc.map(function (group, gi) {
      var children = group.children.map(function (node) {
        if (node.p !== undefined && node.p !== null) {
          return '<button class="toc-item" data-jump="' + node.p + '">' + escapeHtml(node.t) +
            (node.s ? '<span class="toc-note">补充</span>' : "") + "</button>";
        }
        return '<button class="toc-item" data-query="' + escapeHtml(node.q || node.t) + '">' +
          escapeHtml(node.t) + "<span class='toc-note'>（正文缺失）</span></button>";
      }).join("");
      return '<details class="toc-group"' + (gi === 0 ? " open" : "") + ">" +
        "<summary>" + escapeHtml(group.t) + "</summary>" + children + "</details>";
    }).join("");
  }

  function setActiveToc(i) {
    var items = el.paneToc.querySelectorAll(".toc-item[data-jump]");
    var best = null;
    items.forEach(function (item) {
      if (Number(item.dataset.jump) <= i) best = item;
    });
    items.forEach(function (item) { item.classList.remove("is-active"); });
    if (best) {
      best.classList.add("is-active");
      var group = best.closest("details");
      if (group) group.open = true;
    }
  }

  /* ------------------------------------------------------------ 书签 */
  var marks = loadMarks();
  var popoverTarget = null;
  var INTRO_KEY = "ahdx.handbook.intro.v1";

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  function loadMarks() {
    var raw;
    try { raw = JSON.parse(window.localStorage.getItem(MARK_KEY) || "[]"); } catch (e) { raw = []; }
    if (!Array.isArray(raw)) raw = [];
    // 数据重建后段落号可能位移，用正文前缀重新定位。
    return raw.filter(function (m) { return m && typeof m.p === "number"; }).map(function (m) {
      var fp = m.fp || "";
      if (!fp || (paras[m.p] || "").indexOf(fp) === 0) return m;
      for (var i = 0; i < total; i++) {
        if (paras[i].indexOf(fp) === 0) { m.p = i; break; }
      }
      return m;
    });
  }

  function saveMarks() {
    storageSet(MARK_KEY, JSON.stringify(marks));
  }

  function markFor(i) {
    return marks.filter(function (m) { return m.p === i; })[0] || null;
  }

  function addMark(i, name) {
    marks.push({
      id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name,
      p: i,
      fp: paras[i].slice(0, 30),
      ts: Date.now()
    });
    saveMarks();
    renderMarks();
    refreshMarkButtons();
  }

  function renderMarks() {
    el.markCount.hidden = !marks.length;
    el.markCount.textContent = marks.length;

    var tools =
      '<div class="marks-tools">' +
      '<button class="btn tiny" id="marks-export">导出备份</button>' +
      '<button class="btn tiny" id="marks-import">导入备份</button>' +
      "</div>" +
      '<p class="marks-hint">书签只存在这台设备的浏览器里：清理浏览器数据、换设备、用无痕模式都会丢失。' +
      "重要的书签建议点「导出备份」，把得到的那段文字存进备忘录或发给自己。</p>";

    if (!marks.length) {
      el.paneMarks.innerHTML = '<p class="marks-empty">还没有书签。<br>' +
        "点一下正文任意一段，会出现「书签」，就能给这个位置起个自己的名字，之后从这里一键跳回。</p>" + tools;
    } else {
      el.paneMarks.innerHTML = marks.slice().sort(function (a, b) { return a.p - b.p; }).map(function (m) {
        return '<div class="mark" data-id="' + m.id + '">' +
          '<button class="mark-name" data-goto="' + m.p + '">' + escapeHtml(m.name) + "</button>" +
          '<span class="mark-actions">' +
          '<button class="icon-btn" data-rename="' + m.id + '">改名</button>' +
          '<button class="icon-btn danger" data-del="' + m.id + '">删除</button>' +
          "</span>" +
          '<span class="mark-where">' + escapeHtml(whereText(m.p)) + "</span>" +
          "</div>";
      }).join("") + tools;
    }
  }

  var BACKUP_PREFIX = "AHDX1.";

  function toBase64(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function fromBase64(code) {
    var binary = atob(code);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  var backupMode = "import";

  function buildBackupCode() {
    var payload = marks.map(function (m) {
      return { n: m.name, p: m.p, f: m.fp };
    });
    return BACKUP_PREFIX + toBase64(JSON.stringify(payload));
  }

  function openBackup(mode) {
    if (mode === "export" && !marks.length) { toast("还没有书签可备份"); return; }
    backupMode = mode;
    var isExport = mode === "export";

    el.backupTitle.textContent = isExport ? "书签备份" : "导入书签备份";
    el.backupSub.textContent = isExport
      ? "这段文字就是你的全部书签。复制它存进备忘录或发给自己发一份，以后换了设备、清了浏览器数据，粘回来就能恢复。"
      : "把之前备份的那段文字整个粘到下面（以 AHDX1. 开头），点「导入」恢复。";
    el.backupText.value = isExport ? buildBackupCode() : "";
    el.backupText.readOnly = isExport;
    el.backupText.placeholder = isExport ? "" : "在这里粘贴备份内容";
    el.backupDo.textContent = isExport ? "复制" : "导入";
    el.backupCancel.textContent = isExport ? "关闭" : "取消";

    el.backup.hidden = false;
    document.body.classList.add("intro-open");
    el.backupText.focus();
    if (isExport) el.backupText.select();
  }

  function closeBackup() {
    el.backup.hidden = true;
    document.body.classList.remove("intro-open");
  }

  function importMarks() {
    var raw = el.backupText.value.replace(/\s+/g, "");
    if (!raw) { toast("先粘贴备份内容"); return; }
    var json = null;
    try {
      json = raw.indexOf(BACKUP_PREFIX) === 0 ? fromBase64(raw.slice(BACKUP_PREFIX.length)) : raw;
    } catch (e) {
      toast("这段备份读不出来，请检查是否粘全");
      return;
    }
    var list;
    try { list = JSON.parse(json); } catch (e) { toast("这段备份读不出来，请检查是否粘全"); return; }
    if (!Array.isArray(list)) { toast("这段备份格式不对"); return; }

    var added = 0;
    list.forEach(function (item) {
      if (!item || typeof item.p !== "number" || !item.n) return;
      var fp = item.f || (paras[item.p] || "").slice(0, 30);
      var dup = marks.some(function (m) { return m.fp === fp && m.name === item.n; });
      if (dup) return;
      marks.push({
        id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: String(item.n).slice(0, 40),
        p: item.p,
        fp: fp,
        ts: Date.now()
      });
      added++;
    });
    saveMarks();
    renderMarks();
    refreshMarkButtons();
    closeBackup();
    toast(added ? "已导入 " + added + " 条书签" : "没有新的书签可导入");
  }

  function backupPrimary() {
    if (backupMode === "export") {
      copyText(el.backupText.value, "已复制，存到备忘录或发给自己");
      el.backupText.select();
      return;
    }
    importMarks();
  }

  function refreshMarkButtons() {
    el.doc.querySelectorAll(".tool[data-mark]").forEach(function (btn) {
      var i = Number(btn.dataset.mark);
      btn.classList.toggle("on", !!markFor(i));
      btn.textContent = markFor(i) ? "已加书签" : "书签";
    });
  }

  function openPopover(anchorEl, i) {
    popoverTarget = i;
    el.popoverWhere.textContent = whereText(i);
    el.popoverInput.value = (artOf[i] || docOf[i] || paras[i].slice(0, 12));
    el.popover.hidden = false;
    var rect = anchorEl.getBoundingClientRect();
    var width = el.popover.offsetWidth;
    var left = Math.min(Math.max(12, rect.left - width + rect.width), window.innerWidth - width - 12);
    var top = rect.bottom + 8;
    if (top + el.popover.offsetHeight > window.innerHeight - 12) {
      top = Math.max(72, rect.top - el.popover.offsetHeight - 8);
    }
    el.popover.style.left = left + "px";
    el.popover.style.top = top + "px";
    el.popoverInput.focus();
    el.popoverInput.select();
  }

  function closePopover() {
    el.popover.hidden = true;
    popoverTarget = null;
  }

  /* ------------------------------------------------------------ 检索界面 */
  var currentResult = null;
  var focusedHit = -1;

  function renderHits(query, result) {
    if (!query) { el.hits.hidden = true; el.count.hidden = true; return; }
    el.count.hidden = false;
    el.count.textContent = result.exact + " 处";

    if (!result.hits.length) {
      el.hits.hidden = false;
      el.hits.innerHTML = '<div class="hits-empty">没有找到 <b>' + escapeHtml(query) + "</b>。<br>" +
        "试试更短的关键词，比如查「转专业」而不是「转专业要什么条件」。</div>";
      return;
    }

    var shown = result.hits.slice(0, 60);
    var head = "找到 <b>" + result.exact + "</b> 处" +
      (result.approx ? "（另有 " + result.approx + " 处近似匹配）" : "") +
      (result.hits.length > shown.length ? "，先显示前 " + shown.length + " 处" : "");

    el.hits.innerHTML = '<div class="hits-head"><span>' + head + "</span>" +
      "<span>↑↓ 选择 · Enter 跳转</span></div>" +
      shown.map(function (hit) {
        return '<button class="hit" data-jump="' + hit.i + '">' +
          '<span class="hit-where"><span class="chip">' + escapeHtml(docOf[hit.i] || "正文") + "</span>" +
          '<span class="chip soft">' + escapeHtml(artOf[hit.i] || chapOf[hit.i] || "第 " + (hit.i + 1) + " 段") + "</span>" +
          (hit.approx ? '<span class="chip soft">近似</span>' : "") +
          "</span>" +
          '<span class="hit-text">' + snippet(hit.i, hit.spans, 120, hit.approx ? "approx" : "strong") + "</span>" +
          "</button>";
      }).join("");
    el.hits.hidden = false;
    focusedHit = -1;
  }

  function runSearch() {
    var query = el.q.value.trim();
    el.clear.hidden = !query;
    if (!query) {
      currentResult = null;
      el.hits.hidden = true;
      el.count.hidden = true;
      clearHighlights();
      return;
    }
    currentResult = search(query);
    renderHits(query, currentResult);
    highlightResult(currentResult);
  }

  function focusHit(step) {
    var hits = Array.prototype.slice.call(el.hits.querySelectorAll(".hit"));
    if (!hits.length) return;
    focusedHit = focusedHit < 0
      ? (step > 0 ? 0 : hits.length - 1)
      : (focusedHit + step + hits.length) % hits.length;
    hits.forEach(function (h) { h.classList.remove("is-focused"); });
    var node = hits[focusedHit];
    if (!node) return;
    node.classList.add("is-focused");
    node.scrollIntoView({ block: "nearest" });
  }

  /* ------------------------------------------------------------ 位置提示 */
  var ticking = false;
  var offsets = [];

  function measure() {
    offsets = new Array(total);
    var last = 0;
    for (var i = 0; i < total; i++) {
      var node = document.getElementById("p" + i);
      if (node) last = node.offsetTop;
      offsets[i] = last;
    }
  }

  function updateWhere(i) {
    if (i === undefined || i === null) return;
    el.whereText.textContent = whereText(i);
    el.where.hidden = false;
  }

  function currentIndex() {
    if (!offsets.length) return 0;
    var top = window.scrollY + 150;
    var lo = 0, hi = offsets.length - 1, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (offsets[mid] <= top) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    // 刚跳到某一段时，滚动位置可能略高于它，这里以跳转目标为准。
    if (lastTarget) {
      var target = Number(lastTarget.id.slice(1));
      if (target > best && lastTarget.getBoundingClientRect().top < window.innerHeight * 0.6) {
        best = target;
      }
    }
    return best;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      el.toTop.hidden = window.scrollY < 400;
      var i = currentIndex();
      updateWhere(i);
      setActiveToc(i);
    });
  }

  /* ------------------------------------------------------------ 事件 */
  var debounce = null;
  el.q.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 130);
  });

  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    runSearch();
    var first = el.hits.querySelector(".hit");
    if (first) jumpTo(Number(first.dataset.jump));
  });

  el.clear.addEventListener("click", function () {
    el.q.value = "";
    runSearch();
    el.q.focus();
  });

  el.hits.addEventListener("click", function (e) {
    var hit = e.target.closest(".hit");
    if (!hit) return;
    jumpTo(Number(hit.dataset.jump));
    el.hits.hidden = true;
  });

  el.paneToc.addEventListener("click", function (e) {
    var item = e.target.closest(".toc-item");
    if (!item) return;
    if (item.dataset.jump !== undefined) {
      jumpTo(Number(item.dataset.jump));
    } else if (item.dataset.query) {
      el.q.value = item.dataset.query;
      runSearch();
      var first = el.hits.querySelector(".hit");
      if (first) jumpTo(Number(first.dataset.jump));
    }
    closeNav();
  });

  el.paneMarks.addEventListener("click", function (e) {
    if (e.target.closest("#marks-export")) { openBackup("export"); closeNav(); return; }
    if (e.target.closest("#marks-import")) { openBackup(); closeNav(); return; }

    var goto = e.target.closest("[data-goto]");
    if (goto) { jumpTo(Number(goto.dataset.goto)); closeNav(); return; }

    var rename = e.target.closest("[data-rename]");
    if (rename) {
      var row = rename.closest(".mark");
      var current = marks.filter(function (m) { return m.id === rename.dataset.rename; })[0];
      if (!current) return;
      var nameNode = row.querySelector(".mark-name");
      var input = document.createElement("input");
      input.className = "mark-input";
      input.value = current.name;
      input.maxLength = 40;
      nameNode.replaceWith(input);
      input.focus();
      input.select();
      var commit = function () {
        var value = input.value.trim();
        if (value) { current.name = value; saveMarks(); }
        renderMarks();
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
        if (ev.key === "Escape") { input.value = current.name; input.blur(); }
      });
      return;
    }

    var del = e.target.closest("[data-del]");
    if (del) {
      marks = marks.filter(function (m) { return m.id !== del.dataset.del; });
      saveMarks();
      renderMarks();
      refreshMarkButtons();
    }
  });

  el.doc.addEventListener("click", function (e) {
    var markBtn = e.target.closest("[data-mark]");
    if (markBtn) {
      var i = Number(markBtn.dataset.mark);
      var existing = markFor(i);
      if (existing) { switchTab("marks"); closeNav(); return; }
      openPopover(markBtn, i);
      return;
    }
    var copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      var idx = Number(copyBtn.dataset.copy);
      copyText(whereText(idx) + "\n" + paras[idx]);
      return;
    }

    // 触屏没有悬停：点一下段落，这一段的操作按钮才出现，点别处收起。
    var para = e.target.closest(".para");
    var wasOpen = para && para.classList.contains("is-open");
    closeParaTools();
    if (para && !wasOpen) para.classList.add("is-open");
  });

  function closeParaTools() {
    el.doc.querySelectorAll(".para.is-open").forEach(function (node) {
      node.classList.remove("is-open");
    });
  }

  /* ---------------------------------------------------------- 使用说明 */
  function showIntro() {
    el.intro.hidden = false;
    document.body.classList.add("intro-open");
    if (el.introStart) el.introStart.focus();
  }

  function hideIntro() {
    if (el.intro.hidden) return;
    el.intro.hidden = true;
    document.body.classList.remove("intro-open");
    storageSet(INTRO_KEY, "1");   // 记住已看过，下次进站不再自动弹出
  }

  el.help.addEventListener("click", showIntro);
  el.introX.addEventListener("click", hideIntro);
  el.introStart.addEventListener("click", hideIntro);
  el.intro.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-intro-close")) hideIntro();
  });

  el.backupX.addEventListener("click", closeBackup);
  el.backupCancel.addEventListener("click", closeBackup);
  el.backupScrim.addEventListener("click", closeBackup);
  el.backupDo.addEventListener("click", backupPrimary);

  el.popoverSave.addEventListener("click", function () {
    if (popoverTarget === null) return;
    var name = el.popoverInput.value.trim() || whereText(popoverTarget);
    addMark(popoverTarget, name);
    closePopover();
    toast("已加书签");
  });

  el.popoverCancel.addEventListener("click", closePopover);

  el.popoverInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); el.popoverSave.click(); }
    if (e.key === "Escape") closePopover();
  });

  document.addEventListener("click", function (e) {
    if (!el.popover.hidden && !el.popover.contains(e.target) && !e.target.closest("[data-mark]")) closePopover();
    if (!el.hits.hidden && !el.hits.contains(e.target) && !el.form.contains(e.target)) el.hits.hidden = true;
    if (!e.target.closest(".para")) closeParaTools();
  });

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () { switchTab(tab.dataset.tab); });
  });

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(function (tab) {
      var on = tab.dataset.tab === name;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
    });
    el.paneToc.hidden = name !== "toc";
    el.paneMarks.hidden = name !== "marks";
  }

  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault(); el.q.focus(); el.q.select(); return;
    }
    if (e.key === "/" && !typing) { e.preventDefault(); el.q.focus(); return; }
    if (e.key === "Escape") {
      if (!el.intro.hidden) { hideIntro(); return; }
      if (!el.backup.hidden) { closeBackup(); return; }
      if (!el.popover.hidden) { closePopover(); return; }
      if (document.body.classList.contains("nav-open")) { closeNav(); return; }
      if (el.q.value) { el.q.value = ""; runSearch(); return; }
      if (!el.hits.hidden) el.hits.hidden = true;
      closeParaTools();
      return;
    }
    if (e.key === "ArrowDown" && document.activeElement === el.q) { e.preventDefault(); focusHit(1); return; }
    if (e.key === "ArrowUp" && document.activeElement === el.q) { e.preventDefault(); focusHit(-1); return; }
    if (e.key === "Enter" && document.activeElement === el.q) {
      var focused = el.hits.querySelector(".hit.is-focused") || el.hits.querySelector(".hit");
      if (focused) { e.preventDefault(); jumpTo(Number(focused.dataset.jump)); el.hits.hidden = true; }
    }
  });

  el.menu.addEventListener("click", function () {
    var open = document.body.classList.toggle("nav-open");
    el.menu.setAttribute("aria-expanded", String(open));
    el.scrim.hidden = !open;
  });

  el.scrim.addEventListener("click", closeNav);

  function closeNav() {
    document.body.classList.remove("nav-open");
    el.menu.setAttribute("aria-expanded", "false");
    el.scrim.hidden = true;
  }

  el.toTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () { measure(); onScroll(); });

  function copyText(text, message) {
    var done = function () { toast(message || "已复制"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); done(); } catch (err) { /* 忽略 */ }
    document.body.removeChild(area);
  }

  var toastTimer = null;
  function toast(message) {
    var node = document.querySelector(".toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "toast";
      document.body.appendChild(node);
    }
    node.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.remove(); }, 1600);
  }

  /* ------------------------------------------------------------ 启动 */
  var meta = data.meta || {};
  el.meta.textContent = "共 " + total + " 段 · 约 " +
    (Math.round((meta.chars || 0) / 1000) / 10).toFixed(1) + " 万字 · " +
    (toc.reduce(function (n, g) { return n + g.children.length; }, 0)) + " 个目录条目";

  el.footnote.textContent =
    "内容按原文顺序完整呈现，共 " + total + " 段、" +
    (Math.round((meta.chars || 0) / 1000) / 10).toFixed(1) + " 万字；其中 " +
    (meta.supplements || 0) + " 份文件由补充材料录入（标注见目录）。" +
    "原始 Word 为扫描识别稿，个别字词可能存在识别误差，正式引用请以印发版本为准。";

  renderToc();
  renderDoc();
  renderMarks();
  refreshMarkButtons();
  measure();
  updateWhere(0);

  // 第一次进来先看使用说明；关掉后记住，之后点右上角「?」随时再看。
  if (!storageGet(INTRO_KEY)) showIntro();

  if (window.location.hash) {
    var m = /^#p(\d+)$/.exec(window.location.hash);
    if (m) jumpTo(Number(m[1]));
  }

  window.addEventListener("load", measure);
})();
