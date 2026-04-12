# GRIND-TRACKER

Daily “mission” dashboard for CSE placement prep – DSA tasks, core CS progress, streaks, Pomodoro timer, reflections, and lock-screen reminders in a single minimal web app.

## Overview

This is a single-page web app that helps you turn placements into a daily routine:

- Non‑negotiable **daily tasks** (DSA, core subjects, exams, project thinking)
- **Week view** to see how consistent you’ve been
- **Sticky mini Pomodoro** that’s always visible
- Full **Pomodoro timer** with focus / break modes
- **Subject progress** bars for DBMS, OS, CN, DSA
- **Streak tracker** and a loud morning **“slap screen”**
- **Daily reflection** log stored locally
- Optional **PWA install** + notification reminders

Everything is front-end only and stored in `localStorage`.

## Tech Stack

- HTML, CSS, vanilla JavaScript
- LocalStorage for persistence
- Service worker (sw.js) for PWA + notifications

## Running Locally

```bash
git clone https://github.com/aimankhurshid/GRIND-TRACKER.git
cd GRIND-TRACKER

# Simple static server (Python 3)
python -m http.server 5500
```

Now open:

- http://127.0.0.1:5500/cse_dashboard_2.html

## Files

- `cse_dashboard_2.html` – main dashboard UI and logic
- `sw.js` – service worker for PWA + notifications

## Status

Personal project for tracking placement preparation and building a polished front-end dashboard. PRs and suggestions are welcome.
