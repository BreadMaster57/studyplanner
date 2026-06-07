// ==========================================
// 1. DATA & STATE
// ==========================================

/*
  subjectsData is the main array of all our subjects.
  We try to load it from localStorage (the browser’s storage).
  If nothing is saved, we start with an empty array [].
*/
let rawSubjects = JSON.parse(localStorage.getItem("subjectsData")) || [];

/*
  Sometimes old versions of the app saved subjects as plain strings.
  This loop “sanitises” the data:
  - If it’s a string, turn it into an object with a name, empty topics, and empty sessions.
  - If it’s already an object but missing a name, give it “Untitled Subject”.
  - Otherwise keep it as is.
*/
let subjectsData = rawSubjects.map(sub => {
    if (typeof sub === "string") return { name: sub, topics: [], sessions: [] };
    if (sub && typeof sub === "object" && !sub.name)
        return { name: "Untitled Subject", topics: sub.topics || [], sessions: sub.sessions || [] };
    return sub;
});

/*
  blockedEvents stores the dates that the user has marked as “Exam”, “Holiday”, etc.
  It’s an object where each key is a date string (YYYY-MM-DD) and the value is the event name.
*/
let blockedEvents = JSON.parse(localStorage.getItem("blockedEvents")) || {};

/*
  Timer IDs so we can stop them later.
  - alarmInterval: the beeping sound
  - countdown: the focus countdown
  - breakInterval: the break countdown
*/
let alarmInterval = null;
let countdown = null;
let breakInterval = null;

/*
  selectionRange keeps track of the user’s date‑range selection.
  When they click a start date, we store it and the DOM element.
  When they click an end date, we mark all days in between.
*/
let selectionRange = { start: null, end: null, element: null };

/*
  Chart.js objects – we’ll create and destroy them as needed.
*/
let radarChart = null;
let volumeChart = null;

/*
  AudioContext is needed to create the beeping sound.
  Some browsers use webkitAudioContext instead of AudioContext.
*/
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

/*
  Subject colours for light mode (pastel tones).
*/
const subjectColors = {
    "Math": "#ffb3ba",
    "Biology": "#baffc9",
    "Physics": "#bae1ff",
    "Chem": "#d1c4e9",
    "Computer Science": "#faa0f2",
    "Grammar": "#ffdfba",
    "Reading": "#ffffba",
    "Literature": "#bae1be",
    "Listening Speaking": "#e1bae1",
    "Writing": "#bae1df"
};

/*
  Subject colours for dark mode (darker, muted versions of the light colours).
*/
const darkSubjectColors = {
    "Math": "#c44b4b",
    "Biology": "#4b8c5e",
    "Physics": "#4b6e8c",
    "Chem": "#6b5b8c",
    "Computer Science": "#8c4b8c",
    "Grammar": "#8c6b4b",
    "Reading": "#8c8c4b",
    "Literature": "#4b8c5e",
    "Listening Speaking": "#6b4b8c",
    "Writing": "#4b8c8c"
};

/*
  Fallback colours if a subject doesn’t match any key in the colour objects.
*/
const defaultColor = "#e5e7eb";
const darkDefaultColor = "#3a3b4e";

/*
  Preset curriculums for UITM.
  The user can pick a semester and course to quickly load a set of subjects.
*/
const uitmPresets = {
    "Sem 1": {
        "Science": ["Mathematics", "Chemistry I", "Biology I", "Physics I"],
        "Engineering": ["Mathematics", "Chemistry I", "Computer Science", "Physics I"],
        "TESL": ["Grammar", "Reading", "Literature", "Listening Speaking", "Writing"],
        "Law": [
            "Fundamentals of ICT (CSC034)",
            "Basic Principles of Islamic Law (CTU091)",
            "Intro to Malaysian Legal System (LAW033)",
            "Intro to Legal Theories (LAW034)",
            "Intro to Legal Learning Skills (LAW035)",
            "Social Psychology for Law (LAW036)",
            "Intensive English for Foundation (LCC021)",
            "Intro to Academic Reading & Reasoning (LCC031)"
        ]
    },
    "Sem 2": {
        "Science": ["Mathematics for Scientists", "Chem II", "Bio II", "Phy II"],
        "Engineering": ["Mathematics for Engineers", "Chem II", "Phy II", "CS II"],
        "TESL": ["Grammar", "Reading", "Drama", "Listening Speaking", "Writing"],
        "Law": [
            "Islamic Legal System (CTU092)",
            "Intro to Economics (ECO099)",
            "Intro to Law of Contract, Torts & Crimes (LAW083)",
            "Intro to Malaysian System of Government (LAW084)",
            "Contemporary Global & Legal Issues (LAW088)",
            "Intro to Academic Writing (LCC032)",
            "Fundamentals of Communication Skills (LCC033)"
        ]
    }
};

/*
  This array holds the current month’s schedule (date + list of subject names).
  It’s used when the user exports an ICS file.
  We fill it inside generateTimetable().
*/
let currentMonthSchedule = [];

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

/*
  refreshUI() is called whenever something changes.
  It re‑renders every part of the page.
*/
function refreshUI() {
    renderSubjects();      // update the subject list and dropdown
    renderStreak();        // update the streak counter
    generateTimetable();   // redraw the calendar
    renderActivityFeed();  // update the recent activity log
    renderAnalytics();     // redraw the charts
}

