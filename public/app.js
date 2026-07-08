/* ============ סדר דין פלילי — לוגיקת האפליקציה ============ */
(function(){
"use strict";
const $ = s => document.querySelector(s);
const el = (tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;};
const SYNCED_KEYS = ["cardsSeen","quizStats","chaptersOpened","lasttab","topicStats","openGrades"];
let syncTimer=null;
function scheduleSync(){
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>{
    fetch("/api/progress/me",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        cardsSeen: store.get("cardsSeen",[]),
        quizStats: store.get("quizStats",{answered:0,correct:0}),
        chaptersOpened: store.get("chaptersOpened",[]),
        topicStats: store.get("topicStats",{}),
        openGrades: store.get("openGrades",{}),
        lastTab: store.get("lasttab","home")
      })
    }).catch(()=>{});
  },600);
}
const store = {
  get(k,d){try{return JSON.parse(localStorage.getItem('sdp_'+k))??d;}catch(e){return d;}},
  set(k,v){try{localStorage.setItem('sdp_'+k,JSON.stringify(v));}catch(e){}
    if(SYNCED_KEYS.includes(k))scheduleSync();}
};
async function hydrateFromServer(){
  try{
    const res=await fetch("/api/progress/me");
    if(!res.ok)return;
    const p=await res.json();
    store.set("cardsSeen",p.cardsSeen||[]);
    store.set("quizStats",p.quizStats||{answered:0,correct:0});
    store.set("chaptersOpened",p.chaptersOpened||[]);
    store.set("topicStats",p.topicStats||{});
    store.set("openGrades",p.openGrades||{});
    store.set("timeSpentSec",p.timeSpentSec||0);
  }catch(e){}
}

/* ---- Per-topic performance tracking ---- */
function recordMcqAnswer(topic, isCorrect){
  topic = topic || "כללי";
  const stats = store.get("topicStats",{});
  const cur = stats[topic] || {answered:0,correct:0};
  cur.answered++; if(isCorrect)cur.correct++;
  stats[topic] = cur;
  store.set("topicStats",stats);
}
// score: 1 = ידעתי טוב, 0.5 = חלקית, 0 = לא ידעתי (for mcq: 1 = נכון, 0 = טעות)
function recordOpenGrade(gradeKey, topics, score, extra){
  const grades = store.get("openGrades",{});
  const prev = grades[gradeKey];
  grades[gradeKey] = Object.assign({score, ts: Date.now()}, extra||{});
  store.set("openGrades",grades);
  const stats = store.get("topicStats",{});
  (topics||["כללי"]).forEach(topic=>{
    const cur = stats[topic] || {answered:0,correct:0};
    if(prev){ // undo previous grade's contribution before re-applying
      cur.answered--; cur.correct-=prev.score;
    }
    cur.answered++; cur.correct+=score;
    stats[topic]=cur;
  });
  store.set("topicStats",stats);
}
function topicsFromSim(sim){
  // cap tags per question so grading one open question doesn't fan out across every topic the whole sim touches
  return (sim.topics||"").split("·").map(s=>s.trim()).filter(Boolean).slice(0,5);
}
// Suggested grade for one simulation from this user's own MCQ answers + self-graded open questions.
function simProgress(sim){
  const grades=store.get("openGrades",{});
  const openTotal=sim.questions.length, mcqTotal=(sim.mcq||[]).length;
  const total=openTotal+mcqTotal;
  let answered=0, scoreSum=0;
  for(let i=0;i<openTotal;i++){
    const g=grades[`${sim.id}:q${i}`];
    if(g && typeof g.score==="number"){answered++; scoreSum+=g.score;}
  }
  for(let i=0;i<mcqTotal;i++){
    const g=grades[`${sim.id}:m${i}`];
    if(g && typeof g.score==="number"){answered++; scoreSum+=g.score;}
  }
  const pct=answered?Math.round(scoreSum/answered*100):null;
  return {answered, total, pct};
}
/* ---- Practice-time heartbeat: while the tab is visible, ping the server every 30s ---- */
function setupTimeTracking(){
  const HEARTBEAT_MS = 30000;
  let timer=null;
  function tick(){
    if(document.visibilityState!=="visible")return;
    fetch("/api/progress/heartbeat",{method:"POST"})
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(d && typeof d.timeSpentSec==="number") store.set("timeSpentSec",d.timeSpentSec); })
      .catch(()=>{});
  }
  function start(){ if(timer)return; timer=setInterval(tick,HEARTBEAT_MS); }
  function stop(){ clearInterval(timer); timer=null; }
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible")start(); else stop();
  });
  if(document.visibilityState==="visible")start();
}
function fmtDuration(sec){
  sec=sec||0;
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60);
  if(h)return `${h} שעות ו-${m} דק'`;
  if(m)return `${m} דקות`;
  return "פחות מדקה";
}
// Fisher-Yates: returns an array of original indices in a random display order,
// so options are re-scrambled every time a quiz/sim is (re)rendered.
function shuffleIdx(n){
  const idx=[...Array(n).keys()];
  for(let i=idx.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [idx[i],idx[j]]=[idx[j],idx[i]];
  }
  return idx;
}

async function loadUserBar(){
  try{
    const res=await fetch("/api/auth/me");
    if(!res.ok)return;
    const {user}=await res.json();
    const bar=$("#userBar");
    if(bar){
      bar.innerHTML=`<span>שלום, <b style="color:var(--navy)">${user.first_name}</b></span>
        ${user.is_admin?'<a href="/admin.html" style="color:var(--blue);font-weight:700;text-decoration:none">⚙️ ניהול</a>':''}
        <button id="logoutBtn" style="background:none;border:1.5px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;font-family:Heebo;color:var(--muted);font-weight:600">התנתקות</button>`;
      const lb=$("#logoutBtn");
      if(lb)lb.onclick=async()=>{await fetch("/api/auth/logout",{method:"POST"});window.location.href="/login.html";};
    }
  }catch(e){}
}

