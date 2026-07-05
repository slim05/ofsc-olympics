"use strict";
/* ================= OFSC FAMILY OLYMPICS — v3 ================= */
const cfg = window.OFSC_CONFIG;
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);

const $  = (s,r=document)=>r.querySelector(s);
const esc= s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt= n=>(+n||0).toLocaleString();
const ordinal=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};
const nowTime=()=>new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};

let state={settings:{},teams:[],guests:[],events:[],schedule:[],scores:[],awards:[],votes:[],signups:[],matches:[]};
let session=null;
const isHost=()=>!!session;
let route='home';

/* remembered guest identity (per device) */
function getMe(){try{const id=localStorage.getItem('ofsc_me')||'';return id&&guest(id)?id:'';}catch(e){return '';}}
function setMe(id){try{if(id)localStorage.setItem('ofsc_me',id);}catch(e){}}
function clearMe(){try{localStorage.removeItem('ofsc_me');}catch(e){}window.__voter='';render();}

/* ---------------- toast + modal ---------------- */
function toast(msg,type='ok',ms=2800){const el=document.createElement('div');el.className='toast '+(type==='ok'?'':type);el.textContent=msg;$('#toast').appendChild(el);setTimeout(()=>el.remove(),ms);}
function openModal(title,body,footer){$('#modalRoot').innerHTML=`<div class="modal-bg" data-close><div class="modal"><div class="mh"><h2>${esc(title)}</h2><button class="x" data-close>✕</button></div><div class="mb">${body}</div>${footer?`<div class="mf">${footer}</div>`:''}</div></div>`;}
function closeModal(){$('#modalRoot').innerHTML='';}

