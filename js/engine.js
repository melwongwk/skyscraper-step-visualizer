
/* What a replayed trace reports about itself: how the work is grouped. */
function engineMeta(n) {
	var keys = [], i;
	for (i = 1; i <= n; i++) keys.push(i);
	return {
		kind: "trace",
		group: { header: "Row", caption: "Where the work goes, by row of the placement depth (from your trace)", keys: keys, prefix: "Row " }
	};
}

/* ---------- replaying a trace written by someone else's solver ----------
	 A trace is a list of "placed" and "removed" events. Nothing is solved here:
	 the engine walks the list and turns it into the steps a solver would take.

	 Reading the events:
	 - A placement followed at once by the removal of the same cell is a
		 rejection: the solver took it out again straight away.
	 - Any other removal is an undo. Every undo is preceded by the dead end that
		 forced it, so a dead end is added just before it.   */
var TRACE_MAX_EVENTS = 2000000;

function parseTrace(text, maxEvents) {
	maxEvents = maxEvents || TRACE_MAX_EVENTS;
	var len = text.length, pos = 0, lineNo = 0, started = false;
	var n = 0, clues = null, count = 0, end = 0, truncated = false;
	var K = null, R = null, C = null, V = null, grid = null, standing = 0;
	var firstPlace = 0, warnings = [];
	function err(msg) { return { error: "Line " + lineNo + ": " + msg }; }
	function alloc(cap) {
		K = new Uint8Array(cap); R = new Uint8Array(cap); C = new Uint8Array(cap); V = new Uint8Array(cap);
	}
	var cap = 0;
	while (pos < len) {
		var nl = text.indexOf("\n", pos);
		if (nl < 0) nl = len;
		var line = text.substring(pos, nl);
		pos = nl + 1; lineNo++;
		if (line.charCodeAt(line.length - 1) === 13) line = line.substring(0, line.length - 1);
		var t = line.trim();
		if (t === "" || t.charAt(0) === "#") continue;
		if (!started) {
			if (!/^SKYTRACE\s+1\s*$/.test(t)) {
				return err("a trace file starts with the line SKYTRACE 1. This file does not look like one.");
			}
			started = true; continue;
		}
		var c0 = t.charAt(0);
		if (c0 === "+" || c0 === "-") {
			if (!clues) return err("the puzzle size (n) and clues must come before the first placement.");
			var parts = t.split(/\s+/);
			var isPlace = c0 === "+";
			if (parts.length !== (isPlace ? 4 : 3) || parts[0] !== c0) {
				return err("expected " + (isPlace ? "+ row column number" : "- row column") + ".");
			}
			var rr = +parts[1], cc = +parts[2], vv = isPlace ? +parts[3] : 0;
			if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2]) || (isPlace && !/^\d+$/.test(parts[3]))) {
				return err("row, column and number must be whole numbers.");
			}
			if (rr < 1 || rr > n || cc < 1 || cc > n) return err("cell (" + parts[1] + ", " + parts[2] + ") is outside the " + n + "×" + n + " board. Rows and columns count from 1.");
			var idx = (rr - 1) * n + (cc - 1);
			if (isPlace) {
				if (vv < 1 || vv > n) return err("a " + vv + " cannot go in a " + n + "×" + n + " puzzle. Numbers run from 1 to " + n + ".");
				if (grid[idx]) return err("cell (" + rr + ", " + cc + ") already holds a " + grid[idx] + ". Remove it before placing again.");
				grid[idx] = vv; standing++;
				if (!firstPlace) firstPlace = vv;
			} else {
				if (!grid[idx]) return err("cell (" + rr + ", " + cc + ") is already empty, so there is nothing to remove.");
				grid[idx] = 0; standing--;
			}
			if (count >= maxEvents) { truncated = true; break; }
			if (count >= cap) { /* grow */
				var ncap = Math.max(1024, cap * 2), oK = K, oR = R, oC = C, oV = V;
				alloc(ncap); K.set(oK); R.set(oR); C.set(oC); V.set(oV); cap = ncap;
			}
			K[count] = isPlace ? 1 : 2; R[count] = rr - 1; C[count] = cc - 1; V[count] = vv; count++;
			continue;
		}
		var m = /^(\w+)\s*(.*)$/.exec(t);
		var key = m ? m[1].toLowerCase() : "";
		if (key === "n") {
			if (!/^[1-9]$/.test(m[2])) return err("n must be a single digit from 1 to 9.");
			if (n) return err("n is given twice.");
			n = +m[2]; grid = new Int8Array(n * n);
		} else if (key === "clues") {
			if (!n) return err("put n (the puzzle size) before clues.");
			var p = parseClues(m[2]);
			if (p.error) return err(p.error);
			if (p.n !== n) return err("n is " + n + " but there are " + (p.clues.length) + " clues, which is a " + p.n + "×" + p.n + " puzzle.");
			clues = p.clues; alloc(1024); cap = 1024;
		} else if (key === "end") {
			var w = (m[2] || "").toLowerCase();
			if (w === "solved") end = 1; else if (w === "nosolution") end = 2; else if (w === "cut") end = 3;
			else return err("end must be followed by solved, nosolution or cut.");
			break;
		} else {
			return err("did not understand “" + t.substring(0, 30) + (t.length > 30 ? "…" : "") + "”.");
		}
	}
	if (!started) return { error: "The file is empty." };
	if (!clues) return { error: "The file has no puzzle: it needs n and clues lines before the events." };
	if (truncated) end = 3;
	var total = n * n, verdict = "";
	if (end === 1) {
		if (standing !== total) warnings.push("The trace says solved, but " + (total - standing) + " cell" + (total - standing === 1 ? " is" : "s are") + " still empty at the end.");
		else verdict = checkBoard(n, clues, grid);
	} else if (end === 2 && standing !== 0) {
		warnings.push("The trace says no solution, but " + standing + " building" + (standing === 1 ? " is" : "s are") + " still standing at the end.");
	}
	var res = {
		n: n, clues: clues, count: count, K: K, R: R, C: C, V: V, end: end, truncated: truncated,
		standing: standing, firstPlace: firstPlace, warnings: warnings, verdict: verdict
	};
	return res;
}