/* ---- Easter egg: type אסף אלוני / קונובסקי / נטשה anywhere to see the exclusionary rule in action ---- */
function setupEasterEgg(){
  const triggers=["אסף אלוני","קונובסקי","נטשה"];
  const maxLen=Math.max(...triggers.map(t=>t.length));
  let buf="", cooldown=false;
  const style=document.createElement("style");
  style.textContent=`
    @keyframes eggFall{0%{transform:translateY(-10vh) rotate(0deg);opacity:0}10%{opacity:1}100%{transform:translateY(110vh) rotate(360deg);opacity:.9}}
    @keyframes eggStamp{0%{transform:translate(-50%,-50%) scale(2.4) rotate(-14deg);opacity:0}60%{transform:translate(-50%,-50%) scale(1) rotate(-6deg);opacity:1}100%{transform:translate(-50%,-50%) scale(1) rotate(-6deg);opacity:1}}
    .egg-overlay{position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden}
    .egg-drop{position:absolute;top:0;font-size:1.8rem;animation:eggFall linear forwards}
    .egg-msg{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;
      background:#fff;border:3px solid var(--stamp);color:var(--stamp);font-family:'Frank Ruhl Libre',serif;
      font-weight:900;font-size:1.3rem;padding:18px 26px;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.35);
      animation:eggStamp .5s ease forwards;text-align:center;pointer-events:none}
  `;
  document.head.appendChild(style);

  function fire(){
    if(cooldown)return;
    cooldown=true;
    const overlay=document.createElement("div"); overlay.className="egg-overlay";
    document.body.appendChild(overlay);
    const icons=["🔨","⚖️","🥊","📜"];
    for(let i=0;i<28;i++){
      const d=document.createElement("div"); d.className="egg-drop";
      d.textContent=icons[Math.floor(Math.random()*icons.length)];
      d.style.left=Math.random()*100+"vw";
      d.style.animationDuration=(2+Math.random()*1.6)+"s";
      d.style.animationDelay=(Math.random()*0.8)+"s";
      overlay.appendChild(d);
    }
    const msg=document.createElement("div"); msg.className="egg-msg";
    msg.innerHTML=`פסול קבילות! 🔨<br><span style="font-size:.85rem;font-weight:600;color:var(--ink)">כמו בהלכת יששכרוב — גם הבחינה הזו תיפסל... מלהיות בעיה בשבילך.<br>בהצלחה, אסף מאמין בך 💛<br>יאללה חברים עוד שני מבחנים וסיימנו אינעל העולם</span>`;
    document.body.appendChild(msg);
    setTimeout(()=>{overlay.remove();msg.remove();},9000);
    setTimeout(()=>{cooldown=false;},11000);
  }

  document.addEventListener("keydown",(e)=>{
    if(e.key && e.key.length===1){
      buf=(buf+e.key).slice(-maxLen);
      if(triggers.some(t=>buf.endsWith(t)))fire();
    }
  });
}

/* ---- Tabs ---- */
const TABS = [
  {id:"home",   label:"בית",              icon:"🏠"},
  {id:"study",  label:"חומר הלימוד",       icon:"📚"},
  {id:"cases",  label:"מאגר פסיקה",        icon:"⚖️"},
  {id:"flows",  label:"מודלים ותרשימים",   icon:"🧭"},
  {id:"cards",  label:"כרטיסיות",          icon:"🃏"},
  {id:"quiz",   label:"מבחן אמריקאי",      icon:"✅"},
  {id:"sim",    label:"סימולציות",         icon:"📝"},
  {id:"performance", label:"הביצועים שלי", icon:"📊"},
  {id:"exam",   label:"פרטי הבחינה",       icon:"📋"},
  {id:"podcasts", label:"פודקאסטים",       icon:"🎧"},
  {id:"leaderboard", label:"לוח מובילים",  icon:"🏆"}
];
const PODCASTS = [
  {file:"exam-crack-tamir-reifman-zguri.m4a", title:"פיצוח בחינת הסד\"פ של טמיר ורייפמן זגורי", desc:"ניתוח מעמיק של סגנון השאלות והציפיות של המרצה ועו\"ד זגורי בבחינה."},
  {file:"exam-crack-michal-tamir.m4a", title:"פיצוח המבחן של מיכל טמיר בסד\"פ", desc:"פירוק שיטתי של מבנה המבחן ואיך לגשת לכל חלק בו."},
  {file:"winning-strategy-exam.m4a", title:"אסטרטגיה מנצחת למבחן בסדר דין פלילי", desc:"טיפים אסטרטגיים לניהול הזמן וסדר הכתיבה בבחינה."},
  {file:"suspects-rights-vs-evidence.m4a", title:"מתי זכויות חשודים גוברות על הראיות", desc:"דיון על האיזון בין זכויות הנחקר לבין קבילות הראיות שהושגו."},
  {file:"internal-logic-arrest-law.m4a", title:"ההיגיון הפנימי של דיני המעצרים בישראל", desc:"הרציונל שמאחורי מדרג המעצרים והביקורת השיפוטית עליו."}
];
let current = "home";

function buildNav(){
  const nav = $("#nav"); nav.innerHTML="";
  TABS.forEach(t=>{
    const b = el("button",t.id===current?"on":"",(t.icon?t.icon+" ":"")+t.label);
    b.onclick=()=>go(t.id);
    nav.appendChild(b);
  });
  const mt=$("#mainTitle"); if(mt){const c=TABS.find(t=>t.id===current);mt.textContent=c?c.label:"";}
}
function go(id){
  current=id;
  buildNav();
  render();
  window.scrollTo({top:0,behavior:"smooth"});
  store.set("lasttab",id);
}
function render(){
  const app=$("#app"); app.innerHTML="";
  ({home:renderHome,study:renderStudy,cases:renderCases,flows:renderFlows,
    cards:renderCards,quiz:renderQuiz,sim:renderSim,exam:renderExam,
    podcasts:renderPodcasts,leaderboard:renderLeaderboard,performance:renderPerformance})[current]();
}