/*
  saveToStorage() writes the current subjectsData and blockedEvents
  to the browser’s localStorage so they survive a page reload.
*/
function saveToStorage() {
    localStorage.setItem("subjectsData", JSON.stringify(subjectsData));
    localStorage.setItem("blockedEvents", JSON.stringify(blockedEvents));
}

/*
  calculateSubjectScore(subject)
  Returns the average rating (1‑5) for a subject.
  If the subject has no sessions, it returns 0.
*/
function calculateSubjectScore(subject) {
    if (!subject || !subject.sessions || subject.sessions.length === 0) return 0;
    const total = subject.sessions.reduce((sum, s) => sum + s.score, 0);
    return total / subject.sessions.length;
}

/*
  getAllSessions()
  Collects every session from all subjects into one flat array.
  Each session object also gets a 'subject' property (the subject’s name).
*/
function getAllSessions() {
    let all = [];
    subjectsData.forEach(sub => {
        if (sub.sessions) {
            sub.sessions.forEach(s => all.push({ ...s, subject: sub.name }));
        }
    });
    return all;
}

/*
  getFocusDuration()
  Reads the current focus duration (in minutes) from the input field.
  If the input doesn’t exist or is empty, it returns 25.
*/
function getFocusDuration() {
    const el = document.getElementById("focus-duration");
    return el ? parseInt(el.value) || 25 : 25;
}

/*
  getBreakDuration()
  Reads the current break duration from the input field.
  Default is 5 minutes.
*/
function getBreakDuration() {
    const el = document.getElementById("break-duration");
    return el ? parseInt(el.value) || 5 : 5;
}

// ==========================================
// 3. RENDERING FUNCTIONS
// ==========================================

/*
  renderSubjects()
  Fills the sidebar with the list of subjects and their topics,
  and also populates the dropdown (<select>) that the user picks before starting a session.
*/
function renderSubjects() {
    const list = document.getElementById("subject-list");
    const selector = document.getElementById("subject-selector");
    if (!list || !selector) return;

    list.innerHTML = "";                                                // clear existing list
    selector.innerHTML = '<option value="">-- Select a Subject --</option>';  // default option

    // Loop through each subject
    subjectsData.forEach((sub, index) => {
        const score = calculateSubjectScore(sub);
        const percentage = (score / 5) * 100;   // convert score to percentage for progress bar
        let barColor = score >= 4 ? '#4caf50' : (score >= 2 ? '#ffcc00' : '#ff4d4d');  // green / yellow / red

        const li = document.createElement("li");
        li.className = "subject-item";
        li.style.marginBottom = "25px";
        li.style.borderBottom = "1px solid var(--border)";
        li.style.paddingBottom = "15px";

        // Build HTML for the topics list (each topic has a checkbox and a delete button)
        let topicsHTML = `<ul style="list-style:none; padding:0; margin-top:10px; font-size:0.85rem;">`;
        if (sub.topics) {
            sub.topics.forEach((topic, tIndex) => {
                topicsHTML += `
                    <li style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <label style="cursor:pointer; display:flex; align-items:center; gap:5px; ${topic.completed ? 'text-decoration: line-through; color: #9ca3af;' : ''}">
                            <input type="checkbox" onchange="toggleTopic(${index}, ${tIndex})" ${topic.completed ? 'checked' : ''}>
                            ${topic.title}
                        </label>
                        <button onclick="deleteTopic(${index}, ${tIndex})" style="background:none; color:#ef4444; padding:0; border:none; font-size:16px;">×</button>
                    </li>
                `;
            });
        }
        topicsHTML += `</ul>
            <div style="display:flex; gap:5px; margin-top:10px;">
                <input type="text" id="new-topic-${index}" placeholder="New topic chapter..." style="padding:4px; font-size:0.8rem; flex-grow:1; margin:0;">
                <button onclick="addTopic(${index})" style="padding:4px 8px; font-size:0.8rem;">Add</button>
            </div>
        `;

        // Final HTML for the subject item
        li.innerHTML = `
            <div style="display:flex; justify-content:space-between;">
                <strong>${sub.name || "Untitled Subject"}</strong>
                <button onclick="deleteSubject(${index})" style="background:none; color:#ef4444; padding:0; border:none;">Delete</button>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${percentage}%; background-color: ${barColor};"></div>
            </div>
            <small>${score.toFixed(1)}/5 Stars Average</small>
            ${topicsHTML}
        `;
        list.appendChild(li);

        // Add subject to the dropdown selector
        const opt = document.createElement("option");
        opt.value = index;
        opt.textContent = sub.name || "Untitled Subject";
        selector.appendChild(opt);
    });
}

/*
  These functions are attached to the global window object
  because they are called from inline onclick handlers in the HTML.
*/

// addTopic(subIndex) – adds a new topic to a subject
window.addTopic = function(subIndex) {
    const input = document.getElementById(`new-topic-${subIndex}`);
    if (input && input.value.trim() !== "") {
        if (!subjectsData[subIndex].topics) subjectsData[subIndex].topics = [];
        subjectsData[subIndex].topics.push({ title: input.value.trim(), completed: false });
        saveToStorage();
        refreshUI();
    }
};