/* "" when the board is a valid solution, else the first problem found. */
function checkBoard(n, clues, g) {
	var i, j;
	for (i = 0; i < n; i++) {
		var rs = 0, cs = 0;
		for (j = 0; j < n; j++) { rs |= 1 << g[i * n + j]; cs |= 1 << g[j * n + i]; }
		if (rs !== ((1 << (n + 1)) - 2)) return "Row " + (i + 1) + " does not hold each number once.";
		if (cs !== ((1 << (n + 1)) - 2)) return "Column " + (i + 1) + " does not hold each number once.";
	}
	function count(get) { var mx = 0, k = 0; for (var q = 0; q < n; q++) { var x = get(q); if (x > mx) { mx = x; k++; } } return k; }
	for (i = 0; i < n; i++) {
		var got = [
			["column " + (i + 1) + " from the top", count(function (q) { return g[q * n + i]; }), clues[i]],
			["column " + (i + 1) + " from the bottom", count(function (q) { return g[(n - 1 - q) * n + i]; }), clues[n + i]],
			["row " + (i + 1) + " from the left", count(function (q) { return g[i * n + q]; }), clues[2 * n + i]],
			["row " + (i + 1) + " from the right", count(function (q) { return g[i * n + (n - 1 - q)]; }), clues[3 * n + i]]
		];
		for (j = 0; j < 4; j++) if (got[j][1] !== got[j][2]) return "Final board: " + got[j][0] + " shows " + got[j][1] + ", the clue is " + got[j][2] + ".";
	}
	return "";
}