/* ---------------- data + realtime ---------------- */
async function loadAll(){
  const [se,tm,gu,ev,sc,scr,aw,vo,su,ma]=await Promise.all([
    sb.from('settings').select('*').eq('id',1).single(),
    sb.from('teams').select('*').order('name'),
    sb.from('guests').select('*').order('display_name'),
    sb.from('events').select('*').order('sort'),
    sb.from('schedule_blocks').select('*').order('sort'),
    sb.from('scores').select('*').order('created_at'),
    sb.from('awards').select('*').order('sort'),
    sb.from('votes').select('*'),
    sb.from('bracket_signups').select('*').order('created_at'),
    sb.from('matches').select('*')
  ]);
  if(se.data)state.settings=se.data;
  state.teams=tm.data||[];state.guests=gu.data||[];state.events=ev.data||[];
  state.schedule=sc.data||[];state.scores=scr.data||[];state.awards=aw.data||[];
  state.votes=vo.data||[];state.signups=su.data||[];state.matches=ma.data||[];
}
let reTimer=null;
function scheduleReload(){clearTimeout(reTimer);reTimer=setTimeout(async()=>{await loadAll();softRender();},400);}
function subscribeRealtime(){sb.channel('ofsc').on('postgres_changes',{event:'*',schema:'public'},scheduleReload).subscribe();}
async function loadAndRender(){await loadAll();render();}
function softRender(){
  if($('#modalRoot').innerHTML)return;
  if(document.activeElement&&['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
  if($('#fs').classList.contains('on')){renderFS();return;}
  render();
}

/* ---------------- lookups ---------------- */
const team=id=>state.teams.find(t=>t.id===id);
const guest=id=>state.guests.find(g=>g.id===id);
const evById=id=>state.events.find(e=>e.id===id);
const teamName=id=>team(id)?.name||'—';
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
function signupLabel(su){if(!su)return 'BYE';const p1=guestName(su.player1_id);const p2=su.player2_id?guestName(su.player2_id):'';return p2?`${p1} & ${p2}`:p1;}
const scLabel=t=>({placement:'Placement',head2head:'Head-to-Head',best:'Best Attempt',timed:'Timed Race',manual:'Manual',squad:'Squad Battle',team_vs:'Team vs Team',skills:'Skills Placement'}[t]||t);

/* ---------------- DB writes (host via RLS; guests via RPC) ---------------- */
async function ins(t,row){const{error}=await sb.from(t).insert(row);if(error){toast(error.message,'err');return false;}return true;}
async function upd(t,id,patch){const{error}=await sb.from(t).update(patch).eq('id',id);if(error){toast(error.message,'err');return false;}return true;}
async function del(t,id){const{error}=await sb.from(t).delete().eq('id',id);if(error){toast(error.message,'err');return false;}return true;}
async function rpc(fn,args){const{error}=await sb.rpc(fn,args);if(error){toast(error.message.replace(/^.*?: /,''),'err');return false;}return true;}

/* ================= NAV ================= */
function nav(){
  const votingLive=state.awards.some(a=>a.award_type==='vote'&&a.is_open);
  const guestN=[['home','🏟️','Home'],['report','🏆','My Events'],['signup','✍️','Sign Up'],['sched','📅','Schedule'],['rules','📜','Rules'],['standings','🏅','Standings'],['brackets','🎾','Brackets'],['teams','🚩','My Team']];
  if(votingLive||isHost())guestN.push(['vote','🗳️','Vote']);
  const disp=[['dstand','📺','Standings'],['dbrack','📺','Brackets'],['dresults','📺','Recent Results']];
  const host=isHost()
    ?[['score','🎯','Scoring Table'],['awards','🏆','Awards'],['admin','⚙️','Admin']]
    :[['admin','🔑','Host Login']];
  return {guestN,disp,host,votingLive};
}
function renderNav(){
  const n=nav();
  const b=(x)=>`<button data-nav="${x[0]}" class="${route===x[0]?'active':''}"><span class="ic">${x[1]}</span>${x[2]}</button>`;
  $('#rail').innerHTML=
    `<div class="railgroup"><span class="st">★</span> Guest</div>`+n.guestN.map(b).join('')+
    `<div class="railgroup"><span class="st">★</span> Big Displays</div><div class="displays">`+n.disp.map(b).join('')+`</div>`+
    `<div class="railgroup"><span class="st">★</span> Host</div>`+n.host.map(b).join('');
  const guestTabs=['home','report','brackets','standings',(n.votingLive?'vote':'sched')];
  const tabs=(isHost()?['home','score','brackets','standings','teams']:guestTabs)
    .map(id=>{const all=[...n.guestN,...n.disp,...n.host];const x=all.find(y=>y[0]===id);return x?b(x):'';}).join('');
  $('#tabbar').innerHTML=tabs+`<button data-more><span class="ic">☰</span>More</button>`;
}
function go(r){route=r;render();window.scrollTo(0,0);}

/* ================= RENDER ================= */
const VIEWS={};
function render(){
  renderNav();
  if(['dstand','dbrack','dresults'].includes(route)){launchFS(route);return;}
  $('#view').innerHTML=(VIEWS[route]?VIEWS[route]():`<div class="empty">Not found</div>`);
}
function banner(eye,title,sub){
  return `<div class="shead">${eye?`<div class="eyebrow">${eye}</div>`:''}<div class="banner"><span class="st l">★</span><span class="st r">★</span><div class="t">${esc(title)}</div></div>${sub?`<div class="sub">${sub}</div>`:''}</div>`;
}
function standRow(r,i,max){
  return `<div class="srow"><div class="med ${i<3?'g'+(i+1):''}">${i+1}</div>
    <div class="trow-name"><b>${esc(r.t.name)}</b><div class="bar"><i style="width:${max?Math.max(4,Math.round(r.points/max*100)):4}%;background:${r.t.color}"></i></div>
    <div class="meta">🥇${r.medals.g} 🥈${r.medals.s} 🥉${r.medals.b}</div></div>
    <div class="pts">${fmt(r.points)}</div></div>`;
}

/* ---------- HOME ---------- */
VIEWS.home=function(){
  const st=teamStandings();const max=st[0]?st[0].points:0;
  const me=getMe();
  const myCount=me?state.signups.filter(s=>s.player1_id===me||s.player2_id===me).length:0;
  return `${banner(me?('★ Welcome back, '+esc(guestName(me))+' ★'):'★ The Inaugural ★', state.settings.event_name||'OFSC Olympics', esc(state.settings.date_label||''))}
  <div class="card goldtrim" style="margin-bottom:14px">
    <div class="cardhdr"><span class="medallion"></span>Quick links</div>
    <div class="grid g4" style="gap:10px">
      <button class="btn sunsetb block" data-nav="teams">🚩 My Team</button>
      <button class="btn tealb block" data-nav="signup">✍️ Sign Up</button>
      <button class="btn goldb block" data-nav="report">🏆 My Events${myCount?` (${myCount})`:''}</button>
      <button class="btn block" data-nav="sched">📅 Schedule</button>
    </div>
  </div>
  <div class="card"><div class="cardhdr"><span class="medallion"></span>Top of the Podium</div>
    ${st.slice(0,6).map((r,i)=>standRow(r,i,max)).join('')||'<div class="empty">No points yet.</div>'}
    <button class="btn ghost sm block" data-nav="standings" style="margin-top:10px">Full standings →</button>
  </div>`;
};

/* ---------- MY EVENTS / REPORT A WINNER ---------- */
VIEWS.report=function(){
  const me=getMe();
  const bes=state.events.filter(e=>e.is_bracket).sort((a,b)=>a.sort-b.sort);
  // matches ready to report, mine first
  const ready=state.matches.filter(m=>m.status==='ready'&&m.a_signup_id&&m.b_signup_id);
  const mineIn=su=>su&&me&&(su.player1_id===me||su.player2_id===me);
  const withMeta=ready.map(m=>{const a=state.signups.find(s=>s.id===m.a_signup_id),b=state.signups.find(s=>s.id===m.b_signup_id);
    return {m,a,b,mine:mineIn(a)||mineIn(b)};}).sort((x,y)=>(y.mine?1:0)-(x.mine?1:0));
  const sel=window.__repMatch||(withMeta[0]&&withMeta[0].m.id)||'';window.__repMatch=sel;
  const cur=withMeta.find(x=>x.m.id===sel);
  const pick=window.__repPick||'';
  const mySignups=me?state.signups.filter(s=>s.player1_id===me||s.player2_id===me):[];
  return `${banner('Play, then report','My Events')}
  ${me?'':`<div class="helpbox" style="margin-bottom:14px">Tip: pick your name once on the <b>Sign Up</b> or <b>Vote</b> page and this screen will put your matches first.</div>`}
  ${mySignups.length?`<div class="card" style="margin-bottom:14px"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>You're entered in</div><div class="inline">${mySignups.map(s=>`<span class="tag">${esc(eventName(s.event_id))}</span>`).join('')}</div></div>`:''}
  <div class="card goldtrim">
    <div class="cardhdr"><span class="medallion"></span>Report a Winner</div>
    ${withMeta.length?`
    <label class="f"><span>Which match?</span>
      <select class="i" data-repmatch>${withMeta.map(x=>`<option value="${x.m.id}" ${x.m.id===sel?'selected':''}>${x.mine?'⭐ ':''}${esc(eventName(x.m.event_id))} · ${esc(signupLabel(x.a))} vs ${esc(signupLabel(x.b))}</option>`).join('')}</select></label>
    ${cur?`
    <small style="font-family:var(--disp);letter-spacing:.14em;color:var(--ink2);font-weight:800">TAP THE WINNER</small>
    <div class="vs">
      <div class="side ${pick==='a'?'sel':''}" data-reppick="a"><div class="who">${esc(signupLabel(cur.a))}</div>${pick==='a'?'<span class="tag" style="margin-top:8px;display:inline-block;background:#fff">WINNER ★</span>':''}</div>
      <div class="vsbadge">VS</div>
      <div class="side ${pick==='b'?'sel':''}" data-reppick="b"><div class="who">${esc(signupLabel(cur.b))}</div>${pick==='b'?'<span class="tag" style="margin-top:8px;display:inline-block;background:#fff">WINNER ★</span>':''}</div>
    </div>
    <div class="grid g2">
      <label class="f"><span>Score — ${esc(signupLabel(cur.a))}</span><input class="i" id="repA" type="number" inputmode="numeric" placeholder="21"></label>
      <label class="f"><span>Score — ${esc(signupLabel(cur.b))}</span><input class="i" id="repB" type="number" inputmode="numeric" placeholder="17"></label>
    </div>
    <div class="mut small" style="margin-bottom:12px">Score is optional. Winner takes the win points; the bracket advances automatically.</div>
    <button class="btn goldb block big" data-repsubmit="${cur.m.id}" ${pick?'':'disabled'}>Submit — advance the bracket ⚡</button>`:''}
    `:`<div class="empty"><div class="big">No matches ready</div>Once the hosts draw a bracket, matches show up here.</div>`}
  </div>
  <div class="helpbox" style="margin-top:14px"><b>Everything else</b> (kickball, dodgeball, races, precision skills…) is scored by the hosts at the scoring table — just play, then report your result there in person.</div>`;
};

/* ---------- SIGN UP ---------- */
VIEWS.signup=function(){
  const bes=state.events.filter(e=>e.is_bracket).sort((a,b)=>a.sort-b.sort);
  const skills=state.events.filter(e=>e.scoring_type==='skills').sort((a,b)=>a.sort-b.sort);
  const all=[...bes,...skills];
  const sel=window.__suEvent||(all[0]&&all[0].id);window.__suEvent=sel;
  const ev=evById(sel);const me=getMe();
  const mine=state.signups.filter(s=>s.event_id===sel);
  const isSkills=ev&&ev.scoring_type==='skills';
  const locked=ev?(!isSkills&&state.matches.some(m=>m.event_id===ev.id)):false;
  const alreadyIn=me&&mine.some(s=>s.player1_id===me||s.player2_id===me);
  return `${banner('Grab a teammate','Event Sign Up','Tournaments need a partner (Tetherball is solo). Skills challenges — just raise your hand.')}
  <div class="eyebrow" style="margin-bottom:6px">Tournaments</div>
  <div class="btnrow" style="margin-bottom:10px">${bes.map(e=>`<button class="btn sm ${e.id===sel?'sunsetb':'ghost'}" data-suevent="${e.id}">${esc(e.name)}${e.bracket_size===1?' (solo)':''}</button>`).join('')}</div>
  <div class="eyebrow" style="margin-bottom:6px">Skills Challenges</div>
  <div class="btnrow" style="margin-bottom:14px">${skills.map(e=>`<button class="btn sm ${e.id===sel?'tealb':'ghost'}" data-suevent="${e.id}">${esc(e.name)}</button>`).join('')}</div>
  ${ev?`<div class="card goldtrim">
    <div class="cardhdr"><span class="medallion"></span>${esc(ev.name)} — ${isSkills?'skills challenge':(ev.bracket_size===1?'singles':'pairs')}</div>
    ${locked?`<div class="pill warn" style="margin-bottom:10px">Bracket already drawn — see the hosts to be added</div>`:''}
    <div class="mut small" style="margin-bottom:12px">${isSkills?'Sign up solo — the hosts will score placements at the event.':(ev.bracket_size===1?'Sign up as yourself.':'Pick yourself and your teammate.')} ${mine.length} entrant${mine.length===1?'':'s'} so far.</div>
    <label class="f"><span>${(isSkills||ev.bracket_size===1)?'You':'Player 1 (you)'}</span><select class="i" id="suP1"><option value="">— select your name —</option>${state.guests.map(g=>`<option value="${g.id}" ${me===g.id?'selected':''}>${esc(g.display_name)}</option>`).join('')}</select></label>
    ${(!isSkills&&ev.bracket_size===2)?`<label class="f"><span>Player 2 (teammate)</span><select class="i" id="suP2"><option value="">— select —</option>${state.guests.map(g=>`<option value="${g.id}">${esc(g.display_name)}</option>`).join('')}</select></label>`:''}
    ${alreadyIn?`<div class="pill ok" style="margin-bottom:10px">✓ You’re already in this one</div>`:''}
    <button class="btn ${isSkills?'tealb':'sunsetb'} block big" data-dosignup="${ev.id}" ${locked?'disabled':''}>Sign up</button>
  </div>
  <div class="card" style="margin-top:14px"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>Signed up for ${esc(ev.name)}</div>
    ${mine.length?mine.map(s=>`<div class="row" style="padding:9px 12px"><div class="grow"><div class="name" style="font-size:14px">${esc(signupLabel(s))}</div></div>${isHost()?`<button class="btn xs danger" data-delsignup="${s.id}">✕</button>`:''}</div>`).join(''):'<div class="mut small">Be the first!</div>'}
  </div>`:''}`;
};

/* ---------- SCHEDULE ---------- */
VIEWS.sched=function(){
  const STATUS=[['not_started','upcoming'],['now_playing','LIVE'],['delayed','delayed'],['complete','done ✓'],['canceled','canceled']];
  return `${banner('The full day','Schedule')}
  ${state.schedule.map(b=>{
    const live=b.status==='now_playing';
    return `<div class="card" style="padding:13px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div class="disp" style="font-weight:900;font-size:21px"><span style="color:var(--red)">${esc(b.time_label)}</span> — ${esc(b.title)}</div>
      <div class="inline">${live?'<span class="sticker">● Live</span>':`<span class="tag">${(STATUS.find(s=>s[0]===b.status)||STATUS[0])[1]}</span>`}
      ${isHost()?`<select class="selp" data-blockstatus="${b.id}">${STATUS.map(s=>`<option value="${s[0]}" ${b.status===s[0]?'selected':''}>${s[1]}</option>`).join('')}</select>`:''}</div>
    </div>`;}).join('')}`;
};

/* ---------- STANDINGS ---------- */
VIEWS.standings=function(){
  const tab=window.__lb||'team';window.__lb=tab;
  const tabs=[['team','Teams'],['individual','Individuals'],['kids','Kids'],['medals','Medals']];
  let body='';
  if(tab==='team'){const st=teamStandings();const max=st[0]?st[0].points:0;body=st.length?st.map((r,i)=>standRow(r,i,max)).join(''):'<div class="empty">No points yet.</div>';}
  else if(tab==='medals'){const st=teamStandings().sort((a,b)=>b.medals.g-a.medals.g||b.medals.s-a.medals.s||b.medals.b-a.medals.b);
    body=st.map((r,i)=>`<div class="srow"><div class="med ${i<3?'g'+(i+1):''}">${i+1}</div><div class="trow-name"><b>${esc(r.t.name)}</b></div><div class="disp" style="font-size:20px;font-weight:900">🥇${r.medals.g} 🥈${r.medals.s} 🥉${r.medals.b}</div></div>`).join('');}
  else{const st=individualStandings(tab==='kids');
    body=st.length?st.map((r,i)=>`<div class="srow"><div class="med ${i<3?'g'+(i+1):''}">${i+1}</div><div class="trow-name"><b>${esc(r.g.display_name)}</b><div class="meta">${esc(r.g.family)} · ${r.g.kind}</div></div><div class="pts">${fmt(r.points)}</div></div>`).join(''):'<div class="empty">No individual points yet.</div>';}
  return `${banner('Glory is temporary','Standings','Every family member’s points, added up.')}
  <div class="btnrow" style="margin-bottom:14px">${tabs.map(t=>`<button class="btn sm ${tab===t[0]?'sunsetb':'ghost'}" data-lb="${t[0]}">${t[1]}</button>`).join('')}</div>
  <div class="card goldtrim">${body}</div>`;
};

/* ---------- BRACKETS ---------- */
VIEWS.brackets=function(){
  const bes=state.events.filter(e=>e.is_bracket).sort((a,b)=>a.sort-b.sort);
  const sel=window.__bkEvent||(bes[0]&&bes[0].id);window.__bkEvent=sel;
  const ms=state.matches.filter(m=>m.event_id===sel).sort((a,b)=>a.round-b.round||a.slot-b.slot);
  const signups=state.signups.filter(s=>s.event_id===sel);
  const final=ms.find(m=>!m.next_match_id);
  const champ=final&&final.status==='complete'?final.winner_signup_id:null;
  return `${banner('March to a champion','Brackets')}
  <div class="btnrow" style="margin-bottom:14px">${bes.map(e=>`<button class="btn sm ${e.id===sel?'sunsetb':'ghost'}" data-bkevent="${e.id}">${esc(e.name)}</button>`).join('')}</div>
  ${champ?`<div class="champ" style="margin-bottom:14px"><div class="eyebrow" style="color:#7a5200">Champion</div><div class="disp" style="font-size:28px;font-weight:900">🏆 ${esc(signupLabel(state.signups.find(s=>s.id===champ)))}</div></div>`:''}
  ${isHost()?`<div class="card" style="margin-bottom:14px"><div class="inline" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="disp" style="font-size:16px;font-weight:900">Host controls · ${signups.length} entrants</div>
    <div class="btnrow"><button class="btn sm tealb" data-genbracket="${sel}">${ms.length?'Re-draw':'Generate'} bracket</button><button class="btn sm ghost" data-seedbracket="${sel}">Manual seed…</button><button class="btn sm danger" data-clearevsignups="${sel}">Clear sign-ups</button></div></div></div>`:''}
  ${ms.length?`<div class="card goldtrim"><div class="bracket">${bracketHtml(ms,false)}</div></div>`
    :`<div class="empty"><div class="big">No bracket yet</div>${signups.length?signups.length+' entrants signed up.':'Waiting on sign-ups.'}</div>`}`;
};
function bracketHtml(ms,tv){
  const rounds=[...new Set(ms.map(m=>m.round))].sort((a,b)=>a-b);
  const roundName=(r,total)=>{const left=total-r;return left===0?'Final':left===1?'Semifinals':left===2?'Quarterfinals':'Round '+r;};
  return rounds.map(r=>`<div class="bcol"><h4>${roundName(r,rounds.length)}</h4>${ms.filter(m=>m.round===r).map(m=>matchCard(m,tv)).join('')}</div>`).join('');
}
function matchCard(m,tv){
  const a=state.signups.find(s=>s.id===m.a_signup_id),b=state.signups.find(s=>s.id===m.b_signup_id);
  const win=m.winner_signup_id;
  const slot=(su,score,side)=>{const isWin=win&&su&&su.id===win;const isBye=(side==='a'?!m.a_signup_id:!m.b_signup_id)&&m.status==='bye';
    return `<div class="bs ${isWin?'w':''} ${isBye||(!su&&m.status!=='bye')?'bye':''}"><span class="nm">${su?esc(signupLabel(su)):(isBye?'bye':'—')}</span>${score!=null?`<span class="sc">${score}</span>`:''}</div>`;};
  const hostBtn=!tv&&isHost()&&m.a_signup_id&&m.b_signup_id&&m.status!=='bye'
    ?`<div style="padding:6px"><button class="btn xs ${m.status==='complete'?'ghost':'sunsetb'} block" data-matchresult="${m.id}">${m.status==='complete'?'Edit result':'Enter result'}</button></div>`:'';
  return `<div class="bm ${m.status==='ready'?'live':''}">${slot(a,m.a_score,'a')}${slot(b,m.b_score,'b')}${hostBtn}</div>`;
}

/* ---------- MY TEAM (guest-editable) ---------- */
VIEWS.teams=function(){
  const me=getMe();
  const myTeam=me?guest(me)?.team_id:'';
  const sel=window.__tmSel||myTeam||(state.teams[0]&&state.teams[0].id);window.__tmSel=sel;
  const t=team(sel);if(!t)return '<div class="empty">No teams.</div>';
  const members=state.guests.filter(g=>g.team_id===sel);
  const COLORS=['#E23A24','#F5821F','#FFC124','#59A82D','#189FB0','#2E86D8','#7B4FE0','#EC4899','#122142','#C1743A'];
  return `${banner('Coordinated colors encouraged','Team Management','Rename your team, upload a flag, fix member names — go wild.')}
  <label class="f" style="max-width:380px"><span>Team</span><select class="i" data-tmsel>${state.teams.map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${esc(x.name)}${x.id===myTeam?' (your team)':''}</option>`).join('')}</select></label>
  <div class="grid g2">
    <div class="card">
      <label class="f"><span>Team name</span><input class="i" id="tmName" value="${esc(t.name)}"></label>
      <label class="f"><span>Team color</span><div class="inline">${COLORS.map(c=>`<div class="sw" data-tmcolor="${c}" style="background:${c};${t.color===c?'outline:3px solid var(--navy);outline-offset:3px':''}"></div>`).join('')}</div></label>
      <label class="f"><span>Entrance song</span><input class="i" id="tmSong" value="${esc(t.song||'')}" placeholder="e.g. Thunderstruck"></label>
      <button class="btn sunsetb block" data-tmsave="${t.id}">Save team</button>
    </div>
    <div class="card goldtrim">
      <div class="cardhdr" style="font-size:16px"><span class="medallion"></span>Team flag</div>
      <div class="flagbox">${t.flag_img?`<img src="${t.flag_img}" alt="flag">`:`<div class="fl sunset slats" style="position:absolute;inset:0"></div><div class="fallback">★ ${esc(t.name)}</div>`}</div>
      <input type="file" id="tmFlagFile" accept="image/*" class="hide">
      <div class="drop" style="margin-top:12px;padding:14px" data-tmflag>⬆ Upload a flag image</div>
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="cardhdr" style="font-size:17px"><span class="medallion"></span>Members (${members.length})</div>
    ${members.map(g=>`<div class="member"><input value="${esc(g.display_name)}" data-mname="${g.id}"><button class="btn xs ghost" data-msave="${g.id}">Save</button></div>`).join('')||'<div class="mut small">No members assigned yet.</div>'}
    ${isHost()?`<button class="btn tealb sm" data-addguest="${t.id}" style="margin-top:12px">+ Add member</button>`:''}
  </div>`;
};

/* ---------- RULES ---------- */
const RULES={
  tournaments:{title:'Tournament Events',sub:'Where confidence goes to be tested. Sign up in the app · single-elimination brackets · report your winner in the app when the game ends.',accent:'var(--red)',events:[
    {id:'cornhole',name:'Cornhole',sub:'2-player teams',accent:'var(--red)',f:[
      ['Goal','Score points by landing bags on the board or in the hole.'],
      ['How to play','Each team throws 4 bags per round from behind the front of the board. Children 12 or under can throw from 5 steps in front of the board.'],
      ['Scoring',['In the hole = 3 points','On the board = 1 point','Cancellation scoring applies'],'Example: if Team A scores 5 and Team B scores 3, Team A gets 2 points for the round.'],
      ['How to win','First rounds play to <b>11</b>. Later rounds play to <b>21, win by 2</b>. Teams can go over 21 — the game does not end at 21 unless the team is ahead by at least 2.','Examples: 21–19 wins. 22–20 wins. 25–23 wins. 21–20 does not win. 23–22 does not win.'],
      ['Time cap','<b>15 minutes.</b> If time runs out, the team in the lead wins. If tied, one sudden-death round decides it.'],
      ['Important details',['Bags knocked in by an opponent count.','Bags that hit the ground first do not count.','Bags hanging off the board count only if they are not touching the ground.']]],
      note:'If you refer to yourself as “a cornhole guy,” expectations rise immediately.'},
    {id:'tetherball',name:'Tetherball',sub:'Singles',accent:'var(--orange)',f:[
      ['Goal','Wrap the rope completely around the pole in your direction.'],
      ['How to play','One player serves the ball around the pole. The other player tries to hit it back the opposite way.'],
      ['How to win','<b>Best of 3 wraps.</b> A wrap counts when the rope is fully wrapped around the pole and the ball cannot go any farther.'],
      ['Time cap','<b>8 minutes.</b> If time runs out, the player with the most wraps wins. If tied, one sudden-death wrap decides it.'],
      ['You may not',['Catch, hold, or throw the ball.','Touch the rope or the pole.','Cross into your opponent’s side.']],
      ['Penalty','First violation = replay. Second violation = lose the wrap.']],
      note:'Everyone was apparently elite at tetherball in elementary school. Today, we verify.'},
    {id:'kanjam',name:'KanJam',sub:'2-player teams',accent:'var(--gold)',f:[
      ['Goal','Throw and deflect the disc to score points at the can.'],
      ['How to play','Partners stand at opposite cans. One player throws. The partner may deflect the disc.'],
      ['Scoring',['<b>Dinger</b> — deflected hit = 1 point','<b>Deucer</b> — unassisted hit = 2 points','<b>Bucket</b> — deflected into the can = 3 points','<b>Slot</b> — thrown directly into the slot = instant win']],
      ['How to win','Reach <b>exactly 11</b>. If you go over 11, subtract the extra points from your score.','Example: if you have 10 and score 3, you go over by 2, so your score drops to 8.'],
      ['Time cap','<b>12 minutes.</b> If time runs out, the team in the lead wins. If tied, one sudden-death throw decides it.']],
      note:'A slot is an instant win. Yes, everyone will yell. Yes, it was probably mostly luck.'},
    {id:'spikeball',name:'Spikeball',sub:'2-player teams',accent:'var(--teal)',f:[
      ['Goal','Hit the ball onto the net so the other team cannot return it.'],
      ['How to play','The serving team serves off the net. The receiving team has up to 3 touches to hit it back onto the net.'],
      ['Scoring','Rally scoring applies — a point is scored on every serve, no matter who served.'],
      ['How to win','<b>Game to 11, win by 2.</b>'],
      ['Time cap','<b>12 minutes.</b> If time runs out, the team in the lead wins. If tied, one sudden-death point decides it.'],
      ['Serve rule','If the ball hits the rim or rolls awkwardly on the net during a serve, re-serve. Each server gets one do-over per serve.']],
      note:'The phrase “that was rim” will be used often and confidently.'},
    {id:'bocce',name:'Bocce Ball',sub:'2-player teams',accent:'var(--blue)',f:[
      ['Goal','Get your bocce balls closer to the pallino than the other team. The pallino is the little target ball.'],
      ['How to play','One team tosses the pallino. Teams alternate rolling bocce balls toward it.'],
      ['Scoring','At the end of each frame, the team with the closest ball scores — 1 point for each ball closer than the opponent’s closest ball.'],
      ['How to win','<b>Game to 7.</b>'],
      ['Time cap','<b>12 minutes.</b> If time runs out, the team in the lead wins. If tied, one sudden-death roll decides it.']],
      note:'Knocking balls is legal. Knocking the pallino is legal. Acting like you meant to do either is also legal.'}
  ]},
  squad:{title:'Squad Events',sub:'Organized chaos with points. No sign-up required — hosts pick sides on the spot. This process will be described as fair, regardless of the evidence.',accent:'var(--teal)',events:[
    {id:'dodgeball',name:'Sponge Dodgeball',sub:'Squad battle',accent:'var(--teal)',f:[
      ['Goal','Get the other team out using soaked sponges.'],
      ['How to play','Two teams. Soaked sponges. Clearly marked center line.'],
      ['You are out if',['You get hit below the shoulders.','Someone catches your throw.']],
      ['If your throw is caught','You are out, and one player from the other team gets to come back in.'],
      ['Head shots','Head shots do not count. They also earn a stern committee glare.'],
      ['How to win','<b>Best of 3 rounds.</b> Each round lasts 5 minutes or until one team is eliminated. If time runs out, the team with fewer players remaining loses.']],
      note:'This is sponge dodgeball, not a water-based legal proceeding.'},
    {id:'kickball',name:'Kickball',sub:'Squad battle',accent:'var(--green)',f:[
      ['Goal','Score more runs than the other team using baseball rules and childhood confidence.'],
      ['How to play',['Everyone in the lineup kicks.','Pitches should be rolled friendly.','No leadoffs. No stealing.','This is not the World Series.']],
      ['How to win','Most runs after <b>3 innings or 40 minutes</b>.'],
      ['Scoring limit','<b>5-run cap per half inning</b> to keep the game moving.'],
      ['Getting runners out',['Catch the ball in the air.','Tag the runner.','Force out at the base.','Peg the runner below the shoulders.']],
      ['Pegging rule','Below the shoulders = out. Above the shoulders = runner is safe and gets to act wounded.']],
      note:'Several adults will take this too seriously. The Committee has already accepted this.'},
    {id:'tugofwar',name:'Tug of War',sub:'2 teams vs 2 teams',accent:'var(--red)',f:[
      ['Goal','Pull the center flag past your line.'],
      ['How to win','<b>Best of 1 pull.</b>'],
      ['Time cap','Each pull is capped at <b>90 seconds</b>. If time runs out, the side closest to pulling the flag across wins.'],
      ['Safety rules',['No wrapping the rope around your body.','No sitting down on purpose.','No sudden “strategy” that looks like an insurance claim.','No gloves unless the hosts allow them.']]],
      note:'Kids may be added to a side as strategic ballast.'},
    {id:'dizzybat',name:'Dizzy Bat Race',sub:'Team vs. team',accent:'var(--violet)',f:[
      ['Goal','Finish the relay before the other team and before your body files a formal complaint.'],
      ['How to play',['Run to the bat.','Put your forehead on the bat.','Spin around the bat.','Drop the bat. Run back. Tag the next racer.']],
      ['Spin count','Kids spin <b>3</b> times. Adults spin <b>6</b> times. Adults who have had a beverage also spin 6 times, but it will look like 12.'],
      ['How to win','First team to get every racer through wins.']],
      note:'Falling is legal, expected, and frankly the point.'}
  ]},
  skills:{title:'Skills Challenges',sub:'For people who claim they have touch. Sign up in the app for the events you want. Each person gets 2 official attempts — best counts. One warm-up if the line is short. Ties: one sudden-death attempt. Scoring: 1st = 10 · 2nd = 7 · 3rd = 5 · everyone who enters = 1.',accent:'var(--gold)',events:[
    {id:'longcornhole',name:'Longest Cornhole Shot',sub:'Skills challenge',accent:'var(--red)',f:[
      ['Goal','Sink a cornhole shot from the farthest distance.'],
      ['How to play','Start at regulation distance. If you sink it, you stay alive and move back 5 feet. If you miss, you are out unless the hosts decide otherwise due to crowd pressure.'],
      ['How to win','Last person to sink a shot from the longest distance wins.']],
      note:'Every missed bag was apparently “right on line.”'},
    {id:'fastwrap',name:'Fastest Tetherball Wrap',sub:'Skills challenge',accent:'var(--orange)',f:[
      ['Goal','Wrap the tetherball around the pole as fast as possible.'],
      ['How to play','One person goes at a time. Start on the signal. Hit the ball until the rope fully wraps around the pole.'],
      ['How to win','Fastest full wrap wins.']],
      note:'This event looks simple until your coordination leaves the premises.'},
    {id:'frisbee',name:'Frisbee Accuracy Challenge',sub:'Skills challenge',accent:'var(--gold)',f:[
      ['Goal','Hit the target as many times as possible.'],
      ['How to play','Each player gets 5 throws from the set line.'],
      ['Scoring','Most hits wins. Tie-breaker: one throw from 5 feet farther back.']],
      note:'Blaming the wind is permitted but not respected.'},
    {id:'crossbar',name:'Soccer Crossbar Challenge',sub:'Skills challenge',accent:'var(--teal)',f:[
      ['Goal','Hit the crossbar.'],
      ['How to play','Each player gets 3 kicks from the set line.'],
      ['Scoring','Most crossbar hits wins. Tie-breaker: one sudden-death kick.']],
      note:'A clean clang earns style points that count for absolutely nothing.'},
    {id:'football',name:'Football Toss Target Challenge',sub:'Skills challenge',accent:'var(--blue)',f:[
      ['Goal','Hit the target as many times as possible.'],
      ['How to play','Each player gets 5 throws from the set line.'],
      ['Scoring','Most hits wins. Tie-breaker: one throw from farther back.']],
      note:'Quarterback confidence and quarterback accuracy are not the same thing.'},
    {id:'tennisbocce',name:'Tennis Ball Bocce',sub:'Closest to the pin',accent:'var(--green)',f:[
      ['Goal','Roll your tennis ball closest to the pin.'],
      ['How to play','Each player gets one roll toward the target.'],
      ['How to win','Closest ball wins. Tie-breaker: one sudden-death roll.']],
      note:'Measurement disputes will be settled by tape measure and a heavy sigh from the host.'}
  ]}
};
function ruleCard(ev){
  const fields=ev.f.map(f=>{
    const[label,...rest]=f;
    const parts=rest.map(x=>Array.isArray(x)?`<ul>${x.map(li=>`<li>${li}</li>`).join('')}</ul>`:`<p>${x}</p>`).join('');
    return `<div class="rlab">${esc(label)}</div>${parts}`;
  }).join('');
  return `<div class="rulecard" id="rule-${ev.id}" style="--accent:${ev.accent};border-left:5px solid ${ev.accent}">
    <div class="rhead"><div class="rname">${esc(ev.name)}</div><div class="rsub">${esc(ev.sub)}</div></div>
    ${fields}${ev.note?`<div class="cnote"><b>Committee note:</b> ${ev.note}</div>`:''}</div>`;
}
VIEWS.rules=function(){
  const allEvents=[...RULES.tournaments.events,...RULES.squad.events,...RULES.skills.events];
  return `${banner('Ratified after minutes of careful review','Official Rules')}
  <div class="jumpbar">
    <div class="eyebrow">Jump to an event</div>
    <div class="jumprow">
      ${RULES.tournaments.events.map(e=>`<button class="jump sun" data-jump="rule-${e.id}">${esc(e.name)}</button>`).join('')}
      ${RULES.squad.events.map(e=>`<button class="jump tl" data-jump="rule-${e.id}">${esc(e.name)}</button>`).join('')}
      ${RULES.skills.events.map(e=>`<button class="jump" data-jump="rule-${e.id}">${esc(e.name)}</button>`).join('')}
      <button class="jump" data-jump="rule-voting">Awards Voting</button>
      <button class="jump" data-jump="rule-bonus">Bonus Points</button>
    </div>
  </div>
  <div class="goldcard"><div class="gt">★ The Golden Rule ★</div>
    <p><b>Keep it moving.</b></p>
    <p>Every event has a time cap. When the time cap hits, the leader wins. If the score is tied, we go to sudden death.</p>
    <p>Sudden death sounds dramatic. In most cases, it just means one more point.</p>
    <p>Arguing counts against you spiritually. Excessive rules-lawyering may also cost actual points.</p>
  </div>
  <div class="grid g2" style="margin-bottom:16px">
    <div class="card"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>General Rules</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.55">
      <li>Sign up in the app when an event requires signups.</li><li>Report to your event when called.</li>
      <li>Listen for announcements.</li><li>Respect the time caps.</li>
      <li>Report winners in the app or to the nearest responsible adult.</li><li>Hosts settle all disputes.</li>
      <li>Bonus points may be awarded for great celebrations, elite trash talk, sportsmanship, and questionable athletic decisions.</li>
      <li>Points may be deducted for ruining the vibe.</li></ul></div>
    <div class="card"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>Basic Scoring</div>
      <p style="margin:0 0 6px;font-size:14px">Unless the app or host says otherwise:</p>
      <ul style="margin:0 0 8px;padding-left:20px;font-size:14px;line-height:1.55"><li><b>1st place = 10 points</b></li><li><b>2nd place = 7 points</b></li><li><b>3rd place = 5 points</b></li><li><b>Participation = 1 point</b></li></ul>
      <p style="margin:0 0 4px;font-size:13.5px">For team events, points go to the team. For individual events, points go to the individual and may also help the family team.</p>
      <p style="margin:0;font-size:13.5px">For squad events, hosts may assign points based on the format, the chaos level, and whether anyone made the mistake of asking for a full explanation.</p></div>
  </div>
  ${['tournaments','squad','skills'].map(k=>{const s=RULES[k];
    return `<div class="rsec">${banner('',s.title,s.sub)}</div>${s.events.map(ruleCard).join('')}`;}).join('')}
  <div class="rsec" id="rule-voting">${banner('','Awards Voting','Guests will be able to vote in the app for select awards.')}</div>
  <div class="grid g2" style="margin-bottom:14px">
    <div class="card"><div class="cardhdr" style="font-size:15px"><span class="medallion"></span>Guest voting awards</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6"><li>Best Family Team Name</li><li>Best Family Flag</li><li>MVP Kid</li><li>Toughest Competitor</li><li>Biggest Upset</li><li>Best Celebration</li><li>Most Dramatic Athlete</li><li>Lifetime Achievement Award</li></ul></div>
    <div class="card"><div class="cardhdr" style="font-size:15px"><span class="medallion"></span>Voting rules</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6"><li>Each guest gets one vote per award.</li><li>Ballot stuffing is prohibited.</li><li>Lobbying is expected.</li><li>Campaign signs are not prohibited, which may have been an oversight.</li><li>The hosts may override results if democracy fails the event.</li></ul>
      <div class="cnote" style="margin-top:8px"><b>Committee note:</b> All voting results are final unless they are funny enough to challenge.</div></div>
  </div>
  <div class="rsec" id="rule-bonus">${banner('','Bonus Points','Bonus points may be awarded at any time.')}</div>
  <div class="grid g2" style="margin-bottom:14px">
    <div class="card" style="border-color:var(--green)"><div class="cardhdr" style="font-size:15px;color:var(--green)"><span class="medallion"></span>Possible reasons include</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6"><li>Great celebration</li><li>Elite trash talk</li><li>Outstanding sportsmanship</li><li>Questionable athletic decision</li><li>Impressive comeback</li><li>Refusing to quit despite clear physical decline</li><li>Making the event funnier</li><li>Helping a kid</li><li>Helping the hosts</li><li>Not making the hosts regret this idea</li></ul></div>
    <div class="card" style="border-color:var(--red)"><div class="cardhdr" style="font-size:15px;color:var(--red)"><span class="medallion"></span>Points may be deducted for</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6"><li>Rules-lawyering</li><li>Arguing too long</li><li>Taking a kid’s game too seriously</li><li>Delaying the schedule</li><li>Complaining about the app</li><li>Trying to turn sponge dodgeball into constitutional law</li></ul></div>
  </div>
  ${banner('','The Fine Print','')}
  <div class="card center" style="margin-bottom:14px">
    <p style="font-size:14px;margin:0 0 4px">Hosts settle all disputes. Bribes are noted but rarely effective.</p>
    <p style="font-size:14px;margin:0 0 4px">The app is the official scoring system unless the app is wrong, frozen, ignored, or replaced by yelling.</p>
    <p style="font-size:14px;margin:0 0 4px">All competitors participate at their own risk. Stretching is encouraged. Dignity is optional.</p>
    <p style="font-size:14px;margin:0 0 10px">Medical professionals remain theoretical.</p>
    <div class="disp" style="font-weight:900;font-size:18px">History will remember the champions.</div>
    <div class="mut small" style="font-style:italic">The OFSC will remember everyone who needed ice afterward.</div>
  </div>`;
};

/* ---------- VOTE ---------- */
VIEWS.vote=function(){
  const votingLive=state.awards.some(a=>a.award_type==='vote'&&a.is_open);
  if(!isHost()&&!votingLive)return `${banner('Patience, athlete','Awards Voting')}<div class="empty"><div class="big">Voting hasn’t opened yet</div>The hosts will open the polls later in the day — check back after dinner.</div>`;
  if(isHost()&&window.__voteAdmin!==false)return votingAdminView();
  return `${isHost()?`<div class="btnrow" style="margin-bottom:12px"><button class="btn sm ghost" data-votemode="admin">Admin control</button><button class="btn sm sunsetb" data-votemode="guest">Ballot preview</button></div>`:''}${guestBallotView()}`;
};
function nominees(a){if(a.subject==='team')return state.teams.map(t=>({id:t.id,label:t.name}));if(a.subject==='kid')return state.guests.filter(g=>g.kind==='kid').map(g=>({id:g.id,label:g.display_name}));return state.guests.map(g=>({id:g.id,label:g.display_name}));}
function nomineeLabel(a,id){return a.subject==='team'?teamName(id):guestName(id);}
function voteTally(aid){const a=state.awards.find(x=>x.id===aid);const c={};state.votes.filter(v=>v.award_id===aid).forEach(v=>c[v.nominee_id]=(c[v.nominee_id]||0)+1);return Object.entries(c).map(([id,count])=>({id,count,label:nomineeLabel(a,id)})).sort((x,y)=>y.count-x.count);}
function guestBallotView(){
  const voter=window.__voter||getMe()||'';window.__voter=voter;
  const open=state.awards.filter(a=>a.is_open&&a.award_type==='vote');
  return `${banner('The voters have spoken','Awards Voting')}
  <div class="card goldtrim" style="max-width:540px">
  ${voter?`<div class="inline" style="justify-content:space-between;margin-bottom:12px"><span class="sticker tealbg">Voting as ${esc(guestName(voter))}</span><button class="btn xs ghost" data-clearme>Not you?</button></div>`
    :`<label class="f"><span>Who are you?</span><select class="i" data-voter><option value="">— select your name —</option>${state.guests.map(g=>`<option value="${g.id}">${esc(g.display_name)}</option>`).join('')}</select></label>`}
  ${!voter?'<div class="mut small center">Select your name to see open awards.</div>':(!open.length?'<div class="empty">No awards are open right now.</div>':open.map(a=>{
    const already=state.votes.some(v=>v.award_id===a.id&&v.voter_id===voter);const noms=nominees(a);
    return `<div class="divider"></div><div class="cardhdr" style="font-size:17px;margin-bottom:4px"><span class="medallion"></span>${esc(a.name)}</div><div class="mut small" style="margin-bottom:8px">${esc(a.description)}</div>
    ${already?'<span class="pill ok">✓ You already voted</span>':`<select class="i ballot-nom" data-award="${a.id}" style="margin-bottom:8px"><option value="">— choose —</option>${noms.map(n=>`<option value="${n.id}">${esc(n.label)}</option>`).join('')}</select>
    <input class="i ballot-cm" data-award="${a.id}" placeholder="Optional comment" style="margin-bottom:8px">
    <button class="btn sunsetb block sm" data-castvote="${a.id}">Submit vote</button>`}`;}).join(''))}
  </div>`;
}
function votingAdminView(){
  return `${banner('The committee counts','Voting Control')}
  <div class="btnrow" style="margin-bottom:12px"><button class="btn sm ghost" data-votemode="admin">Admin control</button><button class="btn sm ghost" data-votemode="guest">Ballot preview</button>
  <button class="btn tealb sm" data-voteall="open">Open all</button><button class="btn ghost sm" data-voteall="close">Close all</button></div>
  ${state.awards.filter(a=>a.award_type==='vote').map(a=>{const t=voteTally(a.id);const total=t.reduce((s,x)=>s+x.count,0);
  return `<div class="card" style="padding:14px"><div class="inline" style="justify-content:space-between"><div><div class="disp" style="font-size:18px;font-weight:900">${esc(a.name)}</div><div class="mut small">${esc(a.description)}</div></div>${a.is_open?'<span class="pill live">Open</span>':'<span class="pill">Closed</span>'}</div>
  <div class="kv" style="margin-top:8px"><span>Votes</span><span>${total}</span></div>
  <div class="kv"><span>Leader</span><span style="color:var(--red);font-weight:800">${t[0]?esc(t[0].label)+' ('+t[0].count+')':'—'}</span></div>
  ${a.winner_id?`<div class="kv"><span>Locked winner</span><span style="color:var(--medgold);font-weight:800">🏆 ${esc(nomineeLabel(a,a.winner_id))}</span></div>`:''}
  <div class="btnrow" style="margin-top:10px"><button class="btn xs ${a.is_open?'ghost':'tealb'}" data-awardopen="${a.id}">${a.is_open?'Close':'Open'}</button><button class="btn xs ghost" data-awardwinner="${a.id}">Set winner</button><button class="btn xs danger" data-awardreset="${a.id}">Reset votes</button></div></div>`;}).join('')}`;
}

/* ---------- SCORING TABLE (host) ---------- */
VIEWS.score=function(){
  const evs=state.events.filter(e=>!e.is_bracket&&e.name!=='Bonus');
  const sel=window.__scEvent||(evs[0]&&evs[0].id);window.__scEvent=sel;
  const ev=evById(sel);if(!ev)return '<div class="empty">No events.</div>';
  return `${banner('The committee tallies','Scoring Table','Places → every team member gets the points automatically.')}
  <div class="inline" style="margin-bottom:14px;gap:12px">
    <label class="f" style="margin:0;min-width:280px;flex:1;max-width:420px"><span>Event</span>
      <select class="i" data-scselect>${evs.map(e=>`<option value="${e.id}" ${e.id===sel?'selected':''}>${esc(e.name)} · ${scLabel(e.scoring_type)}${e.status==='complete'?' ✓':''}</option>`).join('')}</select></label>
    <label class="f" style="margin:0"><span>Scoring type</span>
      <select class="i" data-sctype="${ev.id}">${['placement','head2head','squad','team_vs','skills','best','timed','manual'].map(t=>`<option value="${t}" ${ev.scoring_type===t?'selected':''}>${scLabel(t)}</option>`).join('')}</select></label>
  </div>
  <div class="card goldtrim">${scoreForm(ev)}</div>
  <div class="card" style="margin-top:14px">
    <div class="inline" style="justify-content:space-between;margin-bottom:8px"><div class="cardhdr" style="font-size:16px;margin:0"><span class="medallion"></span>Results in this event</div>
    <button class="btn xs ${ev.status==='complete'?'goldb':'ghost'}" data-completeevent="${ev.id}">${ev.status==='complete'?'✓ Complete':'Mark complete'}</button></div>
    ${eventResults(ev.id)}
  </div>
  <div class="card" style="margin-top:14px"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>⭐ Bonus / penalty points</div>${bonusForm()}</div>`;
};
function scoreForm(ev){
  if(ev.scoring_type==='squad'){
    const q=(window.__sqQ||'').toLowerCase();
    const picks=window.__sqPicks||(window.__sqPicks={});
    const shown=state.guests.filter(g=>!q||(g.display_name+' '+g.family).toLowerCase().includes(q));
    const aCount=Object.values(picks).filter(v=>v==='a').length;
    const bCount=Object.values(picks).filter(v=>v==='b').length;
    return `<div class="mut small" style="margin-bottom:10px">Tap A or B next to everyone who played. Winning side: <b>10 pts each</b> · losing side: <b>5 pts each</b>.</div>
    <input class="i" placeholder="Search players…" value="${esc(window.__sqQ||'')}" data-sqsearch style="margin-bottom:10px">
    <div style="max-height:340px;overflow:auto;border:2px solid var(--line);border-radius:12px;padding:6px">
    ${shown.map(g=>{const v=picks[g.id]||'';return `<div class="member" style="border-bottom:1.5px dashed var(--line)">
      <div style="flex:1;min-width:0;font-weight:700;font-size:14px">${esc(g.display_name)} <span class="mut small">· ${esc(g.family)}</span></div>
      <button class="btn xs ${v==='a'?'sunsetb':'ghost'}" data-sqpick="${g.id}|a">A</button>
      <button class="btn xs ${v==='b'?'tealb':'ghost'}" data-sqpick="${g.id}|b">B</button>
    </div>`;}).join('')}</div>
    <div class="inline" style="margin:12px 0 8px;justify-content:space-between"><span class="tag">Side A · ${aCount} players</span><span class="tag">Side B · ${bCount} players</span></div>
    <small style="font-family:var(--disp);letter-spacing:.12em;color:var(--ink2);font-weight:800">WHO WON?</small>
    <div class="btnrow" style="margin:8px 0 14px">
      <button class="btn ${window.__sqWin==='a'?'sunsetb':'ghost'}" data-sqwin="a">Side A won</button>
      <button class="btn ${window.__sqWin==='b'?'tealb':'ghost'}" data-sqwin="b">Side B won</button>
    </div>
    <div class="btnrow"><button class="btn goldb big" data-savesquad="${ev.id}">Save — award 10 / 5</button><button class="btn ghost" data-undoscore="${ev.id}">↶ Undo last save</button></div>`;
  }
  if(ev.scoring_type==='team_vs'){
    return `<div class="mut small" style="margin-bottom:10px">Pick the two teams, then the winner. Winning team: <b>10 pts each member</b> · losing team: <b>5 pts each member</b>.</div>
    <div class="grid g2">
      <label class="f"><span>Team 1</span><select class="i" id="tvA"><option value="">—</option>${state.teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Team 2</span><select class="i" id="tvB"><option value="">—</option>${state.teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    </div>
    <div class="btnrow" style="margin-bottom:14px">
      <button class="btn ${window.__tvWin==='a'?'sunsetb':'ghost'}" data-tvwin="a">Team 1 won</button>
      <button class="btn ${window.__tvWin==='b'?'tealb':'ghost'}" data-tvwin="b">Team 2 won</button>
    </div>
    <div class="btnrow"><button class="btn goldb big" data-saveteamvs="${ev.id}">Save — award 10 / 5</button><button class="btn ghost" data-undoscore="${ev.id}">↶ Undo last save</button></div>`;
  }
  if(ev.scoring_type==='skills'){
    const entrants=state.signups.filter(s=>s.event_id===ev.id);
    if(!entrants.length)return `<div class="empty"><div class="big">No sign-ups yet</div>Players raise their hand on the Sign Up page — then they appear here to place.</div>`;
    return `<div class="mut small" style="margin-bottom:10px">Everyone signed up is listed. Set 1st (${P().first}), 2nd (${P().second}), 3rd (${P().third}) — everyone else entered gets ${P().participation} for participating.</div>
    <table class="scoretbl"><thead><tr><th>Competitor</th><th>Place</th></tr></thead><tbody>
    ${entrants.map(s=>`<tr><td><b>${esc(guestName(s.player1_id))}</b> <span class="mut small">· ${esc(guest(s.player1_id)?.family||'')}</span></td>
      <td><select class="selp skills-sel" data-guest="${s.player1_id}"><option value="">entered</option><option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option></select></td></tr>`).join('')}
    </tbody></table>
    <div class="btnrow" style="margin-top:14px"><button class="btn goldb big" data-saveskills="${ev.id}">Save placements</button><button class="btn ghost" data-undoscore="${ev.id}">↶ Undo last save</button></div>`;
  }
  if(ev.scoring_type==='placement'||ev.scoring_type==='head2head'){
    const h2h=ev.scoring_type==='head2head';
    const note=h2h?'Head-to-head: set the winner to 1st. Every team you mark gets points; unmarked teams get nothing (or use Participation).'
                  :'Set places. 1st '+P().first+' · 2nd '+P().second+' · 3rd '+P().third+' · participation '+P().participation+'.';
    return `<div class="mut small" style="margin-bottom:10px">${note}</div>
    <table class="scoretbl"><thead><tr><th>Team</th><th>Place</th></tr></thead><tbody>
    ${state.teams.map(t=>`<tr><td><span class="swatch" style="display:inline-block;vertical-align:middle;background:${t.color};margin-right:8px"></span><b>${esc(t.name)}</b></td>
      <td><select class="selp place-sel" data-team="${t.id}"><option value="">—</option><option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option><option value="p">Participation</option></select></td></tr>`).join('')}
    </tbody></table>
    <div class="btnrow" style="margin-top:14px"><button class="btn goldb big" data-savetable="${ev.id}">Save scores</button><button class="btn ghost" data-undoscore="${ev.id}">↶ Undo last save</button></div>`;
  }
  if(ev.scoring_type==='best'||ev.scoring_type==='timed'){
    const timed=ev.scoring_type==='timed';
    return `<div class="mut small" style="margin-bottom:10px">Individual competitors. Enter each person's ${timed?'time in seconds (lowest wins)':'best attempt (highest wins)'} — ranked automatically on save.</div>
    <div id="bestRows">${bestRow()}${bestRow()}${bestRow()}</div>
    <button class="btn ghost sm" data-addbest style="margin:6px 0 14px">+ Add competitor</button>
    <div class="btnrow"><button class="btn goldb big" data-savebest="${ev.id}|${timed?'timed':'best'}">Rank &amp; award points</button><button class="btn ghost" data-undoscore="${ev.id}">↶ Undo last save</button></div>`;
  }
  return `<div class="grid g2"><label class="f"><span>Give to</span><select class="i" id="manTarget">${teamOrGuestOptions()}</select></label>
  <label class="f"><span>Points</span><input class="i" id="manP" type="number" value="10"></label></div>
  <label class="f"><span>Reason</span><input class="i" id="manR" placeholder="Reason"></label>
  <button class="btn goldb block" data-savemanual="${ev.id}">Award points</button>`;
}
function bestRow(){return `<div class="inline best-row" style="margin-bottom:8px"><select class="i best-g" style="flex:2;min-width:170px"><option value="">— competitor —</option>${state.guests.map(g=>`<option value="${g.id}">${esc(g.display_name)}</option>`).join('')}</select><input class="i best-v" style="flex:1;min-width:90px" type="number" step="any" inputmode="decimal" placeholder="value"></div>`;}
function teamOrGuestOptions(){return `<optgroup label="Teams (→ all members)">${state.teams.map(t=>`<option value="t:${t.id}">${esc(t.name)}</option>`).join('')}</optgroup><optgroup label="Individuals">${state.guests.map(g=>`<option value="g:${g.id}">${esc(g.display_name)}</option>`).join('')}</optgroup>`;}
function bonusForm(){
  const reasons=['Great celebration','Best trash talk','Questionable athletic decision','Sportsmanship','Rule violation','Participation bonus'];
  return `<div class="grid g2"><label class="f"><span>Give to</span><select class="i" id="bonTarget">${teamOrGuestOptions()}</select></label><label class="f"><span>Points (+/-)</span><input class="i" id="bonP" type="number" value="3"></label></div>
  <label class="f"><span>Reason</span><select class="i" onchange="if(this.value)document.getElementById('bonR').value=this.value"><option value="">Custom…</option>${reasons.map(r=>`<option>${r}</option>`).join('')}</select></label>
  <input class="i" id="bonR" placeholder="Reason" style="margin-bottom:10px"><button class="btn tealb block" data-savebonus>Apply</button>`;
}
function eventResults(eid){
  const rows=state.scores.filter(s=>s.event_id===eid).slice().reverse();
  const seen=new Set();const compact=[];
  rows.forEach(s=>{
    const noteKey=(s.note||'');
    if(s.team_id&&s.guest_id){const key='t|'+s.team_id+'|'+(s.place||'')+'|'+noteKey;if(seen.has(key))return;seen.add(key);
      compact.push({...s,label:teamName(s.team_id)+' (all members)',delArg:s.id+'|'+s.team_id+'|'+(s.place||'')+'|'+encodeURIComponent(noteKey)});}
    else if(s.guest_id&&/^\[batch:/.test(noteKey)){const key='n|'+(s.place||'')+'|'+(s.points||'')+'|'+noteKey;
      const n=rows.filter(x=>x.guest_id&&(x.note||'')===noteKey&&x.place===s.place&&x.points===s.points).length;
      if(n>1){if(seen.has(key))return;seen.add(key);
        compact.push({...s,label:'×'+n+' players',delArg:s.id+'|note|'+(s.place||'')+'|'+encodeURIComponent(noteKey)});}
      else compact.push({...s,label:guestName(s.guest_id),delArg:s.id});}
    else compact.push({...s,label:s.guest_id?guestName(s.guest_id):teamName(s.team_id),delArg:s.id});
  });
  if(!compact.length)return '<div class="mut small">No results yet.</div>';
  return compact.slice(0,30).map(s=>`<div class="row" style="padding:8px 12px"><div class="swatch" style="background:${s.team_id?(team(s.team_id)?.color||'#889'):'#889'}"></div>
    <div class="grow"><div class="name" style="font-size:14px">${esc(s.label)}</div>
    <div class="meta">${s.place?ordinal(s.place)+' · ':''}${s.note?esc(String(s.note).replace(/^\[[^\]]+\]\s*/,''))+' · ':''}${s.points>=0?'+':''}${s.points} pts each</div></div>
    <button class="btn xs danger" data-delscore="${s.delArg}" title="Remove">✕</button></div>`).join('');
}

/* ---------- AWARDS (host) ---------- */
VIEWS.awards=function(){
  return `${banner('History remembers the champion','Awards')}
  <button class="btn sunsetb big block" data-act="launchAwards" style="margin-bottom:14px">🏆 Launch Awards Ceremony</button>
  ${state.awards.map(a=>{let w='—';
    if(a.winner_id)w=nomineeLabel(a,a.winner_id);
    else if(a.award_type==='points'){const idx={'Family Gold Medal':0,'Family Silver Medal':1,'Family Bronze Medal':2}[a.name];const st=teamStandings();if(st[idx])w=st[idx].t.name+' (auto)';}
    else{const t=voteTally(a.id);if(t[0])w=t[0].label+' (leading)';}
  return `<div class="card" style="padding:13px 16px"><div class="inline" style="justify-content:space-between"><div><div class="disp" style="font-size:18px;font-weight:900">${esc(a.name)}</div><div class="mut small">${esc(a.description)}</div></div><span class="tag">${a.award_type==='vote'?'VOTED':a.award_type==='points'?'BY POINTS':'MANUAL'}</span></div>
  <div class="kv" style="margin-top:8px"><span>Winner</span><span style="color:var(--medgold);font-weight:800">${a.locked?'🔒 ':''}${esc(w)}</span></div>
  <div class="btnrow" style="margin-top:8px"><button class="btn xs ghost" data-awardwinner="${a.id}">Set winner</button><button class="btn xs ${a.locked?'goldb':'ghost'}" data-awardlock="${a.id}">${a.locked?'🔒 Locked':'Lock'}</button></div></div>`;}).join('')}`;
};

/* ---------- ADMIN ---------- */
VIEWS.admin=function(){
  if(!isHost()){
    return `${banner('Committee access','Host Login')}
    <div class="card goldtrim" style="max-width:420px"><label class="f"><span>Email</span><input class="i" id="loginEmail" type="email" autocomplete="username"></label>
    <label class="f"><span>Password</span><input class="i" id="loginPass" type="password" autocomplete="current-password"></label>
    <button class="btn sunsetb block" data-login>Sign in</button>
    <div class="mut small" style="margin-top:10px">Hosts only. Guests never need to sign in.</div></div>`;
  }
  const m=state.settings;
  return `${banner('The committee','Admin')}
  <div class="inline" style="margin-bottom:12px"><span class="pill ok">Signed in · ${esc(session.user.email)}</span><button class="btn xs ghost" data-logout>Sign out</button></div>
  <div class="card"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>Event</div>
    <label class="f"><span>Event name</span><input class="i" data-meta="event_name" value="${esc(m.event_name||'')}"></label>
    <label class="f"><span>Date</span><input class="i" data-meta="date_label" value="${esc(m.date_label||'')}"></label>
    <label class="f"><span>Public app URL (QR codes)</span><input class="i" data-meta="public_url" value="${esc(m.public_url||'')}" placeholder="https://your-app.vercel.app"></label>
    <div class="grid g2"><label class="f"><span>Now competing</span><select class="i" data-meta="current_event_id"><option value="">—</option>${state.events.map(e=>`<option value="${e.id}" ${m.current_event_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Next up</span><select class="i" data-meta="next_event_id"><option value="">—</option>${state.events.map(e=>`<option value="${e.id}" ${m.next_event_id===e.id?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label></div>
  </div>
  <div class="card"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>Point values</div>
    <div class="grid g4">${['first','second','third','participation'].map(k=>`<label class="f"><span>${k}</span><input class="i" type="number" data-pts="${k}" value="${(m.points||{})[k]||0}"></label>`).join('')}</div></div>
  <div class="card"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>Data</div>
    <div class="btnrow"><button class="btn tealb" data-act="exportAll">⬇ Export JSON backup</button><button class="btn ghost sm" data-export="scores">Scores CSV</button><button class="btn ghost sm" data-export="votes">Votes CSV</button></div></div>
  <div class="card"><div class="cardhdr" style="font-size:16px"><span class="medallion"></span>Reset &amp; demo controls</div>
    <div class="btnrow"><button class="btn ghost sm" data-act="resetStatuses">↺ Reset statuses</button><button class="btn danger sm" data-act="clearBrackets">Clear brackets</button><button class="btn danger sm" data-act="clearSignups">Clear sign-ups</button><button class="btn danger sm" data-act="clearScores">Clear scores</button><button class="btn danger sm" data-act="clearVotes">Clear votes</button></div>
    <div class="mut small" style="margin-top:8px">Use <b>Clear sign-ups</b> to wipe the demo entrants before the real event.</div></div>`;
};

/* ================= FULLSCREEN: Big displays + awards ================= */
let fsMode=null,awardIdx=0,awardRevealed=false;
function launchFS(mode){fsMode=mode;$('#fs').classList.add('on');renderFS();}
function exitFS(){$('#fs').classList.remove('on');fsMode=null;if(['dstand','dbrack','dresults'].includes(route))route='home';render();}
function fsShell(title,inner,ctrl){
  return `<div class="fs-top"><img src="logo.png" alt="logo"><div><div class="ttl">${esc(state.settings.event_name||'OFSC Family Olympics')}</div><div style="font-size:11px;letter-spacing:.2em;color:#cfd9ea;text-transform:uppercase">${esc(title)}</div></div>
  <div style="margin-left:auto" class="disp" id="tvclock" style="font-size:26px">${nowTime()}</div></div>
  <button class="fs-exit" data-fsexit>✕ Exit</button>
  <div class="fs-body">${inner}</div>${ctrl||''}`;
}
function renderFS(){
  if(fsMode==='awards')return renderAwardsFS();
  let inner='',title='';
  if(fsMode==='dstand'){title='Team Standings';const st=teamStandings();const max=st[0]?st[0].points:1;
    inner=`<div class="bigwrap"><div class="disc sunset slats"></div>${st.slice(0,10).map((r,i)=>`<div class="bigrow"><div class="med ${i<3?'g'+(i+1):''}">${i+1}</div><b>${esc(r.t.name)}</b><div style="flex:2;min-width:100px"><div class="bar"><i style="width:${Math.max(4,Math.round(r.points/Math.max(1,max)*100))}%;background:${r.t.color}"></i></div></div><div class="pts">${fmt(r.points)}</div></div>`).join('')}</div>`;}
  else if(fsMode==='dbrack'){
    const bes=state.events.filter(e=>e.is_bracket);
    const sel=window.__fsBk||bes.find(e=>state.matches.some(m=>m.event_id===e.id))?.id||(bes[0]&&bes[0].id);window.__fsBk=sel;
    const ms=state.matches.filter(m=>m.event_id===sel).sort((a,b)=>a.round-b.round||a.slot-b.slot);
    title=(evById(sel)?.name||'')+' Bracket';
    inner=`<div class="btnrow" style="margin-bottom:14px">${bes.map(e=>`<button class="btn sm ${e.id===sel?'sunsetb':'ghost'}" data-fsbk="${e.id}">${esc(e.name)}</button>`).join('')}</div>
    <div class="bigwrap"><div class="disc sunset slats"></div>${ms.length?`<div class="bracket tv-bracket">${bracketHtml(ms,true)}</div>`:'<div class="empty"><div class="big">Bracket not drawn yet</div></div>'}</div>`;}
  else{title='Recent Results';
    const rows=state.scores.slice().reverse();const seen=new Set();const compact=[];
    for(const s of rows){const key=s.event_id+'|'+(s.team_id||'')+'|'+(s.place||'')+'|'+(s.note||'');
      if(s.team_id&&s.guest_id){if(seen.has(key))continue;seen.add(key);compact.push({...s,who:teamName(s.team_id),color:team(s.team_id)?.color});}
      else compact.push({...s,who:s.guest_id?guestName(s.guest_id):teamName(s.team_id),color:s.team_id?team(s.team_id)?.color:'#122142'});
      if(compact.length>=8)break;}
    inner=`<div class="bigwrap"><div class="disc sunset slats"></div>${compact.map(s=>`<div class="bigrow"><div class="med" style="background:${s.color||'#122142'};color:#fff">★</div><b>${esc(s.who)}</b><span class="tag" style="font-size:1.4vw">${esc(eventName(s.event_id))}${s.place?' · '+ordinal(s.place):''}</span><div class="pts" style="width:9vw;text-align:right">${s.points>=0?'+':''}${s.points}</div></div>`).join('')||'<div class="empty"><div class="big">Awaiting the first result…</div></div>'}</div>`;}
  $('#fs').innerHTML=fsShell(title,inner);
}
function renderAwardsFS(){
  const list=state.awards;const a=list[awardIdx%list.length];
  let winner='',runner='';
  if(a.winner_id)winner=nomineeLabel(a,a.winner_id);
  else if(a.award_type==='points'){const idx={'Family Gold Medal':0,'Family Silver Medal':1,'Family Bronze Medal':2}[a.name];const st=teamStandings();if(st[idx])winner=st[idx].t.name;}
  else{const t=voteTally(a.id);if(t[0])winner=t[0].label;if(t[1])runner=t[1].label;}
  const intros=['And the OFSC voters have spoken.','After careful review and several deeply biased ballots…','This award recognizes courage, chaos, and no self-preservation.','The committee accepts no responsibility for hurt feelings.'];
  const inner=`<div class="center" style="padding-top:2vh">
    <div class="eyebrow" style="font-size:1.6vw;letter-spacing:.3em">${a.award_type==='points'?'By the numbers':a.award_type==='vote'?'The voters have spoken':'Committee selection'}</div>
    <div class="fs-award-name">${esc(a.name)}</div>
    <div class="mut" style="font-size:1.8vw;max-width:70vw;margin:0 auto 3vh">${esc(a.description)}</div>
    ${awardRevealed?`<div class="mut" style="font-size:1.5vw;font-style:italic;margin-bottom:1vh">${esc(intros[awardIdx%intros.length])}</div>
      <div class="fs-award-winner">${esc(winner||'—')}</div>
      ${runner?`<div class="mut" style="font-size:1.8vw;margin-top:1.5vh">Runner-up · ${esc(runner)}</div>`:''}`
    :`<div class="disp" style="font-size:5vw;color:var(--line);font-weight:900">▓▓▓▓▓</div><div class="mut" style="font-size:1.6vw;margin-top:2vh">The committee is reviewing the results…</div>`}
  </div>`;
  const ctrl=`<div class="fs-ctrl"><button class="btn sm" data-awardprev>‹ Prev</button><button class="btn sm ${awardRevealed?'ghost':'sunsetb'}" data-awardreveal>${awardRevealed?'Hide':'Reveal winner'}</button><button class="btn sm" data-awardnext>Next ›</button></div>`;
  $('#fs').innerHTML=fsShell('Awards Ceremony · '+(awardIdx+1)+'/'+list.length,inner,ctrl);
}

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
/* host edit path (can overwrite a completed match) */
async function setMatchResult(matchId,winnerSignupId,aScore,bScore){
  const m=state.matches.find(x=>x.id===matchId);if(!m)return;
  const ev=evById(m.event_id);const bp=state.settings.bracket_points||{champion:15,runnerup:10,win:3};
  await sb.from('scores').delete().like('note',`[m:${matchId}]%`);
  await upd('matches',matchId,{winner_signup_id:winnerSignupId,a_score:aScore??null,b_score:bScore??null,status:'complete'});
  const winSu=state.signups.find(s=>s.id===winnerSignupId);
  const winPlayers=[winSu.player1_id,winSu.player2_id].filter(Boolean);
  for(const pid of winPlayers)await ins('scores',{event_id:m.event_id,guest_id:pid,points:bp.win||0,note:`[m:${matchId}] Won ${ev.name} R${m.round}`});
  if(m.next_match_id){const patch={};patch[m.next_side==='a'?'a_signup_id':'b_signup_id']=winnerSignupId;await upd('matches',m.next_match_id,patch);
    const nm=state.matches.find(x=>x.id===m.next_match_id);
    if(nm){const a=m.next_side==='a'?winnerSignupId:nm.a_signup_id;const b=m.next_side==='b'?winnerSignupId:nm.b_signup_id;if(a&&b&&nm.status!=='complete')await upd('matches',m.next_match_id,{status:'ready'});}
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

/* ================= interactions ================= */
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.matches('[data-sqsearch]')){window.__sqQ=t.value;
    // re-render only the list to keep focus
    const ev=evById(window.__scEvent);if(ev){const card=t.closest('.card');if(card){const pos=t.selectionStart;card.innerHTML=scoreForm(ev);const nt=card.querySelector('[data-sqsearch]');if(nt){nt.focus();nt.setSelectionRange(pos,pos);}}}}
});

document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.matches('[data-scselect]')){window.__scEvent=t.value;render();}
  else if(t.matches('[data-sctype]')){await upd('events',t.dataset.sctype,{scoring_type:t.value});await loadAndRender();}
  else if(t.matches('[data-repmatch]')){window.__repMatch=t.value;window.__repPick='';render();}
  else if(t.matches('[data-voter]')){window.__voter=t.value;setMe(t.value);render();}
  else if(t.matches('[data-tmsel]')){window.__tmSel=t.value;render();}
  else if(t.matches('[data-blockstatus]')){await upd('schedule_blocks',t.dataset.blockstatus,{status:t.value});await loadAndRender();}
  else if(t.matches('[data-meta]')){await upd('settings',1,{[t.dataset.meta]:t.value||null});await loadAll();}
  else if(t.matches('[data-pts]')){const p={...(state.settings.points||{})};p[t.dataset.pts]=+t.value||0;await upd('settings',1,{points:p});await loadAll();}
  else if(t.matches('#tmFlagFile')){handleFlagFile(t.files[0]);}
});

document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-nav],[data-more],[data-close],[data-act],[data-lb],[data-suevent],[data-dosignup],[data-delsignup],[data-bkevent],[data-genbracket],[data-seedbracket],[data-clearevsignups],[data-matchresult],[data-shuffleseed],[data-seedmove],[data-dogenerate],[data-submitresult],[data-reppick],[data-repsubmit],[data-savetable],[data-savebest],[data-addbest],[data-savemanual],[data-savebonus],[data-sqpick],[data-sqwin],[data-savesquad],[data-tvwin],[data-saveteamvs],[data-saveskills],[data-completeevent],[data-delscore],[data-undoscore],[data-votemode],[data-voteall],[data-awardopen],[data-awardwinner],[data-awardreset],[data-awardlock],[data-castvote],[data-savewinner],[data-clearme],[data-jump],[data-tmsave],[data-tmcolor],[data-tmflag],[data-msave],[data-addguest],[data-saveguest],[data-login],[data-logout],[data-export],[data-fsexit],[data-fsbk],[data-awardprev],[data-awardnext],[data-awardreveal]');
  if(!el)return;const d=el.dataset;

  if('nav'in d){go(d.nav);return;}
  if('more'in d){openMore();return;}
  if('close'in d){if(e.target.matches('[data-close]')||e.target.closest('.x'))closeModal();return;}
  if('lb'in d){window.__lb=d.lb;render();return;}
  if('suevent'in d){window.__suEvent=d.suevent;render();return;}
  if('bkevent'in d){window.__bkEvent=d.bkevent;render();return;}
  if('votemode'in d){window.__voteAdmin=d.votemode==='admin';render();return;}
  if('clearme'in d){clearMe();return;}
  if('jump'in d){const t=document.getElementById(d.jump);if(t)t.scrollIntoView({behavior:'smooth',block:'start'});return;}
  if('act'in d){await handleAct(d.act);return;}

  /* report winner (guest) */
  if('reppick'in d){window.__repPick=d.reppick;render();return;}
  if('repsubmit'in d){
    const m=state.matches.find(x=>x.id===d.repsubmit);if(!m)return;
    const pick=window.__repPick;if(!pick){toast('Tap the winner first','err');return;}
    const winner=pick==='a'?m.a_signup_id:m.b_signup_id;
    const a=parseInt($('#repA')?.value),b=parseInt($('#repB')?.value);
    const ok=await rpc('rpc_report_winner',{p_match:m.id,p_winner:winner,p_a:isNaN(a)?null:a,p_b:isNaN(b)?null:b});
    if(ok){window.__repPick='';window.__repMatch='';await loadAndRender();toast('Result in! The bracket has advanced. 🏆');}
    return;}

  /* signup */
  if('dosignup'in d){await doSignup(d.dosignup);return;}
  if('delsignup'in d){await del('bracket_signups',d.delsignup);await loadAndRender();return;}

  /* bracket admin */
  if('genbracket'in d){const ids=shuffle(state.signups.filter(s=>s.event_id===d.genbracket).map(s=>s.id));await generateBracket(d.genbracket,ids);return;}
  if('seedbracket'in d){seedModal(d.seedbracket);return;}
  if('shuffleseed'in d){window.__seedOrder=shuffle(window.__seedOrder||[]);seedModalBody();return;}
  if('seedmove'in d){const[i,dir]=d.seedmove.split('|').map(Number);const a=window.__seedOrder;const j=i+dir;if(j>=0&&j<a.length){[a[i],a[j]]=[a[j],a[i]];}seedModalBody();return;}
  if('dogenerate'in d){closeModal();await generateBracket(window.__seedEvent,window.__seedOrder.slice());return;}
  if('clearevsignups'in d){if(confirm('Clear sign-ups and bracket for this event?')){await sb.from('matches').delete().eq('event_id',d.clearevsignups);await sb.from('bracket_signups').delete().eq('event_id',d.clearevsignups);await sb.from('scores').delete().eq('event_id',d.clearevsignups).like('note','[%');await upd('events',d.clearevsignups,{status:'not_started'});await loadAndRender();toast('Event cleared');}return;}
  if('matchresult'in d){resultModal(d.matchresult);return;}
  if('submitresult'in d){const wid=$('#resWinner').value;if(!wid){toast('Pick a winner','err');return;}const a=parseInt($('#resA').value),b=parseInt($('#resB').value);closeModal();await setMatchResult(d.submitresult,wid,isNaN(a)?null:a,isNaN(b)?null:b);return;}

  /* scoring table */
  if('sqpick'in d){const[gid,side]=d.sqpick.split('|');const p=window.__sqPicks||(window.__sqPicks={});p[gid]=p[gid]===side?'':side;render();return;}
  if('sqwin'in d){window.__sqWin=d.sqwin;render();return;}
  if('savesquad'in d){await saveSquad(d.savesquad);return;}
  if('tvwin'in d){window.__tvWin=d.tvwin;render();return;}
  if('saveteamvs'in d){await saveTeamVs(d.saveteamvs);return;}
  if('saveskills'in d){await saveSkills(d.saveskills);return;}
  if('savetable'in d){await saveTable(d.savetable);return;}
  if('savebest'in d){await saveBest(d.savebest);return;}
  if('addbest'in d){$('#bestRows').insertAdjacentHTML('beforeend',bestRow());return;}
  if('savemanual'in d){await saveManual(d.savemanual);return;}
  if('savebonus'in d){await saveBonus();return;}
  if('completeevent'in d){const ev=evById(d.completeevent);await upd('events',ev.id,{status:ev.status==='complete'?'not_started':'complete'});await loadAndRender();return;}
  if('delscore'in d){await deleteScore(d.delscore);return;}
  if('undoscore'in d){await undoLast(d.undoscore);return;}

  /* voting */
  if('voteall'in d){for(const a of state.awards.filter(x=>x.award_type==='vote'))await upd('awards',a.id,{is_open:d.voteall==='open'});await loadAndRender();return;}
  if('awardopen'in d){const a=state.awards.find(x=>x.id===d.awardopen);await upd('awards',a.id,{is_open:!a.is_open});await loadAndRender();return;}
  if('awardreset'in d){if(confirm('Reset votes for this award?')){await sb.from('votes').delete().eq('award_id',d.awardreset);await loadAndRender();}return;}
  if('awardwinner'in d){winnerModal(d.awardwinner);return;}
  if('savewinner'in d){const a=state.awards.find(x=>x.id===d.savewinner);await upd('awards',a.id,{winner_id:$('#winSel').value||null,winner_type:a.subject==='team'?'team':'guest'});closeModal();await loadAndRender();return;}
  if('awardlock'in d){const a=state.awards.find(x=>x.id===d.awardlock);let wid=a.winner_id;
    if(!wid){if(a.award_type==='vote'){const t=voteTally(a.id);if(t[0])wid=t[0].id;}else if(a.award_type==='points'){const idx={'Family Gold Medal':0,'Family Silver Medal':1,'Family Bronze Medal':2}[a.name];const st=teamStandings();if(st[idx])wid=st[idx].t.id;}}
    await upd('awards',a.id,{locked:!a.locked,winner_id:wid||null,winner_type:a.subject==='team'?'team':'guest'});await loadAndRender();return;}
  if('castvote'in d){await castVote(d.castvote);return;}

  /* team mgmt */
  if('tmcolor'in d){window.__tmColor=d.tmcolor;document.querySelectorAll('[data-tmcolor]').forEach(x=>x.style.outline='none');el.style.outline='3px solid var(--navy)';el.style.outlineOffset='3px';return;}
  if('tmsave'in d){const ok=await rpc('rpc_update_team',{p_team:d.tmsave,p_name:$('#tmName').value,p_color:window.__tmColor||null,p_song:$('#tmSong').value,p_flag:null});if(ok){window.__tmColor=null;await loadAndRender();toast('Team saved');}return;}
  if('tmflag'in d){$('#tmFlagFile').click();return;}
  if('msave'in d){const inp=document.querySelector(`[data-mname="${d.msave}"]`);const ok=await rpc('rpc_rename_guest',{p_guest:d.msave,p_name:inp.value});if(ok){await loadAndRender();toast('Name saved');}return;}
  if('addguest'in d){addGuestModal(d.addguest);return;}
  if('saveguest'in d){const rec={display_name:$('#agN').value.trim()||'Guest',family:team(d.saveguest)?.family||'',kind:$('#agK').value,team_id:d.saveguest};if(await ins('guests',rec)){closeModal();await loadAndRender();toast('Member added');}return;}

  /* auth / export / fs */
  if('login'in d){const{error}=await sb.auth.signInWithPassword({email:$('#loginEmail').value.trim(),password:$('#loginPass').value});if(error){toast(error.message,'err');}else toast('Signed in');return;}
  if('logout'in d){await sb.auth.signOut();return;}
  if('export'in d){exportCSV(d.export);return;}
  if('fsexit'in d){exitFS();return;}
  if('fsbk'in d){window.__fsBk=d.fsbk;renderFS();return;}
  if('awardprev'in d){awardIdx=(awardIdx-1+state.awards.length)%state.awards.length;awardRevealed=false;renderAwardsFS();return;}
  if('awardnext'in d){awardIdx=(awardIdx+1)%state.awards.length;awardRevealed=false;renderAwardsFS();return;}
  if('awardreveal'in d){awardRevealed=!awardRevealed;renderAwardsFS();return;}
});

