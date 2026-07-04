"use strict";
/* ================= OFSC OLYMPICS — Supabase edition ================= */
const cfg = window.OFSC_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);

const $  = (s,r=document)=>r.querySelector(s);
const esc= s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt= n=>(+n||0).toLocaleString();
const ordinal=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};
const nowTime=()=>new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};

let state = {settings:{},teams:[],guests:[],events:[],schedule:[],scores:[],awards:[],votes:[],announcements:[],signups:[],matches:[]};
let session=null;
const isHost=()=>!!session;
let route='home';

/* remembered guest identity (per device) so guests pick their name only once */
function getMe(){try{const id=localStorage.getItem('ofsc_me')||'';return id&&guest(id)?id:'';}catch(e){return '';}}
function setMe(id){try{if(id)localStorage.setItem('ofsc_me',id);}catch(e){}}
function clearMe(){try{localStorage.removeItem('ofsc_me');}catch(e){}window.__voter='';render();}

/* ---------------- Toast + Modal ---------------- */
function toast(msg,type='ok',ms=2800){const el=document.createElement('div');el.className='toast '+(type==='ok'?'':type);el.textContent=msg;$('#toast').appendChild(el);setTimeout(()=>el.remove(),ms);}
function openModal(title,body,footer){$('#modalRoot').innerHTML=`<div class="modal-bg" data-close><div class="modal"><div class="mh"><h2>${esc(title)}</h2><button class="x" data-close>✕</button></div><div class="mb">${body}</div>${footer?`<div class="mf">${footer}</div>`:''}</div></div>`;}
function closeModal(){$('#modalRoot').innerHTML='';}