// toggleTopic(subIndex, topicIndex) – toggles a topic’s completed status
window.toggleTopic = function(subIndex, topicIndex) {
    subjectsData[subIndex].topics[topicIndex].completed = !subjectsData[subIndex].topics[topicIndex].completed;
    saveToStorage();
    refreshUI();
};

// deleteTopic(subIndex, topicIndex) – removes a topic from a subject
window.deleteTopic = function(subIndex, topicIndex) {
    subjectsData[subIndex].topics.splice(topicIndex, 1);
    saveToStorage();
    refreshUI();
};

// deleteSubject(subIndex) – removes an entire subject after confirmation
window.deleteSubject = function(subIndex) {
    if (confirm("Delete this entire subject?")) {
        subjectsData.splice(subIndex, 1);
        saveToStorage();
        refreshUI();
    }
};

// ---------- STREAK & CALENDAR ----------

/*
  calculateStreak()
  Counts how many consecutive days (including today) have at least one study session.
  It looks at the session dates from all subjects.
*/
function calculateStreak() {
    const sessions = getAllSessions();
    // Get unique date strings, sorted newest first
    const dates = [...new Set(sessions.map(s => s.date.split('T')[0]))].sort().reverse();
    if (dates.length === 0) return 0;

    let streak = 0;
    const today = new Date().toISOString().split('T')[0];
    let checkDate = new Date(today);

    // Go backwards day by day
    while (true) {
        const checkStr = checkDate.toISOString().split('T')[0];
        if (dates.includes(checkStr)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

/*
  renderStreak()
  Updates the streak display on the page.
*/
function renderStreak() {
    const streakDisplay = document.getElementById("streak-display");
    if (!streakDisplay) return;
    const streak = calculateStreak();
    streakDisplay.textContent = streak > 0 ? `🔥 ${streak}-day study streak!` : "";
}

/*
  generateTimetable()
  Creates the monthly calendar grid. It:
  - Uses a seeded random order so the schedule stays the same all month.
  - Colours each day based on the number of past sessions (heatmap).
  - Shows subjects based on the weighted pool and the slots per day.
  - Saves the schedule for ICS export.
*/
function generateTimetable() {
    const calendarGrid = document.getElementById("calendar-grid");
    if (!calendarGrid) return;

    // How many study slots per weekday/weekend
    const weekdayLoad = parseInt(document.getElementById("weekday-load")?.value) || 2;
    const weekendLoad = parseInt(document.getElementById("weekend-load")?.value) || 1;

    calendarGrid.style.display = "grid";
    calendarGrid.style.gridTemplateColumns = "repeat(7, 1fr)";
    calendarGrid.style.gap = "5px";

    const now = new Date();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // Count sessions per date for the heatmap
    const sessions = getAllSessions();
    const sessionCounts = {};
    sessions.forEach(s => {
        const d = s.date.split('T')[0];
        sessionCounts[d] = (sessionCounts[d] || 0) + 1;
    });

    // Sort subjects by average score (ascending) so lower‑scoring subjects get more weight
    const sortedSubjects = [...subjectsData].sort((a, b) => calculateSubjectScore(a) - calculateSubjectScore(b));

    /*
      getWeightedPool()
      Builds an array where lower‑scoring subjects appear more often.
      Score 1 → weight 5, score 5 → weight 1.
    */
    function getWeightedPool() {
        let pool = [];
        sortedSubjects.forEach(sub => {
            const score = calculateSubjectScore(sub);
            const weight = Math.max(1, Math.floor(6 - score));
            for (let i = 0; i < weight; i++) pool.push(sub);
        });
        return pool;
    }

    /*
      mulberry32(a)
      A seeded pseudo‑random number generator.
      The seed is based on year and month, so the schedule only changes when the month changes.
    */
    function mulberry32(a) {
        return function() {
            a |= 0;
            a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    const seed = now.getFullYear() * 100 + (now.getMonth() + 1);
    const rng = mulberry32(seed);

    /*
      shuffleArray(arr)
      Fisher–Yates shuffle using the seeded RNG.
      Returns a new shuffled copy of the array.
    */
    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    const weightedPool = getWeightedPool();
    const shuffledSubjects = shuffleArray(weightedPool);
    let subjectIndex = 0;  // pointer to walk through the shuffled list

    currentMonthSchedule = [];   // reset ICS data

    // Calendar header
    calendarGrid.innerHTML = `<h3 style="grid-column: span 7; text-align: center;">${monthNames[now.getMonth()]} ${now.getFullYear()}</h3>` +
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div style="font-weight:bold;">${d}</div>`).join('');

    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    // Fill empty cells before the 1st of the month
    for (let i = 0; i < firstDay; i++) calendarGrid.appendChild(document.createElement("div"));

    const isDark = document.body.classList.contains('dark-mode');

    // Loop through each day
    for (let i = 1; i <= daysInMonth; i++) {
        const dateObj = new Date(now.getFullYear(), now.getMonth(), i);
        const dateStr = dateObj.toISOString().split('T')[0];
        const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);
        const slotsNeeded = isWeekend ? weekendLoad : weekdayLoad;

        const dayDiv = document.createElement("div");
        dayDiv.style.border = "1px solid var(--border)";
        dayDiv.style.minHeight = "80px";
        dayDiv.style.padding = "5px";
        dayDiv.style.cursor = "pointer";
        dayDiv.style.position = "relative";
        dayDiv.dataset.date = dateStr;               // store the date on the element
        dayDiv.onclick = () => handleDateClick(dateStr, dayDiv);

        const count = sessionCounts[dateStr] || 0;

        // If the day is blocked, show it in red with a remove button
        if (blockedEvents[dateStr]) {
            dayDiv.style.backgroundColor = "var(--blocked-bg)";
            dayDiv.innerHTML = `<strong>${i}</strong><div style="font-weight:bold; font-size: 0.7rem;">${blockedEvents[dateStr]}</div>
                <button onclick="event.stopPropagation(); removeEvent('${dateStr}')" style="position: absolute; right: 2px; color: var(--danger); background: none; border: none; cursor: pointer; font-size: 1rem;">×</button>`;
        } else {
            // Normal day: set heatmap colour based on session count
            if (count === 0) dayDiv.style.backgroundColor = "var(--heatmap-0)";
            else if (count === 1) dayDiv.style.backgroundColor = "var(--heatmap-1)";
            else if (count === 2) dayDiv.style.backgroundColor = "var(--heatmap-2)";
            else if (count === 3) dayDiv.style.backgroundColor = "var(--heatmap-3)";
            else dayDiv.style.backgroundColor = "var(--heatmap-4)";

            let subjectsHTML = `<strong>${i}</strong>`;
            let daySubjects = [];   // will hold subject names for ICS export

            if (shuffledSubjects.length > 0) {
                let pickedToday = new Set();  // ensure we don’t repeat subjects on the same day

                for (let s = 0; s < slotsNeeded; s++) {
                    let chosenSub = null;
                    let attempts = 0;
                    // Try to pick a subject that hasn’t been used today
                    while (attempts < shuffledSubjects.length) {
                        const candidate = shuffledSubjects[subjectIndex % shuffledSubjects.length];
                        subjectIndex++;
                        if (!pickedToday.has(candidate.name)) {
                            chosenSub = candidate;
                            break;
                        }
                        attempts++;
                    }
                    if (!chosenSub) {
                        // No unique subject available → show a “Break / Free” placeholder
                        subjectsHTML += `<div style="font-size:0.75rem; background-color:var(--progress-bg); color:var(--text-secondary); padding:3px; margin:2px 0; border-radius:4px; text-align:center; font-style:italic;">Break / Free</div>`;
                    } else {
                        pickedToday.add(chosenSub.name);
                        daySubjects.push(chosenSub.name);

                        // Pick the right colour for light/dark mode
                        const currentName = chosenSub.name || "";
                        const foundKey = Object.keys(subjectColors).find(key => currentName.toLowerCase().includes(key.toLowerCase()));
                        let bgColor, textColor;
                        if (isDark) {
                            bgColor = foundKey ? (darkSubjectColors[foundKey] || darkDefaultColor) : darkDefaultColor;
                            textColor = "#f0f0f0";
                        } else {
                            bgColor = foundKey ? (subjectColors[foundKey] || defaultColor) : defaultColor;
                            textColor = "#1f2937";
                        }
                        subjectsHTML += `<div style="font-size:0.75rem; background-color:${bgColor}; color:${textColor}; padding:3px; margin:2px 0; border-radius:4px; border:1px solid rgba(0,0,0,0.1); text-align:center; font-weight:600;">${currentName}</div>`;
                    }
                }
            }
            dayDiv.innerHTML = subjectsHTML;

            // If the day had at least one subject, save it for ICS export
            if (daySubjects.length > 0) {
                currentMonthSchedule.push({ date: dateStr, subjects: daySubjects });
            }
        }
        calendarGrid.appendChild(dayDiv);
    }

    // Make sure the charts match the current theme
    updateChartColors();
}

// ---------- DATE RANGE SELECTION (BLOCKING DAYS) ----------

/*
  handleDateClick(dateStr, element)
  Called when a calendar cell is clicked.
  If no start date is selected, this click sets it.
  If a start date is already selected, this click marks the end date and blocks all days in between.
*/
function handleDateClick(dateStr, element) {
    const status = document.getElementById('selection-status');

    // We already have a start date – this is the end date
    if (selectionRange.start && !selectionRange.end) {
        let start = new Date(selectionRange.start);
        let end = new Date(dateStr);
        if (start > end) [start, end] = [end, start];  // ensure start ≤ end

        const eventName = prompt("Enter event/break name (e.g. Exam, Holiday):");
        if (eventName) {
            let current = new Date(start);
            while (current <= end) {
                const dStr = current.toISOString().split('T')[0];
                blockedEvents[dStr] = eventName;
                current.setDate(current.getDate() + 1);
            }
            saveToStorage();
        }

        // Remove the blue highlight from the start cell
        if (selectionRange.element) {
            selectionRange.element.style.border = "1px solid var(--border)";
        }
        selectionRange = { start: null, end: null, element: null };
        if (status) status.style.display = 'none';
        refreshUI();
        return;
    }

    // No start date yet – this click sets it
    if (!selectionRange.start) {
        // Remove highlight from any previously selected start cell
        if (selectionRange.element) {
            selectionRange.element.style.border = "1px solid var(--border)";
        }
        selectionRange.start = dateStr;
        selectionRange.element = element;
        element.style.border = "2px solid #3b82f6";  // blue highlight

        // Show a non‑blocking message
        if (status) {
            status.style.display = 'block';
            status.textContent = `Start date: ${dateStr}. Now click the end date.`;
            setTimeout(() => { if (status) status.style.display = 'none'; }, 4000);
        }
    }
}

/*
  removeEvent(dateStr)
  Deletes a single blocked day (when the red × is clicked).
*/
function removeEvent(dateStr) {
    delete blockedEvents[dateStr];
    saveToStorage();
    refreshUI();
}

/*
  renderActivityFeed()
  Shows the 5 most recent study sessions in the sidebar.
*/
function renderActivityFeed() {
    const feed = document.getElementById("activity-feed");
    if (!feed) return;
    feed.innerHTML = "";

    let allSessions = getAllSessions();
    // Sort by date, newest first
    allSessions.sort((a, b) => new Date(b.date) - new Date(a.date));
    // Only keep the first 5
    allSessions.slice(0, 5).forEach(s => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${s.subject}</strong>: ${s.score}/5 ⭐ <span style="float:right;">${new Date(s.date).toLocaleDateString()}</span>`;
        feed.appendChild(li);
    });
}

// ========== ANALYTICS (CHARTS) ==========

/*
  renderAnalytics()
  Creates (or re‑creates) the two charts:
  - Radar chart: shows the average score for each subject.
  - Line chart: shows the number of study sessions per day over the last 30 days.
*/
function renderAnalytics() {
    const radarCtx = document.getElementById('radarChart');
    const volumeCtx = document.getElementById('volumeChart');
    if (!radarCtx || !volumeCtx || typeof Chart === 'undefined') return;

    // If the parent is hidden (collapsed), don’t render (prevents zero‑size chart)
    if (radarCtx.offsetParent === null) return;

    const isDark = document.body.classList.contains('dark-mode');
    const textColor = isDark ? '#e1e1e6' : '#374151';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

    // Data for both charts
    const labels = subjectsData.map(s => s?.name || "Untitled");
    const scores = subjectsData.map(s => calculateSubjectScore(s));

    // Destroy previous radar chart (if any) before creating a new one
    if (radarChart) radarChart.destroy();
    radarChart = new Chart(radarCtx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Score',
                data: scores,
                backgroundColor: 'rgba(79, 70, 229, 0.2)',
                borderColor: '#4f46e5',
                pointBackgroundColor: '#4f46e5',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 5,
                    ticks: { stepSize: 1, color: textColor, backdropColor: 'transparent' },
                    pointLabels: { color: textColor },
                    grid: { color: gridColor },
                    angleLines: { color: gridColor }
                }
            },
            plugins: { legend: { labels: { color: textColor } } }
        }
    });

    // Build volume data for the last 30 days
    const allSessions = getAllSessions();
    const last30Days = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        last30Days.push(d.toISOString().split('T')[0]);
    }

    const countMap = {};
    allSessions.forEach(s => {
        const d = s.date.split('T')[0];
        if (last30Days.includes(d)) countMap[d] = (countMap[d] || 0) + 1;
    });
    const volumeData = last30Days.map(d => countMap[d] || 0);

    if (volumeChart) volumeChart.destroy();
    volumeChart = new Chart(volumeCtx, {
        type: 'line',
        data: {
            labels: last30Days.map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
            datasets: [{
                label: 'Sessions per Day',
                data: volumeData,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1, color: textColor }, grid: { color: gridColor } },
                x: { ticks: { color: textColor }, grid: { color: gridColor } }
            },
            plugins: { legend: { labels: { color: textColor } } }
        }
    });
}

