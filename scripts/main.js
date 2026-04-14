const TASKS_KEY='cse_tasks', STREAK_KEY='cse_streak', LAST_DATE_KEY='cse_last_date';
  const STREAK_LOG_KEY='cse_streak_log', SNOOZE_KEY='cse_snooze_until';
  const SUBJ_KEY='cse_subjects', REFLECT_KEY='cse_reflections', POMO_KEY='cse_pomo';
  const POMO_LOG_KEY='cse_pomo_log';
  const WEEK_PHOTO_KEY='cse_week_photos';
  const DAILY_SNAPSHOT_KEY='cse_daily_snapshots';
  const AUDIT_LOG_KEY='cse_audit_log';
  const POMO_RUNTIME_KEY='cse_pomo_runtime';
  const LAST_BACKUP_EXPORT_KEY='cse_last_backup_export';
  const BACKUP_REMINDER_DISMISS_KEY='cse_backup_reminder_dismiss';
  const BACKUP_REMINDER_DAYS_KEY='cse_backup_reminder_days';
  const MORNING_MODE_LAST_OPEN_KEY='cse_morning_mode_last_open';
  const NIGHT_PREP_KEY='cse_night_prep';
  const LAST_DRIFT_ALERT_KEY='cse_last_drift_alert';
  const CUSTOM_TASKS_KEY='cse_custom_tasks';
  const CUSTOM_TASK_TEMPLATES_KEY='cse_custom_task_templates';
  const TASK_SORT_KEY='cse_task_sort_mode';
  const TODAY_FOCUS_PLAN_KEY='cse_today_focus_plan';
  const TASK_COMPLETION_LOG_KEY='cse_task_completion_log';
  const APP_DB_NAME='daily_mission_db', APP_DB_VERSION=1, APP_DB_STORE='kv';
  const DEV_BYPASS_KEY='cse_dev_bypass_slap';
  const DAILY_TASK_CAP=5;
  const BIG_TASK_SPLIT_MINUTES=90;
  const STUCK_TASK_MINUTES=180;
  let pendingWeekPhotoDate=null;
  let pendingWeekChoiceDate=null;
  let reopenStreakViewerDate=null;
  let weekPhotoStream=null;
  let weekPhotoCapturedDataUrl=null;
  let updateWaitingWorker=null;
  let streakPhotoDates=[];
  let streakPhotoIndex=-1;
  let photoHoverTimer=null;
  let photoHoverTargetDate=null;
  let weekPhotosCache=(function(){
    try{return JSON.parse(localStorage.getItem(WEEK_PHOTO_KEY))||{};}catch{return{};}
  })();

  // IndexedDB (free local persistence, better for image storage than localStorage)
  function openAppDb(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window))return reject(new Error('indexedDB unavailable'));
      const req=indexedDB.open(APP_DB_NAME,APP_DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(APP_DB_STORE))db.createObjectStore(APP_DB_STORE);
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('indexedDB open failed'));
    });
  }
  function dbGetValue(key){
    return openAppDb().then(db=>new Promise((resolve,reject)=>{
      const tx=db.transaction(APP_DB_STORE,'readonly');
      const store=tx.objectStore(APP_DB_STORE);
      const req=store.get(key);
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('indexedDB read failed'));
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>db.close();
    }));
  }
  function dbSetValue(key,val){
    return openAppDb().then(db=>new Promise((resolve,reject)=>{
      const tx=db.transaction(APP_DB_STORE,'readwrite');
      const store=tx.objectStore(APP_DB_STORE);
      store.put(val,key);
      tx.oncomplete=()=>{db.close();resolve();};
      tx.onerror=()=>{db.close();reject(tx.error||new Error('indexedDB write failed'));};
    }));
  }
  async function initWeekPhotoStorage(){
    try{
      const stored=await dbGetValue(WEEK_PHOTO_KEY);
      if(stored&&typeof stored==='object'){
        weekPhotosCache=stored;
      }else{
        // One-time migration from localStorage if IndexedDB is empty.
        if(weekPhotosCache&&Object.keys(weekPhotosCache).length>0){
          await dbSetValue(WEEK_PHOTO_KEY,weekPhotosCache);
        }
      }
    }catch(_){
      // Fallback remains localStorage cache.
    }
    renderWeekView();
    updateStorageStatus();
  }

  const QUOTES = [
    "While you slept, someone in your batch solved 3 LeetCode problems.\nThey're getting your job.",
    "You said 'tomorrow' yesterday too.\nTomorrow doesn't exist. Only right now.",
    "Comfort is expensive.\nYou're paying for it with your placement offer.",
    "The students who got placed last year?\nThey were grinding at 7am while you scrolled.",
    "Skipping one day feels small.\nSkipping 30 days is how you fail placements.",
    "The recruiter doesn't care about your reasons.\nOnly your GitHub and your DSA.",
    "You have 90 days. Not 90 'tomorrows'.\n90 todays. Use this one.",
    "Average CSE student: watches TUF, builds nothing, gets rejected.\nDon't be average.",
    "The placement interview is coming whether you prepare or not.\nYour move.",
    "Someone from your college is grinding LeetCode right now.\nAre you?"
  ];
  const TASK_LABELS=[
    '2 LeetCode Problems',
    '45 min TUF+ Study',
    'Review Yesterday\'s Notes',
    '10 min Project Thinking',
    'Study for Sem Exam'
  ];

  function getToday() { return new Date().toISOString().split('T')[0]; }
  function isTaskCompletedEntry(entry){
    if(entry===true)return true;
    if(entry&&typeof entry==='object')return entry.status==='completed';
    return false;
  }
  function isTaskInProgressEntry(entry){
    return Boolean(entry&&typeof entry==='object'&&entry.status==='in_progress');
  }
  function getTaskStateEntry(dayState,taskId){
    const entry=(dayState||{})[taskId];
    if(entry===true)return {status:'completed'};
    if(entry&&typeof entry==='object')return entry;
    return null;
  }
  function getTaskEstimatedMinutes(entry){
    if(!entry||typeof entry!=='object')return null;
    const n=parseInt(entry.estimatedMinutes,10);
    return Number.isFinite(n)&&n>0?n:null;
  }
  function getTaskActualMinutes(entry){
    if(!entry||typeof entry!=='object'||!entry.startedAt||!entry.completedAt)return null;
    const diff=Math.round((new Date(entry.completedAt)-new Date(entry.startedAt))/60000);
    return Number.isFinite(diff)&&diff>=0?diff:null;
  }
  function addDaysToDateStr(dateStr,days){
    const d=new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate()+days);
    return d.toISOString().split('T')[0];
  }
  function formatMins(mins){
    const n=parseInt(mins,10);
    return Number.isFinite(n)&&n>=0?`${n}m`:'-';
  }
  function formatClockTime(iso){
    if(!iso)return '-';
    const d=new Date(iso);
    if(Number.isNaN(d.getTime()))return '-';
    return d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
  }
  function countCompletedTasks(dayState){
    return Object.values(dayState||{}).filter(isTaskCompletedEntry).length;
  }
  function isPastDate(dateStr){ return dateStr<getToday(); }
  function isDateLocked(dateStr){ return dateStr<getToday() || Boolean(loadDailySnapshots()[dateStr]); }
  function loadDailySnapshots(){
    try{return JSON.parse(localStorage.getItem(DAILY_SNAPSHOT_KEY))||{};}catch{return{};}
  }
  function saveDailySnapshots(v){
    localStorage.setItem(DAILY_SNAPSHOT_KEY,JSON.stringify(v));
  }
  function loadAuditLog(){
    try{return JSON.parse(localStorage.getItem(AUDIT_LOG_KEY))||{};}catch{return{};}
  }
  function saveAuditLog(v){
    localStorage.setItem(AUDIT_LOG_KEY,JSON.stringify(v));
  }
  function recordAuditEvent(action,detail,dateStr){
    const day=dateStr||getToday();
    const log=loadAuditLog();
    if(!log[day])log[day]=[];
    log[day].push({
      ts:new Date().toISOString(),
      action,
      detail
    });
    if(log[day].length>120)log[day]=log[day].slice(-120);
    saveAuditLog(log);
  }
  function getRecentAuditEvents(limit){
    const log=loadAuditLog();
    const events=[];
    Object.keys(log).sort().forEach(date=>{
      (log[date]||[]).forEach(item=>events.push({date,...item}));
    });
    events.sort((a,b)=>String(b.ts).localeCompare(String(a.ts)));
    return events.slice(0,limit||10);
  }
  function updateDayLockBadge(){
    const badge=document.getElementById('dayLockBadge');
    if(!badge)return;
    const locked=isDateLocked(getToday());
    badge.textContent=locked?'TODAY LOCKED':'TODAY LIVE';
    badge.classList.toggle('locked',locked);
  }
  function renderAuditLog(){
    const list=document.getElementById('auditLogList');
    if(!list)return;
    const events=getRecentAuditEvents(10);
    if(!events.length){
      list.innerHTML='<div class="audit-log-item">No edits yet.</div>';
      return;
    }
    list.innerHTML='';
    events.forEach(ev=>{
      const el=document.createElement('div');
      el.className='audit-log-item';
      const time=new Date(ev.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
      el.innerHTML=`<b>${ev.date}</b> ${time} · ${ev.action}<br>${ev.detail}`;
      list.appendChild(el);
    });
  }
  function computeStreakCountOnDate(dateStr,log){
    const dates=new Set((log||[]).filter(d=>d<=dateStr));
    if(!dates.has(dateStr))return 0;
    let count=1;
    const cur=new Date(dateStr+'T00:00:00');
    while(true){
      cur.setDate(cur.getDate()-1);
      const prev=cur.toISOString().split('T')[0];
      if(!dates.has(prev))break;
      count++;
    }
    return count;
  }
  function finalizeDailySnapshot(dateStr){
    if(!dateStr||dateStr>getToday())return false;
    const snapshots=loadDailySnapshots();
    if(snapshots[dateStr])return false;

    const state=loadState();
    const log=getStreakLog();
    const dayTasks=state[dateStr]||{};
    const taskDoneCount=countCompletedTasks(dayTasks);
    const dayPomo=loadPomoDailyLog()[dateStr]||{focusMinutes:0,breakMinutes:0,sessions:0};
    const photos=loadWeekPhotos();
    const streakMarked=log.includes(dateStr);

    snapshots[dateStr]={
      date:dateStr,
      capturedAt:new Date().toISOString(),
      tasks:{...dayTasks},
      taskDoneCount,
      streak:{
        marked:streakMarked,
        count:computeStreakCountOnDate(dateStr,log)
      },
      pomodoro:{
        focusMinutes:dayPomo.focusMinutes||0,
        breakMinutes:dayPomo.breakMinutes||0,
        sessions:dayPomo.sessions||0
      },
      photo:{
        hasProof:Boolean(photos[dateStr])
      }
    };
    saveDailySnapshots(snapshots);
    recordAuditEvent('snapshot','Daily snapshot saved and day locked.',dateStr);
    return true;
  }
  function getBackupReminderDays(){
    const n=parseInt(localStorage.getItem(BACKUP_REMINDER_DAYS_KEY)||'7',10);
    return [7,14,30].includes(n)?n:7;
  }
  function formatBytes(bytes){
    if(!Number.isFinite(bytes)||bytes<=0)return '0 B';
    const units=['B','KB','MB','GB'];
    let i=0,val=bytes;
    while(val>=1024&&i<units.length-1){val/=1024;i++;}
    return `${val.toFixed(i===0?0:1)} ${units[i]}`;
  }
  function estimatePhotoBytes(){
    const photos=loadWeekPhotos();
    return Object.values(photos).reduce((sum,v)=>sum+(v?String(v).length:0),0)*0.75;
  }
  async function updateStorageStatus(){
    const text=document.getElementById('storageStatusText');
    const bar=document.getElementById('storageBar');
    if(!text||!bar)return;
    const photoBytes=estimatePhotoBytes();
    const photoCount=Object.keys(loadWeekPhotos()).length;
    let total=0,quota=0;
    try{
      if(navigator.storage&&navigator.storage.estimate){
        const est=await navigator.storage.estimate();
        total=est.usage||0;
        quota=est.quota||0;
      }
    }catch(_){ }
    const pct=quota?Math.min(100,Math.round((total/quota)*100)):0;
    bar.style.width=`${pct}%`;
    text.textContent=`Photos: ${photoCount} | Photos size ~ ${formatBytes(photoBytes)} | Total storage ${quota?`${pct}% used`:'estimate unavailable'}`;
    bar.style.background=pct>=85?'#ff7d7d':(pct>=70?'#f0e040':'#79b7ff');
  }
  function updateBackupAgeText(){
    const el=document.getElementById('backupAgeText');
    if(!el)return;
    const last=parseInt(localStorage.getItem(LAST_BACKUP_EXPORT_KEY)||'0',10)||0;
    if(!last){el.textContent='Last backup: never';return;}
    const days=Math.floor((Date.now()-last)/86400000);
    el.textContent=`Last backup: ${days===0?'today':`${days} day${days===1?'':'s'} ago`}`;
  }
  function hidePhotoHoverPreview(){
    clearTimeout(photoHoverTimer);
    photoHoverTimer=null;
    photoHoverTargetDate=null;
    const p=document.getElementById('photoHoverPreview');
    if(p)p.style.display='none';
  }
  function positionHoverPreview(x,y){
    const p=document.getElementById('photoHoverPreview');
    if(!p)return;
    const w=Math.min(window.innerWidth*0.4,240);
    const h=w*4/3;
    let left=x+14,top=y+14;
    if(left+w>window.innerWidth-8)left=x-w-14;
    if(top+h>window.innerHeight-8)top=y-h-14;
    p.style.left=`${Math.max(8,left)}px`;
    p.style.top=`${Math.max(8,top)}px`;
  }
  function showPhotoHoverPreview(dataUrl,x,y,date){
    const p=document.getElementById('photoHoverPreview');
    const img=document.getElementById('photoHoverPreviewImg');
    if(!p||!img)return;
    img.src=dataUrl;
    positionHoverPreview(x,y);
    p.style.display='block';
    photoHoverTargetDate=date;
  }
  function attachPhotoHoverPreview(el,date,dataUrl){
    if(!el)return;
    el.addEventListener('pointerenter',e=>{
      if(e.pointerType==='touch')return;
      hidePhotoHoverPreview();
      photoHoverTimer=setTimeout(()=>showPhotoHoverPreview(dataUrl,e.clientX,e.clientY,date),1200);
    });
    el.addEventListener('pointermove',e=>{
      const p=document.getElementById('photoHoverPreview');
      if(!p||p.style.display!=='block'||photoHoverTargetDate!==date)return;
      positionHoverPreview(e.clientX,e.clientY);
    });
    el.addEventListener('pointerleave',hidePhotoHoverPreview);
    el.addEventListener('pointerdown',hidePhotoHoverPreview);
  }
  function attachWeekPhotoInlineZoom(el){
    if(!el)return;
    let zoomTimer=null;
    const clearZoom=()=>{
      if(zoomTimer){
        clearTimeout(zoomTimer);
        zoomTimer=null;
      }
      el.classList.remove('thumb-zoom');
    };
    el.addEventListener('pointerenter',e=>{
      if(e.pointerType==='touch')return;
      clearZoom();
      zoomTimer=setTimeout(()=>el.classList.add('thumb-zoom'),1000);
    });
    el.addEventListener('pointerleave',clearZoom);
    el.addEventListener('pointerdown',clearZoom);
  }
  function buildWeeklyReportData(){
    const state=loadState();
    const log=getStreakLog();
    const refl=loadReflections();
    const pomoLog=loadPomoDailyLog();
    const now=new Date();
    const start=new Date(now);start.setDate(now.getDate()-((now.getDay()+6)%7));
    let full=0,partial=0,focus=0,breakMin=0,sessions=0,bestDate='',bestScore=-1;
    for(let i=0;i<7;i++){
      const d=new Date(start);d.setDate(start.getDate()+i);
      const ds=d.toISOString().split('T')[0];
      const done=countCompletedTasks(state[ds]||{});
      const totalForDay=getCustomTasksForDate(ds).length;
      const isFull=totalForDay>0&&done>=totalForDay;
      if(isFull||log.includes(ds))full++;
      else if(done>0)partial++;
      if(done>bestScore){bestScore=done;bestDate=ds;}
      const dayLog=pomoLog[ds]||{};
      focus+=dayLog.focusMinutes||0;
      breakMin+=dayLog.breakMinutes||0;
      sessions+=dayLog.sessions||0;
    }
    const pct=Math.round((full/7)*100);
    return {full,partial,pct,focus,breakMin,sessions,bestDate,reflectionCount:refl.length};
  }
  function renderWeeklyReportCard(){
    const d=buildWeeklyReportData();
    const l1=document.getElementById('weeklyReportLine1');
    const l2=document.getElementById('weeklyReportLine2');
    const l3=document.getElementById('weeklyReportLine3');
    if(l1)l1.textContent=`Full days: ${d.full}/7 (${d.pct}%) | Partial days: ${d.partial}`;
    if(l2)l2.textContent=`Focus: ${d.focus}m | Break: ${d.breakMin}m | Sessions: ${d.sessions}`;
    if(l3)l3.textContent=`Best day: ${d.bestDate||'—'} | Reflections saved: ${d.reflectionCount}`;
  }
  function downloadWeeklyReport(){
    const d=buildWeeklyReportData();
    const lines=[
      'Daily Mission Weekly Report',
      `Generated: ${new Date().toLocaleString()}`,
      `Full days: ${d.full}/7 (${d.pct}%)`,
      `Partial days: ${d.partial}`,
      `Focus minutes: ${d.focus}`,
      `Break minutes: ${d.breakMin}`,
      `Sessions: ${d.sessions}`,
      `Best day: ${d.bestDate||'—'}`,
      `Reflections saved: ${d.reflectionCount}`
    ].join('\n');
    const blob=new Blob([lines],{type:'text/plain'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`daily-mission-weekly-report-${getToday()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function openMorningMode(){
    const modal=document.getElementById('morningModeModal');
    const list=document.getElementById('morningTaskList');
    const picker=document.getElementById('morningPickTask');
    const minsInput=document.getElementById('morningPickMinutes');
    const status=document.getElementById('morningPickStatus');
    if(!modal||!list||!picker||!minsInput)return;
    const tasks=loadState()[getToday()]||{};
    const pendingCore=TASK_LABELS.map((label,idx)=>({id:idx,label})).filter(t=>!tasks[t.id]);
    const pendingCustom=getPendingCustomTasks(tasks).map(t=>({id:t.id,label:t.text}));
    const pending=[...pendingCustom,...pendingCore];
    list.innerHTML='';
    (pending.slice(0,3).map(t=>t.label).length?pending.slice(0,3).map(t=>t.label):['All key tasks done today']).forEach(t=>{
      const el=document.createElement('div');
      el.className='mm-item';
      el.textContent=t;
      list.appendChild(el);
    });
    picker.innerHTML='';
    if(!pending.length){
      const op=document.createElement('option');
      op.value='';
      op.textContent='No pending tasks';
      picker.appendChild(op);
      if(status)status.textContent='No pending tasks right now. Review or close day.';
    }else{
      pending.forEach(t=>{
        const op=document.createElement('option');
        op.value=String(t.id);
        op.textContent=t.label;
        picker.appendChild(op);
      });
      if(status)status.textContent='Pick one task and estimate minutes. The mission ladder will track this.';
    }
    localStorage.setItem(MORNING_MODE_LAST_OPEN_KEY,getToday());
    modal.style.display='flex';
  }
  function closeMorningMode(){
    const modal=document.getElementById('morningModeModal');
    if(modal)modal.style.display='none';
  }
  function maybeAutoOpenMorningMode(){
    if(localStorage.getItem(MORNING_MODE_LAST_OPEN_KEY)===getToday())return;
    const slap=document.getElementById('slapScreen');
    const main=document.getElementById('mainContent');
    const slapHidden=slap&&(slap.style.display==='none');
    const mainVisible=main&&main.style.display==='block';
    if(window.innerWidth<900&&slapHidden&&mainVisible)setTimeout(openMorningMode,350);
  }

  function loadTodayFocusPlanMap(){
    try{return JSON.parse(localStorage.getItem(TODAY_FOCUS_PLAN_KEY))||{};}catch{return{};}
  }
  function saveTodayFocusPlanMap(v){
    localStorage.setItem(TODAY_FOCUS_PLAN_KEY,JSON.stringify(v));
  }
  function getTodayFocusPlan(){
    return loadTodayFocusPlanMap()[getToday()]||null;
  }

  function getTaskLabelById(taskId){
    if(/^[0-9]+$/.test(String(taskId))){
      const idx=Number(taskId);
      return TASK_LABELS[idx]||`Task ${idx+1}`;
    }
    const custom=getTodayCustomTasks().find(t=>String(t.id)===String(taskId));
    return custom?.text||'Selected task';
  }

  function saveFocusEstimate(taskId,taskLabel,minutes){
    const today=getToday();
    const all=loadTodayFocusPlanMap();
    const est=Math.max(10,Math.min(240,minutes||45));
    all[today]={taskId:String(taskId),taskLabel,estimatedMinutes:est,createdAt:new Date().toISOString()};
    saveTodayFocusPlanMap(all);
    renderDailyActionEngine();
  }

  function saveMorningFocusSelection(){
    const picker=document.getElementById('morningPickTask');
    const minsInput=document.getElementById('morningPickMinutes');
    const status=document.getElementById('morningPickStatus');
    if(!picker||!minsInput)return;
    const taskId=picker.value;
    const taskLabel=picker.selectedOptions?.[0]?.textContent||'';
    const est=Math.max(10,Math.min(240,parseInt(minsInput.value||'45',10)||45));
    if(!taskId){
      if(status)status.textContent='No task selected.';
      return;
    }
    const label=taskLabel||getTaskLabelById(taskId);
    saveFocusEstimate(taskId,label,est);
    if(status)status.textContent=`Selected: ${label} (${est} min).`;
    setPomoMode('focus');
    if(pomoState!==POMO_STATES.RUNNING)togglePomo();
    focusTaskById(/^[0-9]+$/.test(taskId)?Number(taskId):taskId);
    renderDailyActionEngine();
    closeMorningMode();
  }
  function getStreakLog() { try{return JSON.parse(localStorage.getItem(STREAK_LOG_KEY))||[];}catch{return[];} }
  function getMissedDays() {
    const log = getStreakLog(); let missed=0;
    for(let i=1;i<=7;i++){const d=new Date();d.setDate(d.getDate()-i);if(!log.includes(d.toISOString().split('T')[0]))missed++;}
    return missed;
  }

  // AUDIO
  let audioCtx=null;
  function playMaxAlarm(){
    try{
      audioCtx=new(window.AudioContext||window.webkitAudioContext)();
      const master=audioCtx.createGain();master.gain.value=1.0;
      const comp=audioCtx.createDynamicsCompressor();
      comp.threshold.value=-3;comp.ratio.value=20;comp.attack.value=0;comp.release.value=0.05;
      comp.connect(master);master.connect(audioCtx.destination);
      function beep(freq,type,t,dur,vol){
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.connect(g);g.connect(comp);o.frequency.value=freq;o.type=type;
        g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.001,t+dur);
        o.start(t);o.stop(t+dur+0.01);
      }
      function alarm(){
        const t=audioCtx.currentTime;
        beep(880,'square',t+0.0,0.18,1.0);beep(1760,'sine',t+0.0,0.18,0.5);
        beep(880,'square',t+0.25,0.18,1.0);beep(1760,'sine',t+0.25,0.18,0.5);
        beep(1100,'square',t+0.55,0.38,1.0);beep(2200,'sine',t+0.55,0.38,0.5);
      }
      alarm();
      window._snd=setInterval(()=>{
        if(document.getElementById('slapScreen').style.display!=='none')alarm();
        else clearInterval(window._snd);
      },1300);
    }catch(e){}
  }
  function stopAlarm(){
    clearInterval(window._snd);clearInterval(window._vib);
    try{if(audioCtx)audioCtx.close();}catch(e){}
    if('vibrate' in navigator)navigator.vibrate(0);
  }
  function vibratePhone(){
    if(!('vibrate' in navigator))return;
    const p=[400,100,400,100,800,150,400,100,400,100,800];
    navigator.vibrate(p);
    window._vib=setInterval(()=>{
      if(document.getElementById('slapScreen').style.display!=='none')navigator.vibrate(p);
      else clearInterval(window._vib);
    },2800);
  }
  function goFullscreen(){
    try{const e=document.documentElement;if(e.requestFullscreen)e.requestFullscreen();else if(e.webkitRequestFullscreen)e.webkitRequestFullscreen();}catch(e){}
  }

  // SLAP SCREEN
  function initSlapScreen(){
    // Dev/admin bypass: set localStorage.setItem('cse_dev_bypass_slap','1') to skip slap screen
    try{
      if(localStorage.getItem(DEV_BYPASS_KEY)==='1'){
        document.getElementById('slapScreen').style.display='none';
        document.getElementById('mainContent').style.display='block';
        document.getElementById('pomoFloat').style.display='flex';
        renderMissedBanner();
        return;
      }
    }catch(e){}

    const snooze=localStorage.getItem(SNOOZE_KEY);
    if(snooze&&Date.now()<parseInt(snooze)){
      document.getElementById('slapScreen').style.display='none';
      document.getElementById('mainContent').style.display='block';
      renderMissedBanner();return;
    }
    document.getElementById('slapQuote').textContent=QUOTES[Math.floor(Math.random()*QUOTES.length)];
    const missed=getMissedDays();
    if(missed>=1){document.getElementById('slapMissed').style.display='block';document.getElementById('slapMissedCount').textContent=missed+(missed===1?' DAY':' DAYS');}
    const ss=document.getElementById('slapScreen');
    ss.classList.add('flash');setTimeout(()=>ss.classList.remove('flash'),3500);
    setTimeout(()=>{goFullscreen();vibratePhone();playMaxAlarm();},300);
    let sec=7;
    const iv=setInterval(()=>{
      sec--;
      if(sec<=0){
        clearInterval(iv);
        document.getElementById('slapBtn').disabled=false;
        const t=document.getElementById('slapTimer');
        t.textContent='✓ Now go do it.';t.style.color='var(--green)';
      }else{document.getElementById('slapTimer').textContent=`Read this — unlocks in ${sec}s`;}
    },1000);
  }
  function honestyAnswer(yes){
    const resp=document.getElementById('honestyResp');
    document.getElementById('hYes').className='honesty-btn'+(yes?' sel-yes':'');
    document.getElementById('hNo').className='honesty-btn'+(!yes?' sel-no':'');
    if(yes){resp.style.color='#cc4444';resp.textContent="That's why you're behind. Close it. Open this first tomorrow.";}
    else{resp.style.color='var(--green)';resp.textContent="Good habit. Keep it. Now do your tasks.";}
  }
  function dismissSlap(){
    stopAlarm();
    document.getElementById('slapScreen').style.display='none';
    document.getElementById('mainContent').style.display='block';
    document.getElementById('pomoFloat').style.display='flex';
    renderMissedBanner();askNotifPermission();
    maybeAutoOpenMorningMode();
  }
  function snoozeSlap(){
    localStorage.setItem(SNOOZE_KEY,Date.now()+3600000);stopAlarm();
    document.getElementById('slapScreen').style.display='none';
    document.getElementById('mainContent').style.display='block';
    maybeAutoOpenMorningMode();
  }

  // TASKS
  function loadState(){try{return JSON.parse(localStorage.getItem(TASKS_KEY))||{};}catch{return{};}}
  function saveState(s){localStorage.setItem(TASKS_KEY,JSON.stringify(s));}
  function loadCustomTasks(){
    try{return JSON.parse(localStorage.getItem(CUSTOM_TASKS_KEY))||{};}catch{return{};}
  }
  function saveCustomTasks(v){
    localStorage.setItem(CUSTOM_TASKS_KEY,JSON.stringify(v));
  }

  function loadCustomTaskTemplates(){
    try{return JSON.parse(localStorage.getItem(CUSTOM_TASK_TEMPLATES_KEY))||[];}catch{return[];}
  }
  function saveCustomTaskTemplates(v){
    localStorage.setItem(CUSTOM_TASK_TEMPLATES_KEY,JSON.stringify(v));
  }

  function syncRecurringTasksForDate(dateStr){
    if(!dateStr) return;
    const templates=loadCustomTaskTemplates().filter(t=>t&&t.repeatDaily&&t.text);
    if(!templates.length)return;
    const all=loadCustomTasks();
    const list=all[dateStr]||[];
    let changed=false;
    templates.forEach(t=>{
      if(t.startDate&&dateStr<t.startDate)return;
      if(list.some(x=>x.recurringTemplateId===t.id))return;
      list.push({
        id:`c${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
        text:t.text,
        recurringTemplateId:t.id
      });
      changed=true;
    });
    if(changed){
      all[dateStr]=list;
      saveCustomTasks(all);
    }
  }

  function getPendingCustomTasks(stateToday){
    return getTodayCustomTasks().filter(t => !isTaskCompletedEntry(stateToday[t.id]));
  }

  function getTaskSortMode(){
    return localStorage.getItem(TASK_SORT_KEY)||'added';
  }
  function setTaskSortMode(val){
    localStorage.setItem(TASK_SORT_KEY,val);
  }
  function setTaskAddStatus(message,type){
    const el=document.getElementById('taskAddStatus');
    if(!el)return;
    el.textContent=message||'';
    el.className='task-add-status'+(type?` ${type}`:'');
  }
  function splitCustomTask(taskId,minutes){
    const today=getToday();
    const all=loadCustomTasks();
    const list=[...(all[today]||[])];
    const idx=list.findIndex(t=>String(t.id)===String(taskId));
    if(idx<0)return false;
    const base=list[idx].text||'Task';
    const firstId=`c${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
    const secondId=`c${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
    const half=Math.max(30,Math.round(minutes/2/5)*5);
    list.splice(idx,1,
      {id:firstId,text:`${base} (Part 1)`},
      {id:secondId,text:`${base} (Part 2)`}
    );
    all[today]=list;
    saveCustomTasks(all);
    const state=loadState();
    if(!state[today])state[today]={};
    delete state[today][taskId];
    state[today][firstId]={status:'not_started',estimatedMinutes:half};
    state[today][secondId]={status:'not_started',estimatedMinutes:half};
    saveState(state);
    setTaskAddStatus('Big task split into two smaller parts for better execution.', 'ok');
    renderTasks();
    renderProgress();
    renderDailyActionEngine();
    return true;
  }


  // --- Estimate Modal Logic ---
  let estimatePendingTaskId = null;

  function openEstimateModal(taskId) {
    estimatePendingTaskId = taskId;
    const modal = document.getElementById('estimateModal');
    const label = document.getElementById('estimateTaskLabel');
    const input = document.getElementById('estimateMinutesInput');
    const promptLabel = document.getElementById('estimateMinutesPrompt');
    if (!modal || !label || !input) return;
    label.textContent = getTaskLabelById(taskId);
    if (promptLabel) promptLabel.textContent = "Since you're going to do this work, how much time will it take?";
    const currentState=loadState()[getToday()]||{};
    const existing=getTaskStateEntry(currentState,taskId);
    input.value = getTaskEstimatedMinutes(existing) || getTodayFocusPlan()?.estimatedMinutes || 45;
    modal.style.display = 'flex';
    setTimeout(() => { input.focus(); }, 100);
  }

  function closeEstimateModal() {
    const modal = document.getElementById('estimateModal');
    if (modal) modal.style.display = 'none';
    estimatePendingTaskId = null;
  }

  function confirmEstimateModal() {
    const input = document.getElementById('estimateMinutesInput');
    if (!input || !estimatePendingTaskId) return;
    const minutes = Math.max(10, Math.min(240, parseInt(input.value || '45', 10) || 45));
    if(minutes>BIG_TASK_SPLIT_MINUTES){
      const split=window.confirm('This is a big task. Split into 2 smaller tasks for better completion?');
      if(split){
        const didSplit=splitCustomTask(estimatePendingTaskId,minutes);
        if(didSplit){
          closeEstimateModal();
          return;
        }
      }
    }
    const label = getTaskLabelById(estimatePendingTaskId);
    saveFocusEstimate(estimatePendingTaskId, label, minutes);
    startTask(estimatePendingTaskId,{estimatedMinutes:minutes});
    focusTaskById(/^[0-9]+$/.test(String(estimatePendingTaskId)) ? Number(estimatePendingTaskId) : estimatePendingTaskId);
    closeEstimateModal();
  }

  // Bind modal buttons on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const cancelBtn = document.getElementById('estimateCancelBtn');
    const saveBtn = document.getElementById('estimateSaveBtn');
    if (cancelBtn) cancelBtn.onclick = closeEstimateModal;
    if (saveBtn) saveBtn.onclick = confirmEstimateModal;
    // Optional: close modal on Escape
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('estimateModal')?.style.display === 'flex' && e.key === 'Escape') {
        closeEstimateModal();
        return;
      }
      if (document.getElementById('taskCompletionModal')?.style.display === 'flex' && e.key === 'Escape') {
        closeTaskCompletionModal();
      }
    });
  });

  function loadTaskCompletionLog(){
    try{return JSON.parse(localStorage.getItem(TASK_COMPLETION_LOG_KEY))||{};}catch{return{};}
  }
  function saveTaskCompletionLog(v){
    localStorage.setItem(TASK_COMPLETION_LOG_KEY,JSON.stringify(v));
  }
  function saveTaskCompletionSnapshot(summary){
    const all=loadTaskCompletionLog();
    const day=getToday();
    if(!all[day])all[day]=[];
    all[day].push(summary);
    if(all[day].length>100)all[day]=all[day].slice(-100);
    saveTaskCompletionLog(all);
  }
  function getCompletionSuggestion(summary){
    const setTime=summary.estimatedMinutes;
    const taken=summary.actualMinutes;
    if(!Number.isFinite(setTime)||setTime<=0){
      return 'Suggestion: Set an estimate before starting next time so the app can guide you better when you run late.';
    }
    const diff=taken-setTime;
    if(diff<=0)return `Suggestion: Completed ${Math.abs(diff)}m early. Tighten next estimate by around 10% if this pattern continues.`;
    if(diff<=15)return 'Suggestion: Slight overrun. Continue in one block next time, but add a 10-15m buffer in your estimate.';
    if(diff<=45)return 'Suggestion: Moderate overrun. Split similar tasks into two smaller parts before starting.';
    return 'Suggestion: Major overrun. Break this into sessions, complete one now, and schedule a follow-up task immediately.';
  }
  function openTaskCompletionModal(summary){
    const modal=document.getElementById('taskCompletionModal');
    const label=document.getElementById('taskCompletionTaskLabel');
    const stats=document.getElementById('taskCompletionStats');
    const suggestion=document.getElementById('taskCompletionSuggestion');
    if(!modal||!label||!stats||!suggestion)return;
    const setTime=Number.isFinite(summary.estimatedMinutes)?formatMins(summary.estimatedMinutes):'Not set';
    const variance=Number.isFinite(summary.estimatedMinutes)
      ? (summary.actualMinutes-summary.estimatedMinutes)
      : null;
    label.textContent=summary.taskLabel||'Task';
    stats.innerHTML=''+
      `<div class="tc-row"><span>Start time</span><strong>${formatClockTime(summary.startedAt)}</strong></div>`+
      `<div class="tc-row"><span>End time</span><strong>${formatClockTime(summary.completedAt)}</strong></div>`+
      `<div class="tc-row"><span>Time taken</span><strong>${formatMins(summary.actualMinutes)}</strong></div>`+
      `<div class="tc-row"><span>Set time</span><strong>${setTime}</strong></div>`+
      `<div class="tc-row"><span>Difference</span><strong>${variance===null?'No estimate':(variance>0?`+${formatMins(variance)} over`:`${formatMins(Math.abs(variance))} early`)}</strong></div>`;
    suggestion.textContent=getCompletionSuggestion(summary);
    modal.style.display='flex';
  }
  function closeTaskCompletionModal(){
    const modal=document.getElementById('taskCompletionModal');
    if(modal)modal.style.display='none';
  }

  function getTodayCustomTasks(){
    syncRecurringTasksForDate(getToday()); return loadCustomTasks()[getToday()] || [];
  }

  function getCustomTasksForDate(dateStr){
    syncRecurringTasksForDate(dateStr); return loadCustomTasks()[dateStr] || [];
  }

  function getSelectedPlanDate(){
    const picker=document.getElementById('taskPlanDate');
    if(!picker)return getToday();
    return picker.value==='tomorrow'?getDateOffset(1):getToday();
  }
  function initTaskPlanDatePicker(){
    const picker=document.getElementById('taskPlanDate');
    if(!picker)return;
    const hour=new Date().getHours();
    picker.value=hour>=20?'tomorrow':'today';
  }


  function startMustDoSprint(){
    const stateToday = loadState()[getToday()] || {};
    const mustTask = getPendingCustomTasks(stateToday)[0];
    if(!mustTask)return;
    const id=mustTask.id;
    setPomoMode('focus');
    if(pomoState!==POMO_STATES.RUNNING)togglePomo();
    if(id!==null)focusTaskById(id);
    renderTasks();
    renderProgress();
    renderDailyActionEngine();
  }
  function closeDayIfReady(){
    const status=document.getElementById('closeDayStatus');
    const md=getTodayMissionData();
    const okTask=md.doneCount>=1;
    const okSprint=md.sessions>=1;
    const okReflect=md.hasReflection;
    if(okTask&&okSprint&&okReflect){
      markToday();
      if(status){
        status.textContent='Day closed. Great execution.';
        status.classList.add('ok');
      }
      return;
    }
    const missing=[];
    if(!okTask)missing.push('1 task');
    if(!okSprint)missing.push('1 sprint');
    if(!okReflect)missing.push('reflection');
    if(status){
      status.textContent=`Still pending: ${missing.join(', ')}.`;
      status.classList.remove('ok');
    }
  }

  function addCustomTask(){
    const input=document.getElementById('customTaskInput');
    const targetDate=getSelectedPlanDate();
    if(!input||isDateLocked(targetDate))return;
    const text=(input.value||'').trim();
    if(!text)return;
    const repeatDaily=Boolean(document.getElementById('customTaskRepeatDaily')?.checked);
    const all=loadCustomTasks();
    let effectiveDate=targetDate;
    let list=all[effectiveDate]||[];
    if(list.length>=DAILY_TASK_CAP){
      while(list.length>=DAILY_TASK_CAP){
        effectiveDate=addDaysToDateStr(effectiveDate,1);
        list=all[effectiveDate]||[];
      }
      setTaskAddStatus(`Daily cap reached (${DAILY_TASK_CAP}). Task moved to ${effectiveDate}.`,'warn');
    }else{
      setTaskAddStatus('','');
    }
    if(repeatDaily){
      // Only add as a recurring template, not as a direct task for today
      const templates=loadCustomTaskTemplates();
      templates.push({
        id:`t${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
        text,
        startDate:effectiveDate,
        repeatDaily:true
      });
      saveCustomTaskTemplates(templates);
      syncRecurringTasksForDate(getToday());
      syncRecurringTasksForDate(getDateOffset(1));
    }else{
      const id=`c${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
      list.push({id,text});
      all[effectiveDate]=list;
      saveCustomTasks(all);
    }
    input.value='';
    const repeatEl=document.getElementById('customTaskRepeatDaily');
    if(repeatEl)repeatEl.checked=false;
    if(effectiveDate===getToday()){
      renderTasks();
      renderProgress();
      renderDailyActionEngine();
      focusTaskById(id);
    }
    recordAuditEvent('task',`Added custom task for ${effectiveDate}: ${text}`,effectiveDate);
  }

  function deleteCustomTask(id){
    if(!id||isDateLocked(getToday()))return;
    const today=getToday();
    const all=loadCustomTasks();
    let list=all[today]||[];
    const idx=list.findIndex(t=>t.id===id);
    if(idx<0)return;
    const task=list[idx];
    // If it's a recurring (daily) task, show retire/replace popup
    if(task.recurringTemplateId){
      openRetireDailyTaskModal(task, idx, list, all, today);
      return;
    }
    // Normal task: just delete
    list=list.filter(t=>t.id!==id);
    all[today]=list;
    saveCustomTasks(all);
    const state=loadState();
    if(state[today]&&Object.prototype.hasOwnProperty.call(state[today],id)){
      delete state[today][id];
      saveState(state);
    }
    renderTasks();
    renderProgress();
    renderDailyActionEngine();
    recordAuditEvent('task','Deleted custom task.',today);
  }
  function openRetireDailyTaskModal(task, idx, list, all, today){
    let modal=document.getElementById('retireDailyTaskModal');
    if(!modal){
      modal=document.createElement('div');
      modal.id='retireDailyTaskModal';
      modal.className='modal retire-daily-modal';
      modal.innerHTML=`
        <div class="modal-content">
          <div class="modal-title">Retire a Daily Task</div>
          <div class="modal-message">Would you like to replace this daily focus, or retire it with no replacement?</div>
          <input type="text" id="newDailyTaskInput" class="modal-input" placeholder="Enter new daily focus..." style="display:none;margin-top:10px;" />
          <div class="modal-actions">
            <button id="replaceDailyBtn" class="modal-btn">Replace with New Daily</button>
            <button id="retireDailyBtn" class="modal-btn">Just Retire</button>
            <button id="cancelRetireBtn" class="modal-btn cancel">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    modal.style.display='flex';
    const input=modal.querySelector('#newDailyTaskInput');
    input.value='';
    input.style.display='none';
    // Button handlers
    modal.querySelector('#replaceDailyBtn').onclick=()=>{
      if(input.style.display==='none'){
        input.style.display='block';
        input.focus();
        return;
      }
      const val=input.value.trim();
      if(val){
        let templates=loadCustomTaskTemplates();
        templates=templates.filter(t=>t.id!==task.recurringTemplateId);
        templates.push({
          id:`t${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
          text:val,
          startDate:today,
          repeatDaily:true
        });
        saveCustomTaskTemplates(templates);
        list.splice(idx,1);
        all[today]=list;
        saveCustomTasks(all);
        modal.style.display='none';
        renderTasks();
        renderProgress();
        renderDailyActionEngine();
        recordAuditEvent('task','Replaced daily task',task.id);
      } else {
        input.focus();
      }
    };
    input.onkeydown=(e)=>{
      if(e.key==='Enter'){
        const val=input.value.trim();
        if(val){
          let templates=loadCustomTaskTemplates();
          templates=templates.filter(t=>t.id!==task.recurringTemplateId);
          templates.push({
            id:`t${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
            text:val,
            startDate:today,
            repeatDaily:true
          });
          saveCustomTaskTemplates(templates);
          list.splice(idx,1);
          all[today]=list;
          saveCustomTasks(all);
          modal.style.display='none';
          renderTasks();
          renderProgress();
          renderDailyActionEngine();
          recordAuditEvent('task','Replaced daily task',task.id);
        }
      }
    };
    modal.querySelector('#retireDailyBtn').onclick=()=>{
      let templates=loadCustomTaskTemplates();
      templates=templates.filter(t=>t.id!==task.recurringTemplateId);
      saveCustomTaskTemplates(templates);
      list.splice(idx,1);
      all[today]=list;
      saveCustomTasks(all);
      modal.style.display='none';
      renderTasks();
      renderProgress();
      renderDailyActionEngine();
      recordAuditEvent('task','Retired daily task',task.id);
    };
    modal.querySelector('#cancelRetireBtn').onclick=()=>{
      modal.style.display='none';
    };
  }

  function startTask(id,options){
    const today=getToday(),state=loadState();
    if(isDateLocked(today))return;
    if(!state[today])state[today]={};
    const current=state[today][id];
    if(isTaskCompletedEntry(current))return;
    const nowIso=new Date().toISOString();
    const next=(current&&typeof current==='object')?{...current}:{status:'in_progress'};
    next.status='in_progress';
    if(!next.startedAt)next.startedAt=nowIso;
    const est=options&&Number.isFinite(options.estimatedMinutes)?options.estimatedMinutes:getTaskEstimatedMinutes(next);
    if(Number.isFinite(est)&&est>0)next.estimatedMinutes=Math.max(10,Math.min(240,Math.round(est)));
    if(!next.firstStartedAt)next.firstStartedAt=nowIso;
    state[today][id]=next;
    saveState(state);renderTasks();renderProgress();renderWeekView();renderDailyActionEngine();
    const label=typeof id==='number'?`Task ${id+1}`:`Task ${id}`;
    recordAuditEvent('task',`${label} marked in progress.`,today);
  }
  function completeTask(id){
    const today=getToday(),state=loadState();
    if(isDateLocked(today))return;
    if(!state[today])state[today]={};
    const current=state[today][id];
    if(isTaskCompletedEntry(current))return;
    const nowIso=new Date().toISOString();
    const startedAt=(current&&typeof current==='object'&&current.startedAt)?current.startedAt:nowIso;
    const estimated=getTaskEstimatedMinutes(current);
    const actual=Math.max(0,Math.round((new Date(nowIso)-new Date(startedAt))/60000));
    const overrunBy=(Number.isFinite(estimated)&&estimated>0)?Math.max(0,actual-estimated):0;
    state[today][id]={status:'completed',startedAt,completedAt:nowIso,estimatedMinutes:estimated||undefined,actualMinutes:actual,overrunByMinutes:overrunBy||undefined};
    saveState(state);renderTasks();renderProgress();renderWeekView();renderDailyActionEngine();
    const label=typeof id==='number'?`Task ${id+1}`:`Task ${id}`;
    recordAuditEvent('task',`${label} completed.`,today);
    const summary={
      taskId:String(id),
      taskLabel:getTaskLabelById(id),
      startedAt,
      completedAt:nowIso,
      estimatedMinutes:Number.isFinite(estimated)?estimated:null,
      actualMinutes:actual,
      overrunByMinutes:overrunBy
    };
    saveTaskCompletionSnapshot(summary);
    openTaskCompletionModal(summary);
  }
  function toggleTask(id){
    completeTask(id);
  }
  function renderTasks(){
    const ts=loadState()[getToday()]||{};
    const customWrap=document.getElementById('customTaskList');
    if(!customWrap)return;

    let custom=getTodayCustomTasks();
    const sortMode=getTaskSortMode();
    if(sortMode==='incomplete'){
      custom=custom
        .map((t,idx)=>({t,idx,done:isTaskCompletedEntry(ts[t.id])}))
        .sort((a,b)=>{
          if(a.done!==b.done)return a.done?1:-1;
          return a.idx-b.idx;
        })
        .map(x=>x.t);
    }

    customWrap.innerHTML='';
    if(!custom.length){
      customWrap.innerHTML='<div class="task-empty">Add your first task above.</div>';
      return;
    }
    let firstPendingId='';
    custom.forEach(task=>{
      const taskEntry=ts[task.id];
      const done=isTaskCompletedEntry(taskEntry);
      const inProgress=isTaskInProgressEntry(taskEntry);
      const est=getTaskEstimatedMinutes(taskEntry);
      const actual=done?(taskEntry?.actualMinutes??getTaskActualMinutes(taskEntry)):null;
      const elapsedInProgress=inProgress&&taskEntry?.startedAt?Math.max(0,Math.round((Date.now()-new Date(taskEntry.startedAt))/60000)):null;
      const overrun=done?((taskEntry?.overrunByMinutes||0)>0):(inProgress&&Number.isFinite(est)&&Number.isFinite(elapsedInProgress)&&elapsedInProgress>est);
      if(!done&&firstPendingId==='')firstPendingId=String(task.id);
      const row=document.createElement('div');
      row.className='task custom-task-item'+(done?' done':'')+(String(task.id)===firstPendingId?' task-next':'');
      row.setAttribute('data-id',task.id);
      const safeTitle=(task.text||'').replaceAll('<','&lt;').replaceAll('>','&gt;');
      // Check if this is a repeated (daily) task
      const isDaily=!!task.recurringTemplateId;
      const tagHtml = isDaily
        ? '<div class="task-tag tag-daily">Daily</div>'
        : '';
      const primaryButton=done
        ? '<button type="button" class="custom-task-select" disabled>Completed</button>'
        : (inProgress
          ? `<button type="button" class="custom-task-select" onclick="completeTask('${task.id}')">Complete</button>`
          : `<button type="button" class="custom-task-select" onclick="openEstimateModal('${task.id}')">Start Task</button>`);
      const metrics=[];
      if(Number.isFinite(est))metrics.push(`<span class="task-metric">Est ${formatMins(est)}</span>`);
      if(done&&Number.isFinite(actual))metrics.push(`<span class="task-metric">Actual ${formatMins(actual)}</span>`);
      if(inProgress&&Number.isFinite(elapsedInProgress))metrics.push(`<span class="task-metric">Elapsed ${formatMins(elapsedInProgress)}</span>`);
      if(inProgress&&Number.isFinite(est)&&Number.isFinite(elapsedInProgress)){
        const remaining=est-elapsedInProgress;
        if(remaining>=0)metrics.push(`<span class="task-metric remaining">Left ${formatMins(remaining)}</span>`);
        else metrics.push(`<span class="task-metric overrun">Over ${formatMins(Math.abs(remaining))}</span>`);
      }
      if(overrun)metrics.push('<span class="task-metric overrun">Overrun</span>');
      row.innerHTML=`
        <div class="custom-task-meta">
          <div class="checkbox">${done?'✓':''}</div>
          <div class="task-body">
            <div class="task-header"><div class="task-title">${safeTitle}</div>${tagHtml}</div>
            <div class="task-desc">${done?'Completed.':(inProgress?'In progress.':'Ready to start.')}</div>
            ${metrics.length?`<div class="task-metrics">${metrics.join('')}</div>`:''}
          </div>
        </div>
        ${primaryButton}
        <button type="button" class="custom-task-delete" onclick="deleteCustomTask('${task.id}')">Delete</button>
      `;
      customWrap.appendChild(row);
    });
  }
  function renderProgress(){
    const ts=loadState()[getToday()]||{};
    const custom=getTodayCustomTasks();
    const total=custom.length;
    const done=custom.filter(t=>isTaskCompletedEntry(ts[t.id])).length;
    const pct=total?Math.min(100,Math.round((done/total)*100)):0;
    document.getElementById('progressBar').style.width=pct+'%';
    document.getElementById('progressLabel').textContent=`${done} / ${total} done today`;
  }
  function resetDay(){
    const today=getToday();
    if(isDateLocked(today))return;
    const s=loadState();
    s[today]={};
    saveState(s);
    renderTasks();
    renderProgress();
    renderWeekView();
    renderDailyActionEngine();
    recordAuditEvent('task','Reset today\'s tasks.',today);
  }

  function loadNightPrep(){
    try{return JSON.parse(localStorage.getItem(NIGHT_PREP_KEY))||{};}catch{return{};}
  }
  function saveNightPrep(v){
    localStorage.setItem(NIGHT_PREP_KEY,JSON.stringify(v));
  }
  function openNightPrep(){
    const modal=document.getElementById('nightPrepModal');
    if(!modal)return;
    const tomorrow=getDateOffset(1);
    const prep=loadNightPrep()[tomorrow]||{};
    const frog=document.getElementById('npFrog');
    const time=document.getElementById('npStartTime');
    const duration=document.getElementById('npDuration');
    const step=document.getElementById('npFirstStep');
    if(frog)frog.value=prep.frog||'';
    if(time)time.value=prep.startTime||'08:00';
    if(duration)duration.value=String(prep.duration||25);
    if(step)step.value=prep.firstStep||'';
    modal.style.display='flex';
  }
  function closeNightPrep(){
    const modal=document.getElementById('nightPrepModal');
    if(modal)modal.style.display='none';
  }
  function saveNightPrepFromUi(){
    const frog=(document.getElementById('npFrog')?.value||'').trim();
    const startTime=(document.getElementById('npStartTime')?.value||'08:00').trim()||'08:00';
    const duration=Math.max(10,Math.min(120,parseInt(document.getElementById('npDuration')?.value||'25',10)||25));
    const firstStep=(document.getElementById('npFirstStep')?.value||'').trim();
    const tomorrow=getDateOffset(1);
    const all=loadNightPrep();
    all[tomorrow]={frog,startTime,duration,firstStep,createdAt:new Date().toISOString()};
    saveNightPrep(all);
    if(frog){
      const allCustom=loadCustomTasks();
      const list=allCustom[tomorrow]||[];
      const exists=list.some(t=>String(t.text||'').trim().toLowerCase()===frog.toLowerCase());
      if(!exists){
        list.push({
          id:`c${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,
          text:frog
        });
        allCustom[tomorrow]=list;
        saveCustomTasks(allCustom);
      }
    }
    recordAuditEvent('plan','Saved night prep for tomorrow.',getToday());
    closeNightPrep();
    scheduleNightPrepNotification();
    renderDailyActionEngine();
  }
  function getTodayMissionData(){
    const today=getToday();
    const tasks=loadState()[today]||{};
    const custom=getTodayCustomTasks();
    const doneCount=custom.filter(t=>isTaskCompletedEntry(tasks[t.id])).length;
    const remainingTasks=getPendingCustomTasks(tasks);
    const sessions=(function(){
      try{const s=JSON.parse(localStorage.getItem(POMO_KEY))||{};return s[today]||0;}catch{return 0;}
    })();
    const hasReflection=loadReflections().some(r=>r.date===today&&((r.studied||r.avoided||r.tomorrow||'').trim().length>0));
    const totalNeededBlocks=3;
    const completedBlocks=(doneCount>=1?1:0)+(sessions>=1?1:0)+(hasReflection?1:0);
    const remainingBlocks=Math.max(0,totalNeededBlocks-completedBlocks);
    return {doneCount,remainingTasks,sessions,hasReflection,remainingBlocks,completedBlocks};
  }
  function formatTimeLeftToday(){
    const now=new Date();
    const end=new Date(now);
    end.setHours(23,59,59,999);
    const diff=Math.max(0,end-now);
    const h=Math.floor(diff/3600000);
    const m=Math.floor((diff%3600000)/60000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  function buildMissionActions(){
    const md=getTodayMissionData();
    const actions=[];
    if(md.remainingTasks.length){
      actions.push({title:'Step 1',detail:`${md.remainingTasks[0].text}`});
    }else actions.push({title:'Step 1',detail:'All tasks are complete.'});
    if(md.sessions<1)actions.push({title:'Step 2',detail:'Run 1 focus sprint (25 min).'});
    else actions.push({title:'Step 2',detail:'Focus sprint complete.'});
    if(!md.hasReflection)actions.push({title:'Step 3',detail:'Write 3-line reflection before sleep.'});
    else actions.push({title:'Step 3',detail:'Reflection complete.'});
    return actions;
  }

  function getWeeklyCalibrationData(){
    const state=loadState();
    let estTotal=0,actualTotal=0,count=0;
    for(let i=0;i<7;i++){
      const ds=addDaysToDateStr(getToday(),-i);
      const day=state[ds]||{};
      Object.values(day).forEach(entry=>{
        if(!isTaskCompletedEntry(entry)||!entry||typeof entry!=='object')return;
        const est=getTaskEstimatedMinutes(entry);
        const actual=Number.isFinite(entry.actualMinutes)?entry.actualMinutes:getTaskActualMinutes(entry);
        if(!Number.isFinite(est)||!Number.isFinite(actual))return;
        estTotal+=est;
        actualTotal+=actual;
        count++;
      });
    }
    if(!count||estTotal<=0)return {hasData:false,accuracy:0,count:0,estTotal:0,actualTotal:0};
    const accuracy=Math.max(0,Math.round((1-Math.abs(actualTotal-estTotal)/estTotal)*100));
    return {hasData:true,accuracy,count,estTotal,actualTotal};
  }

  function pickSmartNextTask(stateToday){
    const pending=getPendingCustomTasks(stateToday);
    if(!pending.length)return null;
    const inProgressFirst=pending.find(t=>isTaskInProgressEntry(getTaskStateEntry(stateToday,t.id)));
    if(inProgressFirst){
      const est=getTaskEstimatedMinutes(getTaskStateEntry(stateToday,inProgressFirst.id))||45;
      return {task:inProgressFirst,est,idx:0,reason:'Continue in-progress task before switching.'};
    }
    const hour=new Date().getHours();
    const enriched=pending.map((t,idx)=>{
      const entry=getTaskStateEntry(stateToday,t.id);
      const est=getTaskEstimatedMinutes(entry)||45;
      return {task:t,est,idx};
    });
    if(hour<11){
      enriched.sort((a,b)=>b.est-a.est||a.idx-b.idx);
      return {...enriched[0],reason:'Hardest first (morning deep-work window).'};
    }
    enriched.sort((a,b)=>a.est-b.est||a.idx-b.idx);
    return {...enriched[0],reason:'Quick win next (keep momentum).'};
  }

  function getTaskHealthSignals(){
    const today=getToday();
    const state=loadState();
    const day=state[today]||{};
    const now=Date.now();
    const overrun=[];
    const stuck=[];
    let changed=false;
    Object.keys(day).forEach(id=>{
      const entry=day[id];
      if(!isTaskInProgressEntry(entry)||!entry.startedAt)return;
      const elapsed=Math.max(0,Math.round((now-new Date(entry.startedAt))/60000));
      const est=getTaskEstimatedMinutes(entry);
      if(Number.isFinite(est)&&est>0){
        const overrunAt=Math.round(Math.min(est*1.25,est+15));
        const snoozeUntilMs=entry.overrunSnoozeUntil?new Date(entry.overrunSnoozeUntil).getTime():0;
        const snoozed=Number.isFinite(snoozeUntilMs)&&snoozeUntilMs>now;
        if(elapsed>=overrunAt&&!snoozed){
          overrun.push({id,elapsed,est});
          if(!entry.overrunNotifiedAt){
            entry.overrunNotifiedAt=new Date().toISOString();
            changed=true;
          }
        }
      }
      if(elapsed>=STUCK_TASK_MINUTES)stuck.push({id,elapsed});
    });
    if(changed){
      state[today]=day;
      saveState(state);
    }
    return {overrun,stuck};
  }

  function renderMissionNoticeActions(actions){
    const wrap=document.getElementById('missionNoticeActions');
    if(!wrap)return;
    wrap.innerHTML='';
    if(!actions||!actions.length){
      wrap.style.display='none';
      return;
    }
    actions.forEach(action=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='engine-notice-btn'+(action.primary?' primary':'');
      btn.textContent=action.label;
      btn.addEventListener('click',action.onClick);
      wrap.appendChild(btn);
    });
    wrap.style.display='flex';
  }

  function snoozeOverrunTask(taskId,minutes){
    const today=getToday();
    const state=loadState();
    if(!state[today]||!state[today][taskId]||typeof state[today][taskId]!=='object')return;
    const until=new Date(Date.now()+Math.max(5,minutes||15)*60000).toISOString();
    state[today][taskId].overrunSnoozeUntil=until;
    saveState(state);
    setTaskAddStatus(`Reminder snoozed for ${Math.max(5,minutes||15)}m.`, 'ok');
    runTaskHealthCheck();
  }

  function extendTaskEstimate(taskId,minutes){
    const today=getToday();
    const state=loadState();
    if(!state[today]||!state[today][taskId]||typeof state[today][taskId]!=='object')return;
    const entry=state[today][taskId];
    const current=getTaskEstimatedMinutes(entry)||45;
    const next=Math.max(10,Math.min(360,current+Math.max(5,minutes||15)));
    entry.estimatedMinutes=next;
    entry.overrunSnoozeUntil=new Date(Date.now()+10*60000).toISOString();
    state[today][taskId]=entry;
    saveState(state);
    setTaskAddStatus(`Estimate updated to ${next}m.`, 'ok');
    renderTasks();
    renderDailyActionEngine();
  }

  function moveTaskToTomorrow(taskId){
    const today=getToday();
    const tomorrow=addDaysToDateStr(today,1);
    const all=loadCustomTasks();
    const todayList=[...(all[today]||[])];
    const idx=todayList.findIndex(t=>String(t.id)===String(taskId));
    if(idx<0)return;
    const source=todayList[idx];
    todayList.splice(idx,1);
    const tomorrowList=[...(all[tomorrow]||[])];
    const movedId=`c${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
    tomorrowList.push({id:movedId,text:`${source.text} (carry-over)`});
    all[today]=todayList;
    all[tomorrow]=tomorrowList;
    saveCustomTasks(all);

    const state=loadState();
    const todayState=state[today]||{};
    const entry=getTaskStateEntry(todayState,taskId);
    delete todayState[taskId];
    state[today]=todayState;
    if(!state[tomorrow])state[tomorrow]={};
    const est=getTaskEstimatedMinutes(entry);
    state[tomorrow][movedId]={status:'not_started',estimatedMinutes:est||undefined,rolledOverFrom:today};
    saveState(state);

    setTaskAddStatus(`Moved to ${tomorrow} as carry-over.`, 'warn');
    recordAuditEvent('task',`Moved task to tomorrow: ${source.text}`,today);
    renderTasks();
    renderProgress();
    renderDailyActionEngine();
  }

  function splitTaskFromHealth(taskId,minutes){
    const splitMinutes=Math.max(60,Math.round((minutes||90)/5)*5);
    if(splitCustomTask(taskId,splitMinutes)){
      runTaskHealthCheck();
    }
  }

  function runTaskHealthCheck(){
    const noticeEl=document.getElementById('missionNotice');
    const modeEl=document.getElementById('missionModeLabel');
    if(!noticeEl)return;
    const {overrun,stuck}=getTaskHealthSignals();
    if(overrun.length){
      const id=overrun[0].id;
      const t=getTaskLabelById(overrun[0].id);
      noticeEl.style.display='block';
      noticeEl.textContent=`Overrun: ${t} has crossed estimate (${overrun[0].elapsed}m vs ${overrun[0].est}m). Continue or split scope.`;
      renderMissionNoticeActions([
        {label:'Continue 15m',onClick:()=>snoozeOverrunTask(id,15)},
        {label:'+15m Estimate',onClick:()=>extendTaskEstimate(id,15),primary:true},
        {label:'Split Task',onClick:()=>splitTaskFromHealth(id,Math.max(overrun[0].est,overrun[0].elapsed))},
        {label:'Move Tomorrow',onClick:()=>moveTaskToTomorrow(id)}
      ]);
      return;
    }
    if(stuck.length){
      const id=stuck[0].id;
      const t=getTaskLabelById(stuck[0].id);
      noticeEl.style.display='block';
      noticeEl.textContent=`Stuck signal: ${t} has been in progress for ${stuck[0].elapsed}m. Do a 15m finish sprint or break it down.`;
      renderMissionNoticeActions([
        {label:'Continue 15m',onClick:()=>snoozeOverrunTask(id,15),primary:true},
        {label:'Split Task',onClick:()=>splitTaskFromHealth(id,stuck[0].elapsed)},
        {label:'Move Tomorrow',onClick:()=>moveTaskToTomorrow(id)}
      ]);
      return;
    }
    if(modeEl&&modeEl.textContent!=='minimum'){
      noticeEl.style.display='none';
      noticeEl.textContent='';
    }
    renderMissionNoticeActions([]);
  }

  function renderReflectionCoach(){
    const el=document.getElementById('reflectionCoachText');
    if(!el)return;
    const state=loadState();
    let overruns=0,lateStarts=0;
    for(let i=0;i<7;i++){
      const ds=addDaysToDateStr(getToday(),-i);
      const day=state[ds]||{};
      Object.values(day).forEach(entry=>{
        if(!entry||typeof entry!=='object')return;
        if(Number.isFinite(entry.overrunByMinutes)&&entry.overrunByMinutes>0)overruns++;
        if(entry.firstStartedAt&&new Date(entry.firstStartedAt).getHours()>=11)lateStarts++;
      });
    }
    if(overruns>=3){
      el.textContent='Coach: 3+ tasks overran this week. In reflection, write why estimates were low and one fix for tomorrow.';
      return;
    }
    if(lateStarts>=4){
      el.textContent='Coach: Most starts happened after 11 AM. In reflection, set a specific first-start time for tomorrow.';
      return;
    }
    const cal=getWeeklyCalibrationData();
    if(cal.hasData){
      el.textContent=`Coach: Weekly estimate accuracy is ${cal.accuracy}%. Note one thing you will improve next week.`;
      return;
    }
    el.textContent='Coach: Keep reflection concrete. Mention one delay trigger and one prevention step for tomorrow.';
  }

  function getNextAction(){
    const stateToday=loadState()[getToday()]||{};
    const customPending=pickSmartNextTask(stateToday);
    if(customPending){
      return {
        text:`${customPending.task.text} — ${customPending.reason}`,
        button:'Do This Task',
        type:'task',
        id:customPending.task.id
      };
    }
    const md=getTodayMissionData();
    if(md.sessions<1){
      return {
        text:'Run 1 focus sprint (25 min)',
        button:'Start Sprint',
        type:'sprint'
      };
    }
    if(!md.hasReflection){
      return {
        text:'Write 3-line reflection before sleep',
        button:'Open Reflection',
        type:'reflection'
      };
    }
    return {
      text:'All done. Set Night Prep for tomorrow',
      button:'Night Prep',
      type:'night-prep'
    };
  }

  function renderNextActionWidget(){
    const textEl=document.getElementById('nextActionText');
    const btnEl=document.getElementById('nextActionBtn');
    const lockToggle=document.getElementById('focusLockToggle');
    if(!textEl||!btnEl)return;
    const action=getNextAction();
    textEl.textContent=action.text;
    btnEl.textContent=action.button;
    btnEl.dataset.actionType=action.type;
    if(action.type==='task')btnEl.dataset.actionId=String(action.id);
    else btnEl.dataset.actionId='';

    // Set lock toggle state from localStorage
    if(lockToggle){
      lockToggle.checked=!!localStorage.getItem('focusLock');
      lockToggle.onchange=function(){
        if(this.checked){
          document.body.classList.add('focus-locked');
          localStorage.setItem('focusLock','1');
        }else{
          document.body.classList.remove('focus-locked');
          localStorage.removeItem('focusLock');
        }
      };
      if(lockToggle.checked){
        document.body.classList.add('focus-locked');
      }else{
        document.body.classList.remove('focus-locked');
      }
    }
  }

  function doNextAction(){
    const btnEl=document.getElementById('nextActionBtn');
    if(!btnEl)return;
    const type=btnEl.dataset.actionType;
    if(type==='must-do'){
      startMustDoSprint();
      return;
    }
    if(type==='task'){
      const id=btnEl.dataset.actionId;
      openEstimateModal(id);
      focusTaskById(/^[0-9]+$/.test(id)?Number(id):id);
      // Auto-unlock focus after completing
      if(document.body.classList.contains('focus-locked')){
        document.body.classList.remove('focus-locked');
        localStorage.removeItem('focusLock');
        const lockToggle=document.getElementById('focusLockToggle');
        if(lockToggle)lockToggle.checked=false;
      }
      return;
    }
    if(type==='sprint'){
      startMissionSprint();
      renderNextActionWidget();
      if(document.body.classList.contains('focus-locked')){
        document.body.classList.remove('focus-locked');
        localStorage.removeItem('focusLock');
        const lockToggle=document.getElementById('focusLockToggle');
        if(lockToggle)lockToggle.checked=false;
      }
      return;
    }
    if(type==='reflection'){
      const box=document.querySelector('.tile-reflection');
      const input=document.getElementById('ref1');
      if(box){
        box.scrollIntoView({behavior:'smooth',block:'start'});
      }
      if(input){
        input.focus();
      }
      if(document.body.classList.contains('focus-locked')){
        document.body.classList.remove('focus-locked');
        localStorage.removeItem('focusLock');
        const lockToggle=document.getElementById('focusLockToggle');
        if(lockToggle)lockToggle.checked=false;
      }
      return;
    }
    openNightPrep();
    if(document.body.classList.contains('focus-locked')){
      document.body.classList.remove('focus-locked');
      localStorage.removeItem('focusLock');
      const lockToggle=document.getElementById('focusLockToggle');
      if(lockToggle)lockToggle.checked=false;
    }
  }
  // On load, restore focus lock if set
  document.addEventListener('DOMContentLoaded',()=>{
    if(localStorage.getItem('focusLock')){
      document.body.classList.add('focus-locked');
      const lockToggle=document.getElementById('focusLockToggle');
      if(lockToggle)lockToggle.checked=true;
    }
  });
  function renderWeeklyExecutionReview(){
    const el=document.getElementById('missionWeeklyReview');
    if(!el)return;
    const state=loadState();
    const pomo=loadPomoDailyLog();
    const refs=loadReflections();
    const today=new Date();
    let fullDays=0,sprintDays=0,reflectionDays=0;
    for(let i=0;i<7;i++){
      const d=new Date(today);d.setDate(today.getDate()-i);
      const ds=d.toISOString().split('T')[0];
      const done=countCompletedTasks(state[ds]||{});
      if(done>=3)fullDays++;
      if((pomo[ds]&&pomo[ds].sessions)||0>=1)sprintDays++;
      if(refs.some(r=>r.date===ds&&((r.studied||r.avoided||r.tomorrow||'').trim().length>0))){reflectionDays++;}
    }
    let weekTasks=0,weekSprints=0;
    for(let i=0;i<7;i++){
      const d=new Date(today);d.setDate(today.getDate()-i);
      const ds=d.toISOString().split('T')[0];
      weekTasks+=countCompletedTasks(state[ds]||{});
      weekSprints+=((pomo[ds]&&pomo[ds].sessions)||0);
    }
    const cal=getWeeklyCalibrationData();
    const calText=cal.hasData?` | Estimate accuracy: ${cal.accuracy}% (${cal.actualTotal}m vs ${cal.estTotal}m)`:' | Estimate accuracy: add estimates to unlock';
    el.textContent=`7-day review: Days >=3 tasks: ${fullDays}/7 | Sprint days: ${sprintDays}/7 | Reflection days: ${reflectionDays}/7 | Target: ${weekTasks}/20 tasks, ${weekSprints}/10 sprints${calText}`;
  }

  function getDailyEngineData(){
    const md=getTodayMissionData();
    const focusPlan=getTodayFocusPlan();
    const todayPomo=loadPomoDailyLog()[getToday()]||{focusMinutes:0,sessions:0};
    let progressPct=Math.round((md.completedBlocks/3)*100);
    let mode=md.remainingBlocks>1?'minimum-mode':'normal';
    let directive=md.remainingBlocks>1
      ?'Must-do minimum is active: complete one task, one sprint, one reflection.'
      :'Follow the next steps and close the day cleanly.';
    if(focusPlan&&Number.isFinite(focusPlan.estimatedMinutes)&&focusPlan.estimatedMinutes>0){
      const spent=todayPomo.focusMinutes||0;
      progressPct=Math.max(progressPct,Math.min(100,Math.round((spent/focusPlan.estimatedMinutes)*100)));
      mode='focus-plan';
      directive=`Current focus: ${focusPlan.taskLabel||'Selected task'} | Estimate: ${focusPlan.estimatedMinutes}m | Done: ${spent}m`;
    }
    return {
      progressPct,
      mode,
      actions:buildMissionActions(),
      directive,
      timeLeft:formatTimeLeftToday(),
      remainingBlocks:md.remainingBlocks
    };
  }

  function renderDailyActionEngine(){
    const scoreEl=document.getElementById('missionTimeLeft');
    const labelEl=document.getElementById('missionModeLabel');
    const barEl=document.getElementById('missionProgressBar');
    const listEl=document.getElementById('dailyActionList');
    const directiveEl=document.getElementById('dailyDirective');
    const noticeEl=document.getElementById('missionNotice');
    if(!scoreEl||!labelEl||!barEl||!listEl||!directiveEl||!noticeEl)return;
    const data=getDailyEngineData();
    scoreEl.textContent=data.timeLeft;
    barEl.style.width=`${data.progressPct}%`;
    labelEl.textContent=data.mode==='minimum-mode'?'minimum':(data.mode==='focus-plan'?'focused':'normal');
    labelEl.style.color=data.mode==='minimum-mode'?'#f0e040':(data.mode==='focus-plan'?'#79b7ff':'#8ad79d');
    labelEl.style.borderColor=data.mode==='minimum-mode'?'#5f561f':(data.mode==='focus-plan'?'#274a6a':'#1f4f2c');
    directiveEl.textContent=data.directive;
    if(data.mode==='minimum-mode'){
      noticeEl.style.display='block';
      noticeEl.textContent='Do only the must-do minimum now. Keep momentum, no overthinking.';
    }else{
      noticeEl.style.display='none';
      noticeEl.textContent='';
    }
    if(!data.actions.length){
      listEl.innerHTML='<div class="engine-action"><span class="engine-dot"></span><span><b>On track:</b> keep consistency and close with reflection tonight.</span></div>';
      renderWeeklyExecutionReview();
      renderNextActionWidget();
      runTaskHealthCheck();
      return;
    }
    listEl.innerHTML='';
    data.actions.forEach(a=>{
      const item=document.createElement('div');
      item.className='engine-action';
      item.innerHTML=`<span class="engine-dot"></span><span><b>${a.title}:</b> ${a.detail}</span>`;
      listEl.appendChild(item);
    });
    renderWeeklyExecutionReview();
    renderNextActionWidget();
    runTaskHealthCheck();
  }

  function focusTaskById(taskId){
    document.querySelectorAll('.task').forEach(el=>el.classList.remove('priority-pulse'));
    const target=document.querySelector(`.task[data-id="${taskId}"]`)||document.querySelector(`.custom-task-item[data-id="${taskId}"]`);
    if(!target)return;
    target.classList.add('priority-pulse');
    target.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>target.classList.remove('priority-pulse'),3500);
  }

  function focusHighestPriorityTask(){
    const todayState=loadState()[getToday()]||{};
    const customPending=getPendingCustomTasks(todayState)[0];
    if(customPending){
      focusTaskById(customPending.id);
      return;
    }
    const pending=TASK_LABELS.map((_,idx)=>idx).find(idx=>!todayState[idx]);
    document.querySelectorAll('.task').forEach(el=>el.classList.remove('priority-pulse'));
    if(pending===undefined)return;
    focusTaskById(pending);
  }

  function startMissionSprint(){
    setPomoMode('focus');
    if(pomoState!==POMO_STATES.RUNNING)togglePomo();
    focusHighestPriorityTask();
    recordAuditEvent('plan','Started mission sprint from ladder.');
    renderDailyActionEngine();
  }

  function sendAppNotification(title,body,tag){
    if(!('Notification' in window)||Notification.permission!=='granted'||!swReg)return;
    try{swReg.showNotification(title,{body,tag:tag||'daily-mission'});}catch(_){ }
  }
  function scheduleNightPrepNotification(){
    const today=getToday();
    const prepToday=loadNightPrep()[today];
    if(!prepToday||!prepToday.startTime)return;
    const [hh,mm]=prepToday.startTime.split(':').map(n=>parseInt(n,10));
    if(!Number.isFinite(hh)||!Number.isFinite(mm))return;
    const now=new Date();
    const target=new Date(now);
    target.setHours(hh,mm,0,0);
    if(target<=now)return;
    const ms=target-now;
    setTimeout(()=>{
      const step=prepToday.firstStep?`First step: ${prepToday.firstStep}`:'Start your first block now.';
      sendAppNotification('Mission start now',`${prepToday.frog||'Start your top task'} (${prepToday.duration||25}m). ${step}`,'night-prep-start');
    },ms);
  }
  function runAntiDriftCheck(){
    const hour=new Date().getHours();
    const md=getTodayMissionData();
    if(hour<11||md.doneCount>0||md.sessions>0)return;
    const key=`${getToday()}-${hour}`;
    if(localStorage.getItem(LAST_DRIFT_ALERT_KEY)===key)return;
    localStorage.setItem(LAST_DRIFT_ALERT_KEY,key);
    const topPending=getPendingCustomTasks(loadState()[getToday()]||{})[0]?.text||'your top task';
    sendAppNotification('Anti-drift: 10-minute start',`Start now: ${topPending}. Just begin for 10 minutes.`,'anti-drift');
    const noticeEl=document.getElementById('missionNotice');
    if(noticeEl){
      noticeEl.style.display='block';
      noticeEl.textContent='Anti-drift trigger: start 10 minutes on your first task now.';
    }
  }
  function scheduleAntiDriftWatcher(){
    runAntiDriftCheck();
    setInterval(runAntiDriftCheck,15*60*1000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')runAntiDriftCheck();});
    window.addEventListener('focus',runAntiDriftCheck);
  }
  function scheduleTaskHealthWatcher(){
    runTaskHealthCheck();
    setInterval(()=>{
      runTaskHealthCheck();
      renderTasks();
    },60*1000);
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'){
        runTaskHealthCheck();
        renderTasks();
      }
    });
    window.addEventListener('focus',()=>{
      runTaskHealthCheck();
      renderTasks();
    });
  }

  function initTaskAccessibility(){
    for(let i=0;i<5;i++){
      const task=document.querySelector(`.task[data-id="${i}"]`);
      if(!task)continue;
      task.setAttribute('tabindex','0');
      task.setAttribute('role','button');
      task.addEventListener('keydown',e=>{
        if(e.key==='Enter'||e.key===' '){
          e.preventDefault();
          toggleTask(i);
        }
      });
    }
  }

  // WEEK VIEW
  // TODO(next): refine the week proof UX into an even simpler one-step flow
  // (cleaner prompt hierarchy, fewer modal transitions, faster capture path).
  function loadWeekPhotos(){
    return weekPhotosCache;
  }
  function saveWeekPhotos(v){
    weekPhotosCache=v;
    localStorage.setItem(WEEK_PHOTO_KEY,JSON.stringify(v));
    dbSetValue(WEEK_PHOTO_KEY,v).catch(()=>{});
  }
  function closeStreakPhotoViewer(){
    const modal=document.getElementById('streakPhotoViewerModal');
    if(modal)modal.style.display='none';
    streakPhotoDates=[];
    streakPhotoIndex=-1;
  }
  function renderStreakPhotoViewer(){
    const modal=document.getElementById('streakPhotoViewerModal');
    const img=document.getElementById('streakPhotoViewerImg');
    const meta=document.getElementById('streakPhotoMeta');
    const prevBtn=document.getElementById('streakPhotoPrevBtn');
    const nextBtn=document.getElementById('streakPhotoNextBtn');
    const retakeBtn=document.getElementById('streakPhotoRetakeBtn');
    const deleteBtn=document.getElementById('streakPhotoDeleteBtn');
    const date=streakPhotoDates[streakPhotoIndex];
    const photos=loadWeekPhotos();
    if(!modal||!img||!date||!photos[date]){
      closeStreakPhotoViewer();
      return;
    }
    modal.style.display='flex';
    img.src=photos[date];
    const pretty=new Date(date+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}).toUpperCase();
    if(meta)meta.textContent=pretty;
    if(prevBtn)prevBtn.disabled=streakPhotoIndex<=0;
    if(nextBtn)nextBtn.disabled=streakPhotoIndex>=streakPhotoDates.length-1;
    const locked=isPastDate(date);
    if(retakeBtn)retakeBtn.disabled=locked;
    if(deleteBtn)deleteBtn.disabled=locked;
  }
  function openStreakPhotoViewer(date){
    const photos=loadWeekPhotos();
    streakPhotoDates=Object.keys(photos).filter(k=>photos[k]).sort();
    if(!streakPhotoDates.length)return;
    streakPhotoIndex=streakPhotoDates.indexOf(date);
    if(streakPhotoIndex<0)streakPhotoIndex=streakPhotoDates.length-1;
    renderStreakPhotoViewer();
  }
  function stepStreakPhotoViewer(step){
    if(!streakPhotoDates.length)return;
    const next=streakPhotoIndex+step;
    if(next<0||next>=streakPhotoDates.length)return;
    streakPhotoIndex=next;
    renderStreakPhotoViewer();
  }
  function getCurrentStreakPhotoDate(){
    return streakPhotoDates[streakPhotoIndex]||null;
  }
  function deleteCurrentStreakPhoto(){
    const date=getCurrentStreakPhotoDate();
    if(!date)return;
    if(!removeWeekPhoto(date)){
      alert('Photo edits are locked after the day has passed.');
      return;
    }
    renderStreak();
    renderWeekView();
    const photos=loadWeekPhotos();
    streakPhotoDates=Object.keys(photos).filter(k=>photos[k]).sort();
    if(!streakPhotoDates.length){
      closeStreakPhotoViewer();
      return;
    }
    if(streakPhotoIndex>=streakPhotoDates.length)streakPhotoIndex=streakPhotoDates.length-1;
    renderStreakPhotoViewer();
  }
  function retakeCurrentStreakPhoto(){
    const date=getCurrentStreakPhotoDate();
    if(!date)return;
    if(isDateLocked(date)){
      alert('Photo edits are locked after the day has passed.');
      return;
    }
    reopenStreakViewerDate=date;
    closeStreakPhotoViewer();
    openWeekPhotoCamera(date);
  }

  // BACKUP / RESTORE
  function buildBackupData(){
    return {
      app:'daily-mission',
      version:1,
      exportedAt:new Date().toISOString(),
      data:{
        [TASKS_KEY]:localStorage.getItem(TASKS_KEY),
        [STREAK_KEY]:localStorage.getItem(STREAK_KEY),
        [LAST_DATE_KEY]:localStorage.getItem(LAST_DATE_KEY),
        [STREAK_LOG_KEY]:localStorage.getItem(STREAK_LOG_KEY),
        [SNOOZE_KEY]:localStorage.getItem(SNOOZE_KEY),
        [SUBJ_KEY]:localStorage.getItem(SUBJ_KEY),
        [REFLECT_KEY]:localStorage.getItem(REFLECT_KEY),
        [POMO_KEY]:localStorage.getItem(POMO_KEY),
        [POMO_LOG_KEY]:localStorage.getItem(POMO_LOG_KEY),
        [WEEK_PHOTO_KEY]:JSON.stringify(weekPhotosCache||{}),
        [DAILY_SNAPSHOT_KEY]:localStorage.getItem(DAILY_SNAPSHOT_KEY)
      }
    };
  }
  function markBackupExported(){
    const now=String(Date.now());
    localStorage.setItem(LAST_BACKUP_EXPORT_KEY,now);
    localStorage.setItem(BACKUP_REMINDER_DISMISS_KEY,now);
    hideBackupReminder();
    updateBackupAgeText();
  }
  function exportBackup(fromReminder){
    try{
      const blob=new Blob([JSON.stringify(buildBackupData())],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      const day=getToday();
      a.href=url;
      a.download=`daily-mission-backup-${day}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      markBackupExported();
      if(!fromReminder)alert('Backup exported successfully. Keep this file safe.');
    }catch(_){
      alert('Backup export failed.');
    }
  }
  function hideBackupReminder(){
    const box=document.getElementById('backupReminder');
    if(box)box.style.display='none';
  }
  function showBackupReminder(){
    const box=document.getElementById('backupReminder');
    if(box)box.style.display='block';
  }
  function dismissBackupReminder(){
    localStorage.setItem(BACKUP_REMINDER_DISMISS_KEY,String(Date.now()));
    hideBackupReminder();
  }
  function maybeShowBackupReminder(){
    const now=Date.now();
    const lastExport=parseInt(localStorage.getItem(LAST_BACKUP_EXPORT_KEY)||'0',10)||0;
    const lastDismiss=parseInt(localStorage.getItem(BACKUP_REMINDER_DISMISS_KEY)||'0',10)||0;
    const reminderMs=getBackupReminderDays()*24*60*60*1000;
    if(now-lastExport>=reminderMs&&now-lastDismiss>=reminderMs)showBackupReminder();
    else hideBackupReminder();
    updateBackupAgeText();
  }
  function triggerImportBackup(){
    const input=document.getElementById('backupFileInput');
    if(!input)return;
    input.value='';
    input.click();
  }
  function handleImportBackup(e){
    const file=e.target.files&&e.target.files[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=async()=>{
      try{
        const parsed=JSON.parse(String(reader.result||'{}'));
        if(parsed.app!=='daily-mission'||!parsed.data)throw new Error('Invalid backup format');
        const keys=[TASKS_KEY,STREAK_KEY,LAST_DATE_KEY,STREAK_LOG_KEY,SNOOZE_KEY,SUBJ_KEY,REFLECT_KEY,POMO_KEY,POMO_LOG_KEY,WEEK_PHOTO_KEY,DAILY_SNAPSHOT_KEY];
        keys.forEach(k=>{
          const v=parsed.data[k];
          if(v===null||v===undefined)localStorage.removeItem(k);
          else localStorage.setItem(k,String(v));
        });
        try{
          weekPhotosCache=JSON.parse(localStorage.getItem(WEEK_PHOTO_KEY)||'{}')||{};
        }catch{weekPhotosCache={};}
        await dbSetValue(WEEK_PHOTO_KEY,weekPhotosCache);
        markBackupExported();
        alert('Backup imported. Dashboard will refresh now.');
        window.location.reload();
      }catch(_){
        alert('Import failed. Please select a valid backup JSON file.');
      }
    };
    reader.readAsText(file);
  }
  function removeWeekPhoto(date){
    if(isDateLocked(date))return false;
    const photos=loadWeekPhotos();
    if(photos[date]){
      delete photos[date];
      saveWeekPhotos(photos);
      updateStorageStatus();
      recordAuditEvent('photo','Removed proof photo.',date);
      return true;
    }
    return false;
  }
  function openWeekChoiceModal(date){
    pendingWeekChoiceDate=date;
    const modal=document.getElementById('weekPhotoChoiceModal');
    if(modal)modal.style.display='flex';
  }
  function closeWeekChoiceModal(){
    const modal=document.getElementById('weekPhotoChoiceModal');
    if(modal)modal.style.display='none';
    pendingWeekChoiceDate=null;
  }
  async function openWeekPhotoCamera(date){
    if(isDateLocked(date)){
      alert('Photo edits are locked after the day has passed.');
      return;
    }
    pendingWeekPhotoDate=date;
    const modal=document.getElementById('weekPhotoModal');
    const video=document.getElementById('weekPhotoVideo');
    const preview=document.getElementById('weekPhotoPreview');
    const capBtn=document.getElementById('weekPhotoCaptureBtn');
    const saveBtn=document.getElementById('weekPhotoSaveBtn');
    const retakeBtn=document.getElementById('weekPhotoRetakeBtn');
    if(!modal||!video)return;
    weekPhotoCapturedDataUrl=null;
    if(preview){preview.style.display='none';preview.src='';}
    if(video)video.style.display='block';
    if(capBtn)capBtn.style.display='block';
    if(saveBtn)saveBtn.style.display='none';
    if(retakeBtn)retakeBtn.style.display='none';
    try{
      weekPhotoStream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:'user'},
        audio:false
      });
      video.srcObject=weekPhotoStream;
      modal.style.display='flex';
    }catch(_){
      pendingWeekPhotoDate=null;
      alert('Camera access failed. Please allow camera permission and try again.');
    }
  }
  function closeWeekPhotoCamera(){
    const modal=document.getElementById('weekPhotoModal');
    const video=document.getElementById('weekPhotoVideo');
    const preview=document.getElementById('weekPhotoPreview');
    if(modal)modal.style.display='none';
    if(video)video.srcObject=null;
    if(preview){preview.style.display='none';preview.src='';}
    weekPhotoCapturedDataUrl=null;
    if(weekPhotoStream){
      weekPhotoStream.getTracks().forEach(t=>t.stop());
      weekPhotoStream=null;
    }
  }
  function drawTimestampWatermark(ctx,w,h){
    const stamp=new Date().toLocaleString();
    const pad=8;
    ctx.font='12px "DM Mono", monospace';
    const tw=ctx.measureText(stamp).width+pad*2;
    const th=20;
    const x=w-tw-8;
    const y=h-th-8;
    ctx.fillStyle='rgba(0,0,0,0.55)';
    ctx.fillRect(x,y,tw,th);
    ctx.fillStyle='#ffffff';
    ctx.fillText(stamp,x+pad,y+14);
  }
  function captureWeekPhoto(){
    if(!pendingWeekPhotoDate)return;
    const video=document.getElementById('weekPhotoVideo');
    const preview=document.getElementById('weekPhotoPreview');
    const capBtn=document.getElementById('weekPhotoCaptureBtn');
    const saveBtn=document.getElementById('weekPhotoSaveBtn');
    const retakeBtn=document.getElementById('weekPhotoRetakeBtn');
    const watermarkToggle=document.getElementById('weekPhotoWatermark');
    if(!video||!video.videoWidth||!video.videoHeight)return;
    const maxSide=960;
    const scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(video.videoWidth*scale);
    canvas.height=Math.round(video.videoHeight*scale);
    const ctx=canvas.getContext('2d');
    if(!ctx)return;
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    if(watermarkToggle&&watermarkToggle.checked)drawTimestampWatermark(ctx,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL('image/jpeg',0.72);
    weekPhotoCapturedDataUrl=dataUrl;
    if(preview){
      preview.src=dataUrl;
      preview.style.display='block';
    }
    video.style.display='none';
    if(capBtn)capBtn.style.display='none';
    if(saveBtn)saveBtn.style.display='block';
    if(retakeBtn)retakeBtn.style.display='block';
  }
  function retakeWeekPhoto(){
    const video=document.getElementById('weekPhotoVideo');
    const preview=document.getElementById('weekPhotoPreview');
    const capBtn=document.getElementById('weekPhotoCaptureBtn');
    const saveBtn=document.getElementById('weekPhotoSaveBtn');
    const retakeBtn=document.getElementById('weekPhotoRetakeBtn');
    weekPhotoCapturedDataUrl=null;
    if(preview){preview.style.display='none';preview.src='';}
    if(video)video.style.display='block';
    if(capBtn)capBtn.style.display='block';
    if(saveBtn)saveBtn.style.display='none';
    if(retakeBtn)retakeBtn.style.display='none';
  }
  function saveWeekPhotoCapture(){
    if(!pendingWeekPhotoDate||!weekPhotoCapturedDataUrl)return;
    if(isDateLocked(pendingWeekPhotoDate)){
      alert('Photo edits are locked after the day has passed.');
      pendingWeekPhotoDate=null;
      closeWeekPhotoCamera();
      return;
    }
    const photos=loadWeekPhotos();
    photos[pendingWeekPhotoDate]=weekPhotoCapturedDataUrl;
    const savedDate=pendingWeekPhotoDate;
    saveWeekPhotos(photos);
    recordAuditEvent('photo','Saved proof photo.',savedDate);
    pendingWeekPhotoDate=null;
    closeWeekPhotoCamera();
    if(reopenStreakViewerDate===savedDate){
      reopenStreakViewerDate=null;
      openStreakPhotoViewer(savedDate);
    }
    renderWeekView();
    renderStreak();
    updateStorageStatus();
    renderWeeklyReportCard();
  }
  function initWeekPhotoKeyboardShortcuts(){
    document.addEventListener('keydown',e=>{
      const choiceModal=document.getElementById('weekPhotoChoiceModal');
      const cameraModal=document.getElementById('weekPhotoModal');
      const choiceOpen=choiceModal&&choiceModal.style.display==='flex';
      const cameraOpen=cameraModal&&cameraModal.style.display==='flex';
      if(!choiceOpen&&!cameraOpen)return;

      // Esc: keep tick (close choice), or close camera without saving.
      if(e.key==='Escape'){
        e.preventDefault();
        if(cameraOpen){
          pendingWeekPhotoDate=null;
          closeWeekPhotoCamera();
          return;
        }
        closeWeekChoiceModal();
        return;
      }

      // Enter/Space: capture flow.
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        if(choiceOpen){
          const date=pendingWeekChoiceDate;
          closeWeekChoiceModal();
          if(date)openWeekPhotoCamera(date);
          return;
        }
        if(cameraOpen){
          if(weekPhotoCapturedDataUrl)saveWeekPhotoCapture();
          else captureWeekPhoto();
        }
      }
    });
  }

  function renderWeekView(){
    const grid=document.getElementById('weekGrid');grid.innerHTML='';
    const state=loadState(),log=getStreakLog(),today=getToday();
    const photos=loadWeekPhotos();
    const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const now=new Date();
    const startOfWeek=new Date(now);
    startOfWeek.setDate(now.getDate()-((now.getDay()+6)%7)); // Monday
    let completedFull=0;
    for(let i=0;i<7;i++){
      const d=new Date(startOfWeek);d.setDate(startOfWeek.getDate()+i);
      const ds=d.toISOString().split('T')[0];
      const isFuture=ds>today,isToday=ds===today;
      const tasks=state[ds]||{};
      const done=countCompletedTasks(tasks);
      const totalForDay=getCustomTasksForDate(ds).length;
      const isFull=totalForDay>0&&done>=totalForDay;
      const col=document.createElement('div');col.className='week-day';
      const lbl=document.createElement('div');lbl.className='week-day-label';lbl.textContent=dayNames[d.getDay()];
      const dot=document.createElement('div');dot.className='week-day-dot';
      if(isToday)dot.classList.add('today-ring');
      if(isFuture){dot.classList.add('future');dot.textContent=d.getDate();}
      else if(log.includes(ds)||isFull){
        if(photos[ds]){
          dot.classList.add('full-photo');
          dot.style.backgroundImage='none';
          dot.textContent='';
          const img=document.createElement('img');
          img.className='week-day-thumb';
          img.src=photos[ds];
          img.alt=`Proof for ${ds}`;
          dot.appendChild(img);
          dot.style.cursor='pointer';
          dot.title='Open proof photo';
          attachWeekPhotoInlineZoom(dot);
          attachPhotoHoverPreview(dot,ds,photos[ds]);
          dot.addEventListener('click',()=>openStreakPhotoViewer(ds));
        }else{
          dot.classList.add('full');
          dot.textContent='✓';
        }
        completedFull++;
      }
      else if(done>0){
        const totalForDay=Math.max(1,getCustomTasksForDate(ds).length);
        dot.classList.add('partial');
        dot.innerHTML=`<span style="font-size:13px">${done}</span><span style="font-size:7px;color:#c1c1c1">/${totalForDay}</span>`;
      }
      else{dot.classList.add('empty');dot.textContent=d.getDate();}
      col.appendChild(lbl);col.appendChild(dot);grid.appendChild(col);
    }
    const s=document.getElementById('weekSummary');
    if(completedFull===0)s.innerHTML='No full days yet this week. Start today.';
    else if(completedFull>=6)s.innerHTML=`<b>${completedFull}/7</b> days — exceptional week 🔥`;
    else s.innerHTML=`<b>${completedFull}/7</b> days completed this week`;
    renderStreakAnalytics();
    renderWeeklyReportCard();
    renderDailyActionEngine();
  }

  // POMODORO
  const POMO_DURATIONS={focus:25*60,short:5*60,long:15*60};
  const POMO_STATES=Object.freeze({
    IDLE:'idle',
    RUNNING:'running',
    PAUSED:'paused',
    COMPLETED:'completed'
  });
  let pomoMode='focus',pomoRunning=false,pomoInterval=null;
  let pomoState=POMO_STATES.IDLE;
  let pomoRemaining=POMO_DURATIONS.focus,pomoTotal=POMO_DURATIONS.focus;
  const CIRC=2*Math.PI*68;

  function persistPomoRuntime(){
    const payload={
      mode:pomoMode,
      state:pomoState,
      remaining:pomoRemaining,
      total:pomoTotal,
      updatedAt:Date.now()
    };
    localStorage.setItem(POMO_RUNTIME_KEY,JSON.stringify(payload));
  }

  function restorePomoRuntime(){
    let saved=null;
    try{saved=JSON.parse(localStorage.getItem(POMO_RUNTIME_KEY)||'null');}catch{saved=null;}
    if(!saved||!POMO_DURATIONS[saved.mode])return;

    pomoMode=saved.mode;
    pomoTotal=POMO_DURATIONS[pomoMode];
    const rawRemaining=Number(saved.remaining);
    let remaining=Number.isFinite(rawRemaining)?rawRemaining:pomoTotal;
    remaining=Math.max(0,Math.min(pomoTotal,Math.round(remaining)));
    const updatedAt=Number(saved.updatedAt)||Date.now();

    if(saved.state===POMO_STATES.RUNNING){
      const elapsed=Math.max(0,Math.floor((Date.now()-updatedAt)/1000));
      remaining=Math.max(0,remaining-elapsed);
      if(remaining<=0){
        pomoRemaining=1;
        pomoTotal=POMO_DURATIONS[pomoMode];
        transitionPomoState(POMO_STATES.RUNNING,{force:true});
        handlePomoComplete({silent:true});
        return;
      }
      pomoRemaining=remaining;
      transitionPomoState(POMO_STATES.RUNNING,{force:true});
      return;
    }

    pomoRemaining=remaining;
    if(saved.state===POMO_STATES.PAUSED)transitionPomoState(POMO_STATES.PAUSED,{force:true});
    else if(saved.state===POMO_STATES.COMPLETED)transitionPomoState(POMO_STATES.COMPLETED,{force:true});
    else transitionPomoState(POMO_STATES.IDLE,{force:true});
  }

  function transitionPomoState(next,opts){
    const force=Boolean(opts&&opts.force);
    const allowed={
      [POMO_STATES.IDLE]:[POMO_STATES.RUNNING],
      [POMO_STATES.RUNNING]:[POMO_STATES.PAUSED,POMO_STATES.COMPLETED],
      [POMO_STATES.PAUSED]:[POMO_STATES.RUNNING,POMO_STATES.IDLE],
      [POMO_STATES.COMPLETED]:[POMO_STATES.IDLE,POMO_STATES.RUNNING]
    };
    if(next===pomoState)return true;
    if(!force&&!(allowed[pomoState]||[]).includes(next))return false;
    if(next===POMO_STATES.RUNNING){
      clearInterval(pomoInterval);
      pomoInterval=setInterval(pomoTick,1000);
      pomoRunning=true;
    }else{
      clearInterval(pomoInterval);
      pomoInterval=null;
      pomoRunning=false;
    }
    pomoState=next;
    persistPomoRuntime();
    return true;
  }

  function runStartupIntegrityChecks(){
    if(!POMO_DURATIONS[pomoMode])pomoMode='focus';
    pomoTotal=POMO_DURATIONS[pomoMode];
    if(!Number.isFinite(pomoRemaining))pomoRemaining=pomoTotal;
    pomoRemaining=Math.max(0,Math.min(pomoTotal,Math.round(pomoRemaining)));

    if(pomoState===POMO_STATES.RUNNING&&(!pomoInterval||!pomoRunning)){
      transitionPomoState(POMO_STATES.PAUSED,{force:true});
    }

    const weekChoiceModal=document.getElementById('weekPhotoChoiceModal');
    if(weekChoiceModal&&weekChoiceModal.style.display==='flex'&&!pendingWeekChoiceDate)closeWeekChoiceModal();

    const weekModal=document.getElementById('weekPhotoModal');
    if(weekModal&&weekModal.style.display==='flex'&&!pendingWeekPhotoDate)closeWeekPhotoCamera();

    const viewer=document.getElementById('streakPhotoViewerModal');
    if(viewer&&viewer.style.display==='flex'){
      const date=getCurrentStreakPhotoDate();
      const photos=loadWeekPhotos();
      if(!date||!photos[date])closeStreakPhotoViewer();
    }
  }

  function setPomoMode(mode){
    if(pomoState===POMO_STATES.RUNNING)return;
    if(pomoState!==POMO_STATES.IDLE)transitionPomoState(POMO_STATES.IDLE);
    pomoMode=mode;pomoRemaining=pomoTotal=POMO_DURATIONS[mode];
    ['focus','short','long'].forEach(m=>{
      const mainBtn=document.getElementById('btn-'+m);
      if(mainBtn)mainBtn.className='pomo-mode-btn'+(m===mode?(mode==='focus'?' active':' break-active'):'');
      const floatBtn=document.getElementById('pf-btn-'+m);
      if(floatBtn)floatBtn.className='pf-mode-btn'+(m===mode?(mode==='focus'?' active':' break-active'):'');
    });
    const mainRing=document.getElementById('pomoRing');
    if(mainRing)mainRing.classList.toggle('break-color',mode!=='focus');
    persistPomoRuntime();
    updatePomoDisplay();
    recordAuditEvent('pomodoro',`Set pomodoro mode to ${mode}.`);
  }
  const PF_CIRC=2*Math.PI*23;
  function updatePomoDisplay(){
    const m=Math.floor(pomoRemaining/60),s=pomoRemaining%60;
    const timeStr=String(m).padStart(2,'0')+(s<10?'0'+s:' '+s);
    const modeLabel={focus:'FOCUS',short:'SHORT BREAK',long:'LONG BREAK'}[pomoMode];
    // main (if full card exists)
    const mainTime=document.getElementById('pomoTime');
    const mainLabel=document.getElementById('pomoModeLabel');
    const mainRing=document.getElementById('pomoRing');
    if(mainTime)mainTime.textContent=timeStr;
    if(mainLabel)mainLabel.textContent=modeLabel;
    const pct=pomoRemaining/pomoTotal;
    if(mainRing)mainRing.style.strokeDashoffset=CIRC-(CIRC*pct);
    if(mainRing)mainRing.classList.toggle('is-running',pomoRunning);
    // float
    document.getElementById('pfTime').textContent=timeStr;
    document.getElementById('pfLabel').textContent=modeLabel;
    const pfRing=document.getElementById('pfRing');
    pfRing.style.strokeDashoffset=PF_CIRC-(PF_CIRC*pct);
    pfRing.classList.toggle('break-color',pomoMode!=='focus');
    pfRing.classList.toggle('is-running',pomoRunning);
    const fl=document.getElementById('pomoFloat');
    const isRunning=pomoState===POMO_STATES.RUNNING;
    fl.classList.toggle('running',isRunning&&pomoMode==='focus');
    fl.classList.toggle('break-running',isRunning&&pomoMode!=='focus');
    const pfBtn=document.getElementById('pfStartBtn');
    if(pfBtn){
      const isPaused=pomoState===POMO_STATES.PAUSED;
      pfBtn.textContent=isRunning?'PAUSE':(isPaused?'RESUME':'START');
      pfBtn.classList.toggle('paused',isPaused);
    }
    persistPomoRuntime();
    loadPomoSessions();
  }

  function playPomoTimeoutAlarm(){
    try{
      const ctx=new(window.AudioContext||window.webkitAudioContext)();
      const master=ctx.createGain();
      master.gain.value=1;
      master.connect(ctx.destination);
      const pattern=[0,0.15,0.3,0.6,0.75,0.9,1.2,1.35,1.5,1.8,1.95,2.1];
      pattern.forEach((offset,i)=>{
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.connect(gain);gain.connect(master);
        osc.type=i%3===0?'square':(i%3===1?'sawtooth':'triangle');
        osc.frequency.value=i%2===0?1040:1560;
        const t=ctx.currentTime+offset;
        gain.gain.setValueAtTime(0.001,t);
        gain.gain.exponentialRampToValueAtTime(0.85,t+0.02);
        gain.gain.exponentialRampToValueAtTime(0.001,t+0.14);
        osc.start(t);
        osc.stop(t+0.145);
      });
    }catch(_){ }
  }

  function loadPomoDailyLog(){
    try{return JSON.parse(localStorage.getItem(POMO_LOG_KEY))||{};}catch{return{};}
  }
  function savePomoDailyLog(v){
    localStorage.setItem(POMO_LOG_KEY,JSON.stringify(v));
  }
  function updatePomoDailyLog(mode){
    const logs=loadPomoDailyLog();
    const today=getToday();
    if(!logs[today])logs[today]={focusMinutes:0,breakMinutes:0,sessions:0};
    if(mode==='focus'){
      logs[today].focusMinutes+=Math.round(POMO_DURATIONS.focus/60);
      logs[today].sessions+=1;
    }else if(mode==='short'){
      logs[today].breakMinutes+=Math.round(POMO_DURATIONS.short/60);
    }else if(mode==='long'){
      logs[today].breakMinutes+=Math.round(POMO_DURATIONS.long/60);
    }
    savePomoDailyLog(logs);
  }

  function handlePomoComplete(opts){
    const silent=opts&&opts.silent;
    if(!transitionPomoState(POMO_STATES.COMPLETED))return;
    recordAuditEvent('pomodoro',`Completed ${pomoMode} session.`);
    const resetBtn=document.getElementById('pomoStartBtn');
    if(resetBtn)resetBtn.textContent='START';
    if(pomoMode==='focus'){
      let sessions={};try{sessions=JSON.parse(localStorage.getItem(POMO_KEY))||{};}catch{}
      const today=getToday();
      sessions[today]=(sessions[today]||0)+1;
      localStorage.setItem(POMO_KEY,JSON.stringify(sessions));
      loadPomoSessions();
    }
    updatePomoDailyLog(pomoMode);
    if(!silent){
      playPomoTimeoutAlarm();
      if('vibrate' in navigator)navigator.vibrate([450,100,450,100,700,100,450]);
    }
    pomoRemaining=pomoTotal;
    transitionPomoState(POMO_STATES.IDLE);
    updatePomoDisplay();
    renderDailyActionEngine();
  }

  function pomoTick(){
    if(pomoState!==POMO_STATES.RUNNING)return;
    pomoRemaining--;
    if(pomoRemaining<=0){
      handlePomoComplete();
      return;
    }
    updatePomoDisplay();
  }

  // Sticky pomodoro drag + resize
  function initPomoFloatDrag(){
    const float=document.getElementById('pomoFloat');
    if(!float)return;
    let mode=null; // 'move' or 'resize'
    let startX=0,startY=0,startLeft=0,startTop=0,startSize=0,startRight=0;
    const sizeVar='--pf-size';

    function clamp(n,min,max){ return Math.min(max,Math.max(min,n)); }
    function keepFloatInViewport(){
      const rect=float.getBoundingClientRect();
      const maxLeft=Math.max(0,window.innerWidth-rect.width);
      const maxTop=Math.max(0,window.innerHeight-rect.height);
      const currentLeft=parseFloat(float.style.left);
      const currentTop=parseFloat(float.style.top);
      const left=Number.isFinite(currentLeft)?currentLeft:rect.left;
      const top=Number.isFinite(currentTop)?currentTop:rect.top;
      float.style.left=clamp(left,0,maxLeft)+'px';
      float.style.top=clamp(top,0,maxTop)+'px';
    }

    function pointerDown(e){
      if(e.button!==0 && e.pointerType!=='touch')return;
      const target=e.target;
      // Do not start drag/resize when interacting with control buttons.
      if(target.closest('.pf-btn')||target.closest('.pf-mode-btn'))return;
      if(target.closest('.pf-resize'))mode='resize';
      else if(target.closest('.pf-ring-wrap'))mode='move';
      else return;
      const rect=float.getBoundingClientRect();
      const cs=getComputedStyle(float);
      if(cs.right!=='auto'){
        float.style.left=rect.left+'px';
        float.style.top=rect.top+'px';
        float.style.right='auto';
      }
      startX=e.clientX;startY=e.clientY;
      startLeft=rect.left;startTop=rect.top;
      startRight=rect.right;
      const rootStyle=getComputedStyle(document.documentElement);
      const currentSize=parseFloat(rootStyle.getPropertyValue(sizeVar))||rect.width;
      startSize=currentSize;
      float.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function pointerMove(e){
      if(!mode)return;
      // If no button is pressed anymore (e.g. pointerup wasn't caught),
      // stop any drag/resize so hovering doesn't move or resize the widget.
      if(e.pointerType!=='touch' && e.buttons===0){
        mode=null;
        return;
      }
      const dx=e.clientX-startX,dy=e.clientY-startY;
      if(mode==='move'){
        const rect=float.getBoundingClientRect();
        const maxLeft=Math.max(0,window.innerWidth-rect.width);
        const maxTop=Math.max(0,window.innerHeight-rect.height);
        float.style.left=clamp(startLeft+dx,0,maxLeft)+'px';
        float.style.top=clamp(startTop+dy,0,maxTop)+'px';
      }else if(mode==='resize'){
        // Resize while keeping the outer (right) edge roughly fixed,
        // so the card visually grows inward (to the left) from the screen edge.
        const delta=dy; // down (dy>0) -> positive -> larger
        const newSize=Math.max(80,Math.min(220,startSize+delta));
        document.documentElement.style.setProperty(sizeVar,newSize+'px');
        const rect=float.getBoundingClientRect();
        const maxLeft=Math.max(0,window.innerWidth-rect.width);
        const newLeft=clamp(startRight-rect.width,0,maxLeft);
        const maxTop=Math.max(0,window.innerHeight-rect.height);
        float.style.left=newLeft+'px';
        float.style.top=clamp(startTop,0,maxTop)+'px';
      }
    }

    function pointerUp(e){
      if(!mode)return;
      mode=null;
      try{float.releasePointerCapture(e.pointerId);}catch(_){}
      keepFloatInViewport();
    }

    float.addEventListener('pointerdown',pointerDown);
    float.addEventListener('pointermove',pointerMove);
    float.addEventListener('pointerup',pointerUp);
    float.addEventListener('pointercancel',pointerUp);
    window.addEventListener('resize',keepFloatInViewport);
  }
  function togglePomo(){
    if(pomoState===POMO_STATES.RUNNING){
      transitionPomoState(POMO_STATES.PAUSED);
      const mainBtn=document.getElementById('pomoStartBtn');
      if(mainBtn)mainBtn.textContent='RESUME';
      recordAuditEvent('pomodoro',`Paused ${pomoMode} session at ${Math.floor(pomoRemaining/60)}m ${pomoRemaining%60}s.`);
      updatePomoDisplay();
      renderDailyActionEngine();
    }else{
      const wasPaused=pomoState===POMO_STATES.PAUSED;
      if(pomoState===POMO_STATES.COMPLETED)pomoRemaining=pomoTotal;
      transitionPomoState(POMO_STATES.RUNNING);
      const mainBtn=document.getElementById('pomoStartBtn');
      if(mainBtn)mainBtn.textContent='PAUSE';
      recordAuditEvent('pomodoro',`${wasPaused?'Resumed':'Started'} ${pomoMode} session.`);
      updatePomoDisplay();
      renderDailyActionEngine();
    }
  }
  function resetPomo(){
    transitionPomoState(POMO_STATES.IDLE);
    pomoRemaining=pomoTotal;
    const mainBtn=document.getElementById('pomoStartBtn');
    if(mainBtn)mainBtn.textContent='START';
    recordAuditEvent('pomodoro','Reset pomodoro timer.');
    updatePomoDisplay();
    renderDailyActionEngine();
  }
  function loadPomoSessions(){
    let sessions={};try{sessions=JSON.parse(localStorage.getItem(POMO_KEY))||{};}catch{}
    const count=sessions[getToday()]||0;
    const dailyLog=loadPomoDailyLog()[getToday()]||{focusMinutes:0,breakMinutes:0,sessions:0};
    const mainSessions=document.getElementById('pomoSessions');
    const floatSessions=document.getElementById('pfSessions');
    if(mainSessions)mainSessions.textContent=count;
    if(floatSessions){
      floatSessions.textContent=`${count}`;
      floatSessions.parentElement.title=`Focus ${dailyLog.focusMinutes}m | Break ${dailyLog.breakMinutes}m | Sessions ${dailyLog.sessions}`;
    }
  }

  function runPomoUnitTests(){
    const snapshot={
      mode:pomoMode,
      state:pomoState,
      running:pomoRunning,
      remaining:pomoRemaining,
      total:pomoTotal,
      interval:pomoInterval,
      pomoStore:localStorage.getItem(POMO_KEY),
      pomoLogStore:localStorage.getItem(POMO_LOG_KEY)
    };
    const results=[];
    function assert(cond,name){ if(!cond)throw new Error(name); results.push(name); }
    try{
      transitionPomoState(POMO_STATES.IDLE);
      pomoMode='focus';
      pomoTotal=POMO_DURATIONS.focus;
      pomoRemaining=pomoTotal;
      updatePomoDisplay();

      togglePomo();
      assert(pomoState===POMO_STATES.RUNNING,'start transitions to running');
      togglePomo();
      assert(pomoState===POMO_STATES.PAUSED,'pause transitions to paused');

      const beforeTick=10;
      pomoRemaining=beforeTick;
      pomoTotal=beforeTick;
      transitionPomoState(POMO_STATES.RUNNING);
      pomoTick();
      assert(pomoRemaining===beforeTick-1,'tick decrements remaining by 1');

      const beforeSessions=(function(){try{const s=JSON.parse(localStorage.getItem(POMO_KEY))||{};return s[getToday()]||0;}catch{return 0;}})();
      const beforeFocusMinutes=(function(){try{const l=JSON.parse(localStorage.getItem(POMO_LOG_KEY))||{};return (l[getToday()]&&l[getToday()].focusMinutes)||0;}catch{return 0;}})();
      pomoMode='focus';
      pomoTotal=1;
      pomoRemaining=1;
      transitionPomoState(POMO_STATES.RUNNING);
      handlePomoComplete({silent:true});
      const afterSessions=(function(){try{const s=JSON.parse(localStorage.getItem(POMO_KEY))||{};return s[getToday()]||0;}catch{return 0;}})();
      const afterFocusMinutes=(function(){try{const l=JSON.parse(localStorage.getItem(POMO_LOG_KEY))||{};return (l[getToday()]&&l[getToday()].focusMinutes)||0;}catch{return 0;}})();
      assert(afterSessions===beforeSessions+1,'focus completion increments session count');
      assert(afterFocusMinutes===beforeFocusMinutes+25,'focus completion adds 25 focus minutes to daily log');

      resetPomo();
      assert(pomoRunning===false&&pomoRemaining===pomoTotal,'reset restores full timer and stopped state');
      console.log('Pomodoro tests passed:',results);
    }catch(err){
      console.error('Pomodoro test failed:',err);
    }finally{
      transitionPomoState(POMO_STATES.IDLE);
      pomoMode=snapshot.mode;
      pomoState=snapshot.state;
      pomoRunning=snapshot.running;
      pomoRemaining=snapshot.remaining;
      pomoTotal=snapshot.total;
      if(snapshot.pomoStore===null)localStorage.removeItem(POMO_KEY);
      else localStorage.setItem(POMO_KEY,snapshot.pomoStore);
      if(snapshot.pomoLogStore===null)localStorage.removeItem(POMO_LOG_KEY);
      else localStorage.setItem(POMO_LOG_KEY,snapshot.pomoLogStore);
      if(snapshot.running){
        pomoState=POMO_STATES.RUNNING;
        clearInterval(pomoInterval);
        pomoInterval=setInterval(pomoTick,1000);
        pomoRunning=true;
      }else{
        clearInterval(pomoInterval);
        pomoInterval=null;
        pomoRunning=false;
      }
      updatePomoDisplay();
    }
  }

  // SUBJECT TRACKER
  function loadSubjects(){try{return JSON.parse(localStorage.getItem(SUBJ_KEY))||{dbms:0,os:0,cn:0,dsa:0};}catch{return{dbms:0,os:0,cn:0,dsa:0};}}
  function saveSubjects(s){localStorage.setItem(SUBJ_KEY,JSON.stringify(s));}
  function renderSubjects(){
    const s=loadSubjects();
    ['dbms','os','cn','dsa'].forEach(k=>{
      document.getElementById('bar-'+k).style.width=s[k]+'%';
      document.getElementById('pct-'+k).textContent=s[k]+'%';
    });
  }
  ['dbms','os','cn','dsa'].forEach(subj=>{
    const wrap=document.getElementById('wrap-'+subj);
    if(!wrap)return;
    function handleBarClick(e){
      const rect=wrap.getBoundingClientRect();
      const clientX=e.touches?e.touches[0].clientX:e.clientX;
      const pct=Math.round(Math.max(0,Math.min(100,(clientX-rect.left)/rect.width*100)));
      const s=loadSubjects();s[subj]=pct;saveSubjects(s);renderSubjects();
    }
    wrap.addEventListener('click',handleBarClick);
    wrap.addEventListener('touchend',e=>{e.preventDefault();handleBarClick(e.changedTouches[0]?{clientX:e.changedTouches[0].clientX}:e);},{passive:false});
  });

  // STREAK
  function getStreakData(){try{return JSON.parse(localStorage.getItem(STREAK_KEY))||{count:0};}catch{return{count:0};}}
  function markToday(){
    const today=getToday(),log=getStreakLog(),streak=getStreakData();
    if(isDateLocked(today))return;
    let markedNow=false;
    if(log.includes(today)){
      log.splice(log.indexOf(today),1);streak.count=Math.max(0,streak.count-1);
      const y=new Date();y.setDate(y.getDate()-1);localStorage.setItem(LAST_DATE_KEY,y.toISOString().split('T')[0]);
      removeWeekPhoto(today);
      recordAuditEvent('streak','Undid today\'s streak mark.',today);
    }else{
      const last=localStorage.getItem(LAST_DATE_KEY);
      const y=new Date();y.setDate(y.getDate()-1);
      streak.count=(last===y.toISOString().split('T')[0])?streak.count+1:1;
      log.push(today);if(log.length>30)log.shift();localStorage.setItem(LAST_DATE_KEY,today);
      markedNow=true;
      recordAuditEvent('streak','Marked today as done.',today);
    }
    localStorage.setItem(STREAK_KEY,JSON.stringify(streak));
    localStorage.setItem(STREAK_LOG_KEY,JSON.stringify(log));
    renderStreak();updateStreakBtn(log.includes(today));renderWeekView();renderDailyActionEngine();
    if(markedNow){
      openWeekChoiceModal(today);
    }
  }
  function updateStreakBtn(marked){
    const b=document.getElementById('streakBtn');
    if(!b)return;
    const locked=isDateLocked(getToday());
    b.disabled=locked;
    if(locked){b.textContent='TODAY LOCKED';b.style.cssText='background:#1b1b1b;color:#9a9a9a;border:1px solid #333;cursor:not-allowed';}
    else if(marked){b.textContent='↩ Undo Today';b.style.cssText='background:var(--green);color:var(--on-light);border:1px solid var(--green)';}
    else{b.textContent='✓ Done Today';b.style.cssText='background:var(--accent);color:var(--on-light);border:none';}
  }
  function renderStreak(){
    const streak=getStreakData(),log=getStreakLog();
    const photos=loadWeekPhotos();
    document.getElementById('streakCount').textContent=streak.count;
    const c=document.getElementById('streakDots');c.innerHTML='';
    const today=getToday();
    for(let i=9;i>=0;i--){
      const d=new Date();d.setDate(d.getDate()-i);
      const ds=d.toISOString().split('T')[0];
      const dot=document.createElement('div');dot.className='dot';dot.textContent=d.getDate();
      if(log.includes(ds))dot.classList.add('active');
      else if(ds<today)dot.classList.add('missed');
      if(ds===today&&!log.includes(ds))dot.classList.add('today');
      if((log.includes(ds)||dot.classList.contains('active'))&&photos[ds]){
        dot.classList.add('photo');
        dot.style.backgroundImage=`url(${photos[ds]})`;
        dot.title='Open proof photo';
        attachPhotoHoverPreview(dot,ds,photos[ds]);
        dot.addEventListener('click',()=>openStreakPhotoViewer(ds));
      }
      c.appendChild(dot);
    }
    renderStreakAnalytics();
  }
  function getDayCompletionLevel(ds,state,log){
    if(log.includes(ds))return 3;
    const done=countCompletedTasks(state[ds]||{});
    const total=getCustomTasksForDate(ds).length;
    if(total>0&&done>=total)return 3;
    if(total>0&&done>=Math.ceil(total*0.6))return 2;
    if(done>=1)return 1;
    return 0;
  }
  function computeLongestStreak(log){
    if(!log.length)return 0;
    const sorted=[...new Set(log)].sort();
    let best=1,run=1;
    for(let i=1;i<sorted.length;i++){
      const prev=new Date(sorted[i-1]);
      const cur=new Date(sorted[i]);
      const diff=Math.round((cur-prev)/86400000);
      if(diff===1){run++;best=Math.max(best,run);}else run=1;
    }
    return best;
  }
  function renderStreakAnalytics(){
    const log=getStreakLog();
    const state=loadState();
    const now=new Date();
    const y=now.getFullYear(),m=now.getMonth();
    const daysInMonth=new Date(y,m+1,0).getDate();
    const today=getToday();
    let fullDays=0,elapsed=0;
    const grid=document.getElementById('monthHeatmapGrid');
    if(grid)grid.innerHTML='';
    const firstOfMonth=new Date(y,m,1);
    const startPad=firstOfMonth.getDay();
    if(grid){
      for(let i=0;i<startPad;i++){
        const padCell=document.createElement('div');
        padCell.className='mcell empty';
        grid.appendChild(padCell);
      }
    }
    for(let day=1;day<=daysInMonth;day++){
      const d=new Date(y,m,day);
      const ds=d.toISOString().split('T')[0];
      if(ds<=today)elapsed++;
      const lvl=getDayCompletionLevel(ds,state,log);
      if(lvl===3&&ds<=today)fullDays++;
      if(grid){
        const cell=document.createElement('div');
        cell.className='mcell'+(lvl?` l${lvl}`:'');
        const status=lvl===3?'full day':(lvl===2?'solid progress':(lvl===1?'some progress':'no progress'));
        cell.title=`${ds} - ${status}`;
        grid.appendChild(cell);
      }
    }
    if(grid){
      const filled=startPad+daysInMonth;
      const endPad=(7-(filled%7))%7;
      for(let i=0;i<endPad;i++){
        const padCell=document.createElement('div');
        padCell.className='mcell empty';
        grid.appendChild(padCell);
      }
    }
    const pct=elapsed?Math.round((fullDays/elapsed)*100):0;
    const longest=computeLongestStreak(log);
    const missInRange=(daysBackStart,daysBackEnd)=>{
      let miss=0;
      for(let i=daysBackStart;i<=daysBackEnd;i++){
        const d=new Date();d.setDate(d.getDate()-i);
        const ds=d.toISOString().split('T')[0];
        if(getDayCompletionLevel(ds,state,log)===0)miss++;
      }
      return miss;
    };
    const missThis=missInRange(0,6);
    const missPrev=missInRange(7,13);
    const trend=missPrev-missThis;
    const trendText=trend>0?`+${trend}`:String(trend);
    const trendLabel=trend>0?'improving':(trend<0?'worse':'steady');

    const head=document.getElementById('monthHeatmapHead');
    if(head)head.textContent=now.toLocaleDateString('en-US',{month:'long',year:'numeric'}).toUpperCase();
    const monthPct=document.getElementById('metricMonthPct');
    if(monthPct)monthPct.textContent=`${pct}%`;
    const longestEl=document.getElementById('metricLongest');
    if(longestEl)longestEl.textContent=String(longest);
    const trendEl=document.getElementById('metricTrend');
    if(trendEl)trendEl.textContent=trendText;
    const trendLine=document.getElementById('monthTrendText');
    if(trendLine)trendLine.textContent=`Missed days trend (7d vs prev 7d): ${trendText} (${trendLabel})`;
  }
  function renderMissedBanner(){
    const missed=getMissedDays();
    if(missed>=2){
      document.getElementById('missedBanner').style.display='block';
      document.getElementById('missedBannerText').textContent=`You missed ${missed} days this week. That's ${missed} days closer to getting rejected. Fix it today.`;
    }
  }

  // DAILY REFLECTION
  function loadReflections(){try{return JSON.parse(localStorage.getItem(REFLECT_KEY))||[];}catch{return[];}}
  function saveReflection(){
    const r1=document.getElementById('ref1').value.trim();
    const r2=document.getElementById('ref2').value.trim();
    const r3=document.getElementById('ref3').value.trim();
    if(!r1&&!r2&&!r3)return;
    const refs=loadReflections(),today=getToday();
    const idx=refs.findIndex(r=>r.date===today);
    const entry={date:today,studied:r1,avoided:r2,tomorrow:r3};
    if(idx>=0)refs[idx]=entry;else refs.unshift(entry);
    if(refs.length>30)refs.pop();
    localStorage.setItem(REFLECT_KEY,JSON.stringify(refs));
    const saved=document.getElementById('reflectionSaved');
    saved.style.display='block';setTimeout(()=>saved.style.display='none',2500);
    renderReflectionHistory();
    renderReflectionCoach();
    renderDailyActionEngine();
    openNightPrep();
  }
  function renderReflectionHistory(){
    const refs=loadReflections();
    const hist=document.getElementById('reflectionHistory'),list=document.getElementById('reflectionList');
    if(refs.length===0){
      hist.style.display='none';
      renderReflectionCoach();
      return;
    }
    hist.style.display='block';list.innerHTML='';
    const today=getToday();
    const todayEntry=refs.find(r=>r.date===today);
    if(todayEntry){
      document.getElementById('ref1').value=todayEntry.studied||'';
      document.getElementById('ref2').value=todayEntry.avoided||'';
      document.getElementById('ref3').value=todayEntry.tomorrow||'';
    }
    refs.slice(0,5).forEach(r=>{
      const el=document.createElement('div');el.className='rh-entry';
      el.innerHTML=`<div class="rh-entry-date">${r.date}</div>`+
        (r.studied?`<div class="rh-entry-row"><b>STUDIED: </b>${r.studied}</div>`:'')  +
        (r.avoided?`<div class="rh-entry-row"><b>AVOIDED: </b>${r.avoided}</div>`:'')  +
        (r.tomorrow?`<div class="rh-entry-row"><b>TOMORROW: </b>${r.tomorrow}</div>`:'');
      list.appendChild(el);
    });
    renderReflectionCoach();
  }

  // DATE & COUNTDOWN
  function renderDate(){
    const d=new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}).toUpperCase();
    document.getElementById('todayDate').textContent=d;
    document.getElementById('reflectionDate').textContent=d;
  }
  function renderCountdown(){
    const diff=Math.ceil((new Date('2026-09-01')-new Date())/86400000);
    document.getElementById('countdownDays').textContent=diff>0?diff:'0';
  }

  // DAY ROLLOVER: keep UI/state correct when app stays open across midnight.
  let activeDayKey=getToday();
  let dayBoundaryTimeoutId=null;
  let dayBoundaryIntervalId=null;
  let dayBoundaryListenersBound=false;
  function getDateOffset(days){
    const d=new Date();
    d.setDate(d.getDate()+days);
    return d.toISOString().split('T')[0];
  }
  function enforceStreakContinuity(){
    const streak=getStreakData();
    if(!streak.count)return;
    const last=localStorage.getItem(LAST_DATE_KEY);
    if(!last){
      streak.count=0;
      localStorage.setItem(STREAK_KEY,JSON.stringify(streak));
      return;
    }
    const today=getToday();
    const yesterday=getDateOffset(-1);
    if(last!==today&&last!==yesterday){
      streak.count=0;
      localStorage.setItem(STREAK_KEY,JSON.stringify(streak));
    }
  }
  function refreshForNewDay(){
    finalizeDailySnapshot(getDateOffset(-1));
    enforceStreakContinuity();
    renderDate();
    renderCountdown();
    renderTasks();
    renderProgress();
    renderWeekView();
    renderStreak();
    updateStreakBtn(getStreakLog().includes(getToday()));
    loadPomoSessions();
    renderReflectionHistory();
    maybeShowBackupReminder();
    updateBackupAgeText();
    updateStorageStatus();
    renderWeeklyReportCard();
    updateDayLockBadge();
    renderAuditLog();
    renderDailyActionEngine();
  }
  function finalizeSnapshotIfDue(){
    const now=new Date();
    const today=getToday();
    if(now.getHours()>=23&&now.getMinutes()>=59&&!loadDailySnapshots()[today]){
      finalizeDailySnapshot(today);
      updateDayLockBadge();
      renderAuditLog();
      renderTasks();
      renderProgress();
      renderStreak();
      renderWeekView();
      renderWeeklyReportCard();
      updateStreakBtn(getStreakLog().includes(today));
      return true;
    }
    return false;
  }
  function closeDaySensitiveUiOnRollover(){
    hidePhotoHoverPreview();
    closeWeekChoiceModal();
    pendingWeekPhotoDate=null;
    closeWeekPhotoCamera();
    closeStreakPhotoViewer();
    closeMorningMode();
  }
  function checkDayBoundary(){
    const nowDay=getToday();
    if(nowDay===activeDayKey)return;
    finalizeDailySnapshot(activeDayKey);
    activeDayKey=nowDay;
    closeDaySensitiveUiOnRollover();
    refreshForNewDay();
  }
  function scheduleDayBoundaryWatcher(){
    if(dayBoundaryTimeoutId)clearTimeout(dayBoundaryTimeoutId);
    const now=new Date();
    const nextMidnight=new Date(now);
    nextMidnight.setHours(24,0,0,0);
    const msUntil=Math.max(1000,nextMidnight-now+500);
    dayBoundaryTimeoutId=setTimeout(()=>{
      checkDayBoundary();
      scheduleDayBoundaryWatcher();
    },msUntil);
    if(!dayBoundaryIntervalId)dayBoundaryIntervalId=setInterval(checkDayBoundary,60000);
    if(!dayBoundaryListenersBound){
      dayBoundaryListenersBound=true;
      document.addEventListener('visibilitychange',()=>{
        if(document.visibilityState==='visible'){
          finalizeSnapshotIfDue();
          checkDayBoundary();
        }
      });
      window.addEventListener('focus',()=>{
        finalizeSnapshotIfDue();
        checkDayBoundary();
      });
    }
  }

  let dailySnapshotTimeoutId=null;
  let dailySnapshotIntervalId=null;
  let dailySnapshotListenersBound=false;
  function scheduleDailySnapshotWatcher(){
    if(dailySnapshotTimeoutId)clearTimeout(dailySnapshotTimeoutId);
    const now=new Date();
    const next=new Date(now);
    next.setHours(23,59,0,0);
    if(next<=now)next.setDate(next.getDate()+1);
    const msUntil=Math.max(1000,next-now+500);
    dailySnapshotTimeoutId=setTimeout(()=>{
      finalizeSnapshotIfDue();
      scheduleDailySnapshotWatcher();
    },msUntil);
    if(!dailySnapshotIntervalId)dailySnapshotIntervalId=setInterval(finalizeSnapshotIfDue,30000);
    if(!dailySnapshotListenersBound){
      dailySnapshotListenersBound=true;
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')finalizeSnapshotIfDue();});
      window.addEventListener('focus',finalizeSnapshotIfDue);
    }
  }

  function reorderDashboardTiles(){
    const main=document.getElementById('mainContent');
    if(!main)return;
    const order=[
      'tile-next',
      'tile-tasks',
      'tile-engine',
      'tile-subjects',
      'tile-week',
      'tile-streak',
      'tile-reflection',
      'tile-reality'
    ];
    order.forEach(cls=>{
      const el=main.querySelector(`.tile.${cls}`);
      if(el)main.appendChild(el);
    });
  }

  function applySimpleTileLimit(){
    const main=document.getElementById('mainContent');
    if(!main)return;
    const tiles=[...main.querySelectorAll('.tile')];
    tiles.forEach((t,idx)=>{
      if(idx>=5)t.classList.add('simple-hidden');
      else t.classList.remove('simple-hidden');
    });
    let btn=document.getElementById('showMoreTilesBtn');
    if(!btn){
      btn=document.createElement('button');
      btn.id='showMoreTilesBtn';
      btn.className='tiny-btn';
      btn.textContent='More';
      btn.style.margin='10px 0 14px';
      btn.addEventListener('click',()=>{
        const hidden=main.querySelectorAll('.tile.simple-hidden');
        hidden.forEach(h=>h.classList.remove('simple-hidden'));
        btn.remove();
      });
      const firstHidden=tiles[5];
      if(firstHidden)main.insertBefore(btn,firstHidden);
    }
  }

  function bindSimplifiedUiControls(){
    const toggleDetails=document.getElementById('toggleStreakDetailsBtn');
    const streakWrap=document.getElementById('streakDetailsWrap');
    if(toggleDetails&&streakWrap){
      toggleDetails.addEventListener('click',()=>{
        const open=streakWrap.style.display!=='none';
        streakWrap.style.display=open?'none':'block';
        toggleDetails.textContent=open?'View Details':'Hide Details';
      });
    }

    const toggleSettings=document.getElementById('toggleSettingsBtn');
    const panel=document.getElementById('settingsPanel');
    if(toggleSettings&&panel){
      toggleSettings.addEventListener('click',()=>{
        const open=panel.style.display!=='none';
        panel.style.display=open?'none':'block';
        toggleSettings.textContent=open?'Settings & Data':'Hide Settings';
      });
    }

    const sortSelect=document.getElementById('taskSortMode');
    if(sortSelect){
      sortSelect.value=getTaskSortMode();
      sortSelect.addEventListener('change',()=>{
        setTaskSortMode(sortSelect.value);
        renderTasks();
      });
    }
  }

  // PWA
  let deferredPrompt=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;document.getElementById('installBanner').style.display='block';});
  function installPWA(){
    if(deferredPrompt){deferredPrompt.prompt();deferredPrompt.userChoice.then(()=>{deferredPrompt=null;document.getElementById('installBanner').style.display='none';});}
    else{alert('Tap browser menu → "Add to Home Screen" to install.');}
  }

  // NOTIFICATIONS
  let swReg=null,reminderLoopStarted=false;
  function showUpdateBanner(){
    const b=document.getElementById('updateBanner');
    if(b)b.style.display='block';
  }
  function applyAppUpdate(){
    if(updateWaitingWorker){
      updateWaitingWorker.postMessage({type:'SKIP_WAITING'});
      return;
    }
    window.location.reload();
  }
  function askNotifPermission(){
    if(!('Notification' in window))return;
    if(Notification.permission==='default')document.getElementById('notifBanner').style.display='block';
    else if(Notification.permission==='granted')scheduleReminder();
  }
  function requestNotifPermission(){
    Notification.requestPermission().then(p=>{
      document.getElementById('notifBanner').style.display='none';
      if(p==='granted'){
        scheduleReminder();
        scheduleNightPrepNotification();
      }
    });
  }
  function scheduleReminder(){
    if(reminderLoopStarted||!('serviceWorker' in navigator)||!('Notification' in window))return;
    reminderLoopStarted=true;

    function startLoop(reg){
      swReg=reg;
      const tick=()=>{
        const log=getStreakLog(),hour=new Date().getHours();
        if(hour>=8&&!log.includes(getToday())){
          try{swReg.showNotification('⚠️ Open Your Daily Mission',{body:"You haven't checked your tasks today. Placements don't wait.",vibrate:[300,100,300,100,600],requireInteraction:true,tag:'daily-mission'});}catch(e){}
        }
        setTimeout(tick,3600000);
      };
      tick();
    }

    if(swReg){
      startLoop(swReg);
    }else{
      navigator.serviceWorker.ready.then(startLoop).catch(()=>{});
    }
  }
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').then(reg=>{
      swReg=reg;
      if(reg.waiting){
        updateWaitingWorker=reg.waiting;
        showUpdateBanner();
      }
      reg.addEventListener('updatefound',()=>{
        const nw=reg.installing;
        if(!nw)return;
        nw.addEventListener('statechange',()=>{
          if(nw.state==='installed'&&navigator.serviceWorker.controller){
            updateWaitingWorker=nw;
            showUpdateBanner();
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange',()=>{
        window.location.reload();
      });
    }).catch(()=>{});
  }

  // INIT
  enforceStreakContinuity();
  reorderDashboardTiles();
  applySimpleTileLimit();
  renderDate();renderCountdown();renderTasks();renderProgress();
  renderStreak();renderWeekView();renderSubjects();
  initTaskPlanDatePicker();
  bindSimplifiedUiControls();
  initWeekPhotoStorage();
  loadPomoSessions();renderReflectionHistory();
  finalizeDailySnapshot(getDateOffset(-1));
  restorePomoRuntime();
  runStartupIntegrityChecks();
  updateDayLockBadge();
  renderAuditLog();
  updateStreakBtn(getStreakLog().includes(getToday()));
  updatePomoDisplay();
  renderDailyActionEngine();
  initTaskAccessibility();
  const weekKeepTickBtn=document.getElementById('weekKeepTickBtn');
  if(weekKeepTickBtn){
    weekKeepTickBtn.addEventListener('click',()=>{
      closeWeekChoiceModal();
    });
  }
  const weekAddSelfieBtn=document.getElementById('weekAddSelfieBtn');
  if(weekAddSelfieBtn){
    weekAddSelfieBtn.addEventListener('click',()=>{
      const date=pendingWeekChoiceDate;
      closeWeekChoiceModal();
      if(date)openWeekPhotoCamera(date);
    });
  }
  const weekPhotoCancelBtn=document.getElementById('weekPhotoCancelBtn');
  if(weekPhotoCancelBtn){
    weekPhotoCancelBtn.addEventListener('click',()=>{
      pendingWeekPhotoDate=null;
      closeWeekPhotoCamera();
    });
  }
  const weekPhotoCaptureBtn=document.getElementById('weekPhotoCaptureBtn');
  if(weekPhotoCaptureBtn)weekPhotoCaptureBtn.addEventListener('click',captureWeekPhoto);
  const weekPhotoRetakeBtn=document.getElementById('weekPhotoRetakeBtn');
  if(weekPhotoRetakeBtn)weekPhotoRetakeBtn.addEventListener('click',retakeWeekPhoto);
  const weekPhotoSaveBtn=document.getElementById('weekPhotoSaveBtn');
  if(weekPhotoSaveBtn)weekPhotoSaveBtn.addEventListener('click',saveWeekPhotoCapture);
  const streakPhotoCloseBtn=document.getElementById('streakPhotoCloseBtn');
  if(streakPhotoCloseBtn)streakPhotoCloseBtn.addEventListener('click',closeStreakPhotoViewer);
  const streakPhotoDoneBtn=document.getElementById('streakPhotoDoneBtn');
  if(streakPhotoDoneBtn)streakPhotoDoneBtn.addEventListener('click',closeStreakPhotoViewer);
  const streakPhotoPrevBtn=document.getElementById('streakPhotoPrevBtn');
  if(streakPhotoPrevBtn)streakPhotoPrevBtn.addEventListener('click',()=>stepStreakPhotoViewer(-1));
  const streakPhotoNextBtn=document.getElementById('streakPhotoNextBtn');
  if(streakPhotoNextBtn)streakPhotoNextBtn.addEventListener('click',()=>stepStreakPhotoViewer(1));
  const streakPhotoDeleteBtn=document.getElementById('streakPhotoDeleteBtn');
  if(streakPhotoDeleteBtn)streakPhotoDeleteBtn.addEventListener('click',deleteCurrentStreakPhoto);
  const streakPhotoRetakeBtn=document.getElementById('streakPhotoRetakeBtn');
  if(streakPhotoRetakeBtn)streakPhotoRetakeBtn.addEventListener('click',retakeCurrentStreakPhoto);
  const backupFileInput=document.getElementById('backupFileInput');
  if(backupFileInput)backupFileInput.addEventListener('change',handleImportBackup);
  const backupReminderDays=document.getElementById('backupReminderDays');
  if(backupReminderDays){
    backupReminderDays.value=String(getBackupReminderDays());
    backupReminderDays.addEventListener('change',()=>{
      localStorage.setItem(BACKUP_REMINDER_DAYS_KEY,String(backupReminderDays.value));
      maybeShowBackupReminder();
    });
  }
  const openMorningModeBtn=document.getElementById('openMorningModeBtn');
  if(openMorningModeBtn)openMorningModeBtn.addEventListener('click',openMorningMode);
  const npCancelBtn=document.getElementById('npCancelBtn');
  if(npCancelBtn)npCancelBtn.addEventListener('click',closeNightPrep);
  const npSaveBtn=document.getElementById('npSaveBtn');
  if(npSaveBtn)npSaveBtn.addEventListener('click',saveNightPrepFromUi);
  const morningCloseBtn=document.getElementById('morningCloseBtn');
  if(morningCloseBtn)morningCloseBtn.addEventListener('click',closeMorningMode);
  const morningStartFocusBtn=document.getElementById('morningStartFocusBtn');
  if(morningStartFocusBtn)morningStartFocusBtn.addEventListener('click',saveMorningFocusSelection);
  const taskCompletionCloseBtn=document.getElementById('taskCompletionCloseBtn');
  if(taskCompletionCloseBtn)taskCompletionCloseBtn.addEventListener('click',closeTaskCompletionModal);
  const downloadWeeklyReportBtn=document.getElementById('downloadWeeklyReportBtn');
  if(downloadWeeklyReportBtn)downloadWeeklyReportBtn.addEventListener('click',downloadWeeklyReport);
  maybeShowBackupReminder();
  updateBackupAgeText();
  updateStorageStatus();
  renderWeeklyReportCard();
  scheduleNightPrepNotification();
  scheduleAntiDriftWatcher();
  scheduleTaskHealthWatcher();
  // Expose manual test trigger.
  window.runPomoUnitTests=runPomoUnitTests;
  initWeekPhotoKeyboardShortcuts();
  document.addEventListener('keydown',e=>{
    const modal=document.getElementById('streakPhotoViewerModal');
    const open=modal&&modal.style.display==='flex';
    if(!open)return;
    if(e.key==='Escape'){e.preventDefault();closeStreakPhotoViewer();return;}
    if(e.key==='ArrowLeft'){e.preventDefault();stepStreakPhotoViewer(-1);return;}
    if(e.key==='ArrowRight'){e.preventDefault();stepStreakPhotoViewer(1);}
  });
  document.addEventListener('pointerdown',e=>{
    const pv=document.getElementById('photoHoverPreview');
    if(!pv||pv.style.display!=='block')return;
    if(!pv.contains(e.target))hidePhotoHoverPreview();
  });
  window.addEventListener('scroll',hidePhotoHoverPreview,{passive:true});
  window.addEventListener('resize',hidePhotoHoverPreview);
  initSlapScreen();
  maybeAutoOpenMorningMode();
  initPomoFloatDrag();
  scheduleDayBoundaryWatcher();
  scheduleDailySnapshotWatcher();