async function handleAct(act){
  if(act==='launchAwards'){fsMode='awards';awardIdx=0;awardRevealed=false;$('#fs').classList.add('on');renderAwardsFS();}
  else if(act==='exportAll'){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='ofsc_backup.json';a.click();toast('Backup downloaded');}
  else if(act==='resetStatuses'){if(confirm('Reset all event & schedule statuses?')){for(const e of state.events)await upd('events',e.id,{status:'not_started'});for(const b of state.schedule)await upd('schedule_blocks',b.id,{status:'not_started'});await upd('settings',1,{current_event_id:null,next_event_id:null});await loadAndRender();toast('Statuses reset');}}
  else if(act==='clearBrackets'){if(confirm('Delete ALL brackets? (Sign-ups stay.)')){await delAll('matches');await sb.from('scores').delete().like('note','[%');for(const e of state.events)if(e.is_bracket)await upd('events',e.id,{status:'not_started'});await loadAndRender();toast('Brackets cleared');}}
  else if(act==='clearSignups'){if(confirm('Delete ALL sign-ups AND brackets?')){await delAll('matches');await delAll('bracket_signups');await sb.from('scores').delete().like('note','[%');await loadAndRender();toast('Sign-ups cleared');}}
  else if(act==='clearScores'){if(confirm('Delete ALL scores? This zeroes the standings.')){await delAll('scores');await loadAndRender();toast('Scores cleared');}}
  else if(act==='clearVotes'){if(confirm('Delete ALL votes?')){await delAll('votes');await loadAndRender();toast('Votes cleared');}}
}
async function delAll(t){const{error}=await sb.from(t).delete().neq('id','00000000-0000-0000-0000-000000000000');if(error)toast(error.message,'err');}
function openMore(){
  const n=nav();const items=[...n.guestN,...n.disp,...n.host];
  openModal('Menu',items.map(x=>`<button class="btn ghost block" data-nav="${x[0]}" style="justify-content:flex-start;margin-bottom:8px"><span style="margin-right:8px">${x[1]}</span>${x[2]}</button>`).join(''),`<button class="btn ghost" data-close>Close</button>`);
  $('#modalRoot').addEventListener('click',ev=>{if(ev.target.closest('[data-nav]'))closeModal();},{once:true});
}