/*
  updateChartColors()
  Called when the theme changes. It updates the existing chart colours without destroying them.
*/
function updateChartColors() {
    const isDark = document.body.classList.contains('dark-mode');
    const textColor = isDark ? '#e1e1e6' : '#374151';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

    [radarChart, volumeChart].forEach(chart => {
        if (!chart) return;
        if (chart.config.type === 'radar') {
            chart.options.scales.r.ticks.color = textColor;
            chart.options.scales.r.pointLabels.color = textColor;
            chart.options.scales.r.grid.color = gridColor;
            chart.options.scales.r.angleLines.color = gridColor;
        } else {
            chart.options.scales.x.ticks.color = textColor;
            chart.options.scales.y.ticks.color = textColor;
            chart.options.scales.x.grid.color = gridColor;
            chart.options.scales.y.grid.color = gridColor;
        }
        if (chart.options.plugins?.legend) chart.options.plugins.legend.labels.color = textColor;
        chart.update();
    });
}

// ==========================================
// 4. ICS EXPORT (calendar file)
// ==========================================

/*
  exportICS()
  Generates an .ics file from the current month’s schedule.
  The user can import this into Google Calendar, Apple Calendar, etc.
*/
function exportICS() {
    // If there’s no schedule yet, warn the user
    if (currentMonthSchedule.length === 0) {
        alert('No schedule to export. Please view the calendar first.');
        return;
    }

    // Read user‑selected start time and duration
    const startTimeInput = document.getElementById('ics-start-time').value || '09:00';
    const durationMin = parseInt(document.getElementById('ics-duration').value) || 60;
    const [hours, minutes] = startTimeInput.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
        alert('Invalid start time.');
        return;
    }

    // ICS file content starts with these standard lines
    let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//StudyPlanner//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH'
    ];

    // Helper to format a date as YYYYMMDDTHHMMSS
    const formatDateTime = (dateStr, hour, minute) => {
        const d = new Date(dateStr + 'T00:00:00');
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}${month}${day}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
    };

    // For each day with subjects, create consecutive events
    currentMonthSchedule.forEach(dayEntry => {
        const date = dayEntry.date;
        const subjects = dayEntry.subjects;

        subjects.forEach((subject, idx) => {
            // Start time = base start + (index × duration)
            const startTotalMinutes = hours * 60 + minutes + idx * durationMin;
            const startH = Math.floor(startTotalMinutes / 60) % 24;
            const startM = startTotalMinutes % 60;
            const endTotalMinutes = startTotalMinutes + durationMin;
            const endH = Math.floor(endTotalMinutes / 60) % 24;
            const endM = endTotalMinutes % 60;

            const dtstart = formatDateTime(date, startH, startM);
            const dtend = formatDateTime(date, endH, endM);
            const summary = `Study ${subject}`;
            const uid = `${date}-${subject}-${idx}@studyplanner`;

            // Add a VEVENT block
            icsContent.push('BEGIN:VEVENT');
            icsContent.push(`DTSTART:${dtstart}`);
            icsContent.push(`DTEND:${dtend}`);
            icsContent.push(`SUMMARY:${summary}`);
            icsContent.push(`UID:${uid}`);
            icsContent.push('END:VEVENT');
        });
    });

    icsContent.push('END:VCALENDAR');

    // Create a downloadable .ics file
    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-plan-${new Date().toISOString().slice(0, 7)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==========================================
// 5. FOCUS MODE, BREAK, DATA MANAGEMENT
// ==========================================

/*
  startAlarmPulse()
  Uses the Web Audio API to create a short beep every 200ms.
  The beep continues until stopAlarmPulse() is called.
*/
function startAlarmPulse() {
    if (alarmInterval) return;  // already beeping
    if (audioCtx.state === 'suspended') audioCtx.resume();
    alarmInterval = setInterval(() => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 440;   // A4 note
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    }, 200);
}