/* ================= HOME ================= */
function renderHome(){
  const app=$("#app");
  const hero=el("div","hero");
  hero.innerHTML=`<span class="stamp">הסיכום האישי של אסף אלוני</span>
    <h2 style="margin-top:12px">כל מה שצריך כדי לעבור את סדר הדין הפלילי — במקום אחד</h2>
    <p class="lead">האפליקציה מבוססת על הסיכומים האישיים שלי להרצאות ולתרגולים של פרופ' טמיר ועו"ד זגורי, על 12 בחינות לדוגמה עם הפתרונות הרשמיים, ועל "מיני-הקייסים". כוללת חומר לימוד מלא, מאגר פסיקה מתויג, מודלים ויזואליים לפתרון קייסים, כרטיסיות, מבחנים אמריקאיים אינטראקטיביים, וסימולציות בחינה מלאות עם תשובות מודל.</p>
    <p class="lead" style="margin-top:-8px;font-size:.82rem">© אסף אלוני · כל הזכויות שמורות · לשימוש אישי בלבד, אינו מסמך רשמי</p>`;
  app.appendChild(hero);

  const prog = store.get("cardsSeen",[]).length;
  const quizStats = store.get("quizStats",{answered:0,correct:0});
  const stats=el("div","grid grid3");
  stats.style.marginBottom="16px";
  stats.innerHTML=`
    <div class="stat"><div class="n">${DATA.chapters.length}</div><div class="l">פרקי לימוד</div></div>
    <div class="stat"><div class="n">${DATA.cases.length}</div><div class="l">פסקי דין במאגר</div></div>
    <div class="stat"><div class="n">${DATA.sims.length}</div><div class="l">סימולציות בחינה</div></div>`;
  app.appendChild(stats);

  const tilesWrap=el("div","grid grid2");
  const tiles=[
    {id:"study",i:"📚",t:"חומר הלימוד",d:"12 פרקים — מהמבוא התיאורטי ועד נוכחות נאשם"},
    {id:"cases",i:"⚖️",t:"מאגר פסיקה",d:`${DATA.cases.length} פסקי דין עם חיפוש וסינון לפי נושא`},
    {id:"flows",i:"🧭",t:"מודלים ותרשימים",d:"8 תרשימי זרימה לפתרון קייסים שיטתי"},
    {id:"cards",i:"🃏",t:"כרטיסיות",d:`${DATA.flashcards.length} כרטיסי חזרה מהירה`},
    {id:"quiz",i:"✅",t:"מבחן אמריקאי",d:`${DATA.mcq.length} שאלות עם ניקוד ומעקב`},
    {id:"sim",i:"📝",t:"סימולציות בחינה",d:"בחינות אמיתיות עם פתרונות מודל"},
  ];
  tiles.forEach(x=>{
    const c=el("div","tile");
    c.innerHTML=`<div class="ti">${x.i}</div><div class="tt">${x.t}</div><div class="td">${x.d}</div>`;
    c.onclick=()=>go(x.id);
    tilesWrap.appendChild(c);
  });
  app.appendChild(tilesWrap);

  const tip=el("div","note");
  tip.style.marginTop="16px";
  tip.innerHTML=`<b>💡 עצת המרצה:</b> "למדו כאילו הספרים סגורים — תוצאות טובות יותר. בקריאה ראשונה של קייס אל תכתבו כלום, רק סמנו במרקר; רק אחרי שקראתם הכל — התחילו לכתוב בסדר כרונולוגי."`;
  app.appendChild(tip);

  const timeSpentSec = store.get("timeSpentSec",0);
  const chaptersOpened = store.get("chaptersOpened",[]).length;
  const myStats=el("div","grid grid3");
  myStats.style.marginTop="16px";
  myStats.innerHTML=`
    <div class="stat"><div class="n">${fmtDuration(timeSpentSec)}</div><div class="l">זמן תרגול כולל</div></div>
    <div class="stat"><div class="n">${quizStats.answered}</div><div class="l">שאלות אמריקאיות שנענו</div></div>
    <div class="stat"><div class="n">${quizStats.answered?Math.round(quizStats.correct/quizStats.answered*100)+'%':'—'}</div><div class="l">אחוז הצלחה (${quizStats.correct} נכונות)</div></div>`;
  app.appendChild(el("h3",null,"הנתונים האישיים שלך"));
  app.appendChild(myStats);

  if(quizStats.answered>0 || prog>0){
    const qs=el("div","exam");
    qs.style.marginTop="8px";
    qs.innerHTML=`<b>ההתקדמות שלך:</b> ראית ${prog} כרטיסיות, פתחת ${chaptersOpened} פרקי לימוד, ותרגלת ${fmtDuration(timeSpentSec)} סה"כ. המשיכו כך!`;
    app.appendChild(qs);
  }
}

/* ================= STUDY ================= */
function renderStudy(){
  const app=$("#app");
  app.appendChild(el("h2",null,"חומר הלימוד — 12 פרקים"));
  app.appendChild(el("p","lead","הקישו על פרק כדי לפתוח. כל הפרקים מבוססים על הסיכום המאוחד לבחינה. מסגרות ✅ מציינות נקודות מפתח לבחינה."));
  // search inside study
  const sb=el("div","searchbar");
  sb.innerHTML=`<input type="text" id="studySearch" placeholder="חיפוש בכל חומר הלימוד (למשל: הצהרת תובע, יששכרוב, 149)...">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  app.appendChild(sb);
  const results=el("div"); results.id="studyResults"; app.appendChild(results);

  const wrap=el("div"); wrap.id="studyChapters";
  DATA.chapters.forEach((ch,i)=>{
    const d=el("details");
    if(i===0)d.open=false;
    d.innerHTML=`<summary><span class="secmark">${ch.n}</span><span>${ch.icon} ${ch.title}</span><span class="arw">▼</span></summary>
      <div class="dcontent">${ch.body}</div>`;
    d.addEventListener("toggle",()=>{
      if(!d.open)return;
      const opened=store.get("chaptersOpened",[]);
      if(!opened.includes(i)){opened.push(i);store.set("chaptersOpened",opened);}
    });
    wrap.appendChild(d);
  });
  app.appendChild(wrap);

  $("#studySearch").addEventListener("input",e=>{
    const q=e.target.value.trim();
    const rs=$("#studyResults"), wc=$("#studyChapters");
    if(q.length<2){rs.innerHTML="";wc.style.display="";return;}
    wc.style.display="none";
    const low=q.toLowerCase();
    const hits=[];
    DATA.chapters.forEach(ch=>{
      const plain=ch.body.replace(/<[^>]+>/g," ");
      if(plain.toLowerCase().includes(low)||ch.title.toLowerCase().includes(low)){
        // pull snippets
        const idx=plain.toLowerCase().indexOf(low);
        let snip="";
        if(idx>=0){snip=plain.slice(Math.max(0,idx-60),idx+120).replace(/\s+/g," ");
          const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),"gi");
          snip=snip.replace(re,m=>`<mark>${m}</mark>`);}
        hits.push({ch,snip});
      }
    });
    if(!hits.length){rs.innerHTML=`<div class="card">לא נמצאו תוצאות עבור "<b>${q}</b>". נסו מונח אחר.</div>`;return;}
    rs.innerHTML=`<p class="lead">${hits.length} פרקים תואמים:</p>`;
    hits.forEach(h=>{
      const c=el("div","card");
      c.innerHTML=`<div class="tt" style="font-weight:800;color:var(--navy);cursor:pointer">${h.ch.icon} פרק ${h.ch.n}: ${h.ch.title}</div>
        <div style="color:var(--muted);font-size:.9rem;margin-top:6px">…${h.snip}…</div>`;
      c.querySelector('.tt').onclick=()=>{e.target.value="";rs.innerHTML="";wc.style.display="";
        const d=wc.querySelectorAll("details")[DATA.chapters.indexOf(h.ch)];d.open=true;d.scrollIntoView({behavior:"smooth"});};
      rs.appendChild(c);
    });
  });
}

/* ================= CASES ================= */
function renderCases(){
  const app=$("#app");
  app.appendChild(el("h2",null,"מאגר הפסיקה"));
  app.appendChild(el("p","lead",`${DATA.cases.length} פסקי דין. ⭐ = פסיקת חובה בעדיפות גבוהה. חפשו לפי שם, ציטוט או הלכה, או סננו לפי נושא.`));
  const sb=el("div","searchbar");
  sb.innerHTML=`<input type="text" id="caseSearch" placeholder="חיפוש: יששכרוב, זאדה, מדובב, הצהרת תובע...">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  app.appendChild(sb);
  const topics=[...new Set(DATA.cases.map(c=>c.t))];
  const chips=el("div","chips");
  const allc=el("div","chip on","הכל"); allc.dataset.t="";chips.appendChild(allc);
  topics.forEach(t=>{const c=el("div","chip",t);c.dataset.t=t;chips.appendChild(c);});
  app.appendChild(chips);
  const list=el("div"); list.id="caseList"; app.appendChild(list);

  let filterT="", filterQ="";
  function draw(){
    const list=$("#caseList");
    const items=DATA.cases.filter(c=>{
      if(filterT && c.t!==filterT)return false;
      if(filterQ){const s=(c.n+" "+c.c+" "+c.t+" "+c.h).toLowerCase();if(!s.includes(filterQ.toLowerCase()))return false;}
      return true;
    }).sort((a,b)=>b.pri-a.pri);
    list.innerHTML="";
    if(!items.length){list.innerHTML=`<div class="card">לא נמצאו פסקי דין תואמים.</div>`;return;}
    items.forEach(c=>{
      const d=el("div","case"+(c.pri?" pri":""));
      d.innerHTML=`<div class="cn">${c.pri?"⭐ ":""}${c.n}${c.c?` <span style="font-weight:400;font-size:.8rem;color:var(--muted)">${c.c}</span>`:""}</div>
        <div class="ch">${c.h}</div>
        <span class="ctag">${c.t}</span>`;
      list.appendChild(d);
    });
  }
  draw();
  $("#caseSearch").addEventListener("input",e=>{filterQ=e.target.value.trim();draw();});
  chips.querySelectorAll(".chip").forEach(ch=>ch.onclick=()=>{
    chips.querySelectorAll(".chip").forEach(x=>x.classList.remove("on"));
    ch.classList.add("on");filterT=ch.dataset.t;draw();
  });
}