/* ---------------- signup / votes ---------------- */
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
async function castVote(awardId){
  const voter=window.__voter;if(!voter){toast('Select your name first','err');return;}
  if(state.votes.some(v=>v.award_id===awardId&&v.voter_id===voter)){toast('You already voted for this award. The committee rejects ballot stuffing.','err');return;}
  const a=state.awards.find(x=>x.id===awardId);
  const nomSel=document.querySelector(`.ballot-nom[data-award="${awardId}"]`);const cm=document.querySelector(`.ballot-cm[data-award="${awardId}"]`);
  if(!nomSel||!nomSel.value){toast('Choose a nominee','err');return;}
  const ok=await ins('votes',{award_id:awardId,voter_id:voter,nominee_type:a.subject==='team'?'team':'guest',nominee_id:nomSel.value,comment:cm?cm.value.trim():''});
  if(ok){await loadAndRender();toast('Vote recorded. Democracy has survived another backyard sporting event.');}
}

/* ---------------- scoring saves ---------------- */
async function awardTeamMembers(eventId,teamId,place,points,note){
  const members=state.guests.filter(g=>g.team_id===teamId);
  if(!members.length){await ins('scores',{event_id:eventId,team_id:teamId,points,place,note});return;}
  const rows=members.map(g=>({event_id:eventId,team_id:teamId,guest_id:g.id,points,place,note}));
  const{error}=await sb.from('scores').insert(rows);if(error)toast(error.message,'err');
}
async function saveSquad(eventId){
  const picks=window.__sqPicks||{};const win=window.__sqWin;
  const A=Object.keys(picks).filter(k=>picks[k]==='a'),B=Object.keys(picks).filter(k=>picks[k]==='b');
  if(!A.length||!B.length){toast('Pick players for both sides','err');return;}
  if(!win){toast('Tap who won','err');return;}
  const evName=eventName(eventId);const tag='[batch:'+Date.now()+'] ';
  const winners=win==='a'?A:B, losers=win==='a'?B:A;
  const rows=[
    ...winners.map(g=>({event_id:eventId,guest_id:g,points:10,place:1,note:tag+'Won '+evName})),
    ...losers.map(g=>({event_id:eventId,guest_id:g,points:5,note:tag+evName+' — played'}))
  ];
  const{error}=await sb.from('scores').insert(rows);
  if(error){toast(error.message,'err');return;}
  window.__sqPicks={};window.__sqWin='';window.__sqQ='';
  await loadAndRender();toast('Saved — '+winners.length+' winners (10) · '+losers.length+' players (5)');
}
async function saveTeamVs(eventId){
  const a=$('#tvA').value,b=$('#tvB').value;const win=window.__tvWin;
  if(!a||!b){toast('Pick both teams','err');return;}
  if(a===b){toast('Two different teams, please','err');return;}
  if(!win){toast('Tap who won','err');return;}
  const evName=eventName(eventId);const tag='[batch:'+Date.now()+'] ';
  const wTeam=win==='a'?a:b, lTeam=win==='a'?b:a;
  const rows=[
    ...state.guests.filter(g=>g.team_id===wTeam).map(g=>({event_id:eventId,team_id:wTeam,guest_id:g.id,points:10,place:1,note:tag+'Won '+evName})),
    ...state.guests.filter(g=>g.team_id===lTeam).map(g=>({event_id:eventId,team_id:lTeam,guest_id:g.id,points:5,note:tag+evName+' — played'}))
  ];
  const{error}=await sb.from('scores').insert(rows);
  if(error){toast(error.message,'err');return;}
  window.__tvWin='';
  await loadAndRender();toast(teamName(wTeam)+' wins! 10 each · '+teamName(lTeam)+' 5 each');
}
async function saveSkills(eventId){
  const sels=[...document.querySelectorAll('.skills-sel')];
  const placed={};let dup=false;
  sels.forEach(s=>{if(s.value){if(placed[s.value])dup=true;placed[s.value]=s.dataset.guest;}});
  if(dup){toast('Two people have the same place','err');return;}
  const entrants=state.signups.filter(s=>s.event_id===eventId).map(s=>s.player1_id);
  if(!entrants.length){toast('No entrants','err');return;}
  const evName=eventName(eventId);const tag='[batch:'+Date.now()+'] ';
  const placedIds=new Set(Object.values(placed));
  const rows=[];
  for(const[pl,gid]of Object.entries(placed))rows.push({event_id:eventId,guest_id:gid,place:+pl,points:placePoints(+pl),note:tag+ordinal(+pl)+' · '+evName});
  entrants.filter(g=>!placedIds.has(g)).forEach(g=>rows.push({event_id:eventId,guest_id:g,points:P().participation,note:tag+evName+' — entered'}));
  const{error}=await sb.from('scores').insert(rows);
  if(error){toast(error.message,'err');return;}
  await loadAndRender();toast('Placements saved — everyone entered got points');
}
async function saveTable(eventId){
  const sels=[...document.querySelectorAll('.place-sel')];
  const batchTag='[batch:'+Date.now()+'] ';
  let any=false;
  for(const s of sels){const v=s.value;if(!v)continue;any=true;
    const tid=s.dataset.team;
    if(v==='p')await awardTeamMembers(eventId,tid,null,placePoints(99),batchTag+'Participation');
    else{const pl=+v;await awardTeamMembers(eventId,tid,pl,placePoints(pl),batchTag+ordinal(pl)+' place');}}
  if(!any){toast('Set at least one place','err');return;}
  await loadAndRender();toast('Scores saved to all members');
}
async function saveBest(arg){
  const[eventId,mode]=arg.split('|');
  const rows=[...document.querySelectorAll('.best-row')].map(r=>({gid:r.querySelector('.best-g').value,v:parseFloat(r.querySelector('.best-v').value)})).filter(x=>x.gid&&!isNaN(x.v));
  if(!rows.length){toast('Enter at least one competitor','err');return;}
  rows.sort((a,b)=>mode==='timed'?a.v-b.v:b.v-a.v);
  const batchTag='[batch:'+Date.now()+'] ';
  for(let i=0;i<rows.length;i++){const pl=i+1;await ins('scores',{event_id:eventId,guest_id:rows[i].gid,place:pl,points:placePoints(pl),note:batchTag+(mode==='timed'?rows[i].v+'s':String(rows[i].v))});}
  await loadAndRender();toast('Ranked & awarded');
}
async function saveManual(eventId){
  const tgt=$('#manTarget').value;const p=+$('#manP').value;const r=$('#manR').value.trim();
  await awardTarget(eventId,tgt,p,r||'Manual');await loadAndRender();toast('Awarded');
}
async function saveBonus(){
  const tgt=$('#bonTarget').value;const p=+$('#bonP').value;const r=$('#bonR').value.trim();
  let ev=state.events.find(e=>e.name==='Bonus');
  if(!ev){await ins('events',{name:'Bonus',category:'Open',scoring_type:'manual',sort:99,status:'complete'});await loadAll();ev=state.events.find(e=>e.name==='Bonus');}
  await awardTarget(ev.id,tgt,p,r||'Bonus');await loadAndRender();toast('Applied');
}
async function awardTarget(eventId,tgt,points,note){
  if(!tgt){toast('Pick a target','err');return;}
  const[kind,id]=tgt.split(':');
  if(kind==='t')await awardTeamMembers(eventId,id,null,points,note);
  else await ins('scores',{event_id:eventId,guest_id:id,points,note});
}
async function deleteScore(arg){
  const parts=arg.split('|');
  const[id,kind,place,noteEnc]=parts;
  if(parts.length>1&&kind==='note'){ // grouped guest rows sharing a batch note
    const note=decodeURIComponent(noteEnc||'');
    const q=sb.from('scores').delete().eq('note',note);
    if(place)q.eq('place',+place);else q.is('place',null);
    const{error}=await q;if(error)toast(error.message,'err');
  } else if(parts.length>1){ // grouped team rows
    const note=decodeURIComponent(noteEnc||'');
    const q=sb.from('scores').delete().eq('team_id',kind);
    if(place)q.eq('place',+place);else q.is('place',null);
    if(note)q.eq('note',note);
    const{error}=await q;if(error)toast(error.message,'err');
  } else await del('scores',id);
  await loadAndRender();toast('Removed');
}
async function undoLast(eventId){
  const rows=state.scores.filter(s=>s.event_id===eventId);
  if(!rows.length){toast('Nothing to undo','err');return;}
  const last=rows[rows.length-1];
  const m=(last.note||'').match(/^\[batch:\d+\]/);
  if(m){const{error}=await sb.from('scores').delete().eq('event_id',eventId).like('note',m[0]+'%');if(error)toast(error.message,'err');}
  else await del('scores',last.id);
  await loadAndRender();toast('Undid last save');
}