function createTraceEngine(n, clues, tr) {
	var total = n * n;
	var grid = new Int8Array(total);
	var K = tr.K, R = tr.R, C = tr.C, V = tr.V, cnt = tr.count;
	var p = 0, pend = 0, pendIdx = 0;
	var callsBy = new Float64Array(n + 1), accBy = new Float64Array(n + 1), rejBy = new Float64Array(n + 1);
	var deadBy = new Float64Array(n + 1), undoBy = new Float64Array(n + 1);
	var climb = 0, longestClimb = 0;
	var d = 0, maxD = 0, steps = 0;
	var accepted = 0, rejected = 0, deadEnds = 0, undone = 0, calls = 1;
	var done = false, status = "running";
	var lastType = 0, lastR = 0, lastC = 0, lastNum = 0;
	function key(x) { var g = (x / n) | 0; if (g >= n) g = n - 1; return g + 1; }
	callsBy[key(0)] = 1;

	var TCAP = 600, tMin = new Int16Array(TCAP), tMax = new Int16Array(TCAP), tSum = new Float64Array(TCAP);
	var tN = 0, tSize = 1, tCnt = 0, tCurMin = 32767, tCurMax = -1, tCurSum = 0;
	var accD = new Float64Array(total + 1), rejD = new Float64Array(total + 1);
	var deadD = new Float64Array(total + 1), callsD = new Float64Array(total + 1);
	var climbStart = 0, bestStart = 0, bestEnd = 0;
	callsD[0] = 1;
	function closeBucket() {
		tMin[tN] = tCurMin; tMax[tN] = tCurMax; tSum[tN] = tCurSum; tN++;
		tCnt = 0; tCurMin = 32767; tCurMax = -1; tCurSum = 0;
		if (tN === TCAP) {
			for (var i = 0; i < TCAP / 2; i++) {
				tMin[i] = Math.min(tMin[2 * i], tMin[2 * i + 1]);
				tMax[i] = Math.max(tMax[2 * i], tMax[2 * i + 1]);
				tSum[i] = tSum[2 * i] + tSum[2 * i + 1];
			}
			tN = TCAP / 2; tSize *= 2;
		}
	}
	function rec() {
		if (d < tCurMin) tCurMin = d;
		if (d > tCurMax) tCurMax = d;
		tCurSum += d;
		if (++tCnt === tSize) closeBucket();
	}

	function setLast(t, r, c, num) { lastType = t; lastR = r; lastC = c; lastNum = num; }
	function startDead(rr, cc) {
		deadEnds++; deadBy[key(d)]++; deadD[d]++;
		setLast(3, rr, cc, 0);
		pend = 4;
	}

	function stepCore() {
		if (done) return 0;
		var r, c, num, idx;
		if (pend === 0 && p >= cnt) {
			if (tr.end === 2 && d === 0) {
				steps++; deadEnds++; deadBy[key(0)]++; deadD[0]++;
				setLast(3, 0, 0, 0);
				done = true; status = "nosolution";
				return 3;
			}
			done = true; status = tr.end === 1 && tr.standing === total ? "solved" : "cut";
			return 0;
		}
		steps++;
		if (pend === 4) {
			pend = 0;
			r = R[pendIdx]; c = C[pendIdx]; idx = r * n + c; num = grid[idx];
			grid[idx] = 0; d--;
			undone++; undoBy[key(d)]++;
			climb++; if (climb > longestClimb) { longestClimb = climb; bestStart = climbStart; bestEnd = steps; }
			setLast(4, r, c, num);
			return 4;
		}
		if (K[p] === 2) { /* a removal that is not a rejection: the solver backed up */
			pendIdx = p; p++;
			startDead(R[pendIdx], C[pendIdx]);
			return 3;
		}
		r = R[p]; c = C[p]; num = V[p]; idx = r * n + c;
		var paired = p + 1 < cnt && K[p + 1] === 2 && R[p + 1] === r && C[p + 1] === c;
		grid[idx] = num;
		if (paired) {
			rejected++; rejBy[key(d)]++; rejD[d]++;
			grid[idx] = 0; p += 2;
			setLast(2, r, c, num);
			return 2;
		}
		/* kept */
		accepted++; accBy[key(d)]++; accD[d]++; climb = 0; climbStart = steps;
		setLast(1, r, c, num);
		p++;
		d++; if (d > maxD) maxD = d;
		if (d === total) {
			if (tr.end === 1) { done = true; status = "solved"; }
			return 1;
		}
		callsD[d]++; calls++; callsBy[key(d)]++;
		return 1;
	}

	function stepInner() {
		var t = stepCore();
		if (t) rec();
		return t;
	}

	return {
		n: n, order: "trace", grid: grid,
		step: function () { return stepInner(); },
		run: function (max, stopOnDead) {
			var i = 0;
			while (i < max && !done) {
				var k = Math.min(tSize - tCnt, max - i), mn = tCurMin, mx = tCurMax, sm = tCurSum, j = 0, hit = false;
				while (j < k && !done) {
					var t = stepCore();
					if (t) {
						j++;
						if (d < mn) mn = d;
						if (d > mx) mx = d;
					sm += d;
						if (t === 3 && stopOnDead) { hit = true; break; }
					}
				}
				tCurMin = mn; tCurMax = mx; tCurSum = sm; tCnt += j; i += j;
				if (tCnt === tSize) closeBucket();
				if (hit) return true;
				if (j === 0) break;
			}
			return false;
		},
		trace: function () {
			return { size: tSize, n: tN, min: tMin, max: tMax, sum: tSum, curMin: tCurMin, curMax: tCurMax, curSum: tCurSum, curCnt: tCnt,
							 steps: steps, bestStart: bestStart, bestEnd: bestEnd, bestLen: longestClimb, total: total };
		},
		info: function () { return { events: cnt, used: p, end: tr.end, truncated: tr.truncated }; },
		stats: function () {
			return {
				n: n, d: d, maxD: maxD, steps: steps, accepted: accepted,
				rejected: rejected, deadEnds: deadEnds, undone: undone, calls: calls,
				done: done, status: status, pendingUndo: pend === 4,
				last: { type: lastType, r: lastR, c: lastC, num: lastNum },
				by: { calls: callsBy, acc: accBy, rej: rejBy, dead: deadBy, undo: undoBy, dcalls: callsD, dacc: accD, drej: rejD, ddead: deadD },
				longestClimb: longestClimb,
				num: 0, line: 0, cell: { r: 0, c: 0 }
			};
		}
	};
}