/*
  stopAlarmPulse()
  Stops the beeping alarm.
*/
function stopAlarmPulse() {
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
}

/*
  enterFocusMode()
  Hides most of the UI and shows only the timer, so the user can concentrate.
  Also displays today’s objective.
*/
function enterFocusMode() {
    document.querySelectorAll('.card, .preset-controls, #calendar-grid').forEach(el => {
        if (el.querySelector('#timer-display') || el.id === 'timer-container') return;
        el.classList.add('hidden-in-focus');
    });

    const todayGoal = localStorage.getItem("todaysObjective") || "No focus target declared yet.";
    let focusGoalDisplay = document.getElementById("focus-goal-display");
    if (!focusGoalDisplay) {
        focusGoalDisplay = document.createElement("div");
        focusGoalDisplay.id = "focus-goal-display";
        focusGoalDisplay.style.cssText = "font-size: 1.25rem; font-weight: bold; margin: 15px 0; text-align: center; color: #1e3a8a; background-color: #eff6ff; padding: 10px; border-radius: 6px; border: 1px dashed #bfdbfe;";
        const timerDisp = document.getElementById("timer-display");
        if (timerDisp) timerDisp.parentNode.insertBefore(focusGoalDisplay, timerDisp);
    }
    focusGoalDisplay.textContent = `🎯 Target: ${todayGoal}`;
    focusGoalDisplay.style.display = "block";

    const exitBtn = document.getElementById('exit-focus-btn');
    if (exitBtn) exitBtn.style.display = 'block';
}