/* ================= FLOWS ================= */
function renderFlows(){
  const app=$("#app");
  app.appendChild(el("h2",null,"מודלים ותרשימי זרימה"));
  app.appendChild(el("p","lead","שיטת \"מפתח המאסטר\": לכל תרחיש נפוץ בבחינה — אלגוריתם פתרון + הארסנל המשפטי (חקיקה ופסיקה). עברו על התרחיש שבקייס לפי הצעדים."));
  DATA.flows.forEach(f=>{
    const c=el("div","flow");
    let steps="";
    f.steps.forEach((s,i)=>{
      if(i>0)steps+=`<div class="farrow">↓</div>`;
      if(s.type==="decision")steps+=`<div class="fdecision">❓ ${s.t}</div>`;
      else steps+=`<div class="fnode ${s.type==='navy'?'':s.type}">${s.t}</div>`;
    });
    c.innerHTML=`<h3>${f.title}</h3>
      <div class="note" style="margin-top:0"><b>🎯 הארסנל:</b> ${f.arsenal}</div>
      ${steps}`;
    app.appendChild(c);
  });
}

/* ================= FLASHCARDS ================= */
function renderCards(){
  const app=$("#app");
  app.appendChild(el("h2",null,"כרטיסיות חזרה"));
  app.appendChild(el("p","lead","הקישו על הכרטיס כדי להפוך אותו. סננו לפי נושא. ההתקדמות נשמרת."));
  const topics=[...new Set(DATA.flashcards.map(c=>c.t))];
  const chips=el("div","chips");
  const allc=el("div","chip on","הכל"); allc.dataset.t="";chips.appendChild(allc);
  topics.forEach(t=>{const c=el("div","chip",t);c.dataset.t=t;chips.appendChild(c);});
  app.appendChild(chips);

  const cardBox=el("div"); app.appendChild(cardBox);
  const bar=el("div","fcbar");
  bar.innerHTML=`<button class="btn ghost sm" id="fcPrev">‹ הקודם</button>
    <span class="fccount" id="fcCount"></span>
    <button class="btn ghost sm" id="fcNext">הבא ›</button>
    <button class="btn sm" id="fcShuffle">🔀 ערבוב</button>`;
  app.appendChild(bar);

  let deck=[...DATA.flashcards], idx=0, filterT="";
  function filtered(){return filterT?DATA.flashcards.filter(c=>c.t===filterT):DATA.flashcards;}
  function drawCard(){
    deck=filtered();
    if(idx>=deck.length)idx=0;
    const c=deck[idx];
    cardBox.innerHTML=`<div class="fcard" id="theCard">
      <div class="fcard-inner">
        <div class="fcface fcfront"><div class="lbl">שאלה</div><div class="q">${c.q}</div><div class="fctopic" style="color:#cdd8ef">${c.t}</div></div>
        <div class="fcface fcback"><div class="lbl" style="color:var(--gold)">תשובה</div><div class="a">${c.a}</div><div class="fctopic">${c.t}</div></div>
      </div></div>`;
    $("#fcCount").textContent=`${idx+1} / ${deck.length}`;
    const card=$("#theCard");
    card.onclick=()=>{card.classList.toggle("flip");
      const seen=store.get("cardsSeen",[]);const key=c.t+"|"+c.q;
      if(!seen.includes(key)){seen.push(key);store.set("cardsSeen",seen);}};
  }
  drawCard();
  $("#fcPrev").onclick=()=>{idx=(idx-1+deck.length)%deck.length;drawCard();};
  $("#fcNext").onclick=()=>{idx=(idx+1)%deck.length;drawCard();};
  $("#fcShuffle").onclick=()=>{for(let i=DATA.flashcards.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[DATA.flashcards[i],DATA.flashcards[j]]=[DATA.flashcards[j],DATA.flashcards[i]];}idx=0;drawCard();};
  chips.querySelectorAll(".chip").forEach(ch=>ch.onclick=()=>{
    chips.querySelectorAll(".chip").forEach(x=>x.classList.remove("on"));
    ch.classList.add("on");filterT=ch.dataset.t;idx=0;drawCard();
  });
}

