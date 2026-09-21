(() => {
  "use strict";

  const KEY = "azmoon_study_v1";
  const $ = id => document.getElementById(id);
  let state = load();
  let studyTimer = null;
  let studyStartedAt = null;
  let studyElapsed = 0;
  let selectedCalendarDate = dateKey(new Date());
  let calendarJ = currentJ();

  const JMONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];

  function load(){
    try { const x = JSON.parse(localStorage.getItem(KEY) || "null"); return x && typeof x === "object" ? normalize(x) : normalize({}); }
    catch { return normalize({}); }
  }
  function normalize(x){
    return {
      sessions: Array.isArray(x.sessions) ? x.sessions : [],
      events: Array.isArray(x.events) ? x.events : [],
      goal: x.goal && typeof x.goal === "object" ? {tests:Number(x.goal.tests)||0, studyMinutes:Number(x.goal.studyMinutes)||0} : {tests:0,studyMinutes:0},
      streakMinMinutes: Number(x.streakMinMinutes) || 20,
      updatedAt: x.updatedAt || new Date(0).toISOString()
    };
  }
  function save(){ state.updatedAt = new Date().toISOString(); localStorage.setItem(KEY, JSON.stringify(state)); window.dispatchEvent(new Event("studydatachange")); }
  function fa(n){ return String(n).replace(/\d/g,d=>"۰۱۲۳۴۵۶۷۸۹"[d]); }
  function enDigits(v){ return String(v??"").replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d));}
  function parseJalaliInput(v){ const raw=enDigits(v).trim().replace(/[-.]/g,"/"); const m=raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/); if(!m)return null; try{return dateKey(jalaliToGregorian(Number(m[1]),Number(m[2]),Number(m[3])));}catch{return null;} }
  function jalaliInputToday(){ const j=currentJ(); return `${fa(j.jy)}/${fa(String(j.jm).padStart(2,"0"))}/${fa(String(j.jd).padStart(2,"0"))}`; }
  function jalaliDateTimeInput(date){ const j=jalaliParts(date); const hh=String(date.getHours()).padStart(2,"0"), mm=String(date.getMinutes()).padStart(2,"0"); return `${fa(j.jy)}/${fa(String(j.jm).padStart(2,"0"))}/${fa(String(j.jd).padStart(2,"0"))} - ${fa(hh)}:${fa(mm)}`; }
  function parseJalaliDateTimeInput(v){ const raw=enDigits(v).trim().replace(/[T]/g," ").replace(/[-.]/g,"/"); const m=raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s*[-,]?\s*(\d{1,2})(?::(\d{1,2}))?)?$/); if(!m)return null; const h=m[4]===undefined?0:Number(m[4]), min=m[5]===undefined?0:Number(m[5]); if(h>23||min>59)return null; try{ const d=jalaliToGregorian(Number(m[1]),Number(m[2]),Number(m[3])); d.setHours(h,min,0,0); return d; }catch{return null;} }
  function fmtMin(min){ min=Math.max(0,Math.round(min)); const h=Math.floor(min/60),m=min%60; return h?`${fa(h)} ساعت و ${fa(m)} دقیقه`:`${fa(m)} دقیقه`; }
  function fmtClock(sec){sec=Math.max(0,Math.floor(sec));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${fa(String(h).padStart(2,"0"))}:${fa(String(m).padStart(2,"0"))}:${fa(String(s).padStart(2,"0"))}`;}
  function esc(s){return String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
  function dateKey(ts){const d=new Date(ts);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
  function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
  function jalaliParts(date){
    const parts=new Intl.DateTimeFormat("en-u-ca-persian",{year:"numeric",month:"numeric",day:"numeric"}).formatToParts(date);
    const out={};for(const p of parts)if(p.type==="year"||p.type==="month"||p.type==="day")out[p.type]=Number(p.value);return {jy:out.year,jm:out.month,jd:out.day};
  }
  function toJalali(gy,gm,gd){return jalaliParts(new Date(gy,gm-1,gd));}
  function jalaliToGregorian(jy,jm,jd){
    const cacheKey=`${jy}-${jm}-${jd}`;jalaliToGregorian.cache=jalaliToGregorian.cache||new Map();if(jalaliToGregorian.cache.has(cacheKey))return new Date(jalaliToGregorian.cache.get(cacheKey));
    const anchor=new Date();anchor.setHours(12,0,0,0);anchor.setDate(anchor.getDate()-370);
    const end=new Date(anchor);end.setDate(end.getDate()+741);
    for(let d=new Date(anchor);d<=end;d.setDate(d.getDate()+1)){
      const j=jalaliParts(d);if(j.jy===jy&&j.jm===jm&&j.jd===jd){const out=new Date(d);out.setHours(0,0,0,0);jalaliToGregorian.cache.set(cacheKey,out.getTime());return out;}
    }
    throw new Error("تاریخ جلالی پیدا نشد");
  }
  function currentJ(){return jalaliParts(new Date());}
  function jalaliDateKey(jy,jm,jd){return dateKey(jalaliToGregorian(jy,jm,jd));}
  function jalaliMonthStart(jy,jm){return jalaliToGregorian(jy,jm,1);}
  function jalaliYearRange(){
    const j=currentJ();
    // سال آماری از شهریور تا پایان مرداد است. اگر الان فروردین تا مردادیم،
    // سال آماری از شهریور سال قبل شروع می‌شود.
    const baseYear = j.jm >= 6 ? j.jy : j.jy - 1;
    const start = jalaliMonthStart(baseYear, 6);
    const end = jalaliMonthStart(baseYear + 1, 6);
    return {jy:baseYear,from:start,to:end};
  }
  function rangeInfo(){
    const mode=$("statsRange")?.value||"week", now=new Date(); let from,to;
    if(mode==="day"){from=startOfDay(now);to=new Date(from);to.setDate(to.getDate()+1);}
    else if(mode==="month"){from=new Date(now.getFullYear(),now.getMonth(),1);to=new Date(now.getFullYear(),now.getMonth()+1,1);}
    else if(mode==="year"){const r=jalaliYearRange();from=r.from;to=r.to;}
    else {from=startOfDay(now);const day=(from.getDay()+6)%7;from.setDate(from.getDate()-day);to=new Date(from);to.setDate(to.getDate()+7);}
    return {mode,from,to};
  }
  function allExams(){try{return JSON.parse(localStorage.getItem("azmoon_tracker_v1")||"[]")}catch{return[]}}
  function examData(){return allExams().filter(e=>e && e.status==="completed");}
  function metrics(from,to){
    const exams=examData().filter(e=>{const t=new Date(e.endTime||e.startTime||0);return t>=from&&t<to;});
    const tests=exams.reduce((a,e)=>a+(Number(e.questionCount)||e.questionNumbers?.length||0),0);
    const testSec=exams.reduce((a,e)=>a+(Number(e.totalTime)||0),0);
    const correct=exams.reduce((a,e)=>a+(Number(e.correct)||0),0), wrong=exams.reduce((a,e)=>a+(Number(e.wrong)||0),0), blank=exams.reduce((a,e)=>a+(Number(e.blank)||0),0);
    const study=state.sessions.filter(s=>{const t=new Date(s.startTime);return t>=from&&t<to;}).reduce((a,s)=>a+(Number(s.durationMinutes)||0),0);
    return {exams,tests,testSec,correct,wrong,blank,study};
  }
  function aggregateSubjects(from,to){
    const map={};
    examData().filter(e=>{const t=new Date(e.endTime||e.startTime||0);return t>=from&&t<to;}).forEach(e=>{const k=e.subject||"بدون درس";if(!map[k])map[k]={tests:0,time:0,correct:0};map[k].tests+=Number(e.questionCount)||e.questionNumbers?.length||0;map[k].time+=Number(e.totalTime)||0;map[k].correct+=Number(e.correct)||0;});
    state.sessions.filter(s=>{const t=new Date(s.startTime);return t>=from&&t<to;}).forEach(s=>{const k=s.subject||"بدون درس";if(!map[k])map[k]={tests:0,time:0,correct:0};map[k].time+=(Number(s.durationMinutes)||0)*60;});
    return Object.entries(map).sort((a,b)=>(b[1].tests+b[1].time/60)-(a[1].tests+a[1].time/60));
  }
  function aggregateTopics(from,to){
    const map={};
    examData().filter(e=>{const t=new Date(e.endTime||e.startTime||0);return t>=from&&t<to;}).forEach(e=>{const k=e.topic||"بدون مبحث";if(!map[k])map[k]={tests:0,time:0};map[k].tests+=Number(e.questionCount)||e.questionNumbers?.length||0;map[k].time+=Number(e.totalTime)||0;});
    state.sessions.filter(s=>{const t=new Date(s.startTime);return t>=from&&t<to;}).forEach(s=>{const k=s.topic||"بدون مبحث";if(!map[k])map[k]={tests:0,time:0};map[k].time+=(Number(s.durationMinutes)||0)*60;});
    return Object.entries(map).sort((a,b)=>b[1].tests-a[1].tests).slice(0,12);
  }
  function daySeries(from,to){
    const days=[];for(let d=new Date(from);d<to;d.setDate(d.getDate()+1))days.push({key:dateKey(d),label:d.toLocaleDateString("fa-IR",{weekday:"short"}),tests:0,study:0});
    const map=Object.fromEntries(days.map(x=>[x.key,x]));
    examData().forEach(e=>{const t=new Date(e.endTime||e.startTime||0),x=map[dateKey(t)];if(x)x.tests+=Number(e.questionCount)||e.questionNumbers?.length||0;});
    state.sessions.forEach(s=>{const x=map[dateKey(s.startTime)];if(x)x.study+=Number(s.durationMinutes)||0;});return days;
  }
  function bucketSeries(from,to,mode){
    const buckets=[];
    if(mode==="month"){
      const totalDays=Math.round((to-from)/86400000), n=Math.ceil(totalDays/7);
      for(let i=0;i<n;i++){const a=new Date(from);a.setDate(a.getDate()+i*7);const b=new Date(a);b.setDate(b.getDate()+7);if(b>to)b.setTime(to.getTime());buckets.push({from:a,to:b,label:`${fa(i*7+1)}-${fa(Math.min(totalDays,i*7+7))}`,tests:0,study:0});}
    } else {
      const jr=jalaliYearRange(), seq=[6,7,8,9,10,11,12,1,2,3,4,5];
      for(let i=0;i<12;i++){
        const jm=seq[i],jy=jr.jy+(jm<6?1:0),a=jalaliMonthStart(jy,jm);
        const nextJm=seq[i+1];
        const b=i===11?jr.to:jalaliMonthStart(jr.jy+(nextJm<6?1:0),nextJm);
        buckets.push({from:a,to:b,label:JMONTHS[jm-1],tests:0,study:0});
      }
    }
    const ex=examData();ex.forEach(e=>{const t=new Date(e.endTime||e.startTime||0),q=Number(e.questionCount)||e.questionNumbers?.length||0;const b=buckets.find(x=>t>=x.from&&t<x.to);if(b)b.tests+=q;});
    state.sessions.forEach(s=>{const t=new Date(s.startTime),b=buckets.find(x=>t>=x.from&&t<x.to);if(b)b.study+=Number(s.durationMinutes)||0;});
    return buckets;
  }
  function overallPercent(){const ex=examData();let c=0,w=0,b=0;ex.forEach(e=>{c+=Number(e.correct)||0;w+=Number(e.wrong)||0;b+=Number(e.blank)||0});const n=c+w+b;return n?((c*3-w)/(n*3)*100):null;}
  function render(){
    if(!$('studyDashboard'))return;const r=rangeInfo(),m=metrics(r.from,r.to);const jyear=r.mode==='year'?jalaliYearRange().jy:null; $('studyRangeLabel').textContent=r.mode==='day'?'امروز':r.mode==='week'?'این هفته':r.mode==='month'?'این ماه':`شهریور ${fa(jyear)} تا مرداد ${fa(jyear+1)}`;
    $('dashTests').textContent=fa(m.tests);$('dashTestTime').textContent=fmtClock(m.testSec);$('dashStudyTime').textContent=fmtMin(m.study);$('dashPercent').textContent=overallPercent()==null?'—':`${fa(Math.round(overallPercent()))}٪`;
    if(r.mode==='month'||r.mode==='year')renderBars(bucketSeries(r.from,r.to,r.mode));else renderBars(daySeries(r.from,r.to));
    renderSubjects(r.from,r.to);renderTopics(r.from,r.to);renderSessions(r.from,r.to);renderCalendar();renderGoals();renderRecords();renderUpcoming();renderCalendarDetails(selectedCalendarDate);
  }
  function renderBars(rows){
    const maxT=Math.max(1,...rows.map(x=>x.tests)),maxS=Math.max(1,...rows.map(x=>x.study));
    const el=$('trendChart'), count=rows.length;
    const gap=8, preferred=count<=7 ? 58 : count<=12 ? 52 : 48;
    const available=Math.max(280, el.clientWidth || 760);
    const col=Math.max(28, Math.min(preferred, (available - Math.max(0,count-1)*gap) / Math.max(1,count)));
    const chartWidth=Math.max(available, count*col + Math.max(0,count-1)*gap);
    el.style.setProperty('--chart-cols', count);
    el.style.setProperty('--chart-width', `${chartWidth}px`);
    el.innerHTML=rows.map(x=>`<div class="trend-col"><div class="trend-value">${x.tests?fa(x.tests):''}</div><div class="trend-bars"><i class="test-bar" style="height:${Math.max(3,x.tests/maxT*100)}%"></i><i class="study-bar" style="height:${Math.max(3,x.study/maxS*100)}%"></i></div><small title="${esc(x.label)}">${esc(x.label)}</small></div>`).join('');
  }
  function renderSubjects(from,to){const rows=aggregateSubjects(from,to);$('subjectStats').innerHTML=rows.length?rows.slice(0,10).map(([k,v])=>`<div class="stat-row"><div><strong>${esc(k)}</strong><span>${fa(v.tests)} تست · ${fmtMin(v.time/60)} مطالعه</span></div><b>${fa(v.tests)}</b></div>`).join(''):`<div class="empty-inline">هنوز داده‌ای در این بازه ثبت نشده.</div>`;}
  function renderTopics(from,to){const rows=aggregateTopics(from,to);$('topicStats').innerHTML=rows.length?rows.map(([k,v])=>`<div class="stat-row"><div><strong>${esc(k)}</strong><span>${fmtMin(v.time/60)}</span></div><b>${fa(v.tests)} تست</b></div>`).join(''):`<div class="empty-inline">هنوز داده‌ای در این بازه ثبت نشده.</div>`;}
  function renderSessions(from,to){const rows=state.sessions.filter(s=>{const t=new Date(s.startTime);return t>=from&&t<to;}).sort((a,b)=>new Date(b.startTime)-new Date(a.startTime)).slice(0,20);$('sessionList').innerHTML=rows.length?rows.map(s=>`<div class="session-row"><div><strong>${esc(s.subject||'بدون درس')}</strong><span>${esc(s.topic||'بدون مبحث')} · ${new Date(s.startTime).toLocaleDateString('fa-IR')}</span></div><b>${fmtMin(s.durationMinutes)}</b></div>`).join(''):`<div class="empty-inline">مطالعه‌ای در این بازه ثبت نشده.</div>`;}
  function renderGoals(){const today=new Date(),d0=startOfDay(today),d1=new Date(d0);d1.setDate(d1.getDate()+1);const m=metrics(d0,d1),tGoal=state.goal.tests||0,sGoal=state.goal.studyMinutes||0;$('goalTests').textContent=tGoal?`${fa(Math.min(100,Math.round(m.tests/tGoal*100)))}٪`:'—';$('goalStudy').textContent=sGoal?`${fa(Math.min(100,Math.round(m.study/sGoal*100)))}٪`:'—';$('goalTestsCount').textContent=`${fa(m.tests)} از ${fa(tGoal)} تست`;$('goalStudyCount').textContent=`${fa(m.study)} از ${fa(sGoal)} دقیقه`;$('goalTestsBar').style.width=tGoal?`${Math.min(100,m.tests/tGoal*100)}%`:'0%';$('goalStudyBar').style.width=sGoal?`${Math.min(100,m.study/sGoal*100)}%`:'0%';}
  function records(){const ex=examData(),byDay={};ex.forEach(e=>{const k=dateKey(e.endTime||e.startTime);byDay[k]=(byDay[k]||0)+(Number(e.questionCount)||e.questionNumbers?.length||0);});const maxTests=Math.max(0,...Object.values(byDay));const studyByDay={};state.sessions.forEach(s=>{const k=dateKey(s.startTime);studyByDay[k]=(studyByDay[k]||0)+(Number(s.durationMinutes)||0);});const maxStudy=Math.max(0,...Object.values(studyByDay));return {maxTests,maxStudy};}
  function renderRecords(){const r=records();$('recordTests').textContent=fa(r.maxTests);$('recordStudy').textContent=fmtMin(r.maxStudy);}
  function renderUpcoming(){const now=Date.now(),items=state.events.filter(e=>new Date(e.dateTime).getTime()>=now).sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime)).slice(0,6);$('upcomingList').innerHTML=items.length?items.map(e=>`<div class="event-row"><div><strong>${esc(e.title)}</strong><span>${new Date(e.dateTime).toLocaleString('fa-IR',{dateStyle:'medium',timeStyle:'short'})}</span></div><button class="icon-btn small" data-del-event="${esc(e.id)}">×</button></div>`).join(''):`<div class="empty-inline">رویداد آینده‌ای ثبت نشده.</div>`;}
  function calendarItems(k){
    const exams=examData().filter(e=>dateKey(e.endTime||e.startTime)===k);
    const sessions=state.sessions.filter(s=>dateKey(s.startTime)===k);
    const events=state.events.filter(e=>dateKey(e.dateTime)===k).sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime));
    return {exams,sessions,events};
  }
  function jalaliMonthDays(jy,jm){
    if(jm<=6) return 31;
    if(jm<=11) return 30;
    const a=jalaliToGregorian(jy,12,1), b=jalaliToGregorian(jy+1,1,1);
    return Math.round((b-a)/86400000);
  }
  function calendarMonthTitle(jy,jm){ return `${JMONTHS[jm-1]} ${fa(jy)}`; }
  function renderCalendar(){
    const el=$('calendar'), jy=calendarJ.jy, jm=calendarJ.jm, days=jalaliMonthDays(jy,jm);
    const first=jalaliToGregorian(jy,jm,1), offset=(first.getDay()+1)%7;
    let html=`<div class="calendar-toolbar"><button type="button" class="icon-btn calendar-nav" data-cal-nav="prev" aria-label="ماه قبل">‹</button><strong>${calendarMonthTitle(jy,jm)}</strong><button type="button" class="icon-btn calendar-nav" data-cal-nav="next" aria-label="ماه بعد">›</button></div>`;
    ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'].forEach(x=>html+=`<div class="cal-head">${x}</div>`);
    for(let i=0;i<offset;i++) html+='<div class="cal-day empty-day"></div>';
    const todayJ=currentJ();
    for(let d=1;d<=days;d++){ const dt=jalaliToGregorian(jy,jm,d),k=dateKey(dt),it=calendarItems(k),hasTest=it.exams.length>0,hasStudy=it.sessions.length>0,active=hasTest||hasStudy||it.events.length,sel=k===selectedCalendarDate,today=jy===todayJ.jy&&jm===todayJ.jm&&d===todayJ.jd; html+=`<button type="button" class="cal-day ${active?'active':''} ${today?'today':''} ${sel?'selected':''}" data-cal-date="${k}" title="${fa(it.exams.length)} آزمون · ${fmtMin(it.sessions.reduce((a,s)=>a+Number(s.durationMinutes||0),0))} مطالعه · ${fa(it.events.length)} رویداد">${fa(d)}${hasTest?'<i class="test-mark"></i>':''}${hasStudy?'<i class="study-mark"></i>':''}</button>`; }
    el.innerHTML=html;
  }
  function renderCalendarDetails(k){
    const el=$('calendarDetails');if(!el)return;selectedCalendarDate=k;const it=calendarItems(k),d=new Date(`${k}T12:00:00`),jp=jalaliParts(d),weekday=d.toLocaleDateString('fa-IR',{weekday:'long'}),title=`${weekday}، ${fa(jp.jd)} ${JMONTHS[jp.jm-1]} ${fa(jp.jy)}`;
    const blocks=[];
    it.events.forEach(e=>blocks.push(`<div class="cal-detail-row"><span class="cal-kind event">📌</span><div><strong>${esc(e.title)}</strong><small>${new Date(e.dateTime).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})}${e.note?' · '+esc(e.note):''}</small></div><button class="icon-btn small" data-del-event="${esc(e.id)}">×</button></div>`));
    it.exams.forEach(e=>blocks.push(`<div class="cal-detail-row"><span class="cal-kind test">📝</span><div><strong>${esc(e.name||'آزمون')}</strong><small>${esc(e.subject||'')} · ${fa(Number(e.questionCount)||e.questionNumbers?.length||0)} تست</small></div></div>`));
    it.sessions.forEach(s=>blocks.push(`<div class="cal-detail-row"><span class="cal-kind study">📚</span><div><strong>${esc(s.subject||'مطالعه')}</strong><small>${esc(s.topic||'بدون مبحث')} · ${fmtMin(s.durationMinutes)}</small></div></div>`));
    el.innerHTML=`<div class="calendar-detail-head"><div><strong>${title}</strong><span>${blocks.length?`${fa(blocks.length)} مورد ثبت شده`:'برای این روز چیزی ثبت نشده'}</span></div><button class="btn secondary small-btn" id="addEventForDay">＋ افزودن رویداد</button></div>${blocks.length?`<div class="calendar-detail-list">${blocks.join('')}</div>`:'<div class="empty-inline">رویداد، آزمون یا مطالعه‌ای برای این روز ثبت نشده.</div>'}`;
    $('addEventForDay')?.addEventListener('click',()=>openEventDialog(k));
  }
  function openStudy(){render();document.querySelectorAll('.app-view').forEach(v=>v.classList.add('hidden'));$('studyDashboard').classList.remove('hidden');window.scrollTo({top:0,behavior:'instant'});}
  function toast(m){const t=$('toast');if(t){t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2300)}}
  function startStudy(){
    if(studyTimer)return;
    studyStartedAt=Date.now()-studyElapsed*1000;studyTimer=setInterval(()=>{studyElapsed=Math.floor((Date.now()-studyStartedAt)/1000);$('studyTimer').textContent=fmtClock(studyElapsed);},250);
    $('startStudyBtn').classList.add('hidden');$('pauseStudyBtn').classList.remove('hidden');$('finishStudyBtn').classList.remove('hidden');$('studyTimer').textContent=fmtClock(studyElapsed);
  }
  function pauseStudy(){
    if(!studyTimer)return;studyElapsed=Math.floor((Date.now()-studyStartedAt)/1000);clearInterval(studyTimer);studyTimer=null;studyStartedAt=null;
    $('startStudyBtn').classList.remove('hidden');$('pauseStudyBtn').classList.add('hidden');$('finishStudyBtn').classList.remove('hidden');$('studyTimer').textContent=fmtClock(studyElapsed);toast('تایمر متوقف شد؛ زمان تا اینجا حفظ شد.');
  }
  function finishStudy(){
    if(studyTimer){studyElapsed=Math.floor((Date.now()-studyStartedAt)/1000);clearInterval(studyTimer);studyTimer=null;studyStartedAt=null;}
    const sec=studyElapsed;if(sec<10){studyElapsed=0;resetStudyControls();toast('مطالعه خیلی کوتاه بود و ثبت نشد.');return;}
    openSessionDialog(sec/60,true);
  }
  function resetStudyControls(){studyStartedAt=null;studyElapsed=0;$('studyTimer').textContent=fmtClock(0);$('startStudyBtn').classList.remove('hidden');$('pauseStudyBtn').classList.add('hidden');$('finishStudyBtn').classList.add('hidden');}
  function openSessionDialog(minutes=null,fromTimer=false){
    $('sessionDialog').showModal();$('sessionDuration').value=minutes?Math.max(1,Math.round(minutes)):30;$('sessionDate').value=jalaliInputToday();$('sessionSubject').value='';$('sessionTopic').value='';$('sessionNote').value='';$('sessionDialog').dataset.fromTimer=fromTimer?'1':'0';$('sessionDuration').focus();
  }
  function addSession(){
    const mins=Math.max(1,Number($('sessionDuration').value)||0),rawDate=$('sessionDate').value,date=parseJalaliInput(rawDate);if(!date){toast('تاریخ شمسی را به شکل ۱۴۰۵/۰۶/۲۹ وارد کن.');return;}
    const start=new Date(`${date}T12:00:00`),s={id:'study_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),startTime:start.toISOString(),durationMinutes:mins,subject:$('sessionSubject').value.trim(),topic:$('sessionTopic').value.trim(),note:$('sessionNote').value.trim(),source:$('sessionDialog').dataset.fromTimer==='1'?'timer':'manual'};
    state.sessions.push(s);save();$('sessionDialog').close();$('sessionDialog').dataset.fromTimer='0';resetStudyControls();render();toast('زمان مطالعه ثبت شد ✓');
  }
  function cancelSession(){
    const fromTimer=$('sessionDialog').dataset.fromTimer==='1';$('sessionDialog').close();
    if(fromTimer){$('startStudyBtn').classList.remove('hidden');$('pauseStudyBtn').classList.remove('hidden');$('finishStudyBtn').classList.remove('hidden');$('startStudyBtn').textContent='▶ ادامه مطالعه';$('pauseStudyBtn').classList.add('hidden');toast('ثبت لغو شد؛ زمان مطالعه حفظ شد.');}
  }
  function openEventDialog(prefillDate=null){
    $('eventDialog').showModal();$('eventTitle').value='';$('eventNote').value='';
    const base=prefillDate?new Date(`${prefillDate}T09:00:00`):new Date(Date.now()+3600000);$('eventDate').value=jalaliDateTimeInput(base);$('eventTitle').focus();
  }
  function addEvent(){const title=$('eventTitle').value.trim(),rawDate=$('eventDate').value,date=parseJalaliDateTimeInput(rawDate);if(!title||!date){toast('تاریخ را به شکل ۱۴۰۵/۰۶/۲۹ - ۱۸:۳۰ وارد کن.');return;}state.events.push({id:'event_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),title,dateTime:date.toISOString(),note:$('eventNote').value.trim()});save();$('eventDialog').close();selectedCalendarDate=dateKey(date);render();toast('رویداد به تقویم اضافه شد ✓');}
  function editGoals(){const a=prompt('هدف تست روزانه را وارد کن:',state.goal.tests||0);if(a===null)return;const b=prompt('هدف مطالعه روزانه به دقیقه:',state.goal.studyMinutes||0);if(b===null)return;state.goal.tests=Math.max(0,Number(a)||0);state.goal.studyMinutes=Math.max(0,Number(b)||0);save();render();}
  function bind(){
    $('studyNav').addEventListener('click',openStudy);$('historyNav')?.addEventListener('click',()=>{if(typeof window.__azmoonGoHome==='function')window.__azmoonGoHome();else{$('studyDashboard').classList.add('hidden');$('homeView').classList.remove('hidden');}});$('statsRange').addEventListener('change',render);$('startStudyBtn').addEventListener('click',startStudy);$('pauseStudyBtn').addEventListener('click',pauseStudy);$('finishStudyBtn').addEventListener('click',finishStudy);$('manualStudyBtn').addEventListener('click',()=>openSessionDialog());$('addEventBtn').addEventListener('click',()=>openEventDialog());$('editGoalsBtn').addEventListener('click',editGoals);
    $('sessionCancel').addEventListener('click',cancelSession);$('sessionSave').addEventListener('click',addSession);$('eventCancel').addEventListener('click',()=>$('eventDialog').close());$('eventSave').addEventListener('click',addEvent);
    $('upcomingList').addEventListener('click',e=>{const b=e.target.closest('[data-del-event]');if(!b)return;state.events=state.events.filter(x=>x.id!==b.dataset.delEvent);save();render();toast('رویداد حذف شد.');});
    $('calendar').addEventListener('click',e=>{
      const nav=e.target.closest('[data-cal-nav]');
      if(nav){
        const dir=nav.dataset.calNav==='next'?1:-1;
        let jy=calendarJ.jy, jm=calendarJ.jm+dir;
        if(jm>12){jm=1;jy++;}
        if(jm<1){jm=12;jy--;}
        calendarJ={jy,jm,jd:1};
        renderCalendar();
        renderCalendarDetails(selectedCalendarDate);
        return;
      }
      const b=e.target.closest('[data-cal-date]');
      if(!b)return;
      selectedCalendarDate=b.dataset.calDate;
      renderCalendar();
      renderCalendarDetails(selectedCalendarDate);
    });
    $('calendarDetails').addEventListener('click',e=>{const b=e.target.closest('[data-del-event]');if(!b)return;state.events=state.events.filter(x=>x.id!==b.dataset.delEvent);save();render();toast('رویداد حذف شد.');});
    $('studyBackHome').addEventListener('click',()=>{document.querySelectorAll('.app-view').forEach(v=>v.classList.add('hidden'));$('homeView').classList.remove('hidden');if(typeof window.__azmoonRenderHome==='function')window.__azmoonRenderHome();});
    window.addEventListener('storage',()=>{state=load();render();});window.addEventListener('studydatachange',render);
  }
  document.addEventListener('DOMContentLoaded',()=>{bind();render();});
  window.__studyState={get:()=>state,save,render};
})();