/*
  exitFocusMode()
  Restores all UI elements that were hidden during focus mode.
*/
function exitFocusMode() {
    document.querySelectorAll('.hidden-in-focus').forEach(el => el.classList.remove('hidden-in-focus'));

    const focusGoalDisplay = document.getElementById("focus-goal-display");
    if (focusGoalDisplay) focusGoalDisplay.style.display = "none";

    const exitBtn = document.getElementById('exit-focus-btn');
    if (exitBtn) exitBtn.style.display = 'none';

    document.getElementById("study-controls").style.display = "block";
    const timerDisp = document.getElementById("timer-display");
    if (timerDisp) {
        timerDisp.textContent = `${getFocusDuration()}:00`;
        timerDisp.style.display = "block";
    }
    document.getElementById("rating-section").style.display = "none";
    document.getElementById("break-section").style.display = "none";
}

/*
  triggerBreak()
  Shows the break timer and starts counting down.
*/
function triggerBreak() {
    document.getElementById("rating-section").style.display = "none";
    document.getElementById("study-controls").style.display = "none";
    document.getElementById("break-section").style.display = "block";

    const exitBtn = document.getElementById('exit-focus-btn');
    if (exitBtn) exitBtn.style.display = 'block';

    let breakTimeLeft = getBreakDuration() * 60;   // convert minutes to seconds
    breakInterval = setInterval(() => {
        const mins = Math.floor(breakTimeLeft / 60);
        const secs = breakTimeLeft % 60;
        document.getElementById("break-display").textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        if (breakTimeLeft <= 0) {
            clearInterval(breakInterval);
            startAlarmPulse();
            setTimeout(() => { stopAlarmPulse(); endBreakUI(); }, 3000);
        } else {
            breakTimeLeft--;
        }
    }, 1000);
}