/* ================= QUIZ ================= */
function renderQuiz(){
  const app=$("#app");
  app.appendChild(el("h2",null,"מבחן אמריקאי אינטראקטיבי"));
  app.appendChild(el("p","lead",`${DATA.mcq.length} שאלות מבוססות על שאלות אמיתיות מהבחינות + שאלות נוספות. בחרו תשובה — תקבלו משוב מיידי והסבר.`));
  const bar=el("div","scorebar");
  bar.innerHTML=`<span class="s" id="qScore">0 / 0</span>
    <div class="prog"><i id="qProg"></i></div>
    <button class="btn sm" id="qReset">איפוס</button>`;
  app.appendChild(bar);
  const wrap=el("div"); app.appendChild(wrap);

  let answered={}, correct=0, total=0;
  function updBar(){
    $("#qScore").textContent=`${correct} / ${total} נכונות`;
    $("#qProg").style.width=(total?correct/DATA.mcq.length*100:0)+"%";
  }
  shuffleIdx(DATA.mcq.length).forEach((qi,pos)=>{
    const qq=DATA.mcq[qi];
    const c=el("div","qcard");
    let opts="";
    shuffleIdx(qq.o.length).forEach((oi,opos)=>{opts+=`<label class="opt" data-qi="${qi}" data-oi="${oi}"><span class="mk">${["א","ב","ג","ד"][opos]}.</span>${qq.o[oi]}</label>`;});
    c.innerHTML=`<span class="qnum">שאלה ${pos+1}</span><span class="qsrc">${qq.src} · ${qq.topic}</span>
      <div class="qtext">${qq.q}</div>${opts}
      <div class="qexplain" id="exp${qi}"><b>הסבר:</b> ${qq.e}</div>`;
    wrap.appendChild(c);
  });
  wrap.querySelectorAll(".opt").forEach(opt=>{
    opt.onclick=()=>{
      const qi=+opt.dataset.qi, oi=+opt.dataset.oi;
      if(answered[qi]!=null)return;
      answered[qi]=oi;
      const qq=DATA.mcq[qi];
      const opts=wrap.querySelectorAll(`.opt[data-qi="${qi}"]`);
      opts.forEach(o=>{const j=+o.dataset.oi;
        if(j===qq.c)o.classList.add("correct");
        if(j===oi&&oi!==qq.c)o.classList.add("wrong");});
      $("#exp"+qi).classList.add("show");
      total++; if(oi===qq.c)correct++;
      updBar();
      const st=store.get("quizStats",{answered:0,correct:0});
      st.answered++; if(oi===qq.c)st.correct++;
      store.set("quizStats",st);
      recordMcqAnswer(qq.topic, oi===qq.c);
    };
  });
  $("#qReset").onclick=()=>{answered={};correct=0;total=0;renderQuiz();};
  updBar();
}