/* ---------------- team flag upload ---------------- */
function handleFlagFile(file){
  if(!file)return;
  const img=new Image();
  img.onload=async()=>{
    const maxW=720;const scale=Math.min(1,maxW/img.width);
    const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    let dataUrl=c.toDataURL('image/jpeg',.8);
    if(dataUrl.length>1400000)dataUrl=c.toDataURL('image/jpeg',.55);
    const ok=await rpc('rpc_update_team',{p_team:window.__tmSel,p_name:null,p_color:null,p_song:null,p_flag:dataUrl});
    if(ok){await loadAndRender();toast('Flag uploaded! 🚩');}
  };
  img.onerror=()=>toast('Could not read that image','err');
  img.src=URL.createObjectURL(file);
}

/* ---------------- modals ---------------- */
function seedModal(eventId){window.__seedEvent=eventId;window.__seedOrder=shuffle(state.signups.filter(s=>s.event_id===eventId).map(s=>s.id));openModal('Manual seed — '+eventName(eventId),'<div id="seedBody"></div>',`<button class="btn ghost" data-shuffleseed>🎲 Shuffle</button><button class="btn sunsetb" data-dogenerate style="margin-left:auto">Generate bracket</button>`);seedModalBody();}
function seedModalBody(){const ids=window.__seedOrder||[];$('#seedBody').innerHTML=ids.length?ids.map((id,i)=>`<div class="row" style="padding:8px 10px"><div class="med" style="width:30px;height:30px;font-size:12px">${i+1}</div><div class="grow"><div class="name" style="font-size:14px">${esc(signupLabel(state.signups.find(s=>s.id===id)))}</div></div><button class="btn xs ghost" data-seedmove="${i}|-1">▲</button><button class="btn xs ghost" data-seedmove="${i}|1">▼</button></div>`).join(''):'<div class="empty">No entrants.</div>';}
function resultModal(matchId){const m=state.matches.find(x=>x.id===matchId);const a=state.signups.find(s=>s.id===m.a_signup_id),b=state.signups.find(s=>s.id===m.b_signup_id);
  openModal('Match result',`<div class="mut small" style="margin-bottom:10px">${esc(eventName(m.event_id))} · Round ${m.round}</div>
  <label class="f"><span>Winner</span><select class="i" id="resWinner"><option value="">— pick winner —</option><option value="${m.a_signup_id}" ${m.winner_signup_id===m.a_signup_id?'selected':''}>${esc(signupLabel(a))}</option><option value="${m.b_signup_id}" ${m.winner_signup_id===m.b_signup_id?'selected':''}>${esc(signupLabel(b))}</option></select></label>
  <div class="grid g2"><label class="f"><span>Score ${esc(signupLabel(a))}</span><input class="i" id="resA" type="number" value="${m.a_score??''}"></label><label class="f"><span>Score ${esc(signupLabel(b))}</span><input class="i" id="resB" type="number" value="${m.b_score??''}"></label></div>`,
  `<button class="btn ghost" data-close>Cancel</button><button class="btn sunsetb" data-submitresult="${matchId}" style="margin-left:auto">Save result</button>`);}