/*
  endBreakUI()
  Hides the break UI and returns to the normal screen.
*/
function endBreakUI() {
    clearInterval(breakInterval);
    document.getElementById("break-section").style.display = "none";
    exitFocusMode();
}

/*
  exportData()
  Saves all app data (subjects, blocked events) to a JSON file.
*/
function exportData() {
    const dataToExport = {
        subjectsData: JSON.parse(localStorage.getItem("subjectsData") || "[]"),
        blockedEvents: JSON.parse(localStorage.getItem("blockedEvents") || "{}"),
        timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-planner-backup-${new Date().toLocaleDateString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert("Data exported successfully!");
}

/*
  importData(event)
  Loads a previously exported JSON backup and replaces current data.
*/
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (imported.subjectsData) localStorage.setItem("subjectsData", JSON.stringify(imported.subjectsData));
            if (imported.blockedEvents) localStorage.setItem("blockedEvents", JSON.stringify(imported.blockedEvents));
            subjectsData = imported.subjectsData || [];
            blockedEvents = imported.blockedEvents || {};
            alert("Data imported successfully!");
            refreshUI();
        } catch (err) {
            alert("Error importing file.");
        }
    };
    reader.readAsText(file);
}

/*
  resetAllData()
  Clears everything and restores default settings.
*/
function resetAllData() {
    if (confirm("WARNING: This will delete all subjects, events, and settings. Are you sure?")) {
        localStorage.clear();
        subjectsData = [];
        blockedEvents = [];
        document.getElementById("focus-duration").value = 25;
        document.getElementById("break-duration").value = 5;
        document.getElementById("timer-display").textContent = "25:00";
        document.getElementById("objective-display").textContent = "No goal set.";
        document.getElementById("objective-input").value = "";
        loadDarkModePreference();   // re‑sync dark mode toggle with OS
        refreshUI();
    }
}

// ==========================================
// 6. DARK MODE LOGIC
// ==========================================

/*
  applyDarkMode(enabled)
  Adds or removes the 'dark-mode' class on the <body>.
  This triggers all the CSS variable overrides.
*/
function applyDarkMode(enabled) {
    if (enabled) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('darkMode', enabled);
    refreshUI();
}

/*
  loadDarkModePreference()
  Checks localStorage for a saved preference.
  If none is saved, it uses the OS/browser preference.
  Then updates the toggle switch.
*/
function loadDarkModePreference() {
    const saved = localStorage.getItem('darkMode');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const enabled = saved === 'true' || (saved === null && prefersDark);
    applyDarkMode(enabled);
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = enabled;
}