/* ================= SIMULATIONS ================= */
function renderSim(){
  const app=$("#app");
  app.appendChild(el("h2",null,"סימולציות בחינה"));
  app.appendChild(el("p","lead","בחינות אמיתיות מועתקות מילה במילה (עם הפתרון הרשמי) + 5 סימולציות חדשות שהופקו במיוחד. קראו את הקייס, נסחו תשובה בעצמכם (\"ספרים סגורים\"), ואז פתחו את התשובה המלאה כדי להשוות."));
  const real=DATA.sims.filter(s=>s.real), gen=DATA.sims.filter(s=>!s.real);
  const mkCard=(s)=>{
    const card=el("div","card");
    card.style.cursor="pointer";
    card.style.borderTop="4px solid "+(s.real?"var(--stamp)":"var(--gold)");
    const badge=s.real
      ? '<span class="stamp" style="margin-inline-end:8px">בחינה אמיתית</span>'
      : '<span class="stamp" style="margin-inline-end:8px;border-color:var(--gold);color:var(--gold);background:var(--gold-bg)">חדשה</span>';
    const prog=simProgress(s);
    const gradeColor = prog.pct==null ? "var(--muted)" : prog.pct>=80 ? "var(--ok)" : prog.pct>=60 ? "var(--gold)" : "var(--stamp)";
    const gradeBadge = prog.answered
      ? `<span style="font-weight:800;color:${gradeColor}">${prog.pct}%</span> <span style="color:var(--muted);font-size:.78rem">(${prog.answered}/${prog.total} נענו)</span>`
      : `<span style="color:var(--muted);font-size:.82rem">טרם נענתה</span>`;
    card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div><div class="tt" style="font-weight:800;color:var(--navy);font-size:1.1rem;font-family:'Frank Ruhl Libre',serif">${badge}${s.title}</div>
      <div class="td" style="color:var(--muted);font-size:.86rem;margin-top:6px">${s.meta}</div>
      <div style="margin-top:6px;font-size:.9rem">${gradeBadge}</div></div>
      <button class="btn sm">פתיחה ›</button></div>`;
    card.onclick=()=>openSim(s);
    return card;
  };
  app.appendChild(el("h3",null,`📄 בחינות אמיתיות (${real.length}) — מילה במילה עם הפתרון הרשמי`));
  real.forEach(s=>app.appendChild(mkCard(s)));
  app.appendChild(el("h3",null,`✨ סימולציות חדשות (${gen.length}) — לתרגול נוסף`));
  app.appendChild(el("p","lead","בנויות בסגנון הבחינה ומכוונות לנושאים בעלי ההסתברות הגבוהה ביותר לפי הסיכום והערות המרצה."));
  gen.forEach(s=>app.appendChild(mkCard(s)));
}
function openSim(s){
  const app=$("#app"); app.innerHTML="";
  const back=el("button","btn ghost sm","‹ חזרה לרשימת הסימולציות");
  back.onclick=()=>renderSim();
  app.appendChild(back);
  const h=el("div"); h.style.marginTop="12px";
  h.innerHTML=`<h2>${s.title}</h2><p class="lead">${s.meta}</p>
    <div class="note"><b>איך לתרגל:</b> קראו את כל הקייס פעם אחת בלי לכתוב. סמנו סוגיות. אז כתבו תשובה מלאה בסדר כרונולוגי — ורק בסוף פתחו את "התשובה המלאה" להשוואה.</div>`;
  app.appendChild(h);

  const simTopics = topicsFromSim(s);
  const scoreBar=el("div","scorebar");
  scoreBar.innerHTML=`<span class="s" id="simScore">0 / 0</span>
    <div class="prog"><i id="simProg"></i></div>`;
  app.appendChild(scoreBar);
  let mcqTotal=0, mcqCorrect=0;
  const openScores={}; // qi -> score, for this render session
  function updSimScore(){
    const openVals=Object.values(openScores);
    const openAnswered=openVals.length;
    const openSum=openVals.reduce((a,b)=>a+b,0);
    const totalUnits = mcqTotal + openAnswered;
    const correctUnits = mcqCorrect + openSum;
    $("#simScore").textContent = totalUnits
      ? `${correctUnits.toFixed(1).replace(/\.0$/,"")} / ${totalUnits} (${Math.round(correctUnits/totalUnits*100)}%)`
      : "0 / 0";
    $("#simProg").style.width=(totalUnits?correctUnits/totalUnits*100:0)+"%";
  }
  updSimScore();

  s.questions.forEach((q,i)=>{
    const box=el("div","simq");
    const gradeKey=`${s.id}:q${i}`;
    box.innerHTML=`<h4><span>שאלה ${i+1}</span><span class="pts">${q.points} נק'</span></h4>
      <div class="simbody">
        <div class="facts">${q.q}</div>
        <details class="model"><summary><span class="secmark">✓</span> הצג תשובה מלאה (פתרון מודל)</summary>
          <div class="modeltext">${q.model}</div>
          <div class="selfgrade">
            <b>איך הלך לך?</b> דרגו את עצמכם כדי לעקוב אחר ההתקדמות שלכם בנושא זה:
            <div class="sgbtns" data-key="${gradeKey}">
              <button class="sgbtn good" data-score="1">✅ ידעתי טוב</button>
              <button class="sgbtn mid" data-score="0.5">🟡 חלקית</button>
              <button class="sgbtn bad" data-score="0">❌ לא ידעתי</button>
            </div>
          </div>
        </details>
      </div>`;
    app.appendChild(box);
    const existing=(store.get("openGrades",{}))[gradeKey];
    if(existing!=null && existing.score!=null){
      openScores[i]=existing.score;
      const btns=box.querySelectorAll(".sgbtn");
      btns.forEach(b=>{ if(+b.dataset.score===existing.score)b.classList.add("chosen"); });
      updSimScore();
    }
    box.querySelectorAll(".sgbtn").forEach(btn=>{
      btn.onclick=()=>{
        const score=+btn.dataset.score;
        openScores[i]=score;
        recordOpenGrade(gradeKey, simTopics, score);
        box.querySelectorAll(".sgbtn").forEach(b=>b.classList.remove("chosen"));
        btn.classList.add("chosen");
        updSimScore();
      };
    });
  });
  if(s.mcq && s.mcq.length){
    app.appendChild(el("h3",null,`חלק ב' — שאלות אמריקאיות (${s.mcq.length})`));
    app.appendChild(el("p","lead","בבחינה האמיתית בוחרים 4 מתוך 8 — כאן מומלץ לענות על כולן לתרגול מלא."));
    const mwrap=el("div"); app.appendChild(mwrap);
    const storedGrades=store.get("openGrades",{});
    shuffleIdx(s.mcq.length).forEach((qi,pos)=>{
      const qq=s.mcq[qi];
      const c=el("div","qcard");
      let opts="";
      shuffleIdx(qq.o.length).forEach((oi,opos)=>{opts+=`<label class="opt" data-qi="${qi}" data-oi="${oi}"><span class="mk">${["א","ב","ג","ד"][opos]}.</span>${qq.o[oi]}</label>`;});
      c.innerHTML=`<span class="qnum">שאלה ${pos+1}</span>${qq.topic?`<span class="qsrc">${qq.topic}</span>`:""}
        <div class="qtext">${qq.q}</div>${opts}
        <div class="qexplain" id="simExp${qi}"><b>הסבר:</b> ${qq.e}</div>`;
      mwrap.appendChild(c);
      const mKey=`${s.id}:m${qi}`;
      const prior=storedGrades[mKey];
      if(prior!=null && prior.score!=null){
        mcqTotal++; if(prior.score===1)mcqCorrect++;
        c.querySelectorAll(".opt").forEach(o=>{const j=+o.dataset.oi;
          if(j===qq.c)o.classList.add("correct");
          if(j===prior.chosenIndex && j!==qq.c)o.classList.add("wrong");});
        c.querySelector("#simExp"+qi)?.classList.add("show");
      }
    });
    updSimScore();
    mwrap.querySelectorAll(".opt").forEach(opt=>{
      opt.onclick=()=>{
        const qi=+opt.dataset.qi, oi=+opt.dataset.oi;
        const opts=mwrap.querySelectorAll(`.opt[data-qi="${qi}"]`);
        if([...opts].some(o=>o.classList.contains("correct")||o.classList.contains("wrong")))return;
        const qq=s.mcq[qi];
        const isCorrect=oi===qq.c;
        opts.forEach(o=>{const j=+o.dataset.oi;
          if(j===qq.c)o.classList.add("correct");
          if(j===oi&&!isCorrect)o.classList.add("wrong");});
        $("#simExp"+qi).classList.add("show");
        const st=store.get("quizStats",{answered:0,correct:0});
        st.answered++; if(isCorrect)st.correct++;
        store.set("quizStats",st);
        const mKey=`${s.id}:m${qi}`;
        const alreadyCounted=(store.get("openGrades",{}))[mKey]!=null;
        recordOpenGrade(mKey, [qq.topic||simTopics[0]], isCorrect?1:0, {chosenIndex:oi});
        if(!alreadyCounted){ mcqTotal++; if(isCorrect)mcqCorrect++; }
        updSimScore();
      };
    });
  }
  if(s.topics){
    const t=el("details","model");
    t.style.marginTop="6px";
    t.innerHTML=`<summary style="color:var(--gold)"><span class="secmark" style="background:linear-gradient(150deg,#8A6D1A,#b08c2a)">🎯</span> נושאים וחקיקה שנבדקו — לחשיפה רק לאחר שכתבתם את המענה</summary>
      <div class="modeltext" style="background:var(--gold-bg);border-color:var(--goldln)">${s.topics}</div>`;
    app.appendChild(t);
  }
  const back2=el("button","btn ghost sm","‹ חזרה לרשימת הסימולציות");
  back2.style.marginTop="10px";
  back2.onclick=()=>renderSim();
  app.appendChild(back2);
  window.scrollTo({top:0,behavior:"smooth"});
}