function winnerModal(awardId){const a=state.awards.find(x=>x.id===awardId);const noms=nominees(a);
  openModal('Winner — '+a.name,`<label class="f"><span>Winner (override)</span><select class="i" id="winSel"><option value="">— auto —</option>${noms.map(n=>`<option value="${n.id}" ${a.winner_id===n.id?'selected':''}>${esc(n.label)}</option>`).join('')}</select></label>`,
  `<button class="btn ghost" data-close>Cancel</button><button class="btn sunsetb" data-savewinner="${awardId}" style="margin-left:auto">Save</button>`);}
function addGuestModal(teamId){openModal('Add member — '+teamName(teamId),
  `<label class="f"><span>Name</span><input class="i" id="agN" placeholder="Full name"></label>
   <label class="f"><span>Type</span><select class="i" id="agK"><option value="adult">Adult</option><option value="kid">Kid</option></select></label>`,
  `<button class="btn ghost" data-close>Cancel</button><button class="btn sunsetb" data-saveguest="${teamId}" style="margin-left:auto">Add</button>`);}

/* ---------------- export ---------------- */
function exportCSV(kind){
  const csv=rows=>rows.map(r=>r.map(c=>`"${String(c==null?'':c).replace(/"/g,'""')}"`).join(',')).join('\n');
  let rows=[];
  if(kind==='scores')rows=[['Event','Who','Team','Place','Points','Note'],...state.scores.map(s=>[eventName(s.event_id),s.guest_id?guestName(s.guest_id):'',s.team_id?teamName(s.team_id):'',s.place||'',s.points,(s.note||'').replace(/^\[[^\]]+\]\s*/,'')])];
  else if(kind==='votes')rows=[['Award','Voter','Nominee','Comment'],...state.votes.map(v=>{const a=state.awards.find(x=>x.id===v.award_id);return[a?a.name:'',guestName(v.voter_id),a?nomineeLabel(a,v.nominee_id):'',v.comment||''];})];
  const blob=new Blob([csv(rows)],{type:'text/csv'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='ofsc_'+kind+'.csv';a.click();toast('Exported');
}

/* ---------------- clock + boot ---------------- */
function tickClock(){$('#clockT').textContent=nowTime();$('#clockD').textContent=new Date().toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});const tc=$('#tvclock');if(tc)tc.textContent=nowTime();}
async function boot(){
  const{data}=await sb.auth.getSession();session=data.session;
  sb.auth.onAuthStateChange((_e,s)=>{session=s;render();});
  const h=(location.hash||'').replace('#','');
  if(h==='vote')route='vote'; else if(h==='signup')route='signup'; else if(h==='standings')route='standings'; else if(h==='brackets')route='brackets';
  await loadAll();
  subscribeRealtime();
  render();tickClock();setInterval(tickClock,1000);
}
boot();