// ==========================================
// 7. INITIALIZATION (runs when the page finishes loading)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    loadDarkModePreference();
    refreshUI();

    const timerDisp = document.getElementById("timer-display");
    const focusInput = document.getElementById('focus-duration');
    const breakInput = document.getElementById('break-duration');

    // Load saved custom durations (if any)
    const savedFocus = localStorage.getItem('focusDuration');
    if (savedFocus && focusInput) focusInput.value = savedFocus;
    const savedBreak = localStorage.getItem('breakDuration');
    if (savedBreak && breakInput) breakInput.value = savedBreak;
    if (timerDisp) timerDisp.textContent = `${(savedFocus && focusInput ? focusInput.value : 25)}:00`;

    // Save custom durations when the inputs change
    focusInput?.addEventListener('change', () => {
        localStorage.setItem('focusDuration', focusInput.value);
        if (timerDisp) timerDisp.textContent = `${focusInput.value}:00`;
    });
    breakInput?.addEventListener('change', () => localStorage.setItem('breakDuration', breakInput.value));

    // Dark mode toggle switch
    const darkToggle = document.getElementById('dark-mode-toggle');
    darkToggle?.addEventListener('change', (e) => applyDarkMode(e.target.checked));

    // Subject selector – shows the active subject with correct colours
    document.getElementById("subject-selector")?.addEventListener("change", function() {
        const display = document.getElementById("active-subject-display");
        if (!display) return;
        const idx = this.value;
        if (idx !== "") {
            const sub = subjectsData[idx];
            const isDark = document.body.classList.contains('dark-mode');
            const foundKey = Object.keys(subjectColors).find(key => sub.name.toLowerCase().includes(key.toLowerCase()));
            let bgColor, textColor;
            if (isDark) {
                bgColor = foundKey ? (darkSubjectColors[foundKey] || darkDefaultColor) : darkDefaultColor;
                textColor = "#f0f0f0";
            } else {
                bgColor = foundKey ? (subjectColors[foundKey] || defaultColor) : defaultColor;
                textColor = "#1f2937";
            }
            display.style.display = "block";
            display.style.backgroundColor = bgColor;
            display.style.color = textColor;
            display.textContent = `Focusing on: ${sub.name}`;
        } else {
            display.style.display = "none";
        }
    });

    // Collapsible sections – clicking the header toggles the content
    document.querySelectorAll('.collapsible-header').forEach(header => {
        header.addEventListener('click', function() {
            const content = this.nextElementSibling;
            if (content) {
                content.classList.toggle('collapsed');
                const arrow = this.querySelector('span');
                if (arrow) {
                    arrow.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
                }
                // If the analytics card is expanded, re‑render the charts (because the canvas might have been hidden)
                if (!content.classList.contains('collapsed') && (content.querySelector('#radarChart') || content.querySelector('#volumeChart'))) {
                    setTimeout(() => renderAnalytics(), 350);
                }
            }
        });
    });

    // Today’s objective / goal
    const objectiveInput = document.getElementById("objective-input");
    const objectiveDisplay = document.getElementById("objective-display");
    const savedObjective = localStorage.getItem("todaysObjective");
    if (savedObjective && objectiveDisplay) {
        objectiveDisplay.textContent = `Focus for today: ${savedObjective}`;
        if (objectiveInput) objectiveInput.value = savedObjective;
    }
    document.getElementById("save-objective-btn")?.addEventListener("click", () => {
        const text = objectiveInput.value.trim();
        if (text) {
            localStorage.setItem("todaysObjective", text);
            objectiveDisplay.textContent = `Focus for today: ${text}`;
            alert("Goal saved!");
        } else {
            localStorage.removeItem("todaysObjective");
            objectiveDisplay.textContent = "";
            alert("Goal cleared.");
        }
    });

    // Exit focus mode button (created dynamically if not already present)
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay && !document.getElementById('exit-focus-btn')) {
        const exitBtn = document.createElement('button');
        exitBtn.id = 'exit-focus-btn';
        exitBtn.textContent = 'Exit Focus Mode Early';
        exitBtn.style.cssText = "display: none; margin: 15px auto; padding: 10px 20px; background-color: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9rem;";
        exitBtn.onclick = () => {
            clearInterval(countdown);
            clearInterval(breakInterval);
            stopAlarmPulse();
            exitFocusMode();
        };
        timerDisplay.parentNode.appendChild(exitBtn);
    }

    // Load preset subjects
    document.getElementById("load-preset-btn")?.addEventListener("click", () => {
        const sem = document.getElementById("sem-selector").value;
        const course = document.getElementById("course-selector").value;
        const subjects = uitmPresets[sem]?.[course];
        if (subjects && confirm("Load this curriculum?")) {
            subjectsData = subjects.map(name => ({ name, topics: [], sessions: [] }));
            saveToStorage();
            refreshUI();
        }
    });

    // Add custom subject
    document.getElementById('add-subject-btn')?.addEventListener('click', () => {
        const input = document.getElementById('subject-input');
        const name = input.value.trim();
        if (name) {
            subjectsData.push({ name: name, topics: [], sessions: [] });
            saveToStorage();
            input.value = "";
            refreshUI();
        }
    });

    // Start focus timer
    document.getElementById("start-timer-btn")?.addEventListener("click", () => {
        const selector = document.getElementById("subject-selector");
        if (!selector.value) return alert("Select a subject first!");
        enterFocusMode();
        document.getElementById("study-controls").style.display = "none";
        document.getElementById("timer-display").style.display = "block";

        let timeLeft = getFocusDuration() * 60;   // convert minutes to seconds
        countdown = setInterval(() => {
            const mins = Math.floor(timeLeft / 60);
            const secs = timeLeft % 60;
            document.getElementById("timer-display").textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
            if (timeLeft <= 0) {
                clearInterval(countdown);
                startAlarmPulse();
                document.getElementById("timer-display").style.display = "none";
                document.getElementById("rating-section").style.display = "block";
                document.getElementById('exit-focus-btn').style.display = 'block';
            } else {
                timeLeft--;
            }
        }, 1000);
    });

    // Rating buttons (1‑5 stars)
    document.querySelectorAll(".rating-btn").forEach(btn => {
        btn.addEventListener("click", function() {
            stopAlarmPulse();
            const rating = parseInt(this.getAttribute("data-value"));
            const index = document.getElementById("subject-selector").value;
            if (!subjectsData[index].sessions) subjectsData[index].sessions = [];
            subjectsData[index].sessions.push({ date: new Date().toISOString(), score: rating });
            saveToStorage();
            triggerBreak();
            refreshUI();
        });
    });

    // Skip break button
    document.getElementById("skip-break-btn")?.addEventListener("click", () => {
        stopAlarmPulse();
        endBreakUI();
    });

    // Re‑render when the user changes the weekday/weekend load values
    document.getElementById("weekday-load")?.addEventListener("change", refreshUI);
    document.getElementById("weekend-load")?.addEventListener("change", refreshUI);
});