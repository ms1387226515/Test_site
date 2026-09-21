(() => {
  "use strict";

  const DB_KEY = "azmoon_tracker_v1";
  const INCOMPLETE_KEY = "azmoon_tracker_incomplete_v1";
  const INCOMPLETE_DELETED_KEY = "azmoon_tracker_incomplete_deleted_v1";
  const SAVE_INTERVAL = 2500;

  const $ = (id) => document.getElementById(id);
  const views = { home: $("homeView"), create: $("createView"), solve: $("solveView"), result: $("resultView"), study: $("studyDashboard") };

  let exams = loadExams();
  let activeExam = null;
  let currentIndex = 0;
  let pendingDeleteId = null;
  let timerLoop = null;
  let lastTick = null;
  let saveTimer = null;
  let autoAdvanceTimer = null;
  const AUTO_ADVANCE_MS = 3000;
  let toastTimer = null;

  function ensureExamShape(exam) {
    exam = exam && typeof exam === "object" ? exam : {};

    // Some older/cloud-synced records can arrive without questionNumbers.
    // Rebuild the list from the stored range so one malformed record cannot
    // stop the whole history list from rendering.
    if (!Array.isArray(exam.questionNumbers)) {
      const start = Number(exam.rangeStart);
      const end = Number(exam.rangeEnd);
      const type = exam.testType || "all";
      if (Number.isInteger(start) && Number.isInteger(end) && end >= start && start >= 1) {
        exam.questionNumbers = [];
        for (let n = start; n <= end; n++) {
          if (type === "odd" && n % 2 === 0) continue;
          if (type === "even" && n % 2 !== 0) continue;
          exam.questionNumbers.push(n);
        }
      } else {
        exam.questionNumbers = [];
      }
    }

    const qLen = exam.questionNumbers.length;
    if (!Array.isArray(exam.markers)) exam.markers = Array(qLen).fill(null);
    if (!Array.isArray(exam.questionTimes)) exam.questionTimes = Array(qLen).fill(0);
    if (!Array.isArray(exam.answers)) exam.answers = Array(qLen).fill(null);
    if (!Array.isArray(exam.key)) exam.key = Array(qLen).fill(null);
    if (!Array.isArray(exam.statuses)) exam.statuses = Array(qLen).fill("unanswered");
    return exam;
  }

  function isValidExamRecord(exam) {
    return !!(exam && typeof exam === "object" &&
      typeof exam.id === "string" && exam.id.trim() &&
      typeof exam.name === "string" && exam.name.trim() &&
      Number.isFinite(Number(exam.startTime)) &&
      (exam.status === "in_progress" || exam.status === "completed" || exam.status == null));
  }

  function loadExams() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const cleaned = parsed.filter(isValidExamRecord).map(ensureExamShape);
      // Purge malformed legacy rows locally so they cannot keep reappearing
      // in the history count or list. Valid exams are left untouched.
      if (cleaned.length !== parsed.length) {
        localStorage.setItem(DB_KEY, JSON.stringify(cleaned));
      }
      return cleaned;
    } catch {
      return [];
    }
  }

  function saveExams() {
    localStorage.setItem(DB_KEY, JSON.stringify(exams));
  }

  function uid() {
    return "exam_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function faNum(value) {
    return String(value).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${faNum(String(h).padStart(2,"0"))}:${faNum(String(m).padStart(2,"0"))}:${faNum(String(s).padStart(2,"0"))}`
                  : `${faNum(String(m).padStart(2,"0"))}:${faNum(String(s).padStart(2,"0"))}`;
  }

  function formatDate(ts) {
    try {
      return new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
    } catch { return new Date(ts).toLocaleString("fa-IR"); }
  }

  function typeLabel(type) {
    return type === "odd" ? "فرد" : type === "even" ? "زوج" : "همه";
  }

  function showView(name) {
    Object.values(views).forEach(v => v.classList.add("hidden"));
    views[name].classList.remove("hidden");
    window.scrollTo({top: 0, behavior: "instant"});
  }

  function showToast(message) {
    const t = $("toast");
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2300);
  }

  function normalizeAnswer(v) {
    const s = String(v ?? "").trim();
    return ["1","2","3","4"].includes(s) ? Number(s) : null;
  }

  function buildQuestionNumbers(count, type) {
    const nums = [];
    for (let n = 1; n <= count; n++) {
      if (type === "odd" && n % 2 === 0) continue;
      if (type === "even" && n % 2 !== 0) continue;
      nums.push(n);
    }
    return nums;
  }

  function parseKey(raw) {
    return String(raw || "")
      .replace(/[،؛]/g, ",")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(normalizeAnswer);
  }

  function updateQuestionPreview() {
    const start = Math.max(1, Number($("rangeStart").value) || 1);
    const end = Math.max(start, Number($("rangeEnd").value) || start);
    const type = document.querySelector('input[name="testType"]:checked')?.value || "all";
    const nums = [];
    for (let n = start; n <= end; n++) {
      if (type === "odd" && n % 2 === 0) continue;
      if (type === "even" && n % 2 !== 0) continue;
      nums.push(n);
    }
    $("questionNumbersPreview").textContent =
      nums.length <= 80
        ? nums.map(faNum).join("، ") + `  (${faNum(nums.length)} سؤال)`
        : `${faNum(nums[0])} تا ${faNum(nums[nums.length - 1])} با الگوی ${type === "odd" ? "فرد" : type === "even" ? "زوج" : "همه"}  (${faNum(nums.length)} سؤال)`;
    $("typeHelp").textContent = type === "all"
      ? "همه شماره‌ها در بازه شروع تا پایان وارد آزمون می‌شوند."
      : `فقط سؤال‌های ${type === "odd" ? "فرد" : "زوج"} داخل همین بازه وارد آزمون می‌شوند.`;
  }

  function openCreate() {
    stopTimer();
    $("createForm").reset();
    $("rangeStart").value = 1;
    $("rangeEnd").value = 30;
    document.querySelector('input[name="testType"][value="all"]').checked = true;
    updateQuestionPreview();
    showView("create");
  }

  function getIncomplete() {
    try {
      const raw = localStorage.getItem(INCOMPLETE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setIncomplete(exam) {
    localStorage.removeItem(INCOMPLETE_DELETED_KEY);
    localStorage.setItem(INCOMPLETE_KEY, JSON.stringify(exam));
  }

  function clearIncomplete() {
    localStorage.removeItem(INCOMPLETE_KEY);
    localStorage.setItem(INCOMPLETE_DELETED_KEY, new Date().toISOString());
  }

  function renderResumeBanner() {
    const inc = getIncomplete();
    if (!inc || inc.status === "completed") {
      $("resumeBanner").classList.add("hidden");
      return;
    }
    $("resumeBanner").classList.remove("hidden");
    $("resumeText").textContent = `${inc.name} · ${faNum(inc.answers.filter(Boolean).length)}/${faNum(inc.questionNumbers.length)} پاسخ`;
  }

  function populateSubjectFilter() {
    const currentSubject = $("subjectFilter").value;
    const currentTopic = $("topicFilter").value;
    const subjects = [...new Set(exams.map(e => e.subject).filter(Boolean))].sort((a,b) => a.localeCompare(b, "fa"));
    const topics = [...new Set(exams.map(e => e.topic).filter(Boolean))].sort((a,b) => a.localeCompare(b, "fa"));

    $("subjectFilter").innerHTML = `<option value="">همه درس‌ها</option>` +
      subjects.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    $("topicFilter").innerHTML = `<option value="">همه مباحث</option>` +
      topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

    if (subjects.includes(currentSubject)) $("subjectFilter").value = currentSubject;
    if (topics.includes(currentTopic)) $("topicFilter").value = currentTopic;
  }



  function openMarkedQuestion(examId, questionIndex) {
    const exam = exams.find(e => e.id === examId);
    if (!exam) {
      showToast("این آزمون دیگر در سابقه وجود ندارد.");
      return;
    }

    if (exam.status === "completed") {
      renderResult(exam);
      showView("result");
      // Highlight the requested row briefly.
      setTimeout(() => {
        const row = document.querySelector(`#resultTableWrap tbody tr:nth-child(${Number(questionIndex) + 1})`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          row.classList.add("jump-highlight");
          setTimeout(() => row.classList.remove("jump-highlight"), 1600);
        }
      }, 80);
      return;
    }

    // For an unfinished exam, resume it and jump to the exact question.
    startExam(exam, Number(questionIndex));
  }

  function renderMarkedQuestions(markerFilter) {
    const panel = $("markedQuestionsPanel");
    const listEl = $("markedQuestionsList");
    const countEl = $("markedQuestionsCount");
    const titleEl = $("markedQuestionsTitle");

    if (!markerFilter) {
      panel.classList.add("hidden");
      listEl.innerHTML = "";
      return;
    }

    const all = [];
    exams.forEach(exam => {
      ensureExamShape(exam);
      exam.markers.forEach((marker, i) => {
        if (marker !== markerFilter) return;
        all.push({
          exam,
          index: i,
          number: exam.questionNumbers[i],
          marker
        });
      });
    });

    const info = markerLabels[markerFilter];
    titleEl.textContent = `${info.icon} سؤال‌های «${info.label}»`;
    countEl.textContent = `${faNum(all.length)} سؤال`;
    panel.classList.remove("hidden");

    if (!all.length) {
      listEl.innerHTML = `<div class="empty-inline">در حال حاضر سؤالی با این علامت ثبت نشده است.</div>`;
      return;
    }

    listEl.innerHTML = all.map(item => {
      const exam = item.exam;
      const topic = exam.topic || "بدون مبحث";
      return `
        <button class="marked-question-item marked-question-link" data-marked-exam="${escapeHtml(exam.id)}" data-marked-index="${item.index}" type="button">
          <div class="marked-question-number">تست ${faNum(item.number)}</div>
          <div>
            <div class="marked-question-info">
              <strong>${escapeHtml(exam.subject || "بدون درس")}</strong>
              <span>مبحث: ${escapeHtml(topic)}</span>
              <span>آزمون: ${escapeHtml(exam.name)}</span>
            </div>
            <div class="marked-question-exam">${formatDate(exam.startTime)}</div>
          </div>
          ${markerHtml(item.marker)}
        </button>`;
    }).join("");

    listEl.querySelectorAll("[data-marked-exam]").forEach(btn => {
      btn.addEventListener("click", () => {
        openMarkedQuestion(btn.dataset.markedExam, Number(btn.dataset.markedIndex));
      });
    });
  }

  function renderHome() {
    exams = loadExams();
    populateSubjectFilter();
    renderResumeBanner();

    const search = $("searchInput").value.trim().toLocaleLowerCase("fa");
    const subject = $("subjectFilter").value;
    const topic = $("topicFilter").value;
    const type = $("typeFilter").value;
    const markerFilter = $("markerFilter").value;
    const fromRaw = Number($("questionFromFilter").value);
    const toRaw = Number($("questionToFilter").value);
    const hasFrom = Number.isFinite(fromRaw) && fromRaw > 0;
    const hasTo = Number.isFinite(toRaw) && toRaw > 0;
    const rangeFrom = hasFrom ? fromRaw : -Infinity;
    const rangeTo = hasTo ? toRaw : Infinity;
    const sort = $("sortFilter").value;

    let list = exams.filter(isValidExamRecord).filter(e => {
      const text = `${e.name} ${e.subject} ${e.topic}`.toLocaleLowerCase("fa");
      const questions = Array.isArray(e.questionNumbers) ? e.questionNumbers : [];
      // Range filter keeps an exam when at least one of its actual test numbers
      // falls inside the requested range.
      const inRange = !hasFrom && !hasTo
        ? true
        : questions.some(n => n >= rangeFrom && n <= rangeTo);

      const hasMarker = !markerFilter || (Array.isArray(e.markers) && e.markers.includes(markerFilter));
      return (!search || text.includes(search)) &&
        (!subject || e.subject === subject) &&
        (!topic || e.topic === topic) &&
        (!type || e.testType === type) &&
        hasMarker &&
        inRange;
    });
    list.sort((a,b) => sort === "newest" ? b.startTime - a.startTime : a.startTime - b.startTime);

    $("examCount").textContent = `${faNum(list.length)} آزمون`;
    renderMarkedQuestions(markerFilter);
    $("examList").innerHTML = "";
    $("emptyState").classList.toggle("hidden", list.length !== 0);

    list.forEach(rawExam => {
      // Normalize every history item independently. A single legacy/bad row
      // must never prevent the remaining exams from being displayed.
      const exam = ensureExamShape(rawExam);
      const qnums = Array.isArray(exam.questionNumbers) ? exam.questionNumbers : [];
      const item = document.createElement("div");
      item.className = "exam-item";
      const percent = exam.percent == null ? "ناتمام" : `${formatPercent(exam.percent)}٪`;
      item.innerHTML = `
        <div class="exam-info">
          <div class="exam-name">${escapeHtml(exam.name)}</div>
          <div class="exam-meta">
            <span>${escapeHtml(exam.subject || "بدون درس")}</span>
            ${exam.topic ? `<span>• ${escapeHtml(exam.topic)}</span>` : ""}
            <span>• ${faNum(qnums.length)} تست</span>
            <span>• ${faNum(exam.rangeStart ?? qnums[0] ?? 0)} تا ${faNum(exam.rangeEnd ?? qnums[qnums.length - 1] ?? 0)}</span>
            <span>• ${typeLabel(exam.testType)}</span>
            <span>• ${formatDate(exam.startTime)}</span>
            <span>• ${percent}</span>
          </div>
        </div>
        <div class="exam-actions">
          <button class="mini-btn open" data-open="${exam.id}">${exam.status === "in_progress" ? "ادامه" : "باز کردن"}</button>
          <button class="mini-btn delete" data-delete="${exam.id}">حذف</button>
        </div>`;
      $("examList").appendChild(item);
    });
  }

  function formatPercent(p) {
    if (!Number.isFinite(p)) return "۰";
    const rounded = Math.round(p * 100) / 100;
    return faNum(String(rounded).replace(/\.0+$/, ""));
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
  }

  function createExam(e) {
    e.preventDefault();
    const name = $("examName").value.trim();
    const subject = $("examSubject").value.trim();
    const topic = $("examTopic").value.trim();
    const rangeStart = Number($("rangeStart").value);
    const rangeEnd = Number($("rangeEnd").value);
    const testType = document.querySelector('input[name="testType"]:checked').value;
    const questionNumbers = [];
    if (Number.isInteger(rangeStart) && Number.isInteger(rangeEnd) && rangeStart >= 1 && rangeEnd >= rangeStart) {
      for (let n = rangeStart; n <= rangeEnd; n++) {
        if (testType === "odd" && n % 2 === 0) continue;
        if (testType === "even" && n % 2 !== 0) continue;
        questionNumbers.push(n);
      }
    }

    if (!name || !subject || !Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) ||
        rangeStart < 1 || rangeEnd < rangeStart || rangeEnd > 1000000 || !questionNumbers.length || questionNumbers.length > 10000) {
      showToast("بازه سؤال‌ها را درست وارد کن.");
      return;
    }

    const now = Date.now();
    activeExam = {
      id: uid(), name, subject, topic, rangeStart, rangeEnd,
      questionCount: questionNumbers.length, testType, questionNumbers,
      startTime: now, endTime: null, totalTime: 0,
      answers: Array(questionNumbers.length).fill(null),
      key: Array(questionNumbers.length).fill(null),
      statuses: Array(questionNumbers.length).fill("unanswered"),
      questionTimes: Array(questionNumbers.length).fill(0),
      markers: Array(questionNumbers.length).fill(null),
      correct: 0, wrong: 0, blank: questionNumbers.length, percent: null,
      status: "in_progress", currentIndex: 0, lastTickAt: now
    };
    setIncomplete(activeExam);
    openSolve(activeExam);
  }

  function openSolve(exam) {
    activeExam = ensureExamShape(structuredClone(exam));
    currentIndex = Number(activeExam.currentIndex || 0);
    if (currentIndex >= activeExam.questionNumbers.length) currentIndex = 0;
    activeExam.lastTickAt = Date.now();
    renderSolve();
    startTimer();
    showView("solve");
  }

  function renderSolve() {
    if (!activeExam) return;
    $("solveExamName").textContent = activeExam.name;
    $("solveMeta").textContent = `${activeExam.subject}${activeExam.topic ? " · " + activeExam.topic : ""} · ${faNum(activeExam.questionNumbers.length)} تست · ${typeLabel(activeExam.testType)}`;
    $("totalTimer").textContent = formatTime(activeExam.totalTime);
    renderQuestionGrid();
    renderCurrentQuestion();
  }

  function renderQuestionGrid() {
    const grid = $("questionGrid");
    grid.innerHTML = "";
    activeExam.questionNumbers.forEach((num, i) => {
      const b = document.createElement("button");
      b.className = "qnav";
      if (i === currentIndex) b.classList.add("current");
      if (activeExam.answers[i] != null) b.classList.add("answered");
      b.textContent = faNum(num);
      if (activeExam.markers[i]) {
        b.dataset.marker = activeExam.markers[i];
        b.title = `${markerLabels[activeExam.markers[i]].icon} ${markerLabels[activeExam.markers[i]].label}`;
      }
      b.title = `سؤال ${num}`;
      b.addEventListener("click", () => goToQuestion(i));
      grid.appendChild(b);
    });
    $("progressText").textContent = `${faNum(currentIndex + 1)} / ${faNum(activeExam.questionNumbers.length)}`;
  }

  function renderCurrentQuestion() {
    const num = activeExam.questionNumbers[currentIndex];
    $("currentQuestionNumber").textContent = faNum(num);
    $("currentTimer").textContent = formatTime(activeExam.questionTimes[currentIndex]);
    document.querySelectorAll(".option").forEach(btn => {
      btn.classList.toggle("selected", Number(btn.dataset.answer) === activeExam.answers[currentIndex]);
    });
    document.querySelectorAll(".marker-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.marker === activeExam.markers[currentIndex]);
    });
    $("prevQuestion").disabled = currentIndex === 0;
    $("nextQuestion").textContent = currentIndex === activeExam.questionNumbers.length - 1 ? "سؤال آخر →" : "بعدی ←";
  }

  function startTimer() {
    stopTimer();
    lastTick = performance.now();
    timerLoop = setInterval(() => {
      if (!activeExam || document.hidden || !document.hasFocus()) {
        lastTick = performance.now();
        return;
      }
      const now = performance.now();
      const delta = Math.min(1.5, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      activeExam.totalTime += delta;
      activeExam.questionTimes[currentIndex] += delta;
      activeExam.lastTickAt = Date.now();
      $("totalTimer").textContent = formatTime(activeExam.totalTime);
      $("currentTimer").textContent = formatTime(activeExam.questionTimes[currentIndex]);

      if (!saveTimer) {
        saveTimer = setTimeout(() => {
          saveTimer = null;
          persistActive();
        }, SAVE_INTERVAL);
      }
    }, 250);
  }

  function stopTimer() {
    if (timerLoop) clearInterval(timerLoop);
    timerLoop = null;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
  }

  function persistActive() {
    if (!activeExam || activeExam.status !== "in_progress") return;
    activeExam.currentIndex = currentIndex;
    activeExam.lastTickAt = Date.now();
    setIncomplete(activeExam);
  }

  function cancelAutoAdvance() {
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function scheduleAutoAdvance() {
    cancelAutoAdvance();
    if (!activeExam || activeExam.status !== "in_progress") return;
    if (currentIndex >= activeExam.questionNumbers.length - 1) return;
    autoAdvanceTimer = setTimeout(() => {
      autoAdvanceTimer = null;
      if (activeExam?.status === "in_progress") goToQuestion(currentIndex + 1);
    }, AUTO_ADVANCE_MS);
  }

  function selectAnswer(answer) {
    const chosen = normalizeAnswer(answer);
    // Clicking the already-selected option clears it and makes the question unanswered.
    const wasSelected = activeExam.answers[currentIndex] === chosen;
    activeExam.answers[currentIndex] = wasSelected ? null : chosen;
    persistActive();
    renderQuestionGrid();
    renderCurrentQuestion();
    if (wasSelected) cancelAutoAdvance();
    else scheduleAutoAdvance();
  }

  function clearAnswer() {
    activeExam.answers[currentIndex] = null;
    persistActive();
    renderQuestionGrid();
    renderCurrentQuestion();
  }

  const markerLabels = {
    hard: { icon: "★", label: "سخت" },
    unknown: { icon: "×", label: "بلد نبودم" },
    careless: { icon: "−", label: "بی‌دقتی" },
    review: { icon: "○", label: "مرور" }
  };

  function toggleMarker(marker) {
    activeExam.markers[currentIndex] =
      activeExam.markers[currentIndex] === marker ? null : marker;
    persistActive();
    renderQuestionGrid();
    renderCurrentQuestion();
  }

  function markerHtml(marker) {
    if (!marker || !markerLabels[marker]) return "−";
    const m = markerLabels[marker];
    return `<span class="marker-chip ${marker}">${m.icon} ${m.label}</span>`;
  }

  function setStoredMarker(exam, index, marker) {
    exam.markers[index] = exam.markers[index] === marker ? null : marker;
    const idx = exams.findIndex(e => e.id === exam.id);
    if (idx >= 0) {
      exams[idx] = exam;
      saveExams();
    }
    if (activeExam?.id === exam.id) activeExam.markers = exam.markers;
    renderResult(exam);
  }

  function goToQuestion(index) {
    if (!activeExam || index < 0 || index >= activeExam.questionNumbers.length) return;
    cancelAutoAdvance();
    currentIndex = index;
    activeExam.currentIndex = index;
    persistActive();
    renderQuestionGrid();
    renderCurrentQuestion();
  }

  function finishExam() {
    if (!activeExam) return;
    cancelAutoAdvance();
    stopTimer();
    persistActive();

    const answered = activeExam.answers.filter(a => a != null).length;
    $("keyDialogText").textContent =
      `گزینه‌های شما ثبت شده‌اند: ${faNum(answered)} از ${faNum(activeExam.questionNumbers.length)} سؤال پاسخ داده شده. حالا کلید را وارد کن تا آزمون تصحیح شود.`;
    $("finishAnswerKey").value = "";
    $("keyDialog").showModal();
    setTimeout(() => $("finishAnswerKey").focus(), 50);
  }

  function correctAndFinish() {
    if (!activeExam) return;
    const keyRaw = parseKey($("finishAnswerKey").value);

    if (keyRaw.length !== activeExam.questionNumbers.length) {
      showToast(`تعداد کلیدها باید ${faNum(activeExam.questionNumbers.length)} عدد باشد.`);
      return;
    }

    stopTimer();
    activeExam.key = keyRaw;
    activeExam.endTime = Date.now();
    activeExam.status = "completed";
    activeExam.currentIndex = currentIndex;

    let correct = 0, wrong = 0, blank = 0;
    activeExam.answers.forEach((ans, i) => {
      const key = activeExam.key[i];
      if (ans == null) {
        blank++;
        activeExam.statuses[i] = "unanswered";
      } else if (key != null && ans === key) {
        correct++;
        activeExam.statuses[i] = "correct";
      } else if (key != null) {
        wrong++;
        activeExam.statuses[i] = "wrong";
      } else {
        activeExam.statuses[i] = "unanswered";
      }
    });

    activeExam.correct = correct;
    activeExam.wrong = wrong;
    activeExam.blank = blank;
    const keyedCount = activeExam.key.filter(k => k != null).length;
    activeExam.percent = keyedCount
      ? ((correct * 3 - wrong) / (keyedCount * 3)) * 100
      : null;

    const idx = exams.findIndex(e => e.id === activeExam.id);
    if (idx >= 0) exams[idx] = activeExam;
    else exams.push(activeExam);
    saveExams();
    clearIncomplete();
    $("keyDialog").close();
    renderResult(activeExam);
    showView("result");
  }


  function getSmartAnalysis(exam) {
    ensureExamShape(exam);
    const times = exam.questionTimes || [];
    const activeTimes = times.filter(t => t > 0);
    const avg = activeTimes.length ? activeTimes.reduce((a,b) => a+b,0) / activeTimes.length : 0;
    const slowThreshold = Math.max(avg * 1.7, 90);
    const candidates = [];
    let marked=0, slow=0, attention=0, reviewed=0;

    exam.questionNumbers.forEach((num,i) => {
      const marker=exam.markers[i], time=times[i]||0, status=exam.statuses[i];
      if(marker) marked++;
      if(marker==="review") reviewed++;
      if(time>=slowThreshold) slow++;

      let reason=null, badge=null;
      if(marker && markerLabels[marker]){
        reason=`علامت ثبت‌شده: ${markerLabels[marker].label}`;
        badge=marker;
      } else if(status==="wrong" && time>=slowThreshold){
        reason=`غلط + زمان بالا (${formatTime(time)})`; badge="slow";
      } else if(status==="wrong"){
        reason="غلط"; badge="unknown";
      } else if(time>=slowThreshold){
        reason=`زمان بالا (${formatTime(time)})`; badge="slow";
      }
      if(reason){
        if(status==="wrong" || marker==="unknown" || marker==="careless") attention++;
        candidates.push({num,index:i,marker,time,reason,badge,status,avg,slowThreshold});
      }
    });
    return {avg,marked,slow,attention,reviewed,candidates};
  }


  function questionPersona(item) {
    if (item.marker === "unknown") return "🚧 سؤال دردسرساز: این یکی را بلد نبودی؛ بعداً با پاسخ تشریحی شکارش کن.";
    if (item.marker === "careless") return "🧐 سؤال حساس: بی‌دقتی ثبت شده؛ موقع مرور، علت اشتباه را پیدا کن.";
    if (item.marker === "hard") return "🧠 سؤال چالشی: خودت سخت علامتش زده‌ای؛ برای مرور ویژه نگهش دار.";
    if (item.marker === "review") return "🔵 سؤال برگشتی: برای مرور نگه داشته‌ای.";
    if (item.status === "wrong" && item.time >= item.slowThreshold) return "⚠️ سؤال زمان‌گیر: هم غلط شده، هم زمان زیادی گرفته.";
    if (item.status === "wrong") return "🔍 سؤال نیازمند کالبدشکافی: پاسخ غلط بوده؛ علت اشتباه را بررسی کن.";
    if (item.time >= item.slowThreshold) return "⏳ سؤال زمان‌گیر: زمان پاسخ‌گویی از میانگین آزمون بالاتر بوده.";
    if (item.status === "correct" && item.time > 0 && item.time <= item.avg * 0.55) return "⚡ سؤال روان: با زمان کم و پاسخ درست حل شده.";
    return "🧩 سؤال معمولی: داده خاصی برای هشدار ثبت نشده.";
  }

  function getOverallStudyStatus(exam) {
    const total = exam.questionNumbers.length || 0;
    const answered = (exam.answers || []).filter(a => a != null).length;
    const pct = Number.isFinite(exam.percent) ? exam.percent : null;
    if (pct == null) return { icon:"📝", text:"کلید هنوز ثبت نشده؛ بعد از تصحیح وضعیت آزمون مشخص می‌شود." };
    if (pct >= 80 && exam.wrong <= Math.max(1, Math.round(total * 0.08))) return { icon:"🌟", text:"عملکردت خیلی خوب بوده؛ پایه‌ی آزمون محکم بوده." };
    if (pct >= 60) return { icon:"😊", text:"خوبه؛ با مرور غلط‌ها و نکات، جای رشد خوبی داری." };
    if (pct >= 40) return { icon:"🔧", text:"قابل بهبود؛ چند مرور هدفمند می‌تواند نتیجه را بهتر کند." };
    return { icon:"🧭", text:"فعلاً نیاز به مرور بیشتری داری؛ از غلط‌ها شروع کن." };
  }

  function renderSmartAnalysis(exam, selectedFilter = "all") {
    const body = $("smartAnalysisBody");
    if (!body) return;
    const d = getSmartAnalysis(exam);
    const filters = {
      all: x => true,
      marked: x => !!x.marker,
      slow: x => x.time >= x.slowThreshold,
      attention: x => x.status === "wrong" || x.marker === "unknown" || x.marker === "careless",
      reviewed: x => x.marker === "review"
    };
    const related = d.candidates
      .filter(filters[selectedFilter] || filters.all)
      .sort((a,b) => {
        const score = x => (x.marker ? 100 : 0) + (x.status === "wrong" ? 30 : 0) + x.time;
        return score(b) - score(a);
      });

    const cards = [
      ["marked", d.marked, "علامت‌گذاری‌شده", "★"],
      ["slow", d.slow, "زمان بالا", "⏳"],
      ["attention", d.attention, "نیازمند توجه", "⚠️"],
      ["reviewed", d.reviewed, "برای مرور", "○"]
    ];

    const overall = getOverallStudyStatus(exam);
    body.innerHTML = `
      <div class="smart-overview">
        <div class="smart-total-box"><strong>${faNum(exam.questionNumbers.length)}</strong><span>تعداد کل سؤال‌ها</span></div>
        <div class="smart-status-box"><strong>${overall.icon} وضعیت کلی آزمون</strong><span>${escapeHtml(overall.text)}</span></div>
      </div>
      <div class="smart-summary">
        ${cards.map(([key,count,label,icon]) => `
          <button type="button" class="smart-stat smart-filter-card ${selectedFilter === key ? "active" : ""}" data-smart-filter="${key}">
            <strong>${faNum(count)}</strong><span>${icon} ${label}</span>
          </button>`).join("")}
      </div>
      <div class="smart-filter-caption">
        ${selectedFilter === "all" ? "همه موارد قابل توجه" :
          selectedFilter === "marked" ? "تست‌هایی که برایشان علامت ثبت کرده‌ای" :
          selectedFilter === "slow" ? "تست‌هایی که زمانشان از آستانه زمانی آزمون بیشتر است" :
          selectedFilter === "attention" ? "تست‌های غلط یا علامت‌گذاری‌شده به‌عنوان بلد نبودم / بی‌دقتی" :
          "تست‌هایی که برای مرور علامت زده‌ای"}
      </div>
      ${related.length ? `<div class="smart-list">${related.map(x => `
        <button type="button" class="smart-item smart-question-link" data-smart-index="${x.index}">
          <div class="smart-item-num">تست ${faNum(x.num)}</div>
          <div class="smart-item-info">
            <strong>${escapeHtml(x.reason)}</strong><br>
            ${escapeHtml(questionPersona(x))}<br>
            ${escapeHtml(exam.subject || "بدون درس")} · ${escapeHtml(exam.topic || "بدون مبحث")}
          </div>
          <span class="smart-badge ${x.badge}">
            ${x.marker ? markerLabels[x.marker].icon + " " + markerLabels[x.marker].label : "زمان بالا"}
          </span>
        </button>`).join("")}</div>` :
        `<div class="smart-empty">در این دسته موردی وجود ندارد.</div>`}
    `;

    body.querySelectorAll("[data-smart-filter]").forEach(btn => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.smartFilter;
        renderSmartAnalysis(exam, selectedFilter === next ? "all" : next);
      });
    });
    body.querySelectorAll("[data-smart-index]").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.smartIndex);
        const row = document.querySelector(`#resultTableWrap tbody tr:nth-child(${i + 1})`);
        if (row) {
          row.scrollIntoView({behavior:"smooth", block:"center"});
          row.classList.add("jump-highlight");
          setTimeout(() => row.classList.remove("jump-highlight"), 1600);
        }
      });
    });
  }

  function renderResult(exam) {
    exam = ensureExamShape(exam);
    $("resultSubtitle").textContent = `${exam.name} · ${formatDate(exam.startTime)}${exam.endTime ? " تا " + formatDate(exam.endTime) : ""}`;
    $("resultPercent").textContent = exam.percent == null ? "بدون کلید" : `${formatPercent(exam.percent)}٪`;
    $("resultCorrect").textContent = faNum(exam.correct);
    $("resultWrong").textContent = faNum(exam.wrong);
    $("resultBlank").textContent = faNum(exam.blank);
    $("resultTotalTime").textContent = formatTime(exam.totalTime);
    $("resultAverage").textContent = formatTime(exam.questionNumbers.length ? exam.totalTime / exam.questionNumbers.length : 0);

    const rows = exam.questionNumbers.map((num, i) => {
      const status = exam.statuses[i];
      const label = status === "correct" ? "درست" : status === "wrong" ? "غلط" : status === "unanswered" ? "نزده" : "بدون کلید";
      const cls = status === "correct" ? "correct" : status === "wrong" ? "wrong" : "blank";
      const ans = exam.answers[i] == null ? "−" : faNum(exam.answers[i]);
      const key = exam.key[i] == null ? "−" : faNum(exam.key[i]);
      const markerButtons = Object.keys(markerLabels).map(marker => {
        const m = markerLabels[marker];
        return `<button class="result-edit-marker ${exam.markers[i] === marker ? "active" : ""}" data-result-marker="${marker}" data-result-index="${i}" title="${m.label}">${m.icon}</button>`;
      }).join("");
      return `<tr><td>${faNum(num)}</td><td>${ans}</td><td>${key}</td><td><span class="status ${cls}">${label}</span></td><td><div class="result-marker-controls">${markerButtons}</div>${exam.markers[i] ? markerHtml(exam.markers[i]) : ""}</td><td>${formatTime(exam.questionTimes[i])}</td></tr>`;
    }).join("");

    $("resultTableWrap").innerHTML = `
      <table class="result-table">
        <thead><tr><th>سؤال</th><th>پاسخ</th><th>کلید</th><th>وضعیت</th><th>علامت</th><th>زمان</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    renderSmartAnalysis(exam);
    $("resultTableWrap").querySelectorAll("[data-result-marker]").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.resultIndex);
        setStoredMarker(exam, i, btn.dataset.resultMarker);
      });
    });
  }

  function exportResultPdf(exam) {
    exam = ensureExamShape(exam);
    const report = window.open("", "_blank", "width=900,height=800");
    if (!report) {
      showToast("پنجره گزارش باز نشد؛ اجازه باز شدن پنجره جدید را بده.");
      return;
    }

    const d = getSmartAnalysis(exam);
    const overall = getOverallStudyStatus(exam);
    const rows = exam.questionNumbers.map((num, i) => {
      const status = exam.statuses[i];
      const label = status === "correct" ? "درست" : status === "wrong" ? "غلط" : status === "unanswered" ? "نزده" : "بدون کلید";
      const cls = status === "correct" ? "correct" : status === "wrong" ? "wrong" : "blank";
      const ans = exam.answers[i] == null ? "−" : faNum(exam.answers[i]);
      const key = exam.key[i] == null ? "−" : faNum(exam.key[i]);
      const mark = exam.markers[i] && markerLabels[exam.markers[i]]
        ? `${markerLabels[exam.markers[i]].icon} ${markerLabels[exam.markers[i]].label}` : "−";
      return `<tr><td>${faNum(num)}</td><td>${ans}</td><td>${key}</td><td class="${cls}">${label}</td><td>${mark}</td><td>${formatTime(exam.questionTimes[i])}</td></tr>`;
    }).join("");

    const smartRows = d.candidates.length ? d.candidates.map(x => `
      <tr><td>${faNum(x.num)}</td><td>${escapeHtml(x.reason)}</td><td>${escapeHtml(questionPersona(x))}</td><td>${escapeHtml(exam.subject || "بدون درس")}</td><td>${escapeHtml(exam.topic || "بدون مبحث")}</td></tr>
    `).join("") : `<tr><td colspan="5">مورد ویژه‌ای در تحلیلگر تست ثبت نشده است.</td></tr>`;

    report.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>گزارش آزمون - ${escapeHtml(exam.name)}</title>
      <style>
        *{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#172033;background:#fff;margin:0;padding:28px;font-size:12px;line-height:1.8}
        h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px;border-bottom:2px solid #2563eb;padding-bottom:5px}
        .muted{color:#64748b}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #e2e8f0;padding-bottom:14px}
        .meta{margin-top:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.box{border:1px solid #e2e8f0;border-radius:9px;padding:8px;text-align:center}.box b{display:block;font-size:15px}.box span{color:#64748b;font-size:10px}
        .status{margin-top:12px;border:1px solid #dbeafe;background:#eff6ff;border-radius:9px;padding:8px}.status b{display:block}
        table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #e2e8f0;padding:6px;text-align:center}th{background:#f8fafc;font-weight:800}.correct{color:#15803d;background:#f0fdf4}.wrong{color:#dc2626;background:#fef2f2}.blank{color:#64748b;background:#f8fafc}
        .print-note{font-size:10px;color:#64748b;margin-top:20px}@media print{body{padding:12px}.no-print{display:none}.box,.status,table{break-inside:avoid}h2{break-after:avoid}tr{break-inside:avoid}}
      </style></head><body>
      <div class="head"><div><h1>گزارش نتیجه آزمون</h1><div>${escapeHtml(exam.name)}</div><div class="muted">${escapeHtml(exam.subject || "بدون درس")} · ${escapeHtml(exam.topic || "بدون مبحث")} · ${escapeHtml(typeLabel(exam.type))}</div></div>
      <div class="muted">${formatDate(exam.startTime)}${exam.endTime ? " تا " + formatDate(exam.endTime) : ""}</div></div>
      <div class="meta">
        <div class="box"><span>درصد</span><b>${exam.percent == null ? "بدون کلید" : formatPercent(exam.percent) + "٪"}</b></div>
        <div class="box"><span>درست</span><b>${faNum(exam.correct)}</b></div>
        <div class="box"><span>غلط</span><b>${faNum(exam.wrong)}</b></div>
        <div class="box"><span>نزده</span><b>${faNum(exam.blank)}</b></div>
        <div class="box"><span>تعداد کل سؤال‌ها</span><b>${faNum(exam.questionNumbers.length)}</b></div>
        <div class="box"><span>زمان کل</span><b>${formatTime(exam.totalTime)}</b></div>
        <div class="box"><span>میانگین هر سؤال</span><b>${formatTime(exam.questionNumbers.length ? exam.totalTime / exam.questionNumbers.length : 0)}</b></div>
        <div class="box"><span>بازه تست</span><b>${exam.rangeStart != null ? faNum(exam.rangeStart) + " تا " + faNum(exam.rangeEnd) : "−"}</b></div>
      </div>
      <div class="status"><b>${overall.icon} وضعیت کلی آزمون</b>${escapeHtml(overall.text)}</div>
      <h2>تحلیل سؤال‌به‌سؤال</h2>
      <table><thead><tr><th>سؤال</th><th>پاسخ</th><th>کلید</th><th>وضعیت</th><th>علامت</th><th>زمان</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>تحلیلگر تست</h2>
      <div class="muted">موارد زیر بر اساس پاسخ، زمان و علامت‌های ثبت‌شده در آزمون تهیه شده‌اند.</div>
      <table><thead><tr><th>تست</th><th>دلیل</th><th>توضیح</th><th>درس</th><th>مبحث</th></tr></thead><tbody>${smartRows}</tbody></table>
      <div class="print-note">این گزارش از اطلاعات ذخیره‌شده همین آزمون در دفتر آزمون تهیه شده است.</div>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`);
    report.document.close();
  }


  $("exportResultPdf").addEventListener("click", () => {
    if (activeExam?.status === "completed") exportResultPdf(activeExam);
    else showToast("ابتدا آزمون را کامل و تصحیح کن.");
  });

  function requestDelete(id, incomplete = false) {
    pendingDeleteId = { id, incomplete };
    $("dialogTitle").textContent = "حذف آزمون؟";
    $("dialogText").textContent = incomplete
      ? "آزمون نیمه‌کاره و تمام پاسخ‌های ذخیره‌شده آن حذف می‌شود."
      : "این آزمون از سابقه دائمی حذف می‌شود و قابل برگشت نیست.";
    $("dialogConfirm").textContent = "حذف";
    $("confirmDialog").showModal();
  }

  function confirmDelete() {
    if (!pendingDeleteId) return;
    if (pendingDeleteId.incomplete) {
      clearIncomplete();
      renderResumeBanner();
      showToast("آزمون نیمه‌کاره حذف شد.");
    } else {
      exams = exams.filter(e => e.id !== pendingDeleteId.id);
      saveExams();
      renderHome();
      showToast("آزمون حذف شد.");
    }
    pendingDeleteId = null;
    $("confirmDialog").close();
  }

  function openStoredExam(id) {
    const exam = exams.find(e => e.id === id);
    if (!exam) return;
    if (exam.status === "in_progress") {
      openSolve(exam);
    } else {
      activeExam = structuredClone(exam);
      renderResult(activeExam);
      showView("result");
    }
  }

  function resumeIncomplete() {
    const inc = getIncomplete();
    if (!inc) return;
    openSolve(inc);
  }

  // Events
  function goHome() {
    cancelAutoAdvance();
    stopTimer();
    try { renderHome(); } catch (_) {}
    try { showView("home"); } catch (_) {
      Object.entries(views).forEach(([key, el]) => {
        if (el) el.classList.toggle("hidden", key !== "home");
      });
    }
    window.scrollTo({top: 0, behavior: "instant"});
  }

  window.__azmoonGoHome = goHome;

  const historyNav = $("historyNav");
  if (historyNav) historyNav.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); goHome(); }, true);

  ["studyBackHome","backHomeFromCreate","backHomeFromSolve","backHomeFromResult"].forEach(id => {
    const btn = $(id);
    if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); goHome(); }, true);
  });
  $("newExamTop").addEventListener("click", openCreate);
  $("newExamEmpty").addEventListener("click", openCreate);
  $("backHomeFromCreate").addEventListener("click", () => { renderHome(); showView("home"); });
  $("cancelCreate").addEventListener("click", () => { renderHome(); showView("home"); });
  $("createForm").addEventListener("submit", createExam);

  $("rangeStart").addEventListener("input", updateQuestionPreview);
  $("rangeEnd").addEventListener("input", updateQuestionPreview);
  document.querySelectorAll('input[name="testType"]').forEach(r => r.addEventListener("change", updateQuestionPreview));

  ["searchInput","subjectFilter","topicFilter","typeFilter","markerFilter","questionFromFilter","questionToFilter","sortFilter"].forEach(id => {
    $(id).addEventListener("input", renderHome);
    $(id).addEventListener("change", renderHome);
  });
  $("examList").addEventListener("click", e => {
    const open = e.target.closest("[data-open]");
    const del = e.target.closest("[data-delete]");
    if (open) openStoredExam(open.dataset.open);
    if (del) requestDelete(del.dataset.delete);
  });

  $("resumeBtn").addEventListener("click", resumeIncomplete);
  $("discardIncompleteBtn").addEventListener("click", () => requestDelete(null, true));

  document.querySelectorAll(".option").forEach(btn => btn.addEventListener("click", () => selectAnswer(btn.dataset.answer)));
  document.querySelectorAll(".marker-btn").forEach(btn => btn.addEventListener("click", () => toggleMarker(btn.dataset.marker)));
  if ($("clearAnswer")) $("clearAnswer").addEventListener("click", clearAnswer);
  $("prevQuestion").addEventListener("click", () => goToQuestion(currentIndex - 1));
  $("nextQuestion").addEventListener("click", () => goToQuestion(currentIndex + 1));
  $("finishExamSide").addEventListener("click", finishExam);
  $("finishExamBottom").addEventListener("click", finishExam);
  $("keyDialogCancel").addEventListener("click", () => {
    $("keyDialog").close();
    if (activeExam?.status === "in_progress") {
      lastTick = performance.now();
      startTimer();
    }
  });
  $("keyDialogConfirm").addEventListener("click", correctAndFinish);

  $("backHomeFromSolve").addEventListener("click", () => {
    cancelAutoAdvance();
    persistActive();
    stopTimer();
    renderHome();
    showView("home");
    showToast("پیشرفت آزمون ذخیره شد.");
  });
  $("backHomeFromResult").addEventListener("click", () => { renderHome(); showView("home"); });

  $("dialogCancel").addEventListener("click", () => {
    pendingDeleteId = null;
    $("confirmDialog").close();
  });
  $("dialogConfirm").addEventListener("click", confirmDelete);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persistActive();
    } else {
      lastTick = performance.now();
      if (activeExam?.status === "in_progress") startTimer();
    }
  });
  window.addEventListener("blur", () => persistActive());
  window.addEventListener("focus", () => {
    lastTick = performance.now();
  });
  window.addEventListener("beforeunload", () => {
    persistActive();
    stopTimer();
  });

  // Expose a tiny refresh hook for the optional cloud-sync module.
  window.__azmoonRenderHome = renderHome;

  // Initial state
  updateQuestionPreview();
  renderHome();
  showView("home");
})();
