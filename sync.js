(() => {
  "use strict";

  const CONFIG_KEY = "azmoon_supabase_config_v2";
  const SESSION_KEY = "azmoon_supabase_session_v2";
  const SNAPSHOT_KEY = "azmoon_supabase_snapshot_v2";
  const DELETED_KEY = "azmoon_supabase_deleted_v2";
  const DB_KEY = "azmoon_tracker_v1";
  const INCOMPLETE_KEY = "azmoon_tracker_incomplete_v1";
  const INCOMPLETE_DELETED_KEY = "azmoon_tracker_incomplete_deleted_v1";
  const POLL_MS = 3500;

  const $ = id => document.getElementById(id);
  let syncing = false;
  let pollTimer = null;
  let lastLocalFingerprint = null;

  function cfg(){ try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||"null")}catch{return null} }
  function session(){ try{return JSON.parse(localStorage.getItem(SESSION_KEY)||"null")}catch{return null} }
  function saveSession(v){localStorage.setItem(SESSION_KEY,JSON.stringify(v))}
  function clearSession(){localStorage.removeItem(SESSION_KEY)}
  function toast(msg){const t=$("toast");if(t){t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3200)}}
  function status(msg,ok=false,error=false){const el=$("syncStatus");if(el){el.textContent=msg;el.className="sync-status"+(ok?" ok":"")+(error?" error":"")}}
  function readLocal(){let exams=[],incomplete=null,study=null;try{exams=JSON.parse(localStorage.getItem(DB_KEY)||"[]")}catch{}try{incomplete=JSON.parse(localStorage.getItem(INCOMPLETE_KEY)||"null")}catch{}try{study=JSON.parse(localStorage.getItem("azmoon_study_v1")||"null")}catch{} const incompleteDeleted=localStorage.getItem(INCOMPLETE_DELETED_KEY)||null;return{exams:Array.isArray(exams)?exams:[],incomplete,incompleteDeleted,study}}
  function writeLocal(exams,incomplete,study){localStorage.setItem(DB_KEY,JSON.stringify(exams));if(incomplete)localStorage.setItem(INCOMPLETE_KEY,JSON.stringify(incomplete));else localStorage.removeItem(INCOMPLETE_KEY);if(study)localStorage.setItem("azmoon_study_v1",JSON.stringify(study));window.dispatchEvent(new Event("storage"))}
  function fingerprint(data){return JSON.stringify({exams:data.exams,incomplete:data.incomplete,study:data.study})}
  function loadSnapshot(){try{return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)||"null")}catch{return null}}
  function saveSnapshot(data){localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(data));lastLocalFingerprint=fingerprint(data)}
  function loadDeleted(){try{return JSON.parse(localStorage.getItem(DELETED_KEY)||"[]")}catch{return[]}}
  function saveDeleted(v){localStorage.setItem(DELETED_KEY,JSON.stringify(v))}
  function nowIso(){return new Date().toISOString()}
  function ms(v){const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0}
  function later(a,b){return ms(a)>ms(b)}
  function ensureConfig(){const c=cfg();return !!(c&&c.url&&c.key)}

  function normalizeUrl(raw){
    let u=String(raw||"").trim().replace(/\s+/g,"").replace(/\/+$/g,"");
    u=u.replace(/\/rest\/v1$/i,"").replace(/\/auth\/v1$/i,"");
    return u;
  }

  async function api(path,options={}){
    const c=cfg();if(!c)throw new Error("ابتدا Project URL و Publishable Key را ذخیره کن.");
    const headers=Object.assign({apikey:c.key,"Content-Type":"application/json"},options.headers||{});
    const s=session();if(s?.access_token&&!options.skipAuth)headers.Authorization=`Bearer ${s.access_token}`;
    const res=await fetch(c.url+path,Object.assign({},options,{headers}));
    const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch{body=text}
    if(!res.ok){
      const msg=body?.msg||body?.message||body?.error_description||body?.error||body?.details||body?.hint||`HTTP ${res.status}`;
      throw new Error(msg)
    }
    return body;
  }
  async function auth(path,body){return api(path,{method:"POST",body:JSON.stringify(body),skipAuth:true})}

  async function refreshIfNeeded(){
    const s=session();if(!s?.refresh_token)return null;
    if(s.expires_at&&Date.now()<s.expires_at-60000)return s;
    const out=await auth("/auth/v1/token?grant_type=refresh_token",{refresh_token:s.refresh_token});
    const ns={access_token:out.access_token,refresh_token:out.refresh_token||s.refresh_token,expires_at:Date.now()+((out.expires_in||3600)*1000),user:out.user||s.user||null};saveSession(ns);return ns;
  }
  async function getUser(){await refreshIfNeeded();return api("/auth/v1/user")}

  async function signUp(){
    const email=$("syncEmail").value.trim(),password=$("syncPassword").value;
    if(!email||!password)return status("ایمیل و رمز عبور را وارد کن.",false,true);
    if(password.length<6)return status("رمز عبور باید حداقل ۶ کاراکتر باشد.",false,true);
    status("در حال ساخت حساب...");
    try{
      const out=await auth("/auth/v1/signup",{email,password});
      if(out.access_token){saveSession({access_token:out.access_token,refresh_token:out.refresh_token,expires_at:Date.now()+((out.expires_in||3600)*1000),user:out.user||null});updateUI();status("حساب ساخته شد. در حال همگام‌سازی...",true);await syncNow(true)}
      else {status("حساب ساخته شد. ایمیل تأیید Supabase را باز کن، سپس همین‌جا وارد شو.",true);toast("ایمیل تأیید Supabase را بررسی کن.")}
    }catch(e){status("خطا: "+e.message,false,true)}
  }
  async function signIn(){
    const email=$("syncEmail").value.trim(),password=$("syncPassword").value;
    if(!email||!password)return status("ایمیل و رمز عبور را وارد کن.",false,true);
    status("در حال ورود...");
    try{
      const out=await auth("/auth/v1/token?grant_type=password",{email,password});
      saveSession({access_token:out.access_token,refresh_token:out.refresh_token,expires_at:Date.now()+((out.expires_in||3600)*1000),user:out.user||null});updateUI();status("وارد شدی. در حال همگام‌سازی...",true);await syncNow(true)
    }catch(e){status("ورود ناموفق: "+e.message,false,true)}
  }
  function signOut(){clearSession();localStorage.removeItem(SNAPSHOT_KEY);lastLocalFingerprint=null;updateUI();status("از حساب خارج شدی.")}

  async function saveConfig(){
    const rawUrl=$("syncUrl").value, key=$("syncKey").value.trim();
    const url=normalizeUrl(rawUrl);
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))return status("Project URL درست نیست. باید فقط تا ‎.supabase.co باشد، بدون /rest/v1/.",false,true);
    if(!key.startsWith("sb_publishable_")&&!key.startsWith("eyJ"))return status("Publishable Key معتبر نیست. باید با sb_publishable_ شروع شود.",false,true);
    localStorage.setItem(CONFIG_KEY,JSON.stringify({url,key}));$("syncUrl").value=url;
    status("در حال بررسی واقعی اتصال به Supabase... ⟳");
    try{
      // نکته: /rest/v1/ ریشهٔ OpenAPI برای کلید Publishable عمومی قابل استفاده نیست
      // و می‌تواند 403/401 بدهد. برای بررسی خود پروژه و کلید، Auth settings را می‌خوانیم.
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),10000);
      let res;
      try{res=await fetch(url+"/auth/v1/settings",{method:"GET",headers:{apikey:key},signal:controller.signal,cache:"no-store"});}
      finally{clearTimeout(timer)}
      const text=await res.text();
      let body=null;try{body=text?JSON.parse(text):null}catch{}
      if(!res.ok){
        const msg=body?.msg||body?.message||body?.error_description||body?.error||`HTTP ${res.status}`;
        throw new Error(`${msg} (HTTP ${res.status})`);
      }
      status("اتصال Supabase با موفقیت بررسی شد ✓",true);
      toast("اتصال درست است. حالا وارد حساب شو.");
      updateUI();
    }catch(e){
      const msg=e?.name==="AbortError"?"پاسخ Supabase بیشتر از ۱۰ ثانیه طول کشید.":(e?.message||String(e));
      status("اتصال برقرار نشد: "+msg,false,true);
    }
  }

  async function fetchRows(){await refreshIfNeeded();return api("/rest/v1/exams?select=id,user_id,data,updated_at,deleted&order=updated_at.asc",{method:"GET"})}
  async function upsertRows(rows){
    if(!rows.length)return;
    await refreshIfNeeded();

    // PostgREST can reject a bulk JSON array with
    // "All object keys must match" when one row has a different shape.
    // Normalize every row to the exact exams table shape and send rows
    // one-by-one. This is a little slower, but much more reliable for
    // a small personal dataset and avoids losing the whole sync.
    const cleanRows = rows.map(r => ({
      id: String(r.id),
      user_id: String(r.user_id),
      data: (r.data && typeof r.data === "object") ? r.data : {},
      updated_at: r.updated_at || nowIso(),
      deleted: !!r.deleted
    }));

    for(const row of cleanRows){
      await api("/rest/v1/exams?on_conflict=id,user_id",{
        method:"POST",
        headers:{
          Prefer:"resolution=merge-duplicates,return=minimal"
        },
        body:JSON.stringify(row)
      });
    }
  }

  function stampLocalChanges(data,snapshot){
    const stamp=nowIso();
    const oldMap=new Map((snapshot?.exams||[]).map(e=>[e.id,JSON.stringify(e)]));
    data.exams.forEach(e=>{
      if(!e._syncUpdatedAt){e._syncUpdatedAt=snapshot?stamp:null}
      if(snapshot&&oldMap.get(e.id)!==JSON.stringify(e))e._syncUpdatedAt=stamp;
    });
    if(snapshot){
      const oldIds=new Set((snapshot.exams||[]).map(e=>e.id));
      const curIds=new Set(data.exams.map(e=>e.id));
      const deleted=loadDeleted();
      (snapshot.exams||[]).forEach(e=>{if(e?.id&&!curIds.has(e.id)&&!deleted.some(d=>d.id===e.id)){deleted.push({id:e.id,updated_at:stamp})}});
      saveDeleted(deleted);
      if(snapshot.incomplete&&fingerprint({exams:[],incomplete:snapshot.incomplete})!==fingerprint({exams:[],incomplete:data.incomplete})){if(data.incomplete)data.incomplete._syncUpdatedAt=stamp}
      if(!snapshot.incomplete&&data.incomplete)data.incomplete._syncUpdatedAt=stamp;
    }
  }

  async function syncNow(force=false){
    if(syncing)return;if(!ensureConfig())return openSyncDialog();if(!session()?.access_token){updateUI();return toast("اول وارد حساب Supabase شو.")}
    syncing=true;status("در حال همگام‌سازی... ⟳");
    try{
      await refreshIfNeeded();
      let data=readLocal();
      const syncStartFingerprint = fingerprint(data);
      let snapshot=loadSnapshot();
      stampLocalChanges(data,snapshot);
      const user=session()?.user?.id?session().user:await getUser();
      if(!session()?.user?.id){const ss=session();ss.user=user;saveSession(ss)}
      const serverRows=await fetchRows();
      // Legacy bad rows may exist in Supabase with an empty data object.
      // They are not real exams and must never be merged into local history.
      const badServerRows = serverRows.filter(r =>
        !["__study__","__incomplete__"].includes(r.id) &&
        !r.deleted &&
        !(r.data && typeof r.data === "object" && typeof r.data.id === "string" &&
          r.data.id === r.id && typeof r.data.name === "string" && r.data.name.trim())
      );
      const server= new Map(serverRows.filter(r => !badServerRows.includes(r)).map(r=>[r.id,r]));
      const deleted=loadDeleted();
      const localMap=new Map(data.exams.map(e=>[e.id,e]));
      const merged=[];const upload=[];const newDeleted=[];let changed=false;
      // Queue invalid legacy server rows for deletion after upload is initialized.
      // This avoids the temporal-dead-zone error from referencing `upload` early.
      for (const bad of badServerRows) {
        upload.push({id:String(bad.id),user_id:user.id,data:{},updated_at:nowIso(),deleted:true});
      }

      const ids=new Set([...localMap.keys(),...server.keys(),...deleted.map(d=>d.id)]);
      for(const id of ids){
        if(id==="__incomplete__")continue;
        const l=localMap.get(id), r=server.get(id), d=deleted.find(x=>x.id===id);
        const localTime=l?l._syncUpdatedAt:null;
        const delTime=d?.updated_at||null;
        const serverTime=r?.updated_at||null;
        if(d && (!r || later(delTime,serverTime))){
          newDeleted.push(d);upload.push({id,user_id:user.id,data:{},updated_at:d.updated_at,deleted:true});
          continue;
        }
        if(r?.deleted && (!l || later(serverTime,localTime))){
          newDeleted.push({id,updated_at:serverTime});changed=true;continue;
        }
        if(!r && l){
          const t=localTime||nowIso();l._syncUpdatedAt=t;merged.push(l);upload.push({id,user_id:user.id,data:l,updated_at:t,deleted:false});continue;
        }
        if(r&&!l){if(!r.deleted){merged.push(Object.assign({},r.data,{_syncUpdatedAt:r.updated_at}));changed=true}continue;
        }
        if(l&&r){
          if(localTime&&later(localTime,serverTime)){merged.push(l);upload.push({id,user_id:user.id,data:l,updated_at:localTime,deleted:false})}
          else {merged.push(Object.assign({},r.data,{_syncUpdatedAt:r.updated_at}));if(JSON.stringify(l)!==JSON.stringify(r.data))changed=true}
        }
      }

      const localStudy=data.study, serverStudy=server.get("__study__");
      if(localStudy && (!serverStudy || later(localStudy.updatedAt,serverStudy.updated_at))){
        upload.push({id:"__study__",user_id:user.id,data:localStudy,updated_at:localStudy.updatedAt||nowIso(),deleted:false});
      } else if(serverStudy?.data && (!localStudy || later(serverStudy.updated_at,localStudy.updatedAt))){
        data.study=serverStudy.data; changed=true;
      }

      const localInc=data.incomplete, serverInc=server.get("__incomplete__");
      const incompleteDeleted=data.incompleteDeleted;
      if(incompleteDeleted && (!serverInc || later(incompleteDeleted,serverInc.updated_at))){
        upload.push({id:"__incomplete__",user_id:user.id,data:{},updated_at:incompleteDeleted,deleted:true});
        data.incomplete=null;
        localStorage.removeItem(INCOMPLETE_DELETED_KEY);
      } else if(serverInc?.deleted){
        if(localInc && later(serverInc.updated_at,localInc._syncUpdatedAt)){data.incomplete=null;changed=true}
        localStorage.removeItem(INCOMPLETE_DELETED_KEY);
      } else if(localInc&&localInc._syncUpdatedAt&&(!serverInc||later(localInc._syncUpdatedAt,serverInc.updated_at))){
        upload.push({id:"__incomplete__",user_id:user.id,data:localInc,updated_at:localInc._syncUpdatedAt,deleted:false})
      } else if(serverInc?.data&&(!localInc||later(serverInc.updated_at,localInc._syncUpdatedAt))){
        data.incomplete=Object.assign({},serverInc.data,{_syncUpdatedAt:serverInc.updated_at});
        changed=true
      }

      if(upload.length)await upsertRows(upload);

      // اگر هنگام همگام‌سازی کاربر آزمون را تمام کرده باشد، نسخهٔ محلی
      // جدیدتر از داده‌ای است که ابتدای sync خوانده‌ایم. در این حالت نباید
      // دادهٔ قدیمی را روی localStorage بنویسیم و آزمون تازه‌ثبت‌شده را ناپدید کنیم.
      const currentLocalFingerprint = fingerprint(readLocal());
      const localChangedDuringSync = currentLocalFingerprint !== syncStartFingerprint;

      data.exams=merged;
      saveDeleted(newDeleted);
      if(!localChangedDuringSync){
        writeLocal(data.exams,data.incomplete,data.study);
        saveSnapshot({exams:data.exams,incomplete:data.incomplete});
        renderHomeIfAvailable();
        status("همگام‌سازی با موفقیت انجام شد ✓",true);
      }else{
        // تغییر جدید محلی را نگه می‌داریم؛ poll بعدی آن را با سرور sync می‌کند.
        lastLocalFingerprint = null;
        status("همگام‌سازی انجام شد؛ تغییر جدید شما هم حفظ شد ✓",true);
      }
      if(force)toast("همگام‌سازی انجام شد.");
    }catch(e){
      console.error(e);
      const m=String(e?.message||e);
      if(/401|403|permission|row-level|RLS|denied/i.test(m)){
        status("اتصال و ورود درست است، اما دسترسی جدول exams کامل نیست. در Supabase SQL Editor این دستور را اجرا کن: GRANT SELECT, INSERT, UPDATE, DELETE ON public.exams TO authenticated;",false,true);
      }else if(/Email not confirmed|email.*confirm/i.test(m)){
        status("ایمیل حساب تأیید نشده است. ایمیل تأیید Supabase را باز کن و بعد دوباره وارد شو.",false,true);
      }else{
        status("همگام‌سازی ناموفق: "+m,false,true);
      }
    }finally{syncing=false}
  }

  function renderHomeIfAvailable(){try{if(typeof window.__azmoonRenderHome==="function")window.__azmoonRenderHome()}catch{}}
  function updateUI(){const c=cfg(),s=session();if($("syncUrl"))$("syncUrl").value=c?.url||"";if($("syncKey"))$("syncKey").value=c?.key||"";const logged=!!s?.access_token;$("syncAuthBox")?.classList.toggle("hidden",logged);$("syncLoggedBox")?.classList.toggle("hidden",!logged);if($("syncUserEmail"))$("syncUserEmail").textContent=s?.user?.email||"حساب متصل";if($("syncButton"))$("syncButton").textContent=logged?"☁️ همگام‌سازی":"☁️ اتصال و همگام‌سازی"}
  function openSyncDialog(){updateUI();$("syncDialog")?.showModal()}

  function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(async()=>{if(!session()?.access_token||syncing)return;const data=readLocal(),fp=fingerprint(data);if(lastLocalFingerprint===null){const snap=loadSnapshot();lastLocalFingerprint=snap?fingerprint(snap):fp}if(fp!==lastLocalFingerprint)await syncNow(false)},POLL_MS)}

  document.addEventListener("DOMContentLoaded",()=>{
    const dialog=document.createElement("dialog");dialog.id="syncDialog";dialog.innerHTML=`<div class="dialog-content sync-dialog-content"><div class="section-head compact"><div><h3>☁️ همگام‌سازی ابری</h3><p class="muted">ویندوز و اندروید را به یک حساب Supabase وصل کن.</p></div><button class="icon-btn" id="syncClose">×</button></div><label class="field"><span>Project URL</span><input id="syncUrl" dir="ltr" placeholder="https://xxxxx.supabase.co"></label><label class="field"><span>Publishable Key</span><input id="syncKey" dir="ltr" placeholder="sb_publishable_..."></label><button class="btn secondary full" id="syncSaveConfig">ذخیره و بررسی اتصال</button><div id="syncStatus" class="sync-status">اطلاعات اتصال را وارد کن.</div><div id="syncAuthBox"><div class="sync-divider"></div><label class="field"><span>ایمیل</span><input id="syncEmail" type="email" dir="ltr" autocomplete="email"></label><label class="field"><span>رمز عبور</span><input id="syncPassword" type="password" dir="ltr" autocomplete="current-password"></label><div class="row gap"><button class="btn secondary grow" id="syncSignUp">ساخت حساب</button><button class="btn primary grow" id="syncSignIn">ورود</button></div><p class="hint">اگر تأیید ایمیل روشن باشد، بعد از ساخت حساب ایمیل تأیید Supabase را باز کن.</p></div><div id="syncLoggedBox" class="hidden"><div class="sync-user"><span>حساب متصل:</span><strong id="syncUserEmail"></strong></div><div class="row gap"><button class="btn primary grow" id="syncNow">همگام‌سازی الان</button><button class="btn ghost" id="syncSignOut">خروج</button></div></div></div>`;
    document.body.appendChild(dialog);$("syncButton")?.addEventListener("click",openSyncDialog);$("syncClose").addEventListener("click",()=>dialog.close());$("syncSaveConfig").addEventListener("click",saveConfig);$("syncSignUp").addEventListener("click",signUp);$("syncSignIn").addEventListener("click",signIn);$("syncNow").addEventListener("click",()=>syncNow(true));$("syncSignOut").addEventListener("click",signOut);updateUI();startPolling();if(session()?.access_token&&ensureConfig())setTimeout(()=>syncNow(false),900);
  });
})();