/* The page shows an empty board until a trace is loaded; it gets an engine with no events. */
function makeEngine(n, clues, tr) {
	if (!tr) tr = { K: [], R: [], C: [], V: [], count: 0, end: 0, truncated: false, standing: 0 };
	var e = createTraceEngine(n, clues, tr);
	var m = engineMeta(n);
	e.kind = m.kind; e.group = m.group;
	return e;
}

function parseClues(text) {
	var t = String(text).trim();
	if (!t) return { error: "Enter the clues as numbers separated by spaces." };
	var parts = t.split(/[\s,]+/);
	var clues = [];
	for (var i = 0; i < parts.length; i++) {
		if (!/^[0-9]$/.test(parts[i])) {
			return { error: "“" + parts[i] + "” is not a single digit. Clues are digits 1 to 9 separated by spaces." };
		}
		clues.push(+parts[i]);
	}
	if (clues.length % 4 !== 0) {
		return { error: "Got " + clues.length + " clues. The count must be a multiple of 4, one set per side." };
	}
	var n = clues.length / 4;
	if (n > 9) return { error: "That would be a " + n + "×" + n + " puzzle. The largest size is 9×9." };
	for (var j = 0; j < clues.length; j++) {
		if (clues[j] < 1 || clues[j] > n) {
			return { error: "Clue " + (j + 1) + " is " + clues[j] + ". For a " + n + "×" + n + " puzzle every clue must be between 1 and " + n + "." };
		}
	}
	return { n: n, clues: clues };
}
