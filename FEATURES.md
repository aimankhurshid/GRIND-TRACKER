# GRIND-TRACKER Features Documentation

This document provides a comprehensive overview of all implemented features and tiles in the GRIND-TRACKER dashboard, as well as their current status and purpose. Use this as a reference for future development, suggestions, and onboarding.

---

## Dashboard Tiles & Features

### 1. **Task List Tile**
- **Purpose:** Manage all daily, recurring, and one-off tasks.
- **Features:**
  - Add, edit, complete, and delete tasks.
  - Mark tasks as recurring (daily).
  - Supports both placement prep (e.g., DSA, core study) and college tasks.
  - Visual distinction for daily/recurring tasks.

### 2. **Preview/Next Action Tile**
- **Purpose:** Show details and quick actions for the selected or next actionable task.
- **Features:**
  - Displays task title, estimate, timer, notes, and action buttons (pause, complete, edit).
  - Minimal, modern UI with SVG icons.
  - Clicking a task in the list updates this tile.
  - Focus Lock option (subtle link) to hide all except the current step.

### 3. **Streaks Tile**
- **Purpose:** Visually track daily streaks and progress for key habits.
- **Features:**
  - Shows current streak, longest streak, and monthly completion percentage.
  - Calendar/grid view for daily completions.
  - Missed days trend and improvement stats.
  - "Done Today" button for quick marking.

### 4. **Pomodoro/Timer Tile**
- **Purpose:** Support focused work sessions using Pomodoro or custom timers.
- **Features:**
  - Start, pause, and reset focus sessions.
  - Visual ring and time display.
  - Multiple modes (Focus, Short, Long).

### 5. **Subject/Exam Tracker Tile**
- **Purpose:** Track progress in core/college subjects and upcoming exams.
- **Features:**
  - List of all subjects with progress bars.
  - Add and update subject progress.
  - (If implemented) Add exam dates and revision status.

### 6. **Weekly Review Tile**
- **Purpose:** Reflect on weekly progress and plan for the next week.
- **Features:**
  - Shows completed tasks, streaks, and missed days.
  - Missed days trend and improvement stats.
  - (If implemented) Suggestions for next week’s focus.

### 7. **Inbox Tile**
- **Purpose:** Quickly capture random or one-off tasks for later triage.
- **Features:**
  - Simple input for fast task entry.
  - Tasks remain in Inbox until assigned or completed.
  - (If implemented) Drag-and-drop to assign tasks.

### 8. **Upcoming/Repeating Tasks Tile**
- **Purpose:** Aggregate all scheduled/recurring tasks (e.g., study until exam).
- **Features:**
  - Daily/recurring tasks are shown in the main task list.
  - (If implemented) Dedicated tile for all future scheduled tasks.

---

## Tile Relationships & Automation
- Clicking a task in the Task List updates the Preview/Next Action tile.
- Completing a recurring task updates the Streaks tile.
- (If implemented) Adding an exam in Subject/Exam Tracker can auto-create study tasks.
- (If implemented) Moving a task from Inbox to Task List assigns it to a day/subject.

---

## Subject/Exam Automation (Implemented)
- Add exams/subjects with a name, date, and optional topics/syllabus.
- Auto-generates daily study tasks for each topic (or generic tasks if no topics) up to the exam date.
- All auto-created tasks appear in the main "Today's Tasks" tile, mixed with user-added tasks.
- Each task is labeled with the subject/exam name for clarity.
- No new tile is created; the dashboard remains minimal.
- Users can edit or delete any auto-generated task.
- If many subjects/exams are added, the task list may become long, but tasks are always labeled and manageable.
- Sorting and completion filters help keep the list focused.
- **Future option:** Add filters, grouping, or a dedicated tile for subject/exam tasks if the list becomes overwhelming.

---

## UI/UX Principles
- **Tile-based layout:** Each tile has a single, focused purpose.
- **Minimal, modern design:** Uses SVG icons, accent colors, and clear typography.
- **Progressive disclosure:** Details and actions appear on click/hover.
- **Mobile-friendly:** Tiles stack or scroll well on smaller screens.

---

## Feature Status Table
| Tile/Feature                | Status         | Notes                                    |
|----------------------------|---------------|------------------------------------------|
| Task List                  | Implemented   | Supports daily, recurring, and one-off   |
| Preview/Next Action        | Implemented   | Minimal UI, SVG icons, Focus Lock        |
| Streaks                    | Implemented   | Visual streaks, calendar, stats          |
| Pomodoro/Timer             | Implemented   | Multiple modes, visual ring              |
| Subject/Exam Tracker       | Partial       | Subject progress; exam tracking optional |
| Weekly Review              | Partial       | Stats and trends; suggestions optional   |
| Inbox                      | Not Implemented | Planned for fast capture                |
| Upcoming/Repeating Tasks   | Implemented   | Daily/recurring in main list             |
| Tile Automation            | Partial       | Some links; more automation possible     |

---

## Screenshots
*(Add screenshots here for each tile as the project evolves)*

---

## How to Update This File
- Add a new entry for each new tile or feature.
- Update the status and notes as features are added or improved.
- Use this as a reference before suggesting or implementing new features.

---

_Last updated: 14 April 2026_