/* ---------------- Data load + realtime ---------------- */
async function loadAll(){
  const q=(t,order)=>sb.from(t).select('*').order(order||'created_at',{ascending:true});
  const [se,tm,gu,ev,sc,scr,aw,vo,an,su,ma]=await Promise.all([
    sb.from('settings').select('*').eq('id',1).single(),
    q('teams','name'), q('guests','display_name'), sb.from('events').select('*').order('sort'),
    sb.from('schedule_blocks').select('*').order('sort'), q('scores'),
    sb.from('awards').select('*').order('sort'), q('votes'), q('announcements'),
    q('bracket_signups'), q('matches')
  ]);
  if(se.data)state.settings=se.data;
  state.teams=tm.data||[]; state.guests=gu.data||[]; state.events=ev.data||[];
  state.schedule=sc.data||[]; state.scores=scr.data||[]; state.awards=aw.data||[];
  state.votes=vo.data||[]; state.announcements=an.data||[]; state.signups=su.data||[]; state.matches=ma.data||[];
  $('#topName').textContent=state.settings.event_name||'OFSC OLYMPICS';
}
let reTimer=null;
function scheduleReload(){clearTimeout(reTimer);reTimer=setTimeout(async()=>{await loadAll();softRender();},400);}
function subscribeRealtime(){
  sb.channel('ofsc').on('postgres_changes',{event:'*',schema:'public'},scheduleReload).subscribe();
}
async function loadAndRender(){await loadAll();render();}
function softRender(){ // refresh without stomping an open modal or focused input
  if($('#modalRoot').innerHTML)return;
  if(document.activeElement&&['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
  if($('#fs').classList.contains('on')){ if(fsMode==='tv')renderTV(); return; }
  render();
}

/* ---------------- Lookups + derived ---------------- */
const team=id=>state.teams.find(t=>t.id===id);
const guest=id=>state.guests.find(g=>g.id===id);
const evById=id=>state.events.find(e=>e.id===id);
const teamName=id=>team(id)?.name||'—';
const teamColor=id=>team(id)?.color||'#889';
const guestName=id=>guest(id)?.display_name||'—';
const eventName=id=>evById(id)?.name||'—';
const P=()=>state.settings.points||{first:10,second:7,third:5,participation:1};
const placePoints=pl=>{const p=P();return pl===1?p.first:pl===2?p.second:pl===3?p.third:p.participation;};

function guestPoints(gid){return state.scores.filter(s=>s.guest_id===gid).reduce((a,s)=>a+(+s.points||0),0);}
function teamPoints(tid){
  let p=+(team(tid)?.points_adjust||0);
  state.guests.filter(g=>g.team_id===tid).forEach(g=>p+=guestPoints(g.id));
  state.scores.filter(s=>s.team_id===tid&&!s.guest_id).forEach(s=>p+=(+s.points||0));
  return p;
}
function teamMedals(tid){
  const m={g:0,s:0,b:0};const t=team(tid);
  const members=new Set(state.guests.filter(g=>g.team_id===tid).map(g=>g.id));
  state.scores.forEach(s=>{if(s.guest_id&&members.has(s.guest_id)){if(s.place===1)m.g++;else if(s.place===2)m.s++;else if(s.place===3)m.b++;}});
  if(t){m.g+=t.medal_g||0;m.s+=t.medal_s||0;m.b+=t.medal_b||0;}
  return m;
}
function teamStandings(){
  return state.teams.map(t=>({t,points:teamPoints(t.id),medals:teamMedals(t.id)}))
    .sort((a,b)=>b.points-a.points||b.medals.g-a.medals.g||a.t.name.localeCompare(b.t.name));
}
function individualStandings(kidsOnly){
  return state.guests.filter(g=>!kidsOnly||g.kind==='kid').map(g=>({g,points:guestPoints(g.id)}))
    .filter(x=>x.points>0).sort((a,b)=>b.points-a.points||a.g.display_name.localeCompare(b.g.display_name));
}
const scLabel=t=>({placement:'Placement',head2head:'Head-to-Head',best:'Best Attempt',timed:'Timed Race',manual:'Manual'}[t]||t);

/* ---------------- DB write helpers (host-authorized by RLS) ---------------- */
async function ins(t,row){const{error}=await sb.from(t).insert(row);if(error){toast(error.message,'err');return false;}return true;}
async function upd(t,id,patch){const{error}=await sb.from(t).update(patch).eq('id',id);if(error){toast(error.message,'err');return false;}return true;}
async function del(t,id){const{error}=await sb.from(t).delete().eq('id',id);if(error){toast(error.message,'err');return false;}return true;}

/* ================= NAV ================= */
const GUEST_NAV=[['home','🏟️','Home'],['schedule','📅','Schedule'],['standings','🏅','Standings'],['brackets','🎾','Brackets'],['signup','✍️','Sign Up'],['voting','🗳️','Vote']];
const HOST_NAV=[['scoring','🎯','Scoring'],['cornhole','🌽','Cornhole'],['awards','🏆','Awards'],['announcements','📣','Announce'],['tv','📺','TV'],['admin','⚙️','Admin']];
function nav(){return isHost()?GUEST_NAV.concat(HOST_NAV):GUEST_NAV.concat([['admin','🔑','Host']]);}
function renderNav(){
  const items=nav();
  $('#rail').innerHTML=items.map((n,i)=>(i===GUEST_NAV.length?'<div class="sep"></div>':'')+`<button data-nav="${n[0]}" class="${route===n[0]?'active':''}"><span class="ic">${n[1]}</span>${n[2]}</button>`).join('');
  const tabIds=isHost()?['home','scoring','cornhole','brackets','standings']:['home','schedule','standings','brackets','voting'];
  const tabs=tabIds.map(id=>{const n=items.find(x=>x[0]===id);return n?`<button data-nav="${id}" class="${route===id?'active':''}"><span class="ic">${n[1]}</span>${n[2]}</button>`:'';}).join('');
  $('#tabbar').innerHTML=tabs+`<button data-more><span class="ic">☰</span>More</button>`;
}
function go(r){route=r;render();window.scrollTo(0,0);}

/* ================= RENDER ================= */
const VIEWS={};const AFTER={};
function render(){renderNav();$('#view').innerHTML=(VIEWS[route]?VIEWS[route]():`<div class="empty">Not found</div>`);if(AFTER[route])AFTER[route]();}

function standRow(r,i){const m=r.medals;return `<div class="row"><div class="rank ${i<3?'g'+(i+1):''}">${i+1}</div><div class="swatch" style="background:${r.t.color}"></div><div class="grow"><div class="name">${esc(r.t.name)}</div><div class="meta">🥇${m.g} 🥈${m.s} 🥉${m.b} · ${esc(r.t.family)}</div></div><div class="disp" style="font-size:28px;font-weight:900;color:var(--sun3)">${fmt(r.points)}</div></div>`;}

/* ---------- HOME / DASHBOARD ---------- */
VIEWS.home=function(){
  const cur=evById(state.settings.current_event_id), nxt=evById(state.settings.next_event_id);
  const st=teamStandings(), done=state.events.filter(e=>e.status==='complete').length;
  const act=state.announcements.filter(a=>a.active);
  return `<div class="section-title"><div><div class="eyebrow">${isHost()?'Command Center':'Welcome to the'}</div><h1 class="disp">${isHost()?'Dashboard':esc(state.settings.event_name||'OFSC Olympics')}</h1><div class="sub">${(!isHost()&&getMe())?`👋 ${esc(guestName(getMe()))} · `:''}${esc(state.settings.date_label||'')}</div></div></div>
  <div class="grid g2" style="margin-bottom:14px">
    <div class="scoreboard"><div class="eyebrow" style="color:var(--sun3)">Now Competing</div><h2 style="margin:4px 0 2px">${cur?esc(cur.name):'Intermission'}</h2><div class="mut small">${cur?esc(cur.location||''):'Glory is temporary. Bragging rights are forever.'}</div><div class="divider"></div><div class="eyebrow" style="color:var(--teal)">Next Up</div><h2 style="margin:4px 0 2px;font-size:22px">${nxt?esc(nxt.name):'—'}</h2></div>
    <div class="grid g2">
      <div class="stat sun"><div class="n">${st[0]?fmt(st[0].points):0}</div><div class="l">Top · ${st[0]?esc(st[0].t.name):'—'}</div></div>
      <div class="stat"><div class="n">${state.teams.length}</div><div class="l">Teams</div></div>
      <div class="stat"><div class="n">${state.guests.length}</div><div class="l">Guests</div></div>
      <div class="stat"><div class="n">${done}<span style="font-size:20px;color:var(--mute)">/${state.events.length}</span></div><div class="l">Events done</div></div>
    </div>
  </div>
  ${!isHost()?`<div class="btnrow" style="margin-bottom:14px"><button class="btn primary" data-nav="signup">✍️ Sign up for events</button><button class="btn teal" data-nav="brackets">See the brackets</button><button class="btn" data-nav="voting">Vote for awards</button></div>`:
   `<div class="btnrow" style="margin-bottom:14px"><button class="btn primary" data-nav="scoring">🎯 Score</button><button class="btn teal" data-nav="cornhole">🌽 Cornhole</button><button class="btn" data-nav="brackets">🎾 Brackets</button><button class="btn" data-act="launchTV">📺 TV</button><button class="btn" data-act="launchAwards">🏆 Awards</button></div>`}
  <div class="card"><div class="section-title" style="margin-bottom:10px"><h1 class="disp" style="font-size:22px">Current Standings</h1></div>${st.slice(0,6).map(standRow).join('')||'<div class="empty">No points yet.</div>'}<button class="btn ghost sm block" data-nav="standings" style="margin-top:10px">Full standings →</button></div>
  ${act.length?`<div class="card" style="margin-top:14px"><div class="eyebrow">📣 Announcements</div>${act.map(a=>`<div style="padding:6px 0">${esc(a.body)}</div>`).join('')}</div>`:''}`;
};

/* ---------- STANDINGS ---------- */
VIEWS.standings=function(){
  const tab=window.__lb||'team';window.__lb=tab;
  const tabs=[['team','Teams'],['individual','Individuals'],['kids','Kids'],['medals','Medals']];
  let body='';
  if(tab==='team'){const st=teamStandings();body=st.length?st.map(standRow).join(''):'<div class="empty">No team points yet.</div>';}
  else if(tab==='medals'){const st=teamStandings().sort((a,b)=>b.medals.g-a.medals.g||b.medals.s-a.medals.s);body=st.map((r,i)=>`<div class="row"><div class="rank ${i<3?'g'+(i+1):''}">${i+1}</div><div class="swatch" style="background:${r.t.color}"></div><div class="grow"><div class="name">${esc(r.t.name)}</div></div><div style="font-family:var(--disp);font-size:22px">🥇${r.medals.g} 🥈${r.medals.s} 🥉${r.medals.b}</div></div>`).join('');}
  else{const st=individualStandings(tab==='kids');body=st.length?st.map((r,i)=>`<div class="row"><div class="rank ${i<3?'g'+(i+1):''}">${i+1}</div><div class="grow"><div class="name">${esc(r.g.display_name)}</div><div class="meta">${esc(r.g.family)} · ${r.g.kind}</div></div><div class="disp" style="font-size:26px;color:var(--sun3)">${fmt(r.points)}</div></div>`).join(''):'<div class="empty">No individual points yet.</div>';}
  return `<div class="section-title"><div><div class="eyebrow">Glory Is Temporary</div><h1 class="disp">Standings</h1></div></div><div class="btnrow" style="margin-bottom:14px">${tabs.map(t=>`<button class="btn sm ${tab===t[0]?'primary':'ghost'}" data-lb="${t[0]}">${t[1]}</button>`).join('')}</div>${body}`;
};

/* ---------- SCHEDULE ---------- */
const SCH_STATUS=[['not_started','Not started','done'],['now_playing','Now playing','live'],['delayed','Delayed','warn'],['complete','Complete','ok'],['canceled','Canceled','done']];
const statusPill=s=>{const f=SCH_STATUS.find(x=>x[0]===s)||SCH_STATUS[0];return `<span class="pill ${f[2]}">${f[1]}</span>`;};
VIEWS.schedule=function(){
  return `<div class="section-title"><div><div class="eyebrow">The Day</div><h1 class="disp">Schedule</h1></div></div>
  ${state.schedule.map(b=>`<div class="card" style="padding:14px"><div class="inline" style="justify-content:space-between"><div><div class="disp" style="font-size:20px">${esc(b.time_label)} — ${esc(b.title)}</div>${b.note?`<div class="mut small">${esc(b.note)}</div>`:''}</div>${statusPill(b.status)}</div>${isHost()?`<div class="btnrow" style="margin-top:10px">${SCH_STATUS.map(s=>`<button class="btn xs ${b.status===s[0]?'teal':'ghost'}" data-blockstatus="${b.id}|${s[0]}">${s[1]}</button>`).join('')}</div>`:''}</div>`).join('')}`;
};

/* ---------- SIGN UP (guest) ---------- */
VIEWS.signup=function(){
  const bes=state.events.filter(e=>e.is_bracket).sort((a,b)=>a.sort-b.sort);
  const sel=window.__suEvent||(bes[0]&&bes[0].id);window.__suEvent=sel;
  const ev=evById(sel);const me=getMe();
  const mine=state.signups.filter(s=>s.event_id===sel);
  return `<div class="section-title"><div><div class="eyebrow">Grab a teammate</div><h1 class="disp">Event Sign Up</h1><div class="sub">Only these five events need signups. Everything else — just show up and play.</div></div></div>
  <div class="btnrow" style="margin-bottom:12px">${bes.map(e=>`<button class="btn sm ${e.id===sel?'primary':'ghost'}" data-suevent="${e.id}">${esc(e.name)}${e.bracket_size===1?' (solo)':''}</button>`).join('')}</div>
  ${ev?`<div class="card">
    <div class="disp" style="font-size:20px;margin-bottom:6px">${esc(ev.name)} — ${ev.bracket_size===1?'singles':'pairs'}</div>
    <div class="mut small" style="margin-bottom:12px">${ev.bracket_size===1?'Sign up as yourself.':'Pick yourself and your teammate.'} ${mine.length} entrant${mine.length===1?'':'s'} so far.</div>
    <label class="f"><span>${ev.bracket_size===1?'You':'Player 1 (you)'}</span><select class="i" id="suP1"><option value="">— select your name —</option>${state.guests.map(g=>`<option value="${g.id}" ${me===g.id?'selected':''}>${esc(g.display_name)}</option>`).join('')}</select></label>
    ${ev.bracket_size===2?`<label class="f"><span>Player 2 (teammate)</span><select class="i" id="suP2"><option value="">— select —</option>${state.guests.map(g=>`<option value="${g.id}">${esc(g.display_name)}</option>`).join('')}</select></label>`:''}
    <button class="btn primary block" data-dosignup="${ev.id}">Sign up</button>
  </div>
  <div class="card" style="margin-top:14px"><div class="disp" style="font-size:16px;margin-bottom:8px">Signed up for ${esc(ev.name)}</div>
    ${mine.length?mine.map(s=>`<div class="row" style="padding:9px 12px"><div class="grow"><div class="name" style="font-size:14px">${esc(signupLabel(s))}</div></div>${isHost()?`<button class="btn xs bad" data-delsignup="${s.id}">✕</button>`:''}</div>`).join(''):'<div class="mut small">Be the first!</div>'}
  </div>`:''}`;
};
function signupLabel(su){if(!su)return 'BYE';if(su.pair_name)return su.pair_name;const p1=guestName(su.player1_id);const p2=su.player2_id?guestName(su.player2_id):'';return p2?`${p1} & ${p2}`:p1;}

/* ---------- BRACKETS ---------- */
VIEWS.brackets=function(){
  const bes=state.events.filter(e=>e.is_bracket).sort((a,b)=>a.sort-b.sort);
  const sel=window.__bkEvent||(bes[0]&&bes[0].id);window.__bkEvent=sel;
  const ev=evById(sel);
  const ms=state.matches.filter(m=>m.event_id===sel).sort((a,b)=>a.round-b.round||a.slot-b.slot);
  const signups=state.signups.filter(s=>s.event_id===sel);
  const rounds=[...new Set(ms.map(m=>m.round))].sort((a,b)=>a-b);
  const final=ms.find(m=>!m.next_match_id);
  const champ=final&&final.status==='complete'?final.winner_signup_id:null;
  const roundName=(r,total)=>{const left=total-r;return left===0?'Final':left===1?'Semifinals':left===2?'Quarterfinals':'Round '+r;};
  let bracketHtml=ms.length?`<div class="bracket">${rounds.map(r=>`<div class="bkt-round"><h4>${roundName(r,rounds.length)}</h4>${ms.filter(m=>m.round===r).map(m=>matchCard(m)).join('')}</div>`).join('')}</div>`:`<div class="empty"><div class="big">No bracket yet</div>${signups.length?`${signups.length} entrants signed up.`:'Waiting on signups.'}</div>`;
  return `<div class="section-title"><div><div class="eyebrow">March to a Champion</div><h1 class="disp">Brackets</h1></div></div>
  <div class="btnrow" style="margin-bottom:12px">${bes.map(e=>`<button class="btn sm ${e.id===sel?'primary':'ghost'}" data-bkevent="${e.id}">${esc(e.name)}</button>`).join('')}</div>
  ${champ?`<div class="champ" style="margin-bottom:14px"><div class="eyebrow" style="color:var(--gold)">Champion</div><div class="disp" style="font-size:30px">🏆 ${esc(signupLabel(state.signups.find(s=>s.id===champ)))}</div></div>`:''}
  ${isHost()?`<div class="card" style="margin-bottom:14px"><div class="inline" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="disp" style="font-size:16px">Host controls · ${signups.length} entrants</div><div class="btnrow"><button class="btn sm teal" data-genbracket="${sel}">${ms.length?'Re-draw bracket':'Generate bracket (random)'}</button><button class="btn sm ghost" data-seedbracket="${sel}">Manual seed…</button><button class="btn sm bad" data-clearevsignups="${sel}">Clear sign-ups</button></div></div><div class="mut small" style="margin-top:6px">Random draw with automatic byes. Use manual seed to arrange it yourself.</div></div>`:''}
  ${bracketHtml}`;
};
function matchCard(m){
  const a=state.signups.find(s=>s.id===m.a_signup_id), b=state.signups.find(s=>s.id===m.b_signup_id);
  const win=m.winner_signup_id;
  const slot=(su,score,side)=>{const isWin=win&&su&&su.id===win;const isBye=(side==='a'?!m.a_signup_id:!m.b_signup_id)&&m.status==='bye';
    return `<div class="bkt-slot ${isWin?'win':''} ${!su&&!isBye?'bye':''} ${isBye?'bye':''}"><span class="nm">${su?esc(signupLabel(su)):(isBye?'bye':'—')}</span>${score!=null?`<span class="sc">${score}</span>`:''}</div>`;};
  const canScore=isHost()&&m.status!=='bye'&&m.a_signup_id&&m.b_signup_id&&m.status!=='complete';
  return `<div class="bkt-match ${m.status==='ready'?'live':''}">${slot(a,m.a_score,'a')}${slot(b,m.b_score,'b')}${canScore?`<div style="padding:6px"><button class="btn xs primary block" data-matchresult="${m.id}">Enter result</button></div>`:''}${isHost()&&m.status==='complete'?`<div style="padding:6px"><button class="btn xs ghost block" data-matchresult="${m.id}">Edit result</button></div>`:''}</div>`;
}

/* ---------- SCORING (host) ---------- */
VIEWS.scoring=function(){
  const evs=state.events.filter(e=>!e.is_bracket||true);
  const sel=window.__scEvent||(evs[0]&&evs[0].id);window.__scEvent=sel;
  const ev=evById(sel);
  return `<div class="section-title"><div><div class="eyebrow">Scorekeeper</div><h1 class="disp">Scoring</h1><div class="sub">Team-event points go to every member; solo events go to individuals. It all rolls up to the family medals.</div></div></div>
  <label class="f"><span>Event</span><select class="i" data-scselect>${evs.map(e=>`<option value="${e.id}" ${e.id===sel?'selected':''}>${esc(e.name)} · ${scLabel(e.scoring_type)}${e.is_bracket?' (bracket)':''}</option>`).join('')}</select></label>
  ${ev?(ev.is_bracket?`<div class="helpbox">${esc(ev.name)} is a bracket event — score it match-by-match on the <b>Brackets</b> tab${ev.name==='Cornhole'?' or the <b>Cornhole</b> tab':''}.</div>`:`<div class="card"><div class="inline" style="justify-content:space-between;margin-bottom:12px"><div class="disp" style="font-size:22px">${esc(ev.name)}</div><select class="i" style="width:auto" data-sctype="${ev.id}">${['placement','head2head','best','timed','manual'].map(t=>`<option value="${t}" ${ev.scoring_type===t?'selected':''}>${scLabel(t)}</option>`).join('')}</select></div>${scoreForm(ev)}</div>
    <div class="card" style="margin-top:14px"><div class="inline" style="justify-content:space-between;margin-bottom:8px"><div class="disp" style="font-size:18px">Results in this event</div><button class="btn xs ${ev.status==='complete'?'ok':'ghost'}" data-completeevent="${ev.id}">${ev.status==='complete'?'✓ Complete':'Mark complete'}</button></div>${eventResults(ev.id)}</div>`):''}
  <div class="card" style="margin-top:14px"><div class="disp" style="font-size:18px;margin-bottom:8px">⭐ Bonus / Manual Points</div>${bonusForm()}</div>`;
};
function scoreForm(ev){
  const teams=state.teams;
  if(ev.scoring_type==='placement'){
    return `<div class="mut small" style="margin-bottom:8px">Rank teams. Each ranked team's members get the place points. (1st ${P().first} · 2nd ${P().second} · 3rd ${P().third})</div>${[1,2,3,4].map(pl=>`<div class="inline" style="margin-bottom:8px"><div class="rank ${pl<4?'g'+pl:''}" style="width:40px">${pl<4?ordinal(pl):'…'}</div><select class="i place-sel" data-place="${pl}" style="flex:1"><option value="">— team —</option>${teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>`).join('')}<button class="btn primary block" data-saveplacement="${ev.id}">Save & award to members</button>`;
  }
  if(ev.scoring_type==='head2head'){
    return `<div class="grid g2"><label class="f"><span>Winner team</span><select class="i" id="h2hW"><option value="">—</option>${teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label><label class="f"><span>Loser team</span><select class="i" id="h2hL"><option value="">—</option>${teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label></div><div class="mut small" style="margin-bottom:8px">Winner's members get 1st-place points; loser's members get participation.</div><button class="btn primary block" data-saveh2h="${ev.id}">Save result</button>`;
  }
  if(ev.scoring_type==='best'||ev.scoring_type==='timed'){
    const timed=ev.scoring_type==='timed';
    return `<div class="mut small" style="margin-bottom:8px">Individual competitors. Enter each person's ${timed?'time in seconds (lowest wins)':'best attempt (highest wins)'}.</div><div id="bestRows">${bestRow()}</div><button class="btn ghost sm" data-addbest style="margin:6px 0 12px">+ Add competitor</button><button class="btn primary block" data-savebest="${ev.id}|${timed?'timed':'best'}">Rank & award points</button>`;
  }
  return `<div class="grid g2"><label class="f"><span>Give to</span><select class="i" id="manTarget">${teamOrGuestOptions()}</select></label><label class="f"><span>Points</span><input class="i" id="manP" type="number" value="10"></label></div><label class="f"><span>Reason</span><input class="i" id="manR" placeholder="Reason"></label><button class="btn primary block" data-savemanual="${ev.id}">Award points</button>`;
}
function bestRow(){return `<div class="inline best-row" style="margin-bottom:8px"><select class="i best-g" style="flex:2"><option value="">— competitor —</option>${state.guests.map(g=>`<option value="${g.id}">${esc(g.display_name)} (${esc(g.family)})</option>`).join('')}</select><input class="i best-v" style="flex:1" type="number" step="any" placeholder="value"></div>`;}
function teamOrGuestOptions(){return `<optgroup label="Teams (→ all members)">${state.teams.map(t=>`<option value="t:${t.id}">${esc(t.name)}</option>`).join('')}</optgroup><optgroup label="Individuals">${state.guests.map(g=>`<option value="g:${g.id}">${esc(g.display_name)}</option>`).join('')}</optgroup>`;}
function bonusForm(){
  const reasons=['Great celebration','Best trash talk','Questionable athletic decision','Sportsmanship','Rule violation','Participation bonus'];
  return `<div class="grid g2"><label class="f"><span>Give to</span><select class="i" id="bonTarget">${teamOrGuestOptions()}</select></label><label class="f"><span>Points (+/-)</span><input class="i" id="bonP" type="number" value="3"></label></div><label class="f"><span>Reason</span><select class="i" onchange="if(this.value)document.getElementById('bonR').value=this.value"><option value="">Custom…</option>${reasons.map(r=>`<option>${r}</option>`).join('')}</select></label><input class="i" id="bonR" placeholder="Reason" style="margin-bottom:10px"><button class="btn ok block" data-savebonus>Apply</button>`;
}
function eventResults(eid){
  const rows=state.scores.filter(s=>s.event_id===eid).slice().reverse().slice(0,40);
  if(!rows.length)return '<div class="mut small">No results yet.</div>';
  return rows.map(s=>`<div class="row" style="padding:9px 12px"><div class="swatch" style="background:${s.team_id?teamColor(s.team_id):'#889'}"></div><div class="grow"><div class="name" style="font-size:14px">${esc(s.guest_id?guestName(s.guest_id):(s.team_id?teamName(s.team_id):'—'))}</div><div class="meta">${s.place?ordinal(s.place)+' · ':''}${s.note?esc(s.note.replace(/^\[[^\]]+\]\s*/,''))+' · ':''}${s.points>=0?'+':''}${s.points} pts</div></div><button class="btn xs bad" data-delscore="${s.id}">✕</button></div>`).join('');
}

/* ---------- CORNHOLE (host) — win by 2, feeds a bracket match ---------- */
VIEWS.cornhole=function(){
  const chEv=state.events.find(e=>e.name==='Cornhole');
  const ready=state.matches.filter(m=>chEv&&m.event_id===chEv.id&&m.status!=='bye'&&m.a_signup_id&&m.b_signup_id&&m.status!=='complete');
  const c=window.__ch||(window.__ch={matchId:'',a:0,b:0,hist:[]});
  const m=state.matches.find(x=>x.id===c.matchId);
  const A=m?signupLabel(state.signups.find(s=>s.id===m.a_signup_id)):'Team A';
  const B=m?signupLabel(state.signups.find(s=>s.id===m.b_signup_id)):'Team B';
  const win=cornholeWinner(c.a,c.b);
  return `<div class="section-title"><div><div class="eyebrow">Play to 21 · Win by 2</div><h1 class="disp">Cornhole</h1></div></div>
  <label class="f"><span>Cornhole match</span><select class="i" data-chmatch><option value="">— pick a ready match —</option>${ready.map(x=>`<option value="${x.id}" ${c.matchId===x.id?'selected':''}>${esc(signupLabel(state.signups.find(s=>s.id===x.a_signup_id)))} vs ${esc(signupLabel(state.signups.find(s=>s.id===x.b_signup_id)))}</option>`).join('')}</select></label>
  ${!ready.length?'<div class="helpbox">Generate the Cornhole bracket first (Brackets tab), then ready matches appear here.</div>':''}
  <div class="grid g2">
    <div class="ch-team" style="border:2px solid var(--sun2)"><div class="ch-name">${esc(A)}</div><div class="ch-score" style="color:var(--sun3)">${c.a}</div><div class="mut small">${win==='A'?'🏆 WINNER':(c.a>=21&&!win?'game point':'')}</div><div class="ch-btnrow"><button class="ch-b minus" data-ch="A|-1">−1</button><button class="ch-b" data-ch="A|1">+1</button><button class="ch-b" data-ch="A|3">+3</button></div></div>
    <div class="ch-team" style="border:2px solid var(--teal)"><div class="ch-name">${esc(B)}</div><div class="ch-score" style="color:var(--teal)">${c.b}</div><div class="mut small">${win==='B'?'🏆 WINNER':(c.b>=21&&!win?'game point':'')}</div><div class="ch-btnrow"><button class="ch-b minus" data-ch="B|-1">−1</button><button class="ch-b" data-ch="B|1">+1</button><button class="ch-b" data-ch="B|3">+3</button></div></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="kv"><span>Status</span><span style="color:var(--bone)">${win?(win==='A'?A:B)+' wins '+c.a+'–'+c.b:(c.a>=21||c.b>=21?'Must win by 2':'In progress')}</span></div><div class="btnrow" style="margin-top:12px"><button class="btn ghost" data-chundo>↶ Undo</button><button class="btn ghost" data-chreset>Reset</button><button class="btn primary" data-chsave ${win&&m?'':'disabled style="opacity:.5"'}>Save winner → advance bracket</button></div></div>`;
};
const cornholeWinner=(a,b)=> (a>=21&&a-b>=2)?'A':(b>=21&&b-a>=2)?'B':'';

/* ---------- VOTING ---------- */
VIEWS.voting=function(){
  if(isHost()&&window.__voteAdmin!==false)return votingAdminView();
  return `${isHost()?`<div class="btnrow" style="margin-bottom:12px"><button class="btn sm ghost" data-votemode="admin">Admin control</button><button class="btn sm primary" data-votemode="guest">Ballot preview</button></div>`:''}${guestBallotView()}`;
};
function guestBallotView(){
  const voter=window.__voter||getMe()||'';window.__voter=voter;
  const open=state.awards.filter(a=>a.is_open&&a.award_type==='vote');
  return `<div class="card" style="max-width:520px;margin:0 auto"><div class="center" style="margin-bottom:12px"><div class="disp" style="font-size:26px;color:var(--sun3)">OFSC Awards Voting</div><div class="mut small">One vote per award.</div></div>
  ${voter?`<div class="inline" style="justify-content:space-between;margin-bottom:10px"><span class="pill ok">Voting as ${esc(guestName(voter))}</span><button class="btn xs ghost" data-clearme>Not you?</button></div>`:`<label class="f"><span>Who are you?</span><select class="i" data-voter><option value="">— select your name —</option>${state.guests.map(g=>`<option value="${g.id}">${esc(g.display_name)}</option>`).join('')}</select></label>`}
  ${!voter?'<div class="mut small center">Select your name to see open awards.</div>':(!open.length?'<div class="empty">No awards are open right now.</div>':open.map(a=>{const already=state.votes.some(v=>v.award_id===a.id&&v.voter_id===voter);const noms=nominees(a);return `<div class="divider"></div><div class="disp" style="font-size:18px">${esc(a.name)}</div><div class="mut small" style="margin-bottom:8px">${esc(a.description)}</div>${already?'<div class="pill ok">✓ You already voted</div>':`<select class="i ballot-nom" data-award="${a.id}" style="margin-bottom:8px"><option value="">— choose —</option>${noms.map(n=>`<option value="${n.id}">${esc(n.label)}</option>`).join('')}</select><input class="i ballot-cm" data-award="${a.id}" placeholder="Optional comment" style="margin-bottom:8px"><button class="btn primary block sm" data-castvote="${a.id}">Submit vote</button>`}`;}).join(''))}</div>`;
}
function nominees(a){if(a.subject==='team')return state.teams.map(t=>({id:t.id,label:t.name}));if(a.subject==='kid')return state.guests.filter(g=>g.kind==='kid').map(g=>({id:g.id,label:g.display_name+' ('+g.family+')'}));return state.guests.map(g=>({id:g.id,label:g.display_name+' ('+g.family+')'}));}
function nomineeLabel(a,id){return a.subject==='team'?teamName(id):guestName(id);}
function voteTally(aid){const a=state.awards.find(x=>x.id===aid);const c={};state.votes.filter(v=>v.award_id===aid).forEach(v=>c[v.nominee_id]=(c[v.nominee_id]||0)+1);return Object.entries(c).map(([id,count])=>({id,count,label:nomineeLabel(a,id)})).sort((x,y)=>y.count-x.count);}
function votingAdminView(){
  return `<div class="section-title"><div><div class="eyebrow">The Voters Have Spoken</div><h1 class="disp">Voting</h1></div></div>
  <div class="btnrow" style="margin-bottom:12px"><button class="btn sm primary" data-votemode="admin">Admin control</button><button class="btn sm ghost" data-votemode="guest">Ballot preview</button></div>
  <div class="btnrow" style="margin-bottom:12px"><button class="btn teal" data-voteall="open">Open all</button><button class="btn ghost" data-voteall="close">Close all</button></div>
  ${state.awards.filter(a=>a.award_type==='vote').map(a=>{const t=voteTally(a.id);const total=t.reduce((s,x)=>s+x.count,0);return `<div class="card" style="padding:14px"><div class="inline" style="justify-content:space-between"><div><div class="disp" style="font-size:19px">${esc(a.name)}</div><div class="mut small">${esc(a.description)}</div></div>${a.is_open?'<span class="pill live">Open</span>':'<span class="pill done">Closed</span>'}</div><div class="kv" style="margin-top:8px"><span>Votes</span><span>${total}</span></div><div class="kv"><span>Leader</span><span style="color:var(--sun3)">${t[0]?esc(t[0].label)+' ('+t[0].count+')':'—'}</span></div>${a.winner_id?`<div class="kv"><span>Locked winner</span><span style="color:var(--gold)">🏆 ${esc(nomineeLabel(a,a.winner_id))}</span></div>`:''}<div class="btnrow" style="margin-top:10px"><button class="btn xs ${a.is_open?'ghost':'teal'}" data-awardopen="${a.id}">${a.is_open?'Close':'Open'}</button><button class="btn xs ghost" data-awardwinner="${a.id}">Set winner</button><button class="btn xs bad" data-awardreset="${a.id}">Reset votes</button></div></div>`;}).join('')}`;
}

/* ---------- AWARDS (host) ---------- */
VIEWS.awards=function(){
  return `<div class="section-title"><div><div class="eyebrow">History Will Remember</div><h1 class="disp">Awards</h1></div></div>
  <button class="btn primary big block" data-act="launchAwards" style="margin-bottom:14px">🏆 Launch Awards Ceremony</button>
  ${state.awards.map(a=>{let w='—';if(a.winner_id)w=nomineeLabel(a,a.winner_id);else if(a.award_type==='points'){const idx={'Family Gold Medal':0,'Family Silver Medal':1,'Family Bronze Medal':2}[a.name];const st=teamStandings();if(st[idx])w=st[idx].t.name+' (auto)';}else if(a.award_type==='vote'){const t=voteTally(a.id);if(t[0])w=t[0].label+' (leading)';}return `<div class="card" style="padding:13px"><div class="inline" style="justify-content:space-between"><div><div class="disp" style="font-size:18px">${esc(a.name)}</div><div class="mut small">${esc(a.description)}</div></div><span class="pill ${a.award_type==='vote'?'':a.award_type==='points'?'ok':'warn'}">${a.award_type}</span></div><div class="kv" style="margin-top:8px"><span>Winner</span><span style="color:var(--gold)">${a.locked?'🔒 ':''}${esc(w)}</span></div><div class="btnrow" style="margin-top:8px"><button class="btn xs ghost" data-awardwinner="${a.id}">Set winner</button><button class="btn xs ${a.locked?'ok':'ghost'}" data-awardlock="${a.id}">${a.locked?'🔒 Locked':'Lock'}</button></div></div>`;}).join('')}`;
};

/* ---------- ANNOUNCEMENTS (host) ---------- */
VIEWS.announcements=function(){
  const presets=['Cornhole finalists report to the driveway.','Sponge Dodgeball begins in 10 minutes.','Dinner is ready.','Awards voting is now open. Scan the QR code.','Tug of War teams report to the yard.'];
  return `<div class="section-title"><div><div class="eyebrow">Report To The Arena</div><h1 class="disp">Announcements</h1></div></div>
  <div class="card"><label class="f"><span>New announcement</span><input class="i" id="annInput" placeholder="Message for the TV…"></label><div class="btnrow" style="margin-bottom:10px">${presets.map(p=>`<button class="btn xs ghost" data-annpreset="${esc(p)}">${esc(p.slice(0,20))}…</button>`).join('')}</div><button class="btn primary block" data-annadd>Post</button></div>
  <div class="spacer"></div>
  ${state.announcements.slice().reverse().map(a=>`<div class="row"><button class="btn xs ${a.active?'ok':'ghost'}" data-anntoggle="${a.id}|${a.active}">${a.active?'● On TV':'Off'}</button><div class="grow"><div class="name" style="font-size:14px;white-space:normal">${esc(a.body)}</div></div><button class="btn xs bad" data-anndel="${a.id}">✕</button></div>`).join('')||'<div class="empty">No announcements.</div>'}`;
};

/* ---------- TV (host) ---------- */
VIEWS.tv=function(){
  const t=state.settings.tv||{screens:[],rotateSec:14};
  const all=[['now','Now Competing'],['next','Next Up'],['standings','Standings'],['bracket','Live Bracket'],['results','Recent Results'],['schedule','Schedule'],['voteqr','Voting QR'],['signupqr','Signup QR'],['medals','Medals'],['announce','Announcements']];
  return `<div class="section-title"><div><div class="eyebrow">Readable Across The Yard</div><h1 class="disp">TV Mode</h1></div></div>
  <button class="btn primary big block" data-act="launchTV" style="margin-bottom:14px">📺 Launch TV Display</button>
  <div class="card"><label class="f"><span>Seconds per screen: ${t.rotateSec}s</span><input class="i" type="range" min="6" max="30" value="${t.rotateSec}" data-tvrotate></label><div class="divider"></div><div class="disp" style="font-size:16px;margin-bottom:8px">Screens in rotation</div>${all.map(s=>`<label class="checkline"><input type="checkbox" data-tvscreen="${s[0]}" ${(t.screens||[]).includes(s[0])?'checked':''}><span>${s[1]}</span></label>`).join('')}<div class="helpbox" style="margin-top:10px">Connect the laptop to the TV, open this page, hit Launch, then press F11 for full screen.</div></div>`;
};

/* ---------- ADMIN / HOST LOGIN ---------- */
VIEWS.admin=function(){
  if(!isHost()){
    return `<div class="section-title"><div><div class="eyebrow">Committee Access</div><h1 class="disp">Host Login</h1></div></div>
    <div class="card" style="max-width:420px"><label class="f"><span>Email</span><input class="i" id="loginEmail" type="email" autocomplete="username"></label><label class="f"><span>Password</span><input class="i" id="loginPass" type="password" autocomplete="current-password"></label><button class="btn primary block" data-login>Sign in</button><div class="mut small" style="margin-top:10px">Only the hosts sign in. Guests never need to — they can view, sign up, and vote freely.</div></div>`;
  }
  const m=state.settings;
  return `<div class="section-title"><div><div class="eyebrow">The Committee</div><h1 class="disp">Admin</h1></div></div>
  <div class="loginbar" style="margin-bottom:12px"><span class="pill ok">Signed in as ${esc(session.user.email)}</span><button class="btn sm ghost" data-logout>Sign out</button></div>
  <div class="card"><div class="disp" style="font-size:18px;margin-bottom:10px">Event</div>
    <label class="f"><span>Event name</span><input class="i" data-meta="event_name" value="${esc(m.event_name||'')}"></label>
    <label class="f"><span>Date</span><input class="i" data-meta="date_label" value="${esc(m.date_label||'')}"></label>
    <label class="f"><span>Public app URL (for QR codes)</span><input class="i" data-meta="public_url" value="${esc(m.public_url||'')}" placeholder="https://your-app.vercel.app"></label>
  </div>
  <div class="card"><div class="disp" style="font-size:18px;margin-bottom:10px">Set current / next event</div>
    <div class="grid g2"><label class="f"><span>Now competing</span><select class="i" data-meta="current_event_id"><option value="">—</option>${state.events.map(e=>`<option value="${e.id}" ${m.current_event_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Next up</span><select class="i" data-meta="next_event_id"><option value="">—</option>${state.events.map(e=>`<option value="${e.id}" ${m.next_event_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label></div>
  </div>
  <div class="card"><div class="disp" style="font-size:18px;margin-bottom:10px">Point values</div><div class="grid g4">${['first','second','third','participation'].map(k=>`<label class="f"><span>${k}</span><input class="i" type="number" data-pts="${k}" value="${(m.points||{})[k]||0}"></label>`).join('')}</div></div>
  <div class="card"><div class="disp" style="font-size:18px;margin-bottom:10px">Data</div><div class="btnrow"><button class="btn teal" data-act="exportAll">⬇ Export JSON backup</button><button class="btn ghost sm" data-export="scores">Scores CSV</button><button class="btn ghost sm" data-export="votes">Votes CSV</button></div></div>
  <div class="card"><div class="disp" style="font-size:18px;margin-bottom:10px">Reset & demo controls</div>
    <div class="btnrow"><button class="btn ghost sm" data-act="resetStatuses">↺ Reset event/schedule statuses</button><button class="btn bad sm" data-act="clearBrackets">Clear all brackets</button><button class="btn bad sm" data-act="clearSignups">Clear all sign-ups</button><button class="btn bad sm" data-act="clearScores">Clear all scores</button><button class="btn bad sm" data-act="clearVotes">Clear all votes</button></div>
    <div class="mut small" style="margin-top:8px">Use <b>Clear all sign-ups</b> to wipe the demo entrants before the real event. Each button asks to confirm.</div>
  </div>
  <div class="card"><div class="disp" style="font-size:18px;margin-bottom:10px">Teams & guests</div><div class="btnrow"><button class="btn ghost sm" data-nav="managers|teams">Manage teams</button><button class="btn ghost sm" data-nav="managers|guests">Manage guests</button></div></div>`;
};

/* ---------- lightweight team/guest managers (host) via modal ---------- */
function manageTeams(){openModal('Teams',state.teams.map(t=>`<div class="row" style="padding:9px 12px"><div class="swatch" style="background:${t.color}"></div><div class="grow"><div class="name" style="font-size:14px">${esc(t.name)}</div><div class="meta">${esc(t.family)} · ${teamPoints(t.id)} pts</div></div><button class="btn xs ghost" data-editteam="${t.id}">Edit</button></div>`).join(''),`<button class="btn ghost" data-close>Close</button>`);}
function manageGuests(){openModal('Guests ('+state.guests.length+')','<button class="btn primary sm block" data-addguest style="margin-bottom:10px">+ Add guest</button>'+state.guests.map(g=>`<div class="row" style="padding:9px 12px"><div class="grow"><div class="name" style="font-size:14px">${esc(g.display_name)} ${g.kind==='kid'?'<span class="tag">kid</span>':''}</div><div class="meta">${esc(g.family)} · ${g.team_id?esc(teamName(g.team_id)):'no team'}</div></div><button class="btn xs ghost" data-editguest="${g.id}">Edit</button></div>`).join(''),`<button class="btn ghost" data-close>Close</button>`);}
function editTeamModal(id){const t=team(id);const colors=['#E43B2E','#F5821F','#FFC021','#2FB84C','#16C0C9','#1E9BD7','#8B5CF6','#EC4899','#F97316','#22C55E','#06B6D4','#6366F1','#EF4444','#A855F7','#EAB308'];openModal('Edit '+t.name,`<label class="f"><span>Team name</span><input class="i" id="etN" value="${esc(t.name)}"></label><label class="f"><span>Color</span><div class="inline">${colors.map(c=>`<button class="swatch" style="width:28px;height:28px;background:${c};outline:${t.color===c?'3px solid #fff':'none'}" data-pickcolor="${c}"></button>`).join('')}<input class="i" id="etC" value="${esc(t.color)}" style="width:110px"></div></label><label class="f"><span>Entrance song</span><input class="i" id="etSong" value="${esc(t.song||'')}"></label><label class="f"><span>Flag description</span><input class="i" id="etFlag" value="${esc(t.flag_desc||'')}"></label>`,`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-saveteam="${id}" style="margin-left:auto">Save</button>`);}
function editGuestModal(id){const g=id?guest(id):{display_name:'',family:'',kind:'adult',team_id:''};openModal(id?'Edit guest':'Add guest',`<label class="f"><span>Display name</span><input class="i" id="egN" value="${esc(g.display_name)}"></label><label class="f"><span>Family</span><input class="i" id="egF" value="${esc(g.family)}"></label><div class="grid g2"><label class="f"><span>Type</span><select class="i" id="egK"><option value="adult" ${g.kind==='adult'?'selected':''}>Adult</option><option value="kid" ${g.kind==='kid'?'selected':''}>Kid</option></select></label><label class="f"><span>Team</span><select class="i" id="egT"><option value="">—</option>${state.teams.map(t=>`<option value="${t.id}" ${g.team_id===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label></div>`,`${id?`<button class="btn bad" data-delguest="${id}">Delete</button>`:''}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-saveguest="${id||''}" style="margin-left:auto">Save</button>`);}

/* ================= FULLSCREEN TV + AWARDS ================= */
let tvTimer=null,tvIdx=0,awardIdx=0,awardRevealed=false,fsMode=null;
function launchFS(mode){fsMode=mode;$('#fs').classList.add('on');if(mode==='tv'){tvIdx=0;renderTV();startTV();}else{awardIdx=0;awardRevealed=false;renderAwards();}}
function exitFS(){$('#fs').classList.remove('on');clearInterval(tvTimer);fsMode=null;render();}
function startTV(){clearInterval(tvTimer);const t=state.settings.tv||{rotateSec:14};if(t.manual)return;tvTimer=setInterval(()=>{const sc=(t.screens||['now']);tvIdx=(tvIdx+1)%Math.max(1,sc.length);renderTV();},(t.rotateSec||14)*1000);}
function renderTV(){
  const t=state.settings.tv||{screens:['now'],rotateSec:14};const sc=(t.screens&&t.screens.length)?t.screens:['now'];const key=sc[tvIdx%sc.length];
  $('#fs').innerHTML=`<button class="fs-exit" data-fsexit>✕ Exit</button><div class="fs-top"><div class="brandmark">O</div><div><div class="disp" style="font-size:26px">${esc(state.settings.event_name||'OFSC OLYMPICS')}</div><div class="mut" style="letter-spacing:.18em;font-size:12px">${esc(state.settings.date_label||'')}</div></div><div style="margin-left:auto" class="disp" id="tvclock">${nowTime()}</div></div><div class="fs-body">${tvScreen(key)}</div><div class="fs-ctrl"><button class="btn sm" data-tvprev>‹</button><button class="btn sm" data-tvnext>›</button></div>`;
  const q=$('#fs [data-qr]');if(q)drawQR(q);
}
function tvScreen(key){
  const st=teamStandings();
  if(key==='now'){const e=evById(state.settings.current_event_id);return `<div class="eyebrow" style="font-size:16px;letter-spacing:.3em">Now Competing</div><div class="disp" style="font-size:11vw;color:var(--sun3);margin:10px 0">${e?esc(e.name):'Intermission'}</div><div style="font-size:3vw" class="mut">${e?esc(e.location||''):'Glory is temporary.'}</div>`;}
  if(key==='next'){const e=evById(state.settings.next_event_id);return `<div class="eyebrow" style="font-size:16px;letter-spacing:.3em;color:var(--teal)">Next Up</div><div class="disp" style="font-size:11vw;margin:10px 0">${e?esc(e.name):'—'}</div><div style="font-size:3vw" class="mut">Report to the Backyard Arena.</div>`;}
  if(key==='standings'||key==='medals'){const list=key==='medals'?st.slice().sort((a,b)=>b.medals.g-a.medals.g):st;return `<div class="eyebrow" style="font-size:16px;letter-spacing:.3em">${key==='medals'?'Medal Standings':'Team Standings'}</div><div style="margin-top:12px">${list.slice(0,7).map((r,i)=>`<div style="display:flex;align-items:center;gap:2vw;padding:1vh 0;border-bottom:1px solid var(--line)"><div class="disp" style="font-size:4.5vw;width:7vw;color:${i<3?['var(--gold)','var(--silver)','var(--bronze)'][i]:'var(--mute)'}">${i+1}</div><div style="width:2.2vw;height:2.2vw;border-radius:6px;background:${r.t.color}"></div><div class="disp" style="font-size:4vw;flex:1">${esc(r.t.name)}</div><div class="disp" style="font-size:4.5vw;color:var(--sun3)">${key==='medals'?'🥇'+r.medals.g+' 🥈'+r.medals.s:fmt(r.points)}</div></div>`).join('')}</div>`;}
  if(key==='bracket'){const bes=state.events.filter(e=>e.is_bracket);const ev=bes.find(e=>state.matches.some(m=>m.event_id===e.id))||bes[0];const ms=ev?state.matches.filter(m=>m.event_id===ev.id).sort((a,b)=>a.round-b.round||a.slot-b.slot):[];const rounds=[...new Set(ms.map(m=>m.round))];return `<div class="eyebrow" style="font-size:16px;letter-spacing:.3em">${ev?esc(ev.name):''} Bracket</div>${ms.length?`<div class="bracket tv-bracket" style="margin-top:10px">${rounds.map(r=>`<div class="bkt-round">${ms.filter(m=>m.round===r).map(m=>matchCardTV(m)).join('')}</div>`).join('')}</div>`:'<div class="mut" style="font-size:3vw;margin-top:2vh">Bracket not drawn yet.</div>'}`;}
  if(key==='results'){const rec=state.scores.slice(-6).reverse();return `<div class="eyebrow" style="font-size:16px;letter-spacing:.3em">Recent Results</div><div style="margin-top:14px;font-size:3.2vw">${rec.map(s=>`<div style="padding:1vh 0;border-bottom:1px solid var(--line)"><b style="color:var(--sun3)">${esc(s.guest_id?guestName(s.guest_id):teamName(s.team_id))}</b> — ${esc(eventName(s.event_id))} ${s.points>=0?'+':''}${s.points}</div>`).join('')||'<div class="mut">Awaiting results…</div>'}</div>`;}
  if(key==='schedule'){return `<div class="eyebrow" style="font-size:16px;letter-spacing:.3em">Schedule</div><div style="margin-top:12px;font-size:2.8vw">${state.schedule.filter(b=>b.status!=='complete').slice(0,8).map(b=>`<div style="display:flex;gap:2vw;padding:.8vh 0;border-bottom:1px solid var(--line)"><b class="disp" style="width:15vw;color:var(--teal)">${esc(b.time_label)}</b><span>${esc(b.title)}</span></div>`).join('')}</div>`;}
  if(key==='voteqr'||key==='signupqr'){const isV=key==='voteqr';const url=(state.settings.public_url||location.href.split('#')[0])+(isV?'#vote':'#signup');return `<div class="center"><div class="disp" style="font-size:6vw;color:var(--sun3)">${isV?'Scan to Vote':'Scan to Sign Up'}</div><div class="mut" style="font-size:2.6vw;margin:6px 0 18px">${isV?'OFSC Awards':'Cornhole, Tetherball, KanJam, Spikeball, Bocce'}</div><div class="qrbox"><div data-qr="${esc(url)}"></div></div><div class="mut" style="font-size:1.6vw;margin-top:12px;word-break:break-all">${state.settings.public_url?esc(url):'Set Public app URL in Admin.'}</div></div>`;}
  if(key==='announce'){const act=state.announcements.filter(a=>a.active);return `<div class="eyebrow" style="font-size:16px;letter-spacing:.3em">Announcements</div><div style="margin-top:16px">${act.map(a=>`<div class="disp" style="font-size:5vw;margin:2vh 0;color:var(--sun3)">${esc(a.body)}</div>`).join('')||'<div class="mut" style="font-size:3vw">Medical professionals remain theoretical.</div>'}</div>`;}
  return '';
}
function matchCardTV(m){const a=state.signups.find(s=>s.id===m.a_signup_id),b=state.signups.find(s=>s.id===m.b_signup_id);const win=m.winner_signup_id;const slot=(su,side)=>{const isWin=win&&su&&su.id===win;const isBye=(side==='a'?!m.a_signup_id:!m.b_signup_id)&&m.status==='bye';return `<div class="bkt-slot ${isWin?'win':''} ${isBye?'bye':''}"><span class="nm">${su?esc(signupLabel(su)):(isBye?'bye':'—')}</span></div>`;};return `<div class="bkt-match">${slot(a,'a')}${slot(b,'b')}</div>`;}

function renderAwards(){
  const list=state.awards;const a=list[awardIdx%list.length];
  let winner='',runner='',count='';
  if(a.winner_id)winner=nomineeLabel(a,a.winner_id);
  else if(a.award_type==='points'){const idx={'Family Gold Medal':0,'Family Silver Medal':1,'Family Bronze Medal':2}[a.name];const st=teamStandings();if(st[idx])winner=st[idx].t.name;}
  else{const t=voteTally(a.id);if(t[0]){winner=t[0].label;count=t[0].count;}if(t[1])runner=t[1].label;}
  const intros=['And the OFSC voters have spoken.','After careful review and several deeply biased ballots…','This award recognizes courage, chaos, and no self-preservation.','The committee accepts no responsibility for hurt feelings.'];
  $('#fs').innerHTML=`<button class="fs-exit" data-fsexit>✕ Exit</button><div class="fs-top"><div class="brandmark">O</div><div class="disp" style="font-size:24px">OFSC Awards Ceremony</div><div style="margin-left:auto" class="mut">${awardIdx+1}/${list.length}</div></div><div class="fs-body center"><div class="eyebrow" style="font-size:2vw;letter-spacing:.3em">${a.award_type==='points'?'By the numbers':a.award_type==='vote'?'The voters have spoken':'Committee selection'}</div><div class="disp" style="font-size:8vw;margin:1vh 0;color:var(--sun3)">${esc(a.name)}</div><div class="mut" style="font-size:2.2vw;max-width:70vw;margin:0 auto 3vh">${esc(a.description)}</div>${awardRevealed?`<div class="mut" style="font-size:1.9vw;font-style:italic;margin-bottom:1vh">${esc(intros[awardIdx%intros.length])}</div><div class="disp" style="font-size:11vw;color:var(--gold)">${esc(winner||'—')}</div>${runner?`<div class="mut" style="font-size:2.2vw;margin-top:1vh">Runner-up: ${esc(runner)}</div>`:''}${count&&!state.settings.results_hidden?`<div class="mut" style="font-size:1.8vw">${count} votes</div>`:''}`:`<div class="disp" style="font-size:6vw;color:var(--mute2)">▓▓▓▓▓</div>`}</div><div class="fs-ctrl"><button class="btn sm" data-awardprev>‹ Prev</button><button class="btn ${awardRevealed?'ghost':'primary'} sm" data-awardreveal>${awardRevealed?'Hide':'Reveal winner'}</button><button class="btn sm" data-awardnext>Next ›</button></div>`;
}
function drawQR(el){const url=el.getAttribute('data-qr');el.innerHTML='';if(window.QRCode){try{new QRCode(el,{text:url,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});return;}catch(e){}}el.innerHTML=`<div style="width:220px;padding:20px;color:#111;font-size:12px;word-break:break-all;text-align:center">${esc(url)}</div>`;}

/* ================= BRACKET ENGINE ================= */
function powCeil(n){let s=1;while(s<n)s*=2;return s;}
function seedOrder(size){let pods=[1,2];while(pods.length<size){const sum=pods.length*2+1;const out=[];for(const p of pods){out.push(p);out.push(sum-p);}pods=out;}return pods;}
function buildMatches(eventId,orderedIds){
  const size=powCeil(orderedIds.length);
  const order=seedOrder(size);
  const slots=order.map(seed=>orderedIds[seed-1]||null);
  const rounds=Math.log2(size);
  const byRound=[];
  let r1=[];for(let i=0;i<size;i+=2)r1.push({id:crypto.randomUUID(),event_id:eventId,round:1,slot:i/2,a_signup_id:slots[i],b_signup_id:slots[i+1],status:'pending'});
  byRound.push(r1);
  for(let r=2;r<=rounds;r++){const prev=byRound[r-2];const cur=[];for(let j=0;j<prev.length/2;j++)cur.push({id:crypto.randomUUID(),event_id:eventId,round:r,slot:j,a_signup_id:null,b_signup_id:null,status:'pending'});prev.forEach((m,idx)=>{m.next_match_id=cur[Math.floor(idx/2)].id;m.next_side=idx%2===0?'a':'b';});byRound.push(cur);}
  const all=byRound.flat();
  // resolve byes in round 1
  r1.forEach(m=>{const aN=!m.a_signup_id,bN=!m.b_signup_id;if(aN!==bN){const w=m.a_signup_id||m.b_signup_id;m.winner_signup_id=w;m.status='bye';if(m.next_match_id){const nm=all.find(x=>x.id===m.next_match_id);nm[m.next_side==='a'?'a_signup_id':'b_signup_id']=w;}}});
  all.forEach(m=>{if(m.status!=='bye'&&m.a_signup_id&&m.b_signup_id)m.status='ready';});
  return all;
}
async function generateBracket(eventId,orderedIds){
  if(orderedIds.length<2){toast('Need at least 2 entrants','err');return;}
  await sb.from('matches').delete().eq('event_id',eventId);
  await sb.from('scores').delete().eq('event_id',eventId).like('note','[%');
  const all=buildMatches(eventId,orderedIds);
  const{error}=await sb.from('matches').insert(all);
  if(error){toast(error.message,'err');return;}
  await loadAndRender();toast('Bracket drawn — '+orderedIds.length+' entrants');
}
async function setMatchResult(matchId,winnerSignupId,aScore,bScore){
  const m=state.matches.find(x=>x.id===matchId);if(!m)return;
  const ev=evById(m.event_id);const bp=state.settings.bracket_points||{champion:15,runnerup:10,win:3};
  await sb.from('scores').delete().like('note',`[m:${matchId}]%`);
  await upd('matches',matchId,{winner_signup_id:winnerSignupId,a_score:aScore??null,b_score:bScore??null,status:'complete'});
  const winSu=state.signups.find(s=>s.id===winnerSignupId);
  const winPlayers=[winSu.player1_id,winSu.player2_id].filter(Boolean);
  for(const pid of winPlayers)await ins('scores',{event_id:m.event_id,guest_id:pid,points:bp.win||0,note:`[m:${matchId}] Won ${ev.name} R${m.round}`});
  if(m.next_match_id){const patch={};patch[m.next_side==='a'?'a_signup_id':'b_signup_id']=winnerSignupId;await upd('matches',m.next_match_id,patch);
    // set ready if both filled
    const nm=state.matches.find(x=>x.id===m.next_match_id);if(nm){const a=m.next_side==='a'?winnerSignupId:nm.a_signup_id;const b=m.next_side==='b'?winnerSignupId:nm.b_signup_id;if(a&&b)await upd('matches',m.next_match_id,{status:'ready'});}
  }else{
    await sb.from('scores').delete().like('note',`[champ:${m.event_id}]%`);
    await sb.from('scores').delete().like('note',`[runner:${m.event_id}]%`);
    const loseSu=state.signups.find(s=>s.id===(m.a_signup_id===winnerSignupId?m.b_signup_id:m.a_signup_id));
    for(const pid of winPlayers)await ins('scores',{event_id:m.event_id,guest_id:pid,points:bp.champion||0,place:1,note:`[champ:${m.event_id}] ${ev.name} Champion`});
    if(loseSu)for(const pid of [loseSu.player1_id,loseSu.player2_id].filter(Boolean))await ins('scores',{event_id:m.event_id,guest_id:pid,points:bp.runnerup||0,place:2,note:`[runner:${m.event_id}] ${ev.name} Runner-up`});
    await upd('events',ev.id,{status:'complete'});
  }
  await loadAndRender();toast('Result saved & points awarded');
}

/* ================= INTERACTIONS ================= */
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.matches('[data-scselect]')){window.__scEvent=t.value;render();}
  else if(t.matches('[data-sctype]')){await upd('events',t.dataset.sctype,{scoring_type:t.value});await loadAndRender();}
  else if(t.matches('[data-suevent]')){}
  else if(t.matches('[data-voter]')){window.__voter=t.value;setMe(t.value);render();}
  else if(t.matches('[data-chmatch]')){window.__ch={matchId:t.value,a:0,b:0,hist:[]};render();}
  else if(t.matches('[data-meta]')){await upd('settings',1,{[t.dataset.meta]:t.value||null});await loadAll();if(t.dataset.meta==='event_name')$('#topName').textContent=t.value;}
  else if(t.matches('[data-pts]')){const p={...(state.settings.points||{})};p[t.dataset.pts]=+t.value||0;await upd('settings',1,{points:p});await loadAll();}
  else if(t.matches('[data-tvscreen]')){const k=t.dataset.tvscreen;const tv={...(state.settings.tv||{screens:[]})};tv.screens=tv.screens||[];if(t.checked){if(!tv.screens.includes(k))tv.screens.push(k);}else tv.screens=tv.screens.filter(x=>x!==k);await upd('settings',1,{tv});await loadAll();}
});
document.addEventListener('input',e=>{const t=e.target;
  if(t.matches('[data-tvrotate]')){const tv={...(state.settings.tv||{})};tv.rotateSec=+t.value;state.settings.tv=tv;const lab=t.closest('label');if(lab)lab.querySelector('span').textContent='Seconds per screen: '+t.value+'s';clearTimeout(window.__tvSave);window.__tvSave=setTimeout(()=>upd('settings',1,{tv}),500);}
});

document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-nav],[data-more],[data-close],[data-act],[data-lb],[data-blockstatus],[data-suevent],[data-dosignup],[data-delsignup],[data-bkevent],[data-genbracket],[data-seedbracket],[data-matchresult],[data-saveplacement],[data-saveh2h],[data-savebest],[data-addbest],[data-savemanual],[data-savebonus],[data-completeevent],[data-delscore],[data-ch],[data-chundo],[data-chreset],[data-chsave],[data-votemode],[data-voteall],[data-awardopen],[data-awardwinner],[data-awardreset],[data-awardlock],[data-castvote],[data-annadd],[data-annpreset],[data-anntoggle],[data-anndel],[data-login],[data-logout],[data-export],[data-fsexit],[data-tvprev],[data-tvnext],[data-awardprev],[data-awardnext],[data-awardreveal],[data-editteam],[data-editguest],[data-addguest],[data-saveteam],[data-saveguest],[data-delguest],[data-pickcolor],[data-savewinner],[data-shuffleseed],[data-seedmove],[data-dogenerate],[data-submitresult],[data-clearme],[data-clearevsignups]');
  if(!el)return;const d=el.dataset;

  if('nav'in d){if(d.nav.startsWith('managers|')){d.nav.split('|')[1]==='teams'?manageTeams():manageGuests();}else go(d.nav);return;}
  if('more'in d){openMore();return;}
  if('close'in d){if(e.target.matches('[data-close]')||e.target.closest('.x'))closeModal();return;}
  if('lb'in d){window.__lb=d.lb;render();return;}
  if('suevent'in d){window.__suEvent=d.suevent;render();return;}
  if('bkevent'in d){window.__bkEvent=d.bkevent;render();return;}
  if('clearme'in d){clearMe();return;}
  if('clearevsignups'in d){if(confirm('Clear sign-ups and bracket for this event?')){await sb.from('matches').delete().eq('event_id',d.clearevsignups);await sb.from('bracket_signups').delete().eq('event_id',d.clearevsignups);await sb.from('scores').delete().eq('event_id',d.clearevsignups).like('note','[%');await upd('events',d.clearevsignups,{status:'not_started'});await loadAndRender();toast('Event cleared');}return;}
  if('votemode'in d){window.__voteAdmin=d.votemode==='admin';render();return;}

  if('act'in d){await handleAct(d.act);return;}

  /* schedule */
  if('blockstatus'in d){const[id,st]=d.blockstatus.split('|');await upd('schedule_blocks',id,{status:st});await loadAndRender();return;}
  if('completeevent'in d){const ev=evById(d.completeevent);await upd('events',ev.id,{status:ev.status==='complete'?'not_started':'complete'});await loadAndRender();return;}

  /* signup */
  if('dosignup'in d){await doSignup(d.dosignup);return;}
  if('delsignup'in d){await del('bracket_signups',d.delsignup);await loadAndRender();return;}

  /* brackets */
  if('genbracket'in d){const ids=shuffle(state.signups.filter(s=>s.event_id===d.genbracket).map(s=>s.id));await generateBracket(d.genbracket,ids);return;}
  if('seedbracket'in d){seedModal(d.seedbracket);return;}
  if('shuffleseed'in d){window.__seedOrder=shuffle(window.__seedOrder||[]);seedModalBody(window.__seedEvent);return;}
  if('seedmove'in d){const[i,dir]=d.seedmove.split('|').map(Number);const a=window.__seedOrder;const j=i+dir;if(j>=0&&j<a.length){[a[i],a[j]]=[a[j],a[i]];}seedModalBody(window.__seedEvent);return;}
  if('dogenerate'in d){closeModal();await generateBracket(window.__seedEvent,window.__seedOrder.slice());return;}
  if('matchresult'in d){resultModal(d.matchresult);return;}
  if('submitresult'in d){const wid=$('#resWinner').value;if(!wid){toast('Pick a winner','err');return;}const a=$('#resA')?+$('#resA').value:null;const b=$('#resB')?+$('#resB').value:null;closeModal();await setMatchResult(d.submitresult,wid,isNaN(a)?null:a,isNaN(b)?null:b);return;}

  /* scoring */
  if('saveplacement'in d){await savePlacement(d.saveplacement);return;}
  if('saveh2h'in d){await saveH2H(d.saveh2h);return;}
  if('savebest'in d){await saveBest(d.savebest);return;}
  if('addbest'in d){$('#bestRows').insertAdjacentHTML('beforeend',bestRow());return;}
  if('savemanual'in d){await saveManual(d.savemanual);return;}
  if('savebonus'in d){await saveBonus();return;}
  if('delscore'in d){await del('scores',d.delscore);await loadAndRender();return;}

  /* cornhole */
  if('ch'in d){const[side,amt]=d.ch.split('|');const c=window.__ch;c.hist.push({a:c.a,b:c.b});c[side==='A'?'a':'b']=Math.max(0,c[side==='A'?'a':'b']+ +amt);render();return;}
  if('chundo'in d){const c=window.__ch;if(c.hist.length){const p=c.hist.pop();c.a=p.a;c.b=p.b;render();}return;}
  if('chreset'in d){const c=window.__ch;c.a=0;c.b=0;c.hist=[];render();return;}
  if('chsave'in d){const c=window.__ch;const w=cornholeWinner(c.a,c.b);const m=state.matches.find(x=>x.id===c.matchId);if(!w||!m){toast('No winner yet','err');return;}const wid=w==='A'?m.a_signup_id:m.b_signup_id;await setMatchResult(c.matchId,wid,c.a,c.b);window.__ch={matchId:'',a:0,b:0,hist:[]};return;}

  /* voting */
  if('voteall'in d){for(const a of state.awards.filter(x=>x.award_type==='vote'))await upd('awards',a.id,{is_open:d.voteall==='open'});await loadAndRender();return;}
  if('awardopen'in d){const a=state.awards.find(x=>x.id===d.awardopen);await upd('awards',a.id,{is_open:!a.is_open});await loadAndRender();return;}
  if('awardreset'in d){if(confirm('Reset votes for this award?')){await sb.from('votes').delete().eq('award_id',d.awardreset);await loadAndRender();}return;}
  if('awardwinner'in d){winnerModal(d.awardwinner);return;}
  if('savewinner'in d){const a=state.awards.find(x=>x.id===d.savewinner);const v=$('#winSel').value;await upd('awards',a.id,{winner_id:v||null,winner_type:a.subject==='team'?'team':'guest'});closeModal();await loadAndRender();return;}
  if('awardlock'in d){const a=state.awards.find(x=>x.id===d.awardlock);let wid=a.winner_id;if(!wid){if(a.award_type==='vote'){const t=voteTally(a.id);if(t[0])wid=t[0].id;}else if(a.award_type==='points'){const idx={'Family Gold Medal':0,'Family Silver Medal':1,'Family Bronze Medal':2}[a.name];const st=teamStandings();if(st[idx])wid=st[idx].t.id;}}await upd('awards',a.id,{locked:!a.locked,winner_id:wid||null,winner_type:a.subject==='team'?'team':'guest'});await loadAndRender();return;}
  if('castvote'in d){await castVote(d.castvote);return;}

  /* announcements */
  if('annadd'in d){const v=$('#annInput').value.trim();if(v){await ins('announcements',{body:v,active:true});await loadAndRender();}return;}
  if('annpreset'in d){$('#annInput').value=d.annpreset;return;}
  if('anntoggle'in d){const[id,act]=d.anntoggle.split('|');await upd('announcements',id,{active:act!=='true'});await loadAndRender();return;}
  if('anndel'in d){await del('announcements',d.anndel);await loadAndRender();return;}

  /* team/guest managers */
  if('editteam'in d){editTeamModal(d.editteam);return;}
  if('saveteam'in d){await upd('teams',d.saveteam,{name:$('#etN').value.trim(),color:$('#etC').value.trim(),song:$('#etSong').value.trim(),flag_desc:$('#etFlag').value.trim()});closeModal();await loadAndRender();manageTeams();return;}
  if('pickcolor'in d){$('#etC').value=d.pickcolor;document.querySelectorAll('[data-pickcolor]').forEach(b=>b.style.outline='none');el.style.outline='3px solid #fff';return;}
  if('addguest'in d){editGuestModal(null);return;}
  if('editguest'in d){editGuestModal(d.editguest);return;}
  if('saveguest'in d){const rec={display_name:$('#egN').value.trim()||'Guest',family:$('#egF').value.trim(),kind:$('#egK').value,team_id:$('#egT').value||null};if(d.saveguest){await upd('guests',d.saveguest,rec);}else{await ins('guests',rec);}closeModal();await loadAndRender();manageGuests();return;}
  if('delguest'in d){if(confirm('Delete guest?')){await del('guests',d.delguest);closeModal();await loadAndRender();manageGuests();}return;}

  /* auth */
  if('login'in d){await doLogin();return;}
  if('logout'in d){await sb.auth.signOut();return;}

  /* export */
  if('export'in d){exportCSV(d.export);return;}

  /* fullscreen */
  if('fsexit'in d){exitFS();return;}
  if('tvprev'in d){const sc=(state.settings.tv.screens||['now']);tvIdx=(tvIdx-1+sc.length)%sc.length;renderTV();return;}
  if('tvnext'in d){const sc=(state.settings.tv.screens||['now']);tvIdx=(tvIdx+1)%sc.length;renderTV();return;}
  if('awardprev'in d){awardIdx=(awardIdx-1+state.awards.length)%state.awards.length;awardRevealed=false;renderAwards();return;}
  if('awardnext'in d){awardIdx=(awardIdx+1)%state.awards.length;awardRevealed=false;renderAwards();return;}
  if('awardreveal'in d){awardRevealed=!awardRevealed;renderAwards();return;}
});

/* ---------- action handlers ---------- */
async function delAll(t){const{error}=await sb.from(t).delete().neq('id','00000000-0000-0000-0000-000000000000');if(error)toast(error.message,'err');}
async function handleAct(act){
  if(act==='launchTV')launchFS('tv');
  else if(act==='launchAwards')launchFS('awards');
  else if(act==='exportAll'){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='ofsc_backup.json';a.click();toast('Backup downloaded');}
  else if(act==='resetStatuses'){if(confirm('Reset all event & schedule statuses to Not started?')){for(const e of state.events)await upd('events',e.id,{status:'not_started'});for(const b of state.schedule)await upd('schedule_blocks',b.id,{status:'not_started'});await upd('settings',1,{current_event_id:null,next_event_id:null});await loadAndRender();toast('Statuses reset');}}
  else if(act==='clearBrackets'){if(confirm('Delete ALL brackets? (Sign-ups stay.)')){await delAll('matches');await sb.from('scores').delete().like('note','[%');for(const e of state.events)if(e.is_bracket)await upd('events',e.id,{status:'not_started'});await loadAndRender();toast('Brackets cleared');}}
  else if(act==='clearSignups'){if(confirm('Delete ALL sign-ups AND brackets?')){await delAll('matches');await delAll('bracket_signups');await sb.from('scores').delete().like('note','[%');await loadAndRender();toast('Sign-ups cleared');}}
  else if(act==='clearScores'){if(confirm('Delete ALL scores? This zeroes the standings.')){await delAll('scores');await loadAndRender();toast('Scores cleared');}}
  else if(act==='clearVotes'){if(confirm('Delete ALL votes?')){await delAll('votes');await loadAndRender();toast('Votes cleared');}}
}
function openMore(){const items=nav();openModal('Menu',items.map(n=>`<button class="btn block ghost" data-nav="${n[0]}" style="justify-content:flex-start;margin-bottom:8px"><span style="margin-right:8px">${n[1]}</span>${n[2]}</button>`).join(''),`<button class="btn ghost" data-close>Close</button>`);$('#modalRoot').addEventListener('click',ev=>{if(ev.target.closest('[data-nav]'))closeModal();},{once:true});}

async function doLogin(){const email=$('#loginEmail').value.trim();const pass=$('#loginPass').value;const{error}=await sb.auth.signInWithPassword({email,password:pass});if(error){toast(error.message,'err');return;}toast('Signed in');}

async function doSignup(eventId){
  const ev=evById(eventId);const p1=$('#suP1').value;const p2=ev.bracket_size===2?$('#suP2').value:null;
  if(!p1){toast('Pick '+(ev.bracket_size===1?'yourself':'player 1'),'err');return;}
  if(ev.bracket_size===2&&!p2){toast('Pick a teammate','err');return;}
  if(ev.bracket_size===2&&p1===p2){toast('Two different people, please','err');return;}
  const exists=state.signups.some(s=>s.event_id===eventId&&[s.player1_id,s.player2_id].some(x=>x===p1||(p2&&x===p2)));
  if(exists){toast('Someone in this pair is already signed up for this event','err');return;}
  const ok=await ins('bracket_signups',{event_id:eventId,player1_id:p1,player2_id:p2,pair_name:''});
  if(ok){setMe(p1);await loadAndRender();toast('Signed up! Good luck.');}
}

/* scoring saves */
async function savePlacement(eventId){
  const sels=[...document.querySelectorAll('.place-sel')];let any=false;
  for(const s of sels){const pl=+s.dataset.place;const tid=s.value;if(!tid)continue;any=true;await awardTeamMembers(eventId,tid,pl,placePoints(pl),ordinal(pl)+' place');}
  if(!any){toast('Pick at least one team','err');return;}
  await loadAndRender();toast('Placement saved to members');
}
async function saveH2H(eventId){
  const w=$('#h2hW').value,l=$('#h2hL').value;if(!w||!l){toast('Pick winner and loser','err');return;}
  await awardTeamMembers(eventId,w,1,placePoints(1),'Won');await awardTeamMembers(eventId,l,null,placePoints(99),'Participation');
  await loadAndRender();toast(teamName(w)+' wins!');
}
async function awardTeamMembers(eventId,teamId,place,points,note){
  const members=state.guests.filter(g=>g.team_id===teamId);
  if(!members.length){await ins('scores',{event_id:eventId,team_id:teamId,points,place,note});return;}
  for(const g of members)await ins('scores',{event_id:eventId,team_id:teamId,guest_id:g.id,points,place,note});
}
async function saveBest(arg){
  const[eventId,mode]=arg.split('|');
  const rows=[...document.querySelectorAll('.best-row')].map(r=>({gid:r.querySelector('.best-g').value,v:parseFloat(r.querySelector('.best-v').value)})).filter(x=>x.gid&&!isNaN(x.v));
  if(!rows.length){toast('Enter at least one competitor','err');return;}
  rows.sort((a,b)=>mode==='timed'?a.v-b.v:b.v-a.v);
  for(let i=0;i<rows.length;i++){const pl=i+1;await ins('scores',{event_id:eventId,guest_id:rows[i].gid,place:pl,points:placePoints(pl),note:(mode==='timed'?rows[i].v+'s':String(rows[i].v))});}
  await loadAndRender();toast('Ranked & awarded');
}
async function saveManual(eventId){
  const tgt=$('#manTarget').value;const p=+$('#manP').value;const r=$('#manR').value.trim();
  await awardTarget(eventId,tgt,p,r||'Manual');await loadAndRender();toast('Awarded');
}
async function saveBonus(){
  const tgt=$('#bonTarget').value;const p=+$('#bonP').value;const r=$('#bonR').value.trim();
  let ev=state.events.find(e=>e.name==='Bonus');if(!ev){await ins('events',{name:'Bonus',category:'Open',scoring_type:'manual',sort:99,status:'complete'});await loadAll();ev=state.events.find(e=>e.name==='Bonus');}
  await awardTarget(ev.id,tgt,p,r||'Bonus');await loadAndRender();toast('Applied');
}
async function awardTarget(eventId,tgt,points,note){
  if(!tgt){toast('Pick a target','err');return;}
  const[kind,id]=tgt.split(':');
  if(kind==='t')await awardTeamMembers(eventId,id,null,points,note);
  else await ins('scores',{event_id:eventId,guest_id:id,points,note});
}

async function castVote(awardId){
  const voter=window.__voter;if(!voter){toast('Select your name first','err');return;}
  if(state.votes.some(v=>v.award_id===awardId&&v.voter_id===voter)){toast('You already voted for this award. The committee rejects ballot stuffing.','err');return;}
  const a=state.awards.find(x=>x.id===awardId);
  const nomSel=document.querySelector(`.ballot-nom[data-award="${awardId}"]`);const cm=document.querySelector(`.ballot-cm[data-award="${awardId}"]`);
  if(!nomSel||!nomSel.value){toast('Choose a nominee','err');return;}
  const ok=await ins('votes',{award_id:awardId,voter_id:voter,nominee_type:a.subject==='team'?'team':'guest',nominee_id:nomSel.value,comment:cm?cm.value.trim():''});
  if(ok){await loadAndRender();toast('Vote recorded. Democracy has survived another backyard sporting event.');}
}

/* modals: seed, result, winner */
function seedModal(eventId){window.__seedEvent=eventId;window.__seedOrder=shuffle(state.signups.filter(s=>s.event_id===eventId).map(s=>s.id));openModal('Manual seed — '+eventName(eventId),'<div id="seedBody"></div>',`<button class="btn ghost" data-shuffleseed>🎲 Shuffle</button><button class="btn primary" data-dogenerate style="margin-left:auto">Generate bracket</button>`);seedModalBody(eventId);}
function seedModalBody(){const ids=window.__seedOrder||[];$('#seedBody').innerHTML=ids.length?ids.map((id,i)=>`<div class="row" style="padding:8px 10px"><div class="rank" style="width:30px">${i+1}</div><div class="grow"><div class="name" style="font-size:14px">${esc(signupLabel(state.signups.find(s=>s.id===id)))}</div></div><button class="btn xs ghost" data-seedmove="${i}|-1">▲</button><button class="btn xs ghost" data-seedmove="${i}|1">▼</button></div>`).join(''):'<div class="empty">No entrants.</div>';}
function resultModal(matchId){const m=state.matches.find(x=>x.id===matchId);const a=state.signups.find(s=>s.id===m.a_signup_id),b=state.signups.find(s=>s.id===m.b_signup_id);openModal('Match result',`<div class="mut small" style="margin-bottom:10px">${esc(eventName(m.event_id))} · Round ${m.round}</div><label class="f"><span>Winner</span><select class="i" id="resWinner"><option value="">— pick winner —</option><option value="${m.a_signup_id}" ${m.winner_signup_id===m.a_signup_id?'selected':''}>${esc(signupLabel(a))}</option><option value="${m.b_signup_id}" ${m.winner_signup_id===m.b_signup_id?'selected':''}>${esc(signupLabel(b))}</option></select></label><div class="grid g2"><label class="f"><span>Score ${esc(signupLabel(a))}</span><input class="i" id="resA" type="number" value="${m.a_score??''}"></label><label class="f"><span>Score ${esc(signupLabel(b))}</span><input class="i" id="resB" type="number" value="${m.b_score??''}"></label></div>`,`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-submitresult="${matchId}" style="margin-left:auto">Save result</button>`);}
function winnerModal(awardId){const a=state.awards.find(x=>x.id===awardId);const noms=nominees(a);openModal('Winner — '+a.name,`<label class="f"><span>Winner (override)</span><select class="i" id="winSel"><option value="">— auto —</option>${noms.map(n=>`<option value="${n.id}" ${a.winner_id===n.id?'selected':''}>${esc(n.label)}</option>`).join('')}</select></label>`,`<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-savewinner="${awardId}" style="margin-left:auto">Save</button>`);}

/* export CSV */
function exportCSV(kind){
  const csv=rows=>rows.map(r=>r.map(c=>`"${String(c==null?'':c).replace(/"/g,'""')}"`).join(',')).join('\n');
  let rows=[];
  if(kind==='scores')rows=[['Event','Who','Place','Points','Note'],...state.scores.map(s=>[eventName(s.event_id),s.guest_id?guestName(s.guest_id):teamName(s.team_id),s.place||'',s.points,(s.note||'').replace(/^\[[^\]]+\]\s*/,'')])];
  else if(kind==='votes')rows=[['Award','Voter','Nominee','Comment'],...state.votes.map(v=>{const a=state.awards.find(x=>x.id===v.award_id);return[a?a.name:'',guestName(v.voter_id),a?nomineeLabel(a,v.nominee_id):'',v.comment||''];})];
  const blob=new Blob([csv(rows)],{type:'text/csv'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='ofsc_'+kind+'.csv';a.click();toast('Exported');
}

/* clock */
function tickClock(){$('#clockT').textContent=nowTime();$('#clockD').textContent=new Date().toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});const tc=$('#tvclock');if(tc)tc.textContent=nowTime();}

/* ================= BOOT ================= */
async function boot(){
  const{data}=await sb.auth.getSession();session=data.session;
  sb.auth.onAuthStateChange((_e,s)=>{session=s;render();});
  const h=(location.hash||'').replace('#','');
  if(h==='vote')route='voting'; else if(h==='signup')route='signup'; else if(h==='standings')route='standings'; else if(h==='brackets')route='brackets';
  await loadAll();
  subscribeRealtime();
  render();tickClock();setInterval(tickClock,1000);
}
boot();
