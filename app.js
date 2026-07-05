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
const scLabel=t=>({placement:'Placement',head2head:'Head-to-Head',best:'Best Attempt',timed:'Timed Race',manual:'Manual'}[t]||t);

/* ---------------- DB writes (host via RLS; guests via RPC) ---------------- */
async function ins(t,row){const{error}=await sb.from(t).insert(row);if(error){toast(error.message,'err');return false;}return true;}
async function upd(t,id,patch){const{error}=await sb.from(t).update(patch).eq('id',id);if(error){toast(error.message,'err');return false;}return true;}
async function del(t,id){const{error}=await sb.from(t).delete().eq('id',id);if(error){toast(error.message,'err');return false;}return true;}
async function rpc(fn,args){const{error}=await sb.rpc(fn,args);if(error){toast(error.message.replace(/^.*?: /,''),'err');return false;}return true;}

/* ================= NAV ================= */
function nav(){
  const guestN=[['home','🏟️','Home'],['report','🏆','My Events'],['signup','✍️','Sign Up'],['sched','📅','Schedule'],['standings','🏅','Standings'],['brackets','🎾','Brackets'],['teams','🚩','My Team'],['vote','🗳️','Vote']];
  const disp=[['dstand','📺','Standings'],['dbrack','📺','Brackets'],['dresults','📺','Recent Results']];
  const host=isHost()
    ?[['score','🎯','Scoring Table'],['awards','🏆','Awards'],['admin','⚙️','Admin']]
    :[['admin','🔑','Host Login']];
  return {guestN,disp,host};
}
function renderNav(){
  const n=nav();
  const b=(x)=>`<button data-nav="${x[0]}" class="${route===x[0]?'active':''}"><span class="ic">${x[1]}</span>${x[2]}</button>`;
  $('#rail').innerHTML=
    `<div class="railgroup"><span class="st">★</span> Guest</div>`+n.guestN.map(b).join('')+
    `<div class="railgroup"><span class="st">★</span> Big Displays</div><div class="displays">`+n.disp.map(b).join('')+`</div>`+
    `<div class="railgroup"><span class="st">★</span> Host</div>`+n.host.map(b).join('');
  const tabs=(isHost()?['home','score','brackets','standings','teams']:['home','report','brackets','standings','vote'])
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
  const cur=evById(state.settings.current_event_id), nxt=evById(state.settings.next_event_id);
  const st=teamStandings();const max=st[0]?st[0].points:0;
  const me=getMe();
  return `${banner(me?('★ Welcome back, '+esc(guestName(me))+' ★'):'★ The Inaugural ★', state.settings.event_name||'OFSC Olympics', esc(state.settings.date_label||''))}
  <div class="grid g2" style="margin-bottom:14px">
    <div class="hero"><div class="disc sunset slats"></div>
      <div class="now-label">▶ Now Competing</div>
      <h2>${cur?esc(cur.name):'Intermission'}</h2>
      <div class="sub">${cur?esc(cur.location||'Backyard Arena'):'Glory is temporary. Bragging rights are forever.'}</div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center;position:relative;flex-wrap:wrap">
        ${cur?'<span class="sticker">● Live</span>':''}
        ${nxt?`<span class="tag">Up next · ${esc(nxt.name)}</span>`:''}
      </div>
    </div>
    <div class="card goldtrim"><div class="cardhdr"><span class="medallion"></span>${isHost()?'Host quick actions':'Your quick actions'}</div>
      <div class="grid" style="gap:11px">
      ${isHost()
        ?`<button class="btn sunsetb block big" data-nav="score">🎯 Scoring Table</button><button class="btn tealb block" data-nav="brackets">🎾 Brackets</button><button class="btn ghost block" data-nav="awards">🏆 Awards</button>`
        :`<button class="btn sunsetb block big" data-nav="report">🏆 Report a winner</button><button class="btn tealb block" data-nav="signup">✍️ Sign up</button><button class="btn ghost block" data-nav="vote">🗳️ Vote for awards</button>`}
      </div>
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
  const sel=window.__suEvent||(bes[0]&&bes[0].id);window.__suEvent=sel;
  const ev=evById(sel);const me=getMe();
  const mine=state.signups.filter(s=>s.event_id===sel);
  const locked=ev?state.matches.some(m=>m.event_id===ev.id):false;
  return `${banner('Grab a teammate','Event Sign Up','Only these five events need signups — everything else, just show up and play.')}
  <div class="btnrow" style="margin-bottom:14px">${bes.map(e=>`<button class="btn sm ${e.id===sel?'sunsetb':'ghost'}" data-suevent="${e.id}">${esc(e.name)}${e.bracket_size===1?' (solo)':''}</button>`).join('')}</div>
  ${ev?`<div class="card goldtrim">
    <div class="cardhdr"><span class="medallion"></span>${esc(ev.name)} — ${ev.bracket_size===1?'singles':'pairs'}</div>
    ${locked?`<div class="pill warn" style="margin-bottom:10px">Bracket already drawn — see the hosts to be added</div>`:''}
    <div class="mut small" style="margin-bottom:12px">${ev.bracket_size===1?'Sign up as yourself.':'Pick yourself and your teammate.'} ${mine.length} entrant${mine.length===1?'':'s'} so far.</div>
    <label class="f"><span>${ev.bracket_size===1?'You':'Player 1 (you)'}</span><select class="i" id="suP1"><option value="">— select your name —</option>${state.guests.map(g=>`<option value="${g.id}" ${me===g.id?'selected':''}>${esc(g.display_name)}</option>`).join('')}</select></label>
    ${ev.bracket_size===2?`<label class="f"><span>Player 2 (teammate)</span><select class="i" id="suP2"><option value="">— select —</option>${state.guests.map(g=>`<option value="${g.id}">${esc(g.display_name)}</option>`).join('')}</select></label>`:''}
    <button class="btn sunsetb block big" data-dosignup="${ev.id}" ${locked?'disabled':''}>Sign up</button>
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

/* ---------- VOTE ---------- */
VIEWS.vote=function(){
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
      <select class="i" data-sctype="${ev.id}">${['placement','head2head','best','timed','manual'].map(t=>`<option value="${t}" ${ev.scoring_type===t?'selected':''}>${scLabel(t)}</option>`).join('')}</select></label>
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
  rows.forEach(s=>{const key=(s.team_id||'')+'|'+(s.place||'')+'|'+(s.note||'');if(s.team_id&&s.guest_id){if(seen.has(key))return;seen.add(key);compact.push({...s,grouped:true});}else compact.push(s);});
  if(!compact.length)return '<div class="mut small">No results yet.</div>';
  return compact.slice(0,30).map(s=>`<div class="row" style="padding:8px 12px"><div class="swatch" style="background:${s.team_id?(team(s.team_id)?.color||'#889'):'#889'}"></div>
    <div class="grow"><div class="name" style="font-size:14px">${esc(s.grouped?teamName(s.team_id)+' (all members)':(s.guest_id?guestName(s.guest_id):teamName(s.team_id)))}</div>
    <div class="meta">${s.place?ordinal(s.place)+' · ':''}${s.note?esc(String(s.note).replace(/^\[[^\]]+\]\s*/,''))+' · ':''}${s.points>=0?'+':''}${s.points} pts each</div></div>
    <button class="btn xs danger" data-delscore="${s.id}${s.grouped?'|'+s.team_id+'|'+(s.place||'')+'|'+encodeURIComponent(s.note||''):''}" title="Remove">✕</button></div>`).join('');
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
  const el=e.target.closest('[data-nav],[data-more],[data-close],[data-act],[data-lb],[data-suevent],[data-dosignup],[data-delsignup],[data-bkevent],[data-genbracket],[data-seedbracket],[data-clearevsignups],[data-matchresult],[data-shuffleseed],[data-seedmove],[data-dogenerate],[data-submitresult],[data-reppick],[data-repsubmit],[data-savetable],[data-savebest],[data-addbest],[data-savemanual],[data-savebonus],[data-completeevent],[data-delscore],[data-undoscore],[data-votemode],[data-voteall],[data-awardopen],[data-awardwinner],[data-awardreset],[data-awardlock],[data-castvote],[data-savewinner],[data-clearme],[data-tmsave],[data-tmcolor],[data-tmflag],[data-msave],[data-addguest],[data-saveguest],[data-login],[data-logout],[data-export],[data-fsexit],[data-fsbk],[data-awardprev],[data-awardnext],[data-awardreveal]');
  if(!el)return;const d=el.dataset;

  if('nav'in d){go(d.nav);return;}
  if('more'in d){openMore();return;}
  if('close'in d){if(e.target.matches('[data-close]')||e.target.closest('.x'))closeModal();return;}
  if('lb'in d){window.__lb=d.lb;render();return;}
  if('suevent'in d){window.__suEvent=d.suevent;render();return;}
  if('bkevent'in d){window.__bkEvent=d.bkevent;render();return;}
  if('votemode'in d){window.__voteAdmin=d.votemode==='admin';render();return;}
  if('clearme'in d){clearMe();return;}
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
  const[id,teamId,place,noteEnc]=arg.split('|');
  if(teamId!==undefined){ // grouped: remove all matching rows from that save
    const note=decodeURIComponent(noteEnc||'');
    const q=sb.from('scores').delete().eq('team_id',teamId);
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