/* ================= EXAM INFO ================= */
function renderExam(){
  const app=$("#app");
  app.appendChild(el("h2",null,"פרטי הבחינה והנחיות"));
  const g=el("div","grid grid2");
  g.innerHTML=`
    <div class="card"><h3 style="margin-top:0">📋 מבנה ומועדים</h3>
      <ul><li><b>משך:</b> 3–3.5 שעות, ללא הארכה</li>
      <li><b>חומר פתוח</b> (ספרים, סיכומים) — אך אין להעתיק קטעים</li>
      <li><b>חלק א':</b> 3 שאלות פתוחות (קייסים) — כ-80%</li>
      <li><b>חלק ב':</b> 8 שאלות אמריקאיות, לבחור 4 — כ-20%</li>
      <li>מענה על יותר מהנדרש → נבדקות הראשונות בלבד</li>
      <li>יש להקפיד על מגבלת המקום לכל שאלה</li></ul></div>
    <div class="card"><h3 style="margin-top:0">⚠️ עצות המרצה</h3>
      <ul><li>למדו כאילו הספרים סגורים — תוצאות טובות יותר</li>
      <li>קריאה ראשונה של קייס: אל תכתבו, רק סמנו במרקר</li>
      <li>רק אחרי שקראתם הכל — כתבו בסדר כרונולוגי</li>
      <li>יש לנמק כל טענה בפסיקה ובחקיקה הרלוונטית</li>
      <li>ציינו תמיד מספר סעיף לכל צעד</li></ul></div>`;
  app.appendChild(g);

  app.appendChild(el("h3",null,"הצ'קליסט הסופי — רגע לפני ההגשה"));
  const chk=el("div","grid grid2");
  chk.innerHTML=`
    <div class="card"><b style="color:var(--ok)">✅ סמכות וחוק</b><p style="margin:6px 0 0">האם ציינתי מספר סעיף חוק רלוונטי (חסד"פ / מעצרים) לכל צעד של המשטרה או ביהמ"ש?</p></div>
    <div class="card"><b style="color:var(--ok)">✅ פסיקת חובה</b><p style="margin:6px 0 0">האם שזרתי את ההלכות (דגני, יששכרוב, בורוביץ', בן חיים, זאדה) על עובדות המקרה?</p></div>
    <div class="card"><b style="color:var(--ok)">✅ מבחן הזמנים</b><p style="margin:6px 0 0">האם בדקתי לוחות זמנים? ("זה מקרוב", 24 שעות, 15/30 יום, מועד העלאת טענה)</p></div>
    <div class="card"><b style="color:var(--ok)">✅ מידתיות וחלופה</b><p style="margin:6px 0 0">האם הצעתי/בחנתי את החלופה הפוגענית פחות? (עיכוב, חלופת מעצר, סעד מתון)</p></div>`;
  app.appendChild(chk);

  app.appendChild(el("h3",null,"פסיקה בסדר עדיפות — חובה לדעת"));
  const pri=DATA.cases.filter(c=>c.pri).map(c=>`<tr><td>${c.n}</td><td>${c.h}</td></tr>`).join("");
  const t=el("div","card");
  t.innerHTML=`<table class="tbl z"><tr><th>פסק דין</th><th>הלכה בקצרה</th></tr>${pri}</table>`;
  app.appendChild(t);

  const note=el("div","exam");
  note.innerHTML=`יישום מדויק על עובדות המקרה שווה יותר מציטוט הלכות ארוכות. <b>בהצלחה בבחינה!</b>`;
  app.appendChild(note);
}

/* ================= PODCASTS ================= */
function renderPodcasts(){
  const app=$("#app");
  app.appendChild(el("h2",null,"פודקאסטים לדרך"));
  app.appendChild(el("p","lead","פרקים שהפקתי על הבחינה ועל סדר הדין הפלילי — להאזנה ישירה או להורדה למכשיר שלכם."));
  PODCASTS.forEach(p=>{
    const c=el("div","card");
    const src="/media/podcasts/"+encodeURIComponent(p.file);
    c.innerHTML=`
      <div class="tt" style="font-weight:800;color:var(--navy);font-family:'Frank Ruhl Libre',serif;font-size:1.05rem">🎧 ${p.title}</div>
      <div class="td" style="color:var(--muted);font-size:.88rem;margin:6px 0 12px">${p.desc}</div>
      <audio controls preload="none" style="width:100%" src="${src}"></audio>
      <div style="margin-top:10px">
        <a class="btn ghost sm" href="${src}" download style="text-decoration:none;display:inline-block">⬇️ הורדה</a>
      </div>`;
    app.appendChild(c);
  });
  const note=el("div","note");
  note.innerHTML=`<b>💡 טיפ:</b> אפשר להוריד את הפרקים ולהאזין גם במצב לא מקוון, בנסיעה או תוך כדי אימון.`;
  app.appendChild(note);
}

/* ================= LEADERBOARD ================= */
function renderLeaderboard(){
  const app=$("#app");
  app.appendChild(el("h2",null,"לוח מובילים"));
  app.appendChild(el("p","lead","דירוג לפי אחוז ההתקדמות בחומר (כרטיסיות + שאלות שנענו), עם נתוני תרגול מלאים לכל משתמש. מוצג שם פרטי בלבד."));
  const list=el("div"); list.id="lbList"; list.innerHTML=`<div class="card">טוען…</div>`;
  app.appendChild(list);
  fetch("/api/progress/leaderboard").then(r=>r.json()).then(({leaderboard})=>{
    if(!leaderboard || !leaderboard.length){list.innerHTML=`<div class="card">אין עדיין נתוני התקדמות להצגה.</div>`;return;}
    list.innerHTML="";
    leaderboard.forEach((u,i)=>{
      const medal=["🥇","🥈","🥉"][i]||`#${i+1}`;
      const c=el("div","card");
      c.style.display="flex";c.style.alignItems="center";c.style.gap="14px";
      c.style.borderInlineStart=u.isMe?"5px solid var(--gold-bright)":"5px solid transparent";
      const badges=(u.achievements||[]).map(a=>`<span title="${a.label}" style="margin-inline-end:4px">${a.icon}</span>`).join("");
      c.innerHTML=`
        <div style="font-size:1.3rem;min-width:34px;text-align:center">${medal}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;color:var(--navy);font-family:'Frank Ruhl Libre',serif">${u.firstName}${u.isMe?' <span style="color:var(--gold);font-size:.8rem">(את/ה)</span>':''}</div>
          <div style="font-size:.82rem;color:var(--muted);margin-top:2px">
            ${u.quizAnswered} שאלות (${u.quizAccuracy}% דיוק) · ${u.cardsSeenCount} כרטיסיות · ${u.chaptersOpenedCount} פרקים · ${fmtDuration(u.timeSpentSec)} תרגול${u.streak?` · רצף ${u.streak} ימים 🔥`:''}
          </div>
          <div style="font-size:.82rem;color:var(--muted);margin-top:2px">
            📝 ${u.simsAttempted}/${u.simsTotal} סימולציות${u.avgSimGrade!=null?` · ציון ממוצע ${u.avgSimGrade}%`:''}
          </div>
          <div style="margin-top:6px">${badges}</div>
        </div>
        <div style="text-align:center;min-width:70px">
          <div style="font-weight:900;font-size:1.3rem;color:var(--blue);font-family:'Frank Ruhl Libre',serif">${u.progressPct}%</div>
          <div style="font-size:.7rem;color:var(--muted)">התקדמות</div>
        </div>`;
      list.appendChild(c);
    });
  }).catch(()=>{list.innerHTML=`<div class="card">שגיאה בטעינת לוח המובילים.</div>`;});
}

