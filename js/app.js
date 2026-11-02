(function () {
	var SPEEDS = [1, 2, 4, 8, 15, 30, 60, 120, 300, 1000, 3000];
	var MAX_REPLAY = 20000000;
	function $(id) { return document.getElementById(id); }
	var eng, N = 0, CL = [], mode = "idle";
	var LOG_SHOW = 200, logKey = "", logStick = true;
	var log = [], meta = [], cells = [], rows = [];
	var raf = 0, playLast = 0, playAcc = 0, ffTimer = 0, ffStopDead = false;
	var lastRender = 0;
	var LOG_CAP = 100000, saving = false, epoch = 0;
	var empty = true, ffTarget = 0, ffOrigin = 0;
	var TR = null, traceName = "", MAX_FILE = 64 * 1024 * 1024;
	/* A trace that says "solved" but leaves a board that breaks the rules or the clues. */
	function badFinish(s) { return s.status === "solved" && !!TR && !!TR.verdict; }
	function verdictText() { return TR.verdict.replace(/\.$/, "").replace(/^./, function (c) { return c.toLowerCase(); }); }
	function mk() { return makeEngine(N, CL, TR); }
	function emeta() { return engineMeta(N); }

	function fmt(x) { return Math.round(x).toLocaleString("en-US"); }
	/* Complete grids where every row and column holds each height once (Latin squares), for sizes 1 to 9. */
	var GRIDS_TEXT = ["1", "2", "12", "576", "161,280", "812,851,200", "61,479,419,904,000", "108,776,032,459,082,956,800", "5,524,751,496,156,892,842,531,225,600"];
	function searchSpace(n) {
		return n + "\u00d7" + n + ": " + GRIDS_TEXT[n - 1] + (n === 1 ? " possible complete grid" : " possible complete grids");
	}


	/* ---------- board ---------- */
	function buildBoard() {
		var b = $("board"), cols = N + 2;
		b.innerHTML = ""; cells = []; meta = [];
		b.style.setProperty("--cols", cols);
		for (var r = 0; r < cols; r++) {
			for (var c = 0; c < cols; c++) {
				var d = document.createElement("div");
				var m = { kind: "corner" };
				var inR = r > 0 && r < cols - 1, inC = c > 0 && c < cols - 1;
				if (inR && inC) m = { kind: "in", r: r - 1, c: c - 1 };
				else if (r === 0 && inC) m = { kind: "clue", line: c - 1, isCol: true, dir: 0 };
				else if (r === cols - 1 && inC) m = { kind: "clue", line: c - 1, isCol: true, dir: 1 };
				else if (c === 0 && inR) m = { kind: "clue", line: r - 1, isCol: false, dir: 0 };
				else if (c === cols - 1 && inR) m = { kind: "clue", line: r - 1, isCol: false, dir: 1 };
				d.className = "cell";
				if (m.kind === "clue") {
					m.idx = clueIndex(m.line, m.isCol, m.dir);
					d.textContent = empty ? "" : CL[m.idx];
					d.className = "cell clue";
				}
				b.appendChild(d); cells.push(d); meta.push(m);
			}
		}
	}
	function clueIndex(line, isCol, dir) {
		if (isCol) return dir ? N + line : line;
		return dir ? 3 * N + line : 2 * N + line;
	}

	function buildTable() {
		var meta = emeta();
		$("by-h0").textContent = meta.group.header;
		$("by-caption").textContent = meta.group.caption;
		var body = $("by-body"); body.innerHTML = ""; rows = [];
		for (var q = 0; q < meta.group.keys.length; q++) {
			var v = meta.group.keys[q];
			var tr = document.createElement("tr");
			tr.innerHTML = '<td class="num">' + meta.group.prefix + v + '</td><td></td><td class="share"><div class="bar"><i></i></div></td><td></td><td></td><td></td><td></td>';
			body.appendChild(tr);
			rows.push({ v: v, bar: tr.querySelector(".bar i"), t: tr.children });
		}
		buildDepthTable();
	}
	var drows = [], activeTab = "puz", brkView = "num";
	var TABS = ["puz", "sim", "stats", "brk"];
	function selectTab(name, focus) {
		activeTab = name;
		for (var i = 0; i < TABS.length; i++) {
			var on = TABS[i] === name;
			$("tab-" + TABS[i]).setAttribute("aria-selected", on ? "true" : "false");
			$("tab-" + TABS[i]).tabIndex = on ? 0 : -1;
			$("panel-" + TABS[i]).hidden = !on;
		}
		if (focus) $("tab-" + name).focus();
		if (eng) render();
	}
	function depthLabel(d) {
		return "Placement " + (d + 1);
	}
	function buildDepthTable() {
		var body = $("depth-body"), total = N * N, h = [];
		drows = [];
		for (var d = 0; d < total; d++) {
			h.push('<tr><td class="num">' + (d + 1) + '</td><td>' + depthLabel(d) + '</td><td></td><td class="share"><div class="bar"><i></i></div></td><td></td><td></td><td></td><td></td></tr>');
		}
		body.innerHTML = h.join("");
		var trs = body.children;
		for (var q = 0; q < trs.length; q++) drows.push({ tr: trs[q], bar: trs[q].querySelector(".bar i"), t: trs[q].children });
	}
	function renderDepth(s) {
		if (activeTab !== "brk" || brkView !== "depth") return;
		var total = N * N, b = s.by, maxC = 1, d;
		for (d = 0; d < total; d++) if (b.dcalls[d] > maxC) maxC = b.dcalls[d];
		for (d = 0; d < total; d++) {
			var r = drows[d], tried = b.dacc[d] + b.drej[d], blank = s.steps === 0;
			r.t[2].textContent = blank ? "\u2014" : fmt(b.dcalls[d]);
			r.bar.style.width = (b.dcalls[d] / maxC * 100).toFixed(1) + "%";
			r.t[4].textContent = blank ? "\u2014" : fmt(b.dacc[d]);
			r.t[5].textContent = blank ? "\u2014" : fmt(b.drej[d]);
			r.t[6].textContent = tried ? (b.dacc[d] / tried * 100).toFixed(1) + "%" : "\u2014";
			r.t[7].textContent = blank ? "\u2014" : fmt(b.ddead[d]);
			r.tr.className = !s.done && !empty && d === s.d ? "now" : "";
		}
	}
	/* The depth-over-time strip under the board. */
	function renderTrace(s) {
		var tr = eng.trace(), W = 600, H = 72, total = N * N, steps = Math.max(1, s.steps);
		function Y(v) { return (H - 3 - (v / total) * (H - 6)).toFixed(1); }
		function X(st) { return (st / steps * W).toFixed(1); }
		var nb = tr.n + (tr.curCnt > 0 ? 1 : 0), up = [], lo = [], avg = [], i, svg = "";
		var md = s.maxD;
		for (i = 0; i < nb; i++) {
			var part = i >= tr.n;
			var mn = part ? tr.curMin : tr.min[i], mx = part ? tr.curMax : tr.max[i];
			var cnt = part ? tr.curCnt : tr.size;
			var av = (part ? tr.curSum : tr.sum[i]) / cnt;
			var x0 = i * tr.size, x1 = Math.min((i + 1) * tr.size, steps), xc = X((x0 + x1) / 2);
			up.push(xc + "," + Y(mx)); lo.push(xc + "," + Y(mn)); avg.push(xc + "," + Y(av));
		}
		if (tr.bestLen > 0) {
			var cx0 = +X(tr.bestStart), cw = Math.max(2, +X(tr.bestEnd) - cx0);
			svg += '<rect x="' + cx0 + '" y="0" width="' + cw.toFixed(1) + '" height="' + H + '" style="fill:var(--undo-soft)"><title>Longest climb back: ' + fmt(tr.bestLen) + ' placements undone in a row, steps ' + fmt(tr.bestStart) + " to " + fmt(tr.bestEnd) + "</title></rect>";
		}
		if (md > 0) svg += '<line x1="0" x2="' + W + '" y1="' + Y(md) + '" y2="' + Y(md) + '" stroke-dasharray="4 4" style="stroke:var(--muted)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
		/* Slices of more than one step: a soft band from the lowest to the highest depth in the slice, with the average depth as the line. */
		if (nb && tr.size > 1) svg += '<polygon points="' + up.join(" ") + " " + lo.slice().reverse().join(" ") + '" style="fill:var(--accent);fill-opacity:0.22;stroke:none"/>';
		if (nb) svg += '<polyline points="' + avg.join(" ") + '" fill="none" style="stroke:var(--accent)" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
		$("trace").innerHTML = svg;
		$("trace-end").textContent = empty ? "" : "step " + fmt(s.steps);
		$("trace-key").textContent = empty || tr.size < 2 ? "" : "line: average \u00b7 band: lowest to highest";
		$("trace-note").textContent = empty || !s.steps ? "" : "deepest " + md + " of " + total + (tr.bestLen ? " \u00b7 longest climb back " + fmt(tr.bestLen) : "");
	}
	function buildRules() {
		$("ts-acc").textContent = "Placed and kept: your solver went on to build from it.";
		$("ts-rej").textContent = "Placed and taken out again at once.";
		$("ts-dead").textContent = "Nothing left to try at this point, worked out from your trace. Each one makes the solver undo the placement before it.";
	}
	function updateOptNote() {
		if (!TR) { $("opt-note").textContent = ""; return; }
		$("opt-note").textContent = "Replaying " + (traceName || "your trace") + ". Nothing is solved here: every placement and removal comes from your file.";
	}

	function describeTrace(s, t, L, rc) {
		if (t === 1) {
			if (s.done && s.status === "solved") return "Placed " + L.num + " at " + rc + ". Last cell filled: solved.";
			return "Placed " + L.num + " at " + rc + ".";
		}
		if (t === 2) {
			return "Rejected " + L.num + " at " + rc + ". Your solver took it out again at once.";
		}
		if (t === 3) {
			return "Dead end: your solver had nothing more to try here." +
				(s.status === "nosolution" ? " Nothing left to undo, so there is no solution." : " Backing up.");
		}
		return "Undone: " + L.num + " removed from " + rc + ".";
	}
	function describe(s, t) {
		var L = s.last, rc = "row " + (L.r + 1) + ", column " + (L.c + 1);
		return describeTrace(s, t, L, rc);
	}
	var GLYPH = { 1: "✓", 2: "✕", 3: "⊘", 4: "↶" };
	function pushLog(t) {
		if (!t) return;
		var s = eng.stats();
		log.push({ n: s.steps, t: t, snap: s });
		if (log.length > LOG_SHOW) log.shift();
	}

	/* ---------- render ---------- */
	function render() {
		lastRender = performance.now();
		var s = eng.stats(), g = eng.grid, L = s.last;
		var total = N * N;
		for (var i = 0; i < cells.length; i++) {
			var m = meta[i], el = cells[i];
			if (m.kind === "in") {
				var v = g[m.r * N + m.c], cls2 = "cell in", txt = v ? String(v) : "";
				var isLast = L.type && L.r === m.r && L.c === m.c && (L.type !== 3);
				if (isLast) {
					if (L.type === 1) cls2 += " evok";
					else if (L.type === 2) { cls2 += " evrej"; if (!v) { cls2 += " ghost"; txt = String(L.num); } }
					else if (L.type === 4) { cls2 += " evundo"; if (!v) { cls2 += " ghost"; txt = String(L.num); } }
				}
				if (el.className !== cls2) el.className = cls2;
				if (el.textContent !== txt) el.textContent = txt;
				el.style.setProperty("--h", v ? (v / N).toFixed(3) : "0");
			}
		}
		$("board").classList.toggle("solved", s.status === "solved" && !badFinish(s));
		$("board").classList.toggle("invalid", badFinish(s));
		// status
		var st;
		if (empty) st = "No puzzle loaded";
		else if (s.status === "cut") st = (TR.truncated ? "Showing the first part of a longer run" : "The trace ends here") + " \u00b7 " + fmt(s.steps) + " steps";
		else if (badFinish(s)) st = "Trace says solved, but " + verdictText() + " \u00b7 " + fmt(s.steps) + " steps";
		else if (s.status === "solved") st = "Solved in " + fmt(s.steps) + " steps";
		else if (s.status === "nosolution") st = "No solution, found after " + fmt(s.steps) + " steps";
		else if (mode === "ff") st = "Fast-forwarding…";
		else st = "Replaying your solver \u00b7 " + s.d + " of " + total + " standing" + (s.pendingUndo ? " (backing up)" : "");
		if (!empty && s.done) st += " (" + fmt(TR.count) + " events in your file)";
		$("status").textContent = st;
		$("rate").textContent = "";
		// counters
		$("c-acc").textContent = fmt(s.accepted);
		$("c-rej").textContent = fmt(s.rejected);
		$("c-dead").textContent = fmt(s.deadEnds);
		$("c-steps").textContent = fmt(s.steps);
		$("c-calls").textContent = empty ? "0" : fmt(s.calls);
		$("c-rem").textContent = fmt(s.rejected + s.undone);
		var depth = s.d;
		$("depth-fill").style.width = (depth / total * 100).toFixed(1) + "%";
		$("depth-text").textContent = empty ? "" : depth + " of " + total + " standing · deepest so far " + s.maxD;
		if (empty) $("depth-fill").style.width = "0%";
		$("space-text").textContent = empty ? "" : searchSpace(N);
		// statistics
		var attempts = s.accepted + s.rejected;
		$("st-rate").textContent = attempts ? (s.accepted / attempts * 100).toFixed(1) + "%" : "\u2014";
		var standing = s.d;
		$("st-stand").textContent = s.accepted ? fmt(standing) + " of " + fmt(s.accepted) + " \u00b7 " + pct(standing / s.accepted) : "\u2014";
		$("st-climb").textContent = s.steps === 0 ? "\u2014" : fmt(s.longestClimb) + (s.longestClimb === 1 ? " placement" : " placements");
		renderTrace(s);
		renderDepth(s);
		// by-number table
		var maxCalls = 1;
		for (var v2 = 1; v2 <= N; v2++) if (s.by.calls[v2] > maxCalls) maxCalls = s.by.calls[v2];
		for (var q = 0; q < rows.length; q++) {
			var rw = rows[q], n2 = rw.v;
			rw.bar.style.width = (s.by.calls[n2] / maxCalls * 100).toFixed(1) + "%";
			var blank = s.steps === 0;
			rw.t[1].textContent = blank ? "\u2014" : fmt(s.by.calls[n2]);
			rw.t[3].textContent = blank ? "\u2014" : fmt(s.by.acc[n2]);
			rw.t[4].textContent = blank ? "\u2014" : fmt(s.by.rej[n2]);
			var tried = s.by.acc[n2] + s.by.rej[n2];
			rw.t[5].textContent = tried ? (s.by.acc[n2] / tried * 100).toFixed(1) + "%" : "\u2014";
			rw.t[6].textContent = blank ? "\u2014" : fmt(s.by.dead[n2]);
		}
		// log
		var ol = $("log");
		var key = (empty ? "e" : "") + log.length + ":" + (log.length ? log[0].n + ":" + log[log.length - 1].n + ":" + log[log.length - 1].t : "");
		if (key === logKey) { /* log unchanged */ }
		else if (!log.length) ol.innerHTML = '<li class="empty">' + (empty ? "Load a puzzle to begin." : "Press Step to see what the solver does.") + "</li>";
		else {
			var h = "", nw = 5.5;
			for (var q = 0; q < log.length; q++) { var w = String(log[q].n).length + 1; if (w > nw) nw = w; }
			ol.style.setProperty("--nw", nw + "ch");
			for (var j = 0; j < log.length; j++) {
				var e = log[j];
				h += '<li class="t' + e.t + '"><span class="n">' + e.n + '</span><span class="g" aria-hidden="true">' + GLYPH[e.t] + "</span><span>" + (e.text !== undefined ? e.text : describe(e.snap, e.t)).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span></li>";
			}
			ol.innerHTML = h;
		}
		if (key !== logKey) { logKey = key; if (logStick) ol.scrollTop = ol.scrollHeight; }
		// buttons
		var fin = s.done;
		$("b-back").disabled = empty || s.steps === 0 || s.steps > MAX_REPLAY || mode === "ff";
		$("b-back").title = s.steps > MAX_REPLAY ? "Too far in to replay" : "";
		fin = fin || empty;
		$("b-step").disabled = fin || mode === "ff";
		$("b-play").disabled = fin || mode === "ff";
		$("b-play").textContent = mode === "play" ? "Pause" : "Play";
		$("b-dead").disabled = fin || mode === "play";
		$("b-solve").disabled = fin || mode === "play";
		$("b-solve").textContent = mode === "ff" ? "Stop" : "Solve";
		$("b-dead").textContent = mode === "ff" && ffStopDead ? "Stop" : "Next dead end";
		if (mode === "ff" && ffStopDead) $("b-solve").disabled = true;
		if (mode === "ff" && !ffStopDead) $("b-dead").disabled = true;
		$("b-save").disabled = s.steps === 0 || saving || mode === "ff";
		$("b-reset").disabled = empty;
		$("b-json").disabled = s.steps === 0 || mode === "ff";
		$("b-csv").disabled = s.steps === 0 || mode === "ff";
		$("b-jump").disabled = empty || mode === "ff";
		$("jump").disabled = empty || mode === "ff";
		// progress bar for Solve, Next dead end and Go to step
		var rb = $("runbar");
		rb.hidden = mode !== "ff";
		if (mode === "ff") {
			var prog = $("run-prog");
			if (ffTarget) {
				$("run-text").textContent = "Going to step " + fmt(ffTarget) + " \u00b7 now at " + fmt(s.steps);
				prog.classList.remove("indet");
				$("run-fill").style.width = Math.min(100, s.steps / ffTarget * 100).toFixed(1) + "%";
			} else {
				$("run-text").textContent = (ffStopDead ? "Looking for the next dead end" : "Solving") + " \u00b7 " + fmt(s.steps) + " steps";
				prog.classList.add("indet");
				$("run-fill").style.width = "";
			}
			$("run-cancel").hidden = ffOrigin > MAX_REPLAY;
		}
	}

	/* ---------- running ---------- */
	function pct(x) {
		if (x === 0) return "0%";
		if (x < 0.0001) return "<0.01%";
		return (x * 100).toFixed(x < 0.1 ? 2 : 1) + "%";
	}
	function stopAll() {
		mode = "idle"; ffTarget = 0;
		cancelAnimationFrame(raf); clearTimeout(ffTimer);
	}
	function seek(target) {
		stopAll();
		if (eng && eng.release) eng.release();
		eng = mk();
		epoch++;
		log = [];
		logStick = true;
		var pre = Math.max(0, target - LOG_SHOW);
		if (pre) eng.run(pre, false);
		while (eng.stats().steps < target && !eng.stats().done) pushLog(eng.step(true));
		render();
	}
	function doStep() {
		stopAll();
		pushLog(eng.step(true)); render();
	}
	function doBack() {
		stopAll();
		var t = eng.stats().steps - 1;
		if (t >= 0) seek(t);
	}
	function playFrame(ts) {
		if (mode !== "play") return;
		var dt = Math.min(ts - playLast, 100); playLast = ts;
		playAcc += dt / 1000 * SPEEDS[+$("speed").value];
		var k = Math.min(Math.floor(playAcc), 4000); playAcc -= Math.floor(playAcc);
		if (k > 0) {
			if (k > 8) eng.run(k - 8, false);
			for (var i = 0; i < Math.min(k, 8) && !eng.stats().done; i++) pushLog(eng.step(true));
		}
		if (eng.stats().done) { mode = "idle"; render(); return; }
		render();
		raf = requestAnimationFrame(playFrame);
	}
	function togglePlay() {
		if (mode === "play") { stopAll(); render(); return; }
		stopAll(); mode = "play"; playLast = performance.now(); playAcc = 1;
		raf = requestAnimationFrame(playFrame);
	}
	function ffTick() {
		if (mode !== "ff") return;
		var t0 = performance.now(), hit = false;
		while (performance.now() - t0 < 30 && !eng.stats().done && !hit) {
			var k = 20000;
			if (ffTarget) {
				var left = ffTarget - 40 - eng.stats().steps;
				if (left <= 0) break;
				k = Math.min(k, left);
			}
			hit = eng.run(k, ffStopDead);
		}
		var s = eng.stats(), now = performance.now();
		if (ffTarget && !s.done && !hit && s.steps >= ffTarget - 40) {
			log = []; logStick = true;
			while (eng.stats().steps < ffTarget && !eng.stats().done) pushLog(eng.step(true));
			mode = "idle"; ffTarget = 0;
			render(); return;
		}
		if (s.done || hit) {
			if (ffTarget && s.done && s.steps < ffTarget) note("The search finished at step " + fmt(s.steps) + ", before step " + fmt(ffTarget) + ".");
			ffTarget = 0;
			mode = "idle";
			if (hit) { log = [{ n: s.steps, t: 3, snap: s }]; }
			else if (s.done) {
				log = [{ n: s.steps, t: s.status === "solved" && !badFinish(s) ? 1 : s.status === "cut" ? 4 : 3,
					text: badFinish(s) ? "The trace says solved, but " + verdictText() + "."
						: s.status === "solved" ? "Solved. Every clue matches."
						: s.status === "cut" ? "The trace ends here." : "No solution. The search tried every possibility." }];
			}
			render(); return;
		}
		if (now - lastRender > 90) render();
		ffTimer = setTimeout(ffTick, 0);
	}
	function startFF(stopDead) {
		if (mode === "ff") { stopAll(); render(); return; }
		stopAll(); mode = "ff"; ffStopDead = stopDead; ffTarget = 0;
		ffOrigin = eng.stats().steps;
		render(); ffTimer = setTimeout(ffTick, 0);
	}

	/* ---------- go to a step ---------- */
	function parseStepNo(txt) {
		var t = String(txt).replace(/[,_\s]/g, "");
		if (!/^\d{1,15}$/.test(t)) return null;
		return Number(t);
	}
	function doJump() {
		if (empty || mode === "ff") return;
		var v = parseStepNo($("jump").value);
		if (v === null) { note("Enter a step number, for example 1,000,000."); return; }
		note("");
		var cur = eng.stats().steps;
		if (v === cur) return;
		stopAll();
		var origin = cur;
		if (v < cur) {
			if (v <= MAX_REPLAY) { seek(v); return; }
			seek(0);
		}
		if (eng.stats().done) { return; }
		mode = "ff"; ffStopDead = false; ffTarget = v; ffOrigin = origin;
		render(); ffTimer = setTimeout(ffTick, 0);
	}

	/* ---------- save the log as a text file ---------- */
	var TAGS = { 1: "ACCEPT    ", 2: "REJECT    ", 3: "DEAD END  ", 4: "UNDONE    " };
	function optionName() {
		return "Your solver, from " + (traceName || "a trace file");
	}
	function pad(n, w) { var s = String(n); while (s.length < w) s = " " + s; return s; }
	function note(msg) { $("save-note").textContent = msg; }
	/* Replays the puzzle from step 0 (the solver is deterministic) and writes one
		 line per step, for the last LOG_CAP steps up to where the run stands now. */
	function buildLogText(finish) {
		var s0 = eng.stats(), target = s0.steps, myEpoch = epoch;
		var start = Math.max(1, target - LOG_CAP + 1), w = String(target).length;
		var state = badFinish(s0) ? "trace says solved, but the final board is wrong" : s0.status === "solved" ? "solved" : s0.status === "nosolution" ? "no solution" : "in progress";
		var head = [
			"Skyscraper Step Visualizer log",
			"Puzzle: " + N + "x" + N + ", clues: " + CL.join(" "),
			"Replaying: " + optionName(),
			"State: " + state + " at step " + fmt(target),
			"",
			"Counters: accepted " + fmt(s0.accepted) + ", rejected " + fmt(s0.rejected) + ", dead ends " + fmt(s0.deadEnds) +
				", undone " + fmt(s0.undone) + ", calls " + fmt(s0.calls),
			"Acceptance rate: " + $("st-rate").textContent,
			"Placements still standing: " + $("st-stand").textContent,
			"Longest climb back: " + $("st-climb").textContent
		];
		head.push("", "Board at this step ('.' = empty):");
		for (var r = 0; r < N; r++) {
			var row = [];
			for (var c = 0; c < N; c++) { var v = eng.grid[r * N + c]; row.push(v ? v : "."); }
			head.push("  " + row.join(" "));
		}
		head.push("", start === 1
			? "Steps 1 to " + fmt(target) + " (complete)."
			: "Steps " + fmt(start) + " to " + fmt(target) + " (the last " + fmt(LOG_CAP) + "). Earlier steps are left out to keep the file a manageable size.");
		head.push("");
		var e2 = mk(), skipped = 0, lines = [];
		function chunk() {
			if (epoch !== myEpoch) { if (e2.release) e2.release(); finish(null, target); return; }
			var t0 = performance.now();
			while (skipped < start - 1 && performance.now() - t0 < 30) {
				var k = Math.min(200000, start - 1 - skipped);
				e2.run(k, false); skipped += k;
			}
			if (skipped < start - 1) {
				$("b-save").textContent = "Preparing " + Math.floor(skipped / (start - 1) * 100) + "%";
				setTimeout(chunk, 0); return;
			}
			for (var n = start; n <= target; n++) {
				var t = e2.step(true);
				if (!t) break;
				lines.push(pad(n, w) + "  " + TAGS[t] + describe(e2.stats(), t));
			}
			if (e2.release) e2.release();
			finish(head.concat(lines).join("\n") + "\n", target);
		}
		chunk();
	}
	/* Plain browser download (Blob + temporary link). */
	function saveFile(name, text, mime) {
		return new Promise(function (resolve, reject) {
			try {
				var url = URL.createObjectURL(new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" }));
				var a = document.createElement("a");
				a.href = url; a.download = name;
				document.body.appendChild(a); a.click(); a.remove();
				setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
				resolve({ status: "saved" });
			} catch (e) { reject({ code: "unavailable", message: String(e && e.message || e) }); }
		});
	}
	function saveLog() {
		if (saving || eng.stats().steps === 0) return;
		saving = true; note("Preparing the log…"); render();
		buildLogText(function (text, target) {
			$("b-save").textContent = "Save log (.txt)";
			if (text === null) { saving = false; note("Log cancelled because the puzzle changed."); render(); return; }
			var name = "skyscraper-" + N + "x" + N + "-trace-step-" + target + ".txt";
			saveFile(name, text).then(function () {
				saving = false; note("Saved " + name + "."); render();
			}, function (err) {
				saving = false;
				note("Could not save the log" + (err && err.message ? ": " + err.message : "."));
				render();
			});
		});
	}

	/* ---------- size picker, examples and random puzzles ---------- */
	/* A random Latin square (no repeat in any row or column), then the clues it gives. */
	function randomPuzzle(n) {
		var sq = null, tries = 0;
		function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
		var nodes = 0;
		function fillRow(r, c, rowUsed, colUsed, g) {
			if (c === n) return true;
			var cand = [];
			for (var v = 1; v <= n; v++) if (!rowUsed[v] && !colUsed[c][v]) cand.push(v);
			shuffle(cand);
			for (var k = 0; k < cand.length; k++) {
				if (++nodes > 200000) return false;
				var v2 = cand[k];
				rowUsed[v2] = true; colUsed[c][v2] = true; g[r * n + c] = v2;
				if (fillRow(r, c + 1, rowUsed, colUsed, g)) return true;
				rowUsed[v2] = false; colUsed[c][v2] = false; g[r * n + c] = 0;
			}
			return false;
		}
		function build() {
			var g = [], colUsed = [], i;
			for (i = 0; i < n * n; i++) g.push(0);
			for (i = 0; i < n; i++) { colUsed.push([]); }
			nodes = 0;
			function rows(r) {
				if (r === n) return true;
				var rowUsed = [];
				for (var attempt = 0; attempt < 30; attempt++) {
					for (var c = 0; c < n; c++) { g[r * n + c] = 0; }
					rowUsed.length = 0;
					if (fillRow(r, 0, rowUsed, colUsed, g) && rows(r + 1)) return true;
					if (nodes > 200000) return false;
					for (var c2 = 0; c2 < n; c2++) { var v = g[r * n + c2]; if (v) colUsed[c2][v] = false; g[r * n + c2] = 0; }
				}
				return false;
			}
			return rows(0) ? g : null;
		}
		while (!sq && tries++ < 50) sq = build();
		if (!sq) { // fallback: shuffled cyclic square
			var pr = shuffle(Array.apply(null, Array(n)).map(function (_, i) { return i; })), pc = shuffle(pr.slice()), ps = shuffle(pr.slice());
			sq = []; for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) sq.push(ps[(pr[r] + pc[c]) % n] + 1);
		}
		function seen(get) { var m = 0, k = 0; for (var i = 0; i < n; i++) { var v = get(i); if (v > m) { m = v; k++; } } return k; }
		var cl = [], i2;
		for (i2 = 0; i2 < n; i2++) cl.push(seen(function (r) { return sq[r * n + i2]; }));
		for (i2 = 0; i2 < n; i2++) cl.push(seen(function (r) { return sq[(n - 1 - r) * n + i2]; }));
		for (i2 = 0; i2 < n; i2++) cl.push(seen(function (c) { return sq[i2 * n + c]; }));
		for (i2 = 0; i2 < n; i2++) cl.push(seen(function (c) { return sq[i2 * n + (n - 1 - c)]; }));
		return cl.join(" ");
	}

	/* ---------- export statistics ---------- */
	function depthRows(s) {
		var out = [];
		for (var d = 0; d < N * N; d++) {
			var tried = s.by.dacc[d] + s.by.drej[d];
			out.push({ depth: d + 1, placing: depthLabel(d), reached: s.by.dcalls[d], accepted: s.by.dacc[d], rejected: s.by.drej[d],
				acceptRate: tried ? s.by.dacc[d] / tried : null, deadEnds: s.by.ddead[d] });
		}
		return out;
	}
	function exportStats(kind) {
		if (eng.stats().steps === 0) return;
		var s = eng.stats(), g = emeta().group, keys = g.keys, total = N * N, i;
		var name = "skyscraper-" + N + "x" + N + "-trace-step-" + s.steps + (kind === "json" ? ".json" : "-breakdown.csv");
		var text, mime;
		if (kind === "json") {
			var by = [], att = s.accepted + s.rejected;
			for (i = 0; i < keys.length; i++) {
				var v = keys[i], tried = s.by.acc[v] + s.by.rej[v];
				by.push({ number: v, calls: s.by.calls[v], accepted: s.by.acc[v], rejected: s.by.rej[v],
					acceptRate: tried ? s.by.acc[v] / tried : null, deadEnds: s.by.dead[v] });
			}
			var standing = s.d;
			text = JSON.stringify({
				tool: "Skyscraper Step Visualizer",
				puzzle: { size: N, clues: CL.slice() },
				traceFile: traceName,
				state: badFinish(s) ? "trace says solved, but the final board is wrong" : s.status === "solved" ? "solved" : s.status === "nosolution" ? "no solution" : "in progress",
				counters: { steps: s.steps, accepted: s.accepted, rejected: s.rejected, deadEnds: s.deadEnds,
					undone: s.undone, calls: s.calls, removals: s.rejected + s.undone },
				statistics: {
					acceptanceRate: att ? s.accepted / att : null,
					placementsStanding: standing, placementsEverAccepted: s.accepted,
					buildingsStandingNow: standing, deepestReached: s.maxD, cells: total,
					longestClimbBack: s.longestClimb
				},
				breakdownByNumber: by,
				breakdownByDepth: depthRows(s)
			}, null, 2) + "\n";
			mime = "application/json";
		} else {
			var rows2 = ["number,calls,accepted,rejected,accept_rate,dead_ends"];
			for (i = 0; i < keys.length; i++) {
				var w = keys[i], tr = s.by.acc[w] + s.by.rej[w];
				rows2.push([w, s.by.calls[w], s.by.acc[w], s.by.rej[w], tr ? (s.by.acc[w] / tr).toFixed(6) : "", s.by.dead[w]].join(","));
			}
			text = rows2.join("\n") + "\n";
			mime = "text/csv";
		}
		saveFile(name, text, mime).then(function () { note("Saved " + name + "."); },
			function (err) { note("Could not save the file" + (err && err.message ? ": " + err.message : ".")); });
	}

	/* ---------- shareable link ---------- */
	function copyText(text) {
		return new Promise(function (resolve, reject) {
			function fallback() {
				try {
					var ta = document.createElement("textarea");
					ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
					document.body.appendChild(ta); ta.select();
					var ok = document.execCommand && document.execCommand("copy");
					ta.remove();
					ok ? resolve() : reject();
				} catch (e) { reject(e); }
			}
			if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(resolve, fallback);
			else fallback();
		});
	}

	/* ---------- loading ---------- */
	function loadPuzzle(n, clues, tag) {
		note("");
		empty = false;
		N = n; CL = clues;
		$("size-note").textContent = N + "×" + N + " puzzle, " + CL.length + " clues" + (tag ? " \u00b7 " + tag : "");
		buildBoard(); buildTable(); buildRules(); updateOptNote(); seek(0);
		selectTab("sim");
	}

	/* ---------- traces from your own solver ---------- */
	function traceInfoText(p, name, fileCut) {
		var bits = [name + ": " + p.n + "\u00d7" + p.n + ", " + fmt(p.count) + " events"];
		if (p.truncated || fileCut) bits.push("showing the first part of a longer run");
		else if (p.end === 0) bits.push("no end line, so the solver may have been stopped");
		else if (p.end === 3) bits.push("the trace was cut off here, so it is a partial run");
		if (p.end === 1 && !p.warnings.length) {
			bits.push(p.verdict ? "reported solved, but " + p.verdict.replace(/\.$/, "").replace(/^./, function (c) { return c.toLowerCase(); }) : "your solver's final board is a valid solution");
		}
		return bits.join(" \u00b7 ") + (p.warnings.length ? ". " + p.warnings.join(" ") : ".");
	}
	function loadTraceText(text, name, fileCut) {
		var p = parseTrace(text, TRACE_MAX_EVENTS);
		if (p.error) { $("trace-err").textContent = name + ": " + p.error; return false; }
		$("trace-err").textContent = "";
		if (fileCut) { p.truncated = true; if (!p.end) p.end = 3; }
		TR = p; traceName = name;
		$("trace-info").textContent = traceInfoText(p, name, fileCut);
		loadPuzzle(p.n, p.clues, name);
		$("size-note").textContent = p.n + "\u00d7" + p.n + " puzzle \u00b7 replaying " + name;
		selectTab("sim");
		return true;
	}
	function readTraceFile(file) {
		if (!file) return;
		$("trace-err").textContent = ""; $("trace-info").textContent = "Reading " + file.name + "\u2026";
		var cut = file.size > MAX_FILE, blob = cut ? file.slice(0, MAX_FILE) : file;
		function done(text) {
			if (cut) { var k = text.lastIndexOf("\n"); if (k > 0) text = text.substring(0, k + 1); }
			if (!loadTraceText(text, file.name, cut)) $("trace-info").textContent = "";
		}
		if (blob.text) blob.text().then(done, function () { $("trace-err").textContent = "Could not read " + file.name + "."; });
		else {
			var fr = new FileReader();
			fr.onload = function () { done(String(fr.result)); };
			fr.onerror = function () { $("trace-err").textContent = "Could not read " + file.name + "."; };
			fr.readAsText(blob);
		}
	}
	function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; }
	function initTrace() {
		var drop = $("drop"), fi = $("trace-file");
		drop.addEventListener("click", function () { fi.click(); });
		drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); } });
		fi.addEventListener("change", function () { readTraceFile(fi.files[0]); fi.value = ""; });
		document.addEventListener("dragover", function (e) { if (hasFiles(e)) { e.preventDefault(); drop.classList.add("over"); } });
		document.addEventListener("dragleave", function (e) { if (!e.relatedTarget) drop.classList.remove("over"); });
		document.addEventListener("drop", function (e) {
			if (!hasFiles(e)) return;
			e.preventDefault(); drop.classList.remove("over");
			$("tracebox").open = true; selectTab("puz");
			readTraceFile(e.dataTransfer.files[0]);
		});
		$("b-helper-h").addEventListener("click", function () { saveFile("skytrace.h", HELPER_H, "text/x-chdr"); });
		$("b-helper-c").addEventListener("click", function () { saveFile("skytrace.c", HELPER_C, "text/x-csrc"); });
		$("b-sample").addEventListener("click", function () { saveFile("sample-5x5-partial.trace", SAMPLE_TRACE, "text/plain"); });
		$("b-sample-load").addEventListener("click", function () { loadTraceText(SAMPLE_TRACE, "sample-5x5-partial.trace", false);
			$("trace-info").textContent += " This sample only shows what a trace looks like. It is not a solution, and it ends part way through."; });
	}
	/* Hover and focus notes: each term takes its text from the glossary in "How to read this". */
	/* Keep a note inside the window: open it leftwards when it would run off the right edge. */
	function placeTip() {
		var r = this.getBoundingClientRect();
		if (r.left + 260 > document.documentElement.clientWidth) this.setAttribute("data-r", "");
		else this.removeAttribute("data-r");
	}
		function initTerms() {
		var terms = document.querySelectorAll(".term[data-g]");
		for (var i = 0; i < terms.length; i++) {
			var d = document.getElementById("gl-" + terms[i].getAttribute("data-g"));
			if (!d) continue;
			terms[i].setAttribute("data-tip", d.textContent.trim());
			terms[i].setAttribute("aria-describedby", d.id);
			terms[i].addEventListener("mouseenter", placeTip);
			terms[i].addEventListener("focus", placeTip);
		}
	}
	/* Tabs inside "How to read this". Arrow keys, Home and End move between them. */
	function initHowto() {
		var names = ["basics", "gloss", "try"];
		function pick(nm, focus) {
			for (var i = 0; i < names.length; i++) {
				var on = names[i] === nm;
				$("ht-" + names[i]).setAttribute("aria-selected", on ? "true" : "false");
				$("ht-" + names[i]).tabIndex = on ? 0 : -1;
				$("hp-" + names[i]).hidden = !on;
			}
			if (focus) $("ht-" + nm).focus();
		}
		names.forEach(function (nm, i) {
			$("ht-" + nm).addEventListener("click", function () { pick(nm); });
			$("ht-" + nm).addEventListener("keydown", function (e) {
				var j = e.key === "ArrowRight" ? (i + 1) % names.length : e.key === "ArrowLeft" ? (i + names.length - 1) % names.length
					: e.key === "Home" ? 0 : e.key === "End" ? names.length - 1 : -1;
				if (j >= 0) { e.preventDefault(); pick(names[j], true); }
			});
		});
	}
	function init() {
		initTerms();
		initHowto();
		{
			var zsel = $("size"), zh = '<option value="">Choose a size\u2026</option>', zn, rt = "";
			for (zn = 1; zn <= 9; zn++) zh += '<option value="' + zn + '">' + zn + "\u00d7" + zn + "</option>";
			zsel.innerHTML = zh;
			zsel.addEventListener("change", function () {
				$("b-random").disabled = !zsel.value;
				$("b-random").title = zsel.value ? "Make a random puzzle of this size" : "Pick a size first";
			});
			$("b-random").addEventListener("click", function () {
				if (!zsel.value) return;
				rt = randomPuzzle(+zsel.value);
				$("rand-out").value = rt; $("b-copy-clues").disabled = false;
				$("b-copy-clues").textContent = "Copy clues";
			});
			$("b-copy-clues").addEventListener("click", function () {
				if (!rt) return;
				copyText(rt).then(function () { $("b-copy-clues").textContent = "Copied"; },
					function () { $("rand-out").focus(); $("rand-out").select(); });
			});
		}
		$("b-step").addEventListener("click", doStep);
		$("b-back").addEventListener("click", doBack);
		$("b-play").addEventListener("click", togglePlay);
		$("b-dead").addEventListener("click", function () { startFF(true); });
		$("b-solve").addEventListener("click", function () { startFF(false); });
		$("b-reset").addEventListener("click", function () { seek(0); });
		$("b-save").addEventListener("click", saveLog);
		$("speed").addEventListener("input", function () { $("speed-out").textContent = fmt(SPEEDS[+$("speed").value]) + " steps/s"; });
		$("speed-out").textContent = fmt(SPEEDS[+$("speed").value]) + " steps/s";
		function keysPop(show) {
			$("keys-pop").hidden = !show;
			$("b-keys").setAttribute("aria-expanded", show ? "true" : "false");
		}
		$("b-keys").addEventListener("click", function () { keysPop($("keys-pop").hidden); });
		document.addEventListener("click", function (e) {
			if (!$("keys-pop").hidden && !e.target.closest(".keywrap")) keysPop(false);
		});
		document.addEventListener("keydown", function (e) {
			var t = e.target && e.target.tagName;
			if (e.key === "Escape" && !$("keys-pop").hidden) { keysPop(false); $("b-keys").focus(); return; }
			if (e.key === "?" && t !== "INPUT" && t !== "SELECT" && t !== "TEXTAREA") { e.preventDefault(); keysPop($("keys-pop").hidden); }
		});
		document.addEventListener("keydown", function (e) {
			var tag = e.target && e.target.tagName;
			if (empty) return;
			if (tag === "INPUT" || tag === "SELECT" || tag === "BUTTON" || tag === "TEXTAREA") return;
			if (e.key === "ArrowRight") { e.preventDefault(); if (!eng.stats().done) doStep(); }
			else if (e.key === "ArrowLeft") { e.preventDefault(); if (!$("b-back").disabled) doBack(); }
			else if (e.key === " ") { e.preventDefault(); if (!eng.stats().done) togglePlay(); }
		});
		updateOptNote();
		initTrace();
		$("log").addEventListener("scroll", function () {
			var o = $("log"); logStick = o.scrollHeight - o.scrollTop - o.clientHeight < 12;
		});
		var brkRadios = document.querySelectorAll('input[name="brk"]');
		for (var br = 0; br < brkRadios.length; br++) brkRadios[br].addEventListener("change", function (e) {
			brkView = e.target.value;
			$("brk-v-num").hidden = brkView !== "num"; $("brk-v-depth").hidden = brkView !== "depth";
			if (eng) render();
		});
		TABS.forEach(function (nm, i) {
			$("tab-" + nm).addEventListener("click", function () { selectTab(nm); });
			$("tab-" + nm).addEventListener("keydown", function (e) {
				var j = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length
					: e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
				if (j >= 0) { e.preventDefault(); selectTab(TABS[j], true); }
			});
		});
		$("b-jump").addEventListener("click", doJump);
		$("jump").addEventListener("keydown", function (e) { if (e.key === "Enter") doJump(); });
		$("b-json").addEventListener("click", function () { exportStats("json"); });
		$("b-csv").addEventListener("click", function () { exportStats("csv"); });
		$("run-stop").addEventListener("click", function () { stopAll(); render(); });
		$("run-cancel").addEventListener("click", function () { var o = ffOrigin; stopAll(); seek(o); });
		// Launch with nothing loaded: an empty 4x4 grid, no clues, no steps.
		empty = true; N = 4;
		CL = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
		$("size-note").textContent = "";
		buildBoard(); buildTable(); buildRules(); seek(0);
		initTheme();
	}

	/* Theme menu: Auto follows the system; other choices are remembered on this device. */
	function initTheme() {
		var sel = $("theme"), root = document.documentElement;
		function syncColor() {
			var m = document.querySelector('meta[name="theme-color"]');
			if (m) m.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || "#edf0f3");
		}
		sel.value = root.getAttribute("data-theme") || "auto";
		if (sel.selectedIndex < 0) sel.value = "auto";
		sel.addEventListener("change", function () {
			var v = sel.value;
			if (v === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", v);
			try { if (v === "auto") localStorage.removeItem("sky-theme"); else localStorage.setItem("sky-theme", v); } catch (e) {}
			syncColor();
		});
		if (window.matchMedia) {
			var mq = window.matchMedia("(prefers-color-scheme: dark)");
			if (mq.addEventListener) mq.addEventListener("change", syncColor);
		}
		syncColor();
	}
	init();
})();
