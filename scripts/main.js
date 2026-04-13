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
  const APP_DB_NAME='daily_mission_db', APP_DB_VERSION=1, APP_DB_STORE='kv';
  const DEV_BYPASS_KEY='cse_dev_bypass_slap';
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

  function getToday() { return new Date().toISOString().split('T')[0]; }
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
    const taskDoneCount=Object.values(dayTasks).filter(Boolean).length;
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
      const done=Object.values(state[ds]||{}).filter(Boolean).length;
      if(done===5||log.includes(ds))full++;
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
    if(!modal||!list)return;
    const tasks=loadState()[getToday()]||{};
    const labels=[
      '2 LeetCode Problems',
      '45 min TUF+ Study',
      'Review Yesterday\'s Notes',
      '10 min Project Thinking',
      'Study for Sem Exam'
    ];
    const next=labels.filter((_,idx)=>!tasks[idx]).slice(0,3);
    list.innerHTML='';
    (next.length?next:['All key tasks done today']).forEach(t=>{
      const el=document.createElement('div');
      el.className='mm-item';
      el.textContent=t;
      list.appendChild(el);
    });
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
  function toggleTask(id){
    const today=getToday(),state=loadState();
    if(isDateLocked(today))return;
    if(!state[today])state[today]={};
    state[today][id]=!state[today][id];
    saveState(state);renderTasks();renderProgress();renderWeekView();
    recordAuditEvent('task',`Task ${id+1} toggled ${state[today][id]?'on':'off'}.`,today);
  }
  function renderTasks(){
    const ts=loadState()[getToday()]||{};
    for(let i=0;i<5;i++){
      const t=document.querySelector(`.task[data-id="${i}"]`);
      const c=document.getElementById(`cb${i}`);
      if(ts[i]){t.classList.add('done');c.innerHTML='✓';}
      else{t.classList.remove('done');c.innerHTML='';}
    }
  }
  function renderProgress(){
    const ts=loadState()[getToday()]||{};
    const done=Object.values(ts).filter(Boolean).length;
    document.getElementById('progressBar').style.width=(done/5*100)+'%';
    document.getElementById('progressLabel').textContent=`${done} / 5 done today`;
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
    recordAuditEvent('task','Reset today\'s tasks.',today);
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
      const done=Object.values(tasks).filter(Boolean).length;
      const col=document.createElement('div');col.className='week-day';
      const lbl=document.createElement('div');lbl.className='week-day-label';lbl.textContent=dayNames[d.getDay()];
      const dot=document.createElement('div');dot.className='week-day-dot';
      if(isToday)dot.classList.add('today-ring');
      if(isFuture){dot.classList.add('future');dot.textContent=d.getDate();}
      else if(log.includes(ds)||done===5){
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
      else if(done>0){dot.classList.add('partial');dot.innerHTML=`<span style="font-size:13px">${done}</span><span style="font-size:7px;color:#c1c1c1">/5</span>`;}
      else{dot.classList.add('empty');dot.textContent=d.getDate();}
      col.appendChild(lbl);col.appendChild(dot);grid.appendChild(col);
    }
    const s=document.getElementById('weekSummary');
    if(completedFull===0)s.innerHTML='No full days yet this week. Start today.';
    else if(completedFull>=6)s.innerHTML=`<b>${completedFull}/7</b> days — exceptional week 🔥`;
    else s.innerHTML=`<b>${completedFull}/7</b> days completed this week`;
    renderStreakAnalytics();
    renderWeeklyReportCard();
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
    const timeStr=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
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
    }else{
      const wasPaused=pomoState===POMO_STATES.PAUSED;
      if(pomoState===POMO_STATES.COMPLETED)pomoRemaining=pomoTotal;
      transitionPomoState(POMO_STATES.RUNNING);
      const mainBtn=document.getElementById('pomoStartBtn');
      if(mainBtn)mainBtn.textContent='PAUSE';
      recordAuditEvent('pomodoro',`${wasPaused?'Resumed':'Started'} ${pomoMode} session.`);
      updatePomoDisplay();
    }
  }
  function resetPomo(){
    transitionPomoState(POMO_STATES.IDLE);
    pomoRemaining=pomoTotal;
    const mainBtn=document.getElementById('pomoStartBtn');
    if(mainBtn)mainBtn.textContent='START';
    recordAuditEvent('pomodoro','Reset pomodoro timer.');
    updatePomoDisplay();
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
    renderStreak();updateStreakBtn(log.includes(today));renderWeekView();
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
    const done=Object.values(state[ds]||{}).filter(Boolean).length;
    if(done>=5)return 3;
    if(done>=3)return 2;
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
  }
  function renderReflectionHistory(){
    const refs=loadReflections();
    const hist=document.getElementById('reflectionHistory'),list=document.getElementById('reflectionList');
    if(refs.length===0){hist.style.display='none';return;}
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
    Notification.requestPermission().then(p=>{document.getElementById('notifBanner').style.display='none';if(p==='granted')scheduleReminder();});
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
  renderDate();renderCountdown();renderTasks();renderProgress();
  renderStreak();renderWeekView();renderSubjects();
  initWeekPhotoStorage();
  loadPomoSessions();renderReflectionHistory();
  finalizeDailySnapshot(getDateOffset(-1));
  restorePomoRuntime();
  runStartupIntegrityChecks();
  updateDayLockBadge();
  renderAuditLog();
  updateStreakBtn(getStreakLog().includes(getToday()));
  updatePomoDisplay();
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
  const morningCloseBtn=document.getElementById('morningCloseBtn');
  if(morningCloseBtn)morningCloseBtn.addEventListener('click',closeMorningMode);
  const morningStartFocusBtn=document.getElementById('morningStartFocusBtn');
  if(morningStartFocusBtn)morningStartFocusBtn.addEventListener('click',()=>{
    closeMorningMode();
    setPomoMode('focus');
    if(!pomoRunning)togglePomo();
  });
  const downloadWeeklyReportBtn=document.getElementById('downloadWeeklyReportBtn');
  if(downloadWeeklyReportBtn)downloadWeeklyReportBtn.addEventListener('click',downloadWeeklyReport);
  maybeShowBackupReminder();
  updateBackupAgeText();
  updateStorageStatus();
  renderWeeklyReportCard();
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