/* ================= MY PERFORMANCE ================= */
function renderPerformance(){
  const app=$("#app");
  app.appendChild(el("h2",null,"הביצועים שלי"));
  app.appendChild(el("p","lead","סיכום מלא של הציונים שלכם — שאלות אמריקאיות (מהמבחן ומהסימולציות) וגם שאלות פתוחות שדירגתם בעצמכם — מפורק לפי נושא, כדי שתדעו בדיוק איפה חזק ואיפה כדאי לחזור."));

  const quizStats = store.get("quizStats",{answered:0,correct:0});
  const openGrades = store.get("openGrades",{});
  const topicStats = store.get("topicStats",{});
  const openVals = Object.values(openGrades).map(g=>g.score);
  const openAnswered = openVals.length;
  const openAvg = openAnswered ? openVals.reduce((a,b)=>a+b,0)/openAnswered : 0;

  const summary=el("div","grid grid3");
  summary.innerHTML=`
    <div class="stat"><div class="n">${quizStats.answered}</div><div class="l">שאלות אמריקאיות שנענו</div></div>
    <div class="stat"><div class="n">${quizStats.answered?Math.round(quizStats.correct/quizStats.answered*100)+'%':'—'}</div><div class="l">דיוק בשאלות אמריקאיות</div></div>
    <div class="stat"><div class="n">${openAnswered?Math.round(openAvg*100)+'%':'—'}</div><div class="l">ציון עצמי בשאלות פתוחות (${openAnswered} דורגו)</div></div>`;
  app.appendChild(summary);

  const simRows = DATA.sims.map(s=>Object.assign({id:s.id,title:s.title},simProgress(s)));
  const attemptedSims = simRows.filter(r=>r.answered>0);
  app.appendChild(el("h3",null,`ציון מוצע לפי סימולציה (${attemptedSims.length}/${simRows.length} נענו)`));
  app.appendChild(el("p","lead","הציון המוצע משלב את התשובות שלכם בשאלות האמריקאיות עם הדירוג העצמי שנתתם לשאלות הפתוחות בכל סימולציה."));
  if(!attemptedSims.length){
    const empty=el("div","note");
    empty.innerHTML=`עדיין לא ענית או דירגת אף שאלה בסימולציות. פתחו סימולציה בטאב "סימולציות" כדי להתחיל.`;
    app.appendChild(empty);
  }else{
    const simWrap=el("div");
    attemptedSims.sort((a,b)=>(a.pct??0)-(b.pct??0)).forEach(r=>{
      const color = r.pct>=80 ? "var(--ok)" : r.pct>=60 ? "var(--gold)" : "var(--stamp)";
      const row=el("div","card");
      row.style.marginBottom="8px";
      row.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-weight:700;color:var(--navy)">${r.title}</div>
          <div style="font-size:.82rem;color:var(--muted)">${r.answered}/${r.total} שאלות נענו</div>
        </div>
        <div class="prog" style="margin:8px 0 2px"><i style="width:${r.pct}%;background:${color}"></i></div>
        <div style="text-align:end;font-weight:800;color:${color}">${r.pct}%</div>`;
      simWrap.appendChild(row);
    });
    app.appendChild(simWrap);
  }

  const topics = Object.keys(topicStats);
  if(!topics.length){
    const empty=el("div","note");
    empty.style.marginTop="16px";
    empty.innerHTML=`<b>עדיין אין נתונים לפי נושא.</b> ענו על שאלות ב"מבחן אמריקאי" או ב"סימולציות", ודרגו את עצמכם בשאלות הפתוחות — והפירוט לפי נושא יופיע כאן.`;
    app.appendChild(empty);
    return;
  }

  const rows = topics.map(t=>{
    const st=topicStats[t];
    const pct = st.answered ? Math.round((st.correct/st.answered)*100) : 0;
    return {topic:t, answered:st.answered, pct};
  }).sort((a,b)=>a.pct-b.pct);

  const weak = rows.filter(r=>r.pct<60 && r.answered>=2).slice(0,3);
  if(weak.length){
    const tip=el("div","exam");
    tip.style.marginTop="16px";
    tip.innerHTML=`<b>🎯 נושאים לחיזוק:</b> ${weak.map(r=>`${r.topic} (${r.pct}%)`).join(" · ")} — כדאי לחזור על הפרק הרלוונטי בחומר הלימוד ולתרגל שוב.`;
    app.appendChild(tip);
  }

  app.appendChild(el("h3",null,"פירוט לפי נושא"));
  const wrap=el("div");
  rows.forEach(r=>{
    const color = r.pct>=80 ? "var(--ok)" : r.pct>=60 ? "var(--gold)" : "var(--stamp)";
    const row=el("div","card");
    row.style.marginBottom="8px";
    row.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-weight:700;color:var(--navy)">${r.topic}</div>
        <div style="font-size:.82rem;color:var(--muted)">${r.answered} שאלות שנענו/דורגו</div>
      </div>
      <div class="prog" style="margin:8px 0 2px"><i style="width:${r.pct}%;background:${color}"></i></div>
      <div style="text-align:end;font-weight:800;color:${color}">${r.pct}%</div>`;
    wrap.appendChild(row);
  });
  app.appendChild(wrap);
}

/* ---- init ---- */
current = store.get("lasttab","home");
if(!TABS.find(t=>t.id===current))current="home";
buildNav();
render();
loadUserBar();
hydrateFromServer().then(()=>{ if(current==="home")render(); });
setupEasterEgg();
setupTimeTracking();
})();
