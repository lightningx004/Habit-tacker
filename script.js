document.addEventListener('DOMContentLoaded', () => {
    try {
        const firebaseConfig = {
            apiKey: "AIzaSyBySis9wCWSTdBDFH4nM0KgeTizstm6sBs",
            authDomain: "habit-9d03f.firebaseapp.com",
            projectId: "habit-9d03f",
            storageBucket: "habit-9d03f.firebasestorage.app",
            messagingSenderId: "870420873472",
            appId: "1:870420873472:web:ecbbeeef278c7ed037f3e5",
            measurementId: "G-DMV5SVNE7L"
        };

        // Initialize Firebase
        let db;
        let habits = []; // Local mirror of cloud data

        try {
            if (typeof firebase !== 'undefined') {
                firebase.initializeApp(firebaseConfig);
                db = firebase.firestore();
                console.log("Firebase Initialized");
            } else {
                console.warn("Firebase SDK not found. Using LocalStorage fallback.");
            }
        } catch (e) {
            console.error("Firebase Init Error:", e);
        }

        const STATE_KEY = 'habitTrackerState_v1';

        // Initial Load Strategy
        if (db) {
            subscribeToHabits();
        } else {
            habits = loadHabitsLocal();
            // Demo data if empty
            if (habits.length === 0) {
                habits = [
                    { id: Date.now().toString(), name: 'Drink 2L Water', completedDates: [] },
                    { id: (Date.now() + 1).toString(), name: 'Read 30 mins', completedDates: [] }
                ];
            }
        }

        // State
        const today = new Date();
        const todayStr = getLocalDateString(today);
        let selectedDate = new Date();
        let selectedDateStr = todayStr;
        let currentCalendarDate = new Date(); // Controls displayed month

        // --- DOM Elements ---
        const habitsListEl = document.getElementById('habits-list');
        const dayPercentEl = document.getElementById('day-percent'); // This element is still needed for daily progress

        // Calendar Elements
        const calendarGridEl = document.getElementById('calendar-grid');
        const calendarMonthYearEl = document.getElementById('calendar-month-year');
        const prevMonthBtn = document.getElementById('prev-month');
        const nextMonthBtn = document.getElementById('next-month');
        const dayCircleEl = document.getElementById('day-circle');
        const monthPercentEl = document.getElementById('month-percent');
        const monthCircleEl = document.getElementById('month-circle');
        const yearPercentEl = document.getElementById('year-percent');
        const yearFillEl = document.getElementById('year-fill');

        // Modal Elements
        const modal = document.getElementById('modal');
        // Old btn removed, logic handled separately below
        const cancelBtn = document.getElementById('cancel-btn');
        const saveBtn = document.getElementById('save-btn');
        const newHabitInput = document.getElementById('new-habit-input');

        // --- Initial Render ---
        // Sort habits by order before first render
        habits.sort((a, b) => (a.order || 0) - (b.order || 0));
        renderAll();

        // --- Drag & Drop Initialization ---
        if (habitsListEl) {
            new Sortable(habitsListEl, {
                animation: 250,
                // delay: 0, // Removed delay for instant dragging via handle
                forceFallback: true, // Use custom drag element instead of native HTML5 drag
                fallbackOnBody: true, // Append to body to avoid overflow clipping
                touchStartThreshold: 5, // Ignore small shakes
                swapThreshold: 0.65, // Require 65% overlap to swap
                ghostClass: 'sortable-ghost',
                dragClass: 'sortable-drag',
                handle: '.drag-handle', // Restrict drag to handle
                onEnd: function (evt) {
                    // Update Order in Logic
                    const itemEl = evt.item;
                    const newIndex = evt.newIndex;
                    const oldIndex = evt.oldIndex;

                    // Reorder local array
                    const movedItem = habits.splice(oldIndex, 1)[0];
                    habits.splice(newIndex, 0, movedItem);

                    // Update 'order' property for ALL habits to match new index
                    // This ensures consistency
                    habits.forEach((h, index) => {
                        h.order = index;
                    });

                    // Save to Cloud (Batch Update)
                    if (db) {
                        const batch = db.batch();
                        habits.forEach(h => {
                            // Ensure ID is string
                            const ref = db.collection('habits').doc(h.id.toString());
                            batch.update(ref, { order: h.order });
                        });
                        batch.commit().catch(e => console.error("Reorder failed:", e));
                    } else {
                        saveHabitsLocal();
                    }
                }
            });
        }

        // --- Event Listeners ---
        // Menu Elements
        const menuBtn = document.getElementById('menu-btn');
        const habitsMenu = document.getElementById('habits-menu');
        const menuAddHabitBtn = document.getElementById('menu-add-habit');
        const menuAddTaskBtn = document.getElementById('menu-add-task');

        let isOneOff = false; // State to track modal mode

        // Toggle Menu Global Function
        window.toggleMenu = function (event) {
            event.stopPropagation();
            const menu = document.getElementById('habits-menu');
            if (menu) {
                menu.classList.toggle('hidden');
                console.log("Menu Toggled", menu.classList.contains('hidden'));
            } else {
                console.error("Menu element not found!");
            }
        };

        // Close menu on outside click
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('habits-menu');
            const btn = document.getElementById('menu-btn');
            if (menu && !menu.classList.contains('hidden')) {
                // If click is outside menu and button
                if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
                    menu.classList.add('hidden');
                }
            }
        });



        // Open "Daily Habit" Mode
        if (menuAddHabitBtn) {
            menuAddHabitBtn.addEventListener('click', () => {
                isOneOff = false;
                openModal('Add New Daily Habit');
            });
        }

        // Notification Button
        const menuNotificationsBtn = document.getElementById('menu-notifications');
        if (menuNotificationsBtn) {
            menuNotificationsBtn.addEventListener('click', () => {
                Notification.requestPermission().then(permission => {
                    if (permission === "granted") {
                        alert("Notifications Enabled! You will be reminded at 9:00 PM if your goal isn't met.");
                        localStorage.setItem('notificationsEnabled', 'true');
                    } else {
                        alert("Permission denied. We cannot send you reminders.");
                    }
                });
                habitsMenu.classList.add('hidden');
            });
        }

        // Reminder Scheduler (Runs every minute)
        setInterval(() => {
            const now = new Date();
            // Check if it's 9:00 PM (21:00)
            if (now.getHours() === 21 && now.getMinutes() === 0) {
                const enabled = localStorage.getItem('notificationsEnabled') === 'true';
                if (!enabled) return;

                // Calculate progress
                const totalHabits = habits.length;
                if (totalHabits === 0) return;

                // Actionable habits for today
                const todayStr = getLocalDateString(now);
                const actionableHabits = habits.filter(h => {
                    if (h.type === 'one-off') return h.date === todayStr;
                    return true;
                });

                if (actionableHabits.length === 0) return;

                const completedCount = actionableHabits.filter(h => h.completedDates && h.completedDates.includes(todayStr)).length;
                const percent = (completedCount / actionableHabits.length) * 100;

                // Check Threshold < 80%
                if (percent < 80) {
                    if (Notification.permission === "granted") {
                        new Notification("Daily Mission Not Completed", {
                            body: `You have only completed ${Math.round(percent)}% of your habits. Push for 80%!`,
                            icon: '/icon-192.png'
                        });
                    }
                }
            }
        }, 60000); // Check every minute

        // Open "Specific Task" Mode
        if (menuAddTaskBtn) {
            menuAddTaskBtn.addEventListener('click', () => {
                isOneOff = true;
                const dateLabel = selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                openModal(`Task for ${dateLabel}`);
            });
        }

        function openModal(title) {
            habitsMenu.classList.add('hidden');
            modal.classList.remove('hidden');
            document.querySelector('.modal-content h3').textContent = title;
            newHabitInput.value = '';
            newHabitInput.focus();
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const name = newHabitInput.value.trim();
                if (name) {
                    addHabit(name, isOneOff);
                    modal.classList.add('hidden');
                }
            });
        }

        // --- Functions ---

        // --- Data Handling ---

        function loadHabitsLocal() {
            try {
                const stored = localStorage.getItem(STATE_KEY);
                if (!stored) return [];
                const parsed = JSON.parse(stored);
                // Ensure all IDs are strings to match Firestore format
                return parsed.map(h => ({ ...h, id: h.id.toString() }));
            } catch (error) { return []; }
        }

        function subscribeToHabits() {
            if (!db) return;

            const statusEl = document.getElementById('sync-status');

            // Listen to 'habits' collection
            db.collection('habits').onSnapshot(snapshot => {
                // Success! We are connected.
                if (statusEl) {
                    statusEl.classList.add('online');
                    statusEl.title = "Connected to Cloud";
                }

                const cloudHabits = [];
                snapshot.forEach(doc => {
                    cloudHabits.push({ id: doc.id, ...doc.data() });
                });

                // If cloud is empty but we have local data, migrate it!
                if (cloudHabits.length === 0) {
                    const localData = loadHabitsLocal();
                    if (localData.length > 0) {
                        console.log("Migrating local data to cloud...");
                        localData.forEach(h => {
                            // Ensure ID is string for Firestore doc
                            const docId = h.id.toString();
                            db.collection('habits').doc(docId).set(h);
                        });
                        return; // Snapshot will trigger again after writes
                    }
                }

                habits = cloudHabits;
                // Sort by order when receiving from cloud
                habits.sort((a, b) => (a.order || 0) - (b.order || 0));
                renderAll();
            }, error => {
                console.error("Sync Error:", error);
                if (statusEl) {
                    statusEl.classList.remove('online');
                    statusEl.title = "Sync Failed: " + error.message;
                }
                // alert("Cloud Sync Error: Check your API Keys in script.js"); // Removing annoying alert
            });
        }

        function saveHabitAction(habit) {
            if (db) {
                // Cloud Write
                // Use habit.id as doc ID ensures consistency
                db.collection('habits').doc(habit.id.toString()).set(habit)
                    .catch(e => {
                        console.error("Save failed:", e);
                        alert("⚠️ Data Save Failed!\n\nGoogle blocked this save. You probably haven't enabled the database permanently or the API is disabled.\n\nError: " + e.message);
                    });
            } else {
                // Local Write
                saveHabitsLocal();
                renderAll();
            }
        }

        function deleteHabitAction(id) {
            if (db) {
                db.collection('habits').doc(id.toString()).delete();
            } else {
                habits = habits.filter(h => h.id !== id);
                saveHabitsLocal();
                renderAll();
            }
        }

        function saveHabitsLocal() {
            localStorage.setItem(STATE_KEY, JSON.stringify(habits));
        }

        function getLocalDateString(date) {
            // ... existing function ...
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function getLocalDateString(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function addHabit(name, isOneOff) {
            const newHabit = {
                id: Date.now().toString(), // Convert to string for Firestore ID
                name: name,
                completedDates: [],
                type: isOneOff ? 'one-off' : 'daily',
                date: isOneOff ? selectedDateStr : null,
                order: habits.length // Add at the end
            };

            if (db) {
                // For cloud, we just write. The subscription updates existing 'habits' array and re-renders.
                saveHabitAction(newHabit);
            } else {
                habits.push(newHabit);
                saveHabitAction(newHabit); // Will fallback to local
            }
        }

        function toggleHabit(id) {
            // Prevent changing past data
            if (selectedDateStr !== todayStr) {
                alert("You cannot change past data.");
                return;
            }

            // Important: with Firestore, id might be string. Ensure strict comparison matches.
            const habit = habits.find(h => h.id.toString() === id.toString());

            if (habit) {
                const index = habit.completedDates.indexOf(todayStr);
                if (index > -1) {
                    habit.completedDates.splice(index, 1);
                } else {
                    habit.completedDates.push(todayStr);
                }
                saveHabitAction(habit);
            }
        }

        function renderAll() {
            try {
                renderHabits();
                renderProgress();
                renderCalendar();
            } catch (e) {
                console.error("Render Error:", e);
            }
        }

        function calculateStreak(completedDates) {
            if (!completedDates || completedDates.length === 0) return 0;

            // Sort dates descending
            const sorted = [...completedDates].sort((a, b) => new Date(b) - new Date(a));
            const today = getLocalDateString(new Date());
            const yesterday = getLocalDateString(new Date(Date.now() - 86400000));

            // If not completed today, check if completed yesterday to keep streak alive
            let currentStreak = 0;
            let checkDate = new Date();

            // Streak logic primarily for Daily habits. 
            // For one-off, streak might not make sense, but code will just return 1 if done.

            // If we haven't done it today, we start checking from yesterday
            if (!completedDates.includes(today)) {
                checkDate.setDate(checkDate.getDate() - 1);
            }

            while (true) {
                const checkStr = getLocalDateString(checkDate);
                if (completedDates.includes(checkStr)) {
                    currentStreak++;
                    checkDate.setDate(checkDate.getDate() - 1);
                } else {
                    break;
                }
            }

            return currentStreak;
        }

        function deleteHabit(id) {
            if (confirm('Delete this habit?')) {
                deleteHabitAction(id);
            }
        }

        function renderHabits() {
            if (!habitsListEl) return;
            habitsListEl.innerHTML = '';

            const isToday = selectedDateStr === todayStr;

            habits.forEach(habit => {
                // Filter: Show if Daily OR if One-Off matches selected date
                const isDaily = !habit.type || habit.type === 'daily';
                const isOneOffMatch = habit.type === 'one-off' && habit.date === selectedDateStr;

                if (!isDaily && !isOneOffMatch) {
                    return; // Skip this habit for this view
                }

                const isCompleted = habit.completedDates && habit.completedDates.includes(selectedDateStr);
                // Hide streak for one-off tasks? Maybe. User didn't specify. Let's keep it to verify completion.
                const streak = calculateStreak(habit.completedDates);

                const li = document.createElement('li');
                li.className = `habit-item ${isCompleted ? 'completed' : ''} ${!isToday ? 'readonly' : ''}`;

                // Add visual tag for one-off?
                const oneOffTag = habit.type === 'one-off' ? '<span class="tag-oneoff" style="font-size:0.7em; color:var(--accent-neon); margin-left:10px; border:1px solid var(--accent-neon); padding:2px 6px; border-radius:4px;">TASK</span>' : '';

                li.innerHTML = `
                    <div class="habit-left">
                        <div class="drag-handle" style="touch-action: none;">
                             <!-- Six dots icon -->
                            <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor">
                                <circle cx="4" cy="4" r="1.5" />
                                <circle cx="4" cy="10" r="1.5" />
                                <circle cx="4" cy="16" r="1.5" />
                                <circle cx="8" cy="4" r="1.5" />
                                <circle cx="8" cy="10" r="1.5" />
                                <circle cx="8" cy="16" r="1.5" />
                            </svg>
                        </div>
                        <div class="habit-checkbox ${isCompleted ? 'checked' : ''} ${!isToday ? 'disabled' : ''}" data-id="${habit.id}"></div>
                        <span class="habit-name">${habit.name} ${oneOffTag}</span>
                    </div>
                    <div class="habit-right">
                        <div class="streak-container" title="Current Streak">
                            <span class="streak-icon">🔥</span>
                            <span class="streak-count">${streak}</span>
                        </div>
                        <button class="delete-btn" title="Delete Habit">×</button>
                    </div>
                `;

                const checkbox = li.querySelector('.habit-checkbox');
                if (checkbox) {
                    checkbox.addEventListener('click', (e) => {
                        e.stopPropagation();
                        toggleHabit(habit.id);
                    });
                }

                const delBtn = li.querySelector('.delete-btn');
                if (delBtn) {
                    delBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        deleteHabit(habit.id);
                    });
                }

                habitsListEl.appendChild(li);
            });
        }

        function renderProgress() {
            // Update Year Label Dynamically (Always Run First)
            const yearLabelEl = document.getElementById('year-label');
            if (yearLabelEl) {
                const currentYear = new Date().getFullYear();
                yearLabelEl.textContent = `${currentYear} Progress`;
            }

            const totalHabits = habits.length;
            if (totalHabits === 0) {
                updateCircle(dayCircleEl, dayPercentEl, 0);
                updateCircle(monthCircleEl, monthPercentEl, 0);
                updateBar(yearFillEl, yearPercentEl, 0);
                return;
            }

            // Daily Progress (For Selected Date)
            // Filter: Only daily habits + one-off tasks FOR THIS DAY count towards total
            const actionableHabits = habits.filter(h => {
                const isDaily = !h.type || h.type === 'daily';
                const isOneOffMatch = h.type === 'one-off' && h.date === selectedDateStr;
                return isDaily || isOneOffMatch;
            });

            const totalActionable = actionableHabits.length;
            const completedOnSelected = actionableHabits.filter(h => h.completedDates && h.completedDates.includes(selectedDateStr)).length;
            const dayDayPercent = totalActionable > 0 ? Math.round((completedOnSelected / totalActionable) * 100) : 0;

            // Counter String (e.g., "6/8")
            const counterStr = `${completedOnSelected}/${totalActionable}`;

            updateCircle(dayCircleEl, dayPercentEl, dayDayPercent, counterStr);

            // Update "TODAY" Label
            const todayLabel = document.querySelector('.today-focus h1');
            if (todayLabel) {
                if (selectedDateStr === todayStr) {
                    todayLabel.textContent = 'TODAY';
                } else {
                    const options = { month: 'short', day: 'numeric' };
                    todayLabel.textContent = selectedDate.toLocaleDateString('en-US', options).toUpperCase();
                }
            }

            // Monthly
            const year = today.getFullYear();
            const month = today.getMonth();
            const currentDay = today.getDate();

            // Monthly Progress (Time Based)
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const monthPercent = Math.floor((currentDay / daysInMonth) * 100);
            updateCircle(monthCircleEl, monthPercentEl, monthPercent);

            // Yearly Progress (Time Based)
            // User expects "How much of the year has passed" or "Global Status"
            // Switching back to Time Based because "16%" on Jan 1 is confusing if it's just daily average.
            const startOfYear = new Date(year, 0, 1);
            const endOfYear = new Date(year + 1, 0, 1);
            const totalYearTime = endOfYear - startOfYear;
            const timePassed = today - startOfYear;

            // Calculate percentage of year elapsed (Date wise)
            // Or if we specifically want "Time Progress":
            let yearPercent = Math.floor((timePassed / totalYearTime) * 100);

            // Constraint
            if (yearPercent < 0) yearPercent = 0;
            if (yearPercent > 100) yearPercent = 100;

            updateBar(yearFillEl, yearPercentEl, yearPercent);
        }

        function updateCircle(circleEl, textEl, percent, subLabel = "") {
            if (!circleEl || !textEl) return;
            textEl.textContent = `${percent}%`;

            // Handle Sub-Label (Counter)
            const parent = textEl.parentElement;
            if (parent) {
                const labelEl = parent.querySelector('.label');
                if (labelEl) {
                    if (subLabel) {
                        labelEl.innerHTML = subLabel;
                        // Dynamic Glow classes
                        labelEl.className = 'label'; // reset
                        const ratio = parseInt(subLabel.split('/')[0]) / parseInt(subLabel.split('/')[1]);
                        if (ratio >= 0.8) labelEl.classList.add('text-glow-green');
                        else labelEl.classList.add('text-glow-red');
                    } else {
                        labelEl.textContent = "COMPLETED"; // Default fallback
                        labelEl.className = "label";
                    }
                }
            }

            // Update the CSS variable
            circleEl.style.setProperty('--progress-angle', `${percent * 3.6}deg`);
        }

        function updateBar(fillEl, textEl, percent) {
            if (!fillEl || !textEl) return;
            textEl.textContent = `${percent}%`;
            fillEl.style.width = `${percent}%`;
        }

        function renderCalendar() {
            if (!calendarGridEl || !calendarMonthYearEl) return;

            const year = currentCalendarDate.getFullYear();
            const month = currentCalendarDate.getMonth();

            calendarMonthYearEl.textContent = currentCalendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            calendarGridEl.innerHTML = '';

            // Weekday headers
            const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
            weekdays.forEach(day => {
                const dayEl = document.createElement('div');
                dayEl.style.color = '#555';
                dayEl.style.fontSize = '0.8em';
                dayEl.textContent = day;
                calendarGridEl.appendChild(dayEl);
            });

            // Empty cells
            for (let i = 0; i < firstDay; i++) {
                calendarGridEl.appendChild(document.createElement('div'));
            }

            // Days
            for (let i = 1; i <= daysInMonth; i++) {
                const date = new Date(year, month, i);
                const dateStr = getLocalDateString(date);
                const cell = document.createElement('div');
                cell.className = 'calendar-day';
                cell.textContent = i;

                if (dateStr === todayStr) {
                    cell.classList.add('today');
                }

                if (dateStr === selectedDateStr) {
                    cell.classList.add('selected');
                }

                // Compare timestamps for passed/today check
                const isPastOrToday = date <= new Date();

                // Mark passed days
                if (date < new Date(todayStr)) {
                    cell.classList.add('passed');
                }

                // Check Progress for Red Glow (< 60%)
                if (habits.length > 0) {
                    // Filter logic must match renderHabits: 
                    // Daily always counts. One-off counts ONLY if it was for THIS date.
                    // Actually, simpler: check if habit is 'daily' OR ('one-off' AND date==dateStr)
                    // But 'habits' list contains all.
                    // For a specific calendar day, we should check completion of habits relevant to that day.

                    // Count actionable habits for this date
                    const actionableHabits = habits.filter(h => {
                        if (h.type === 'one-off') return h.date === dateStr;
                        return true; // daily
                    });

                    const actionableCount = actionableHabits.length;
                    const completedForDate = actionableHabits.filter(h => h.completedDates && h.completedDates.includes(dateStr)).length;

                    if (actionableCount > 0) {
                        const percent = (completedForDate / actionableCount) * 100;

                        if (percent === 100) {
                            cell.classList.add('completed');
                        } else if (percent >= 75) {
                            // Feature: Glow Green if >= 75% (Past or Present)
                            cell.classList.add('success-high');
                        } else if (isPastOrToday && percent < 60) {
                            cell.classList.add('failure');
                        }
                    }
                }

                cell.addEventListener('click', () => {
                    selectedDate = date;
                    selectedDateStr = dateStr;
                    renderAll();
                });

                calendarGridEl.appendChild(cell);
            }
        }

        // Navigation Listeners
        if (prevMonthBtn) {
            prevMonthBtn.addEventListener('click', () => {
                currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
                renderCalendar();
            });
        }

        if (nextMonthBtn) {
            nextMonthBtn.addEventListener('click', () => {
                currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
                renderCalendar();
            });
        }

    } catch (globalError) {
        console.error("Global Script Error:", globalError);
        alert("An error occurred starting the app: " + globalError.message);
    }

    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('Service Worker registered', reg))
                .catch(err => console.log('Service Worker registration failed', err));
        });
    }
});
