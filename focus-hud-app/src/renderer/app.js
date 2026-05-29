/* ============================================================
   Focus HUD v4
   V3.1 弹性日历视图  V3.2 收尾仪式+日记  V3.3 完成情绪动画
   ============================================================ */

const OVERDUE_MS  = 3 * 60 * 1000;
const AI_COOLDOWN = 90 * 1000;
const CAL_HOURS   = [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];

/* ---------- 数据（带持久化） ---------- */
function defaultWorkspaces() {
  return {
    work: {
      tasks: [
        mkTask('写产品文档','plan',1),
        mkTask('回复 A 的邮件','plan',2),
        mkTask('查看 Slack 消息','daily',1),
        mkTask('写日报','daily',2),
      ],
      notifiedOverdueIds: new Set(),
      expandedSubtaskIds: new Set(),
      aiNavCooldownUntil: 0,
      aiNavMessage: null,
    },
    life: {
      tasks: [
        mkTask('买菜','plan',1),
        mkTask('健身 30min','daily',1),
      ],
      notifiedOverdueIds: new Set(),
      expandedSubtaskIds: new Set(),
      aiNavCooldownUntil: 0,
      aiNavMessage: null,
    },
  };
}
function defaultState() {
  return {
    activeWs: 'work',
    inputType: 'plan',
    expanded: false,  // 默认折叠，有活动任务时自动展开
    pendingSuspendId: null,
    pendingRestoreId: null,
    calOpen: false,
    calExpandedTaskId: null,
    journalOpen: false,
    ritualTriggered: false,
    ritualPostponed: false,
    todayMood: null,
  };
}
function reviveWorkspaces(raw) {
  if (!raw || typeof raw !== 'object') return defaultWorkspaces();
  const def = defaultWorkspaces();
  ['work','life'].forEach(k => {
    if (!raw[k]) { raw[k] = def[k]; return; }
    raw[k].tasks = Array.isArray(raw[k].tasks) ? raw[k].tasks : [];
    raw[k].tasks.forEach(t => {
      if (!t.subtasks) t.subtasks = [];
      if (typeof t.durationHours !== 'number') t.durationHours = 1;
    });
    raw[k].notifiedOverdueIds = new Set(raw[k].notifiedOverdueIds || []);
    raw[k].expandedSubtaskIds = new Set(raw[k].expandedSubtaskIds || []);
    raw[k].aiNavCooldownUntil = raw[k].aiNavCooldownUntil || 0;
    raw[k].aiNavMessage = raw[k].aiNavMessage || null;
  });
  return raw;
}
function snapshotWorkspaces() {
  // Sets 不可 JSON 序列化，转 Array
  const out = {};
  ['work','life'].forEach(k => {
    const w = workspaces[k];
    out[k] = {
      tasks: w.tasks,
      notifiedOverdueIds: Array.from(w.notifiedOverdueIds || []),
      expandedSubtaskIds: Array.from(w.expandedSubtaskIds || []),
      aiNavCooldownUntil: w.aiNavCooldownUntil || 0,
      aiNavMessage: w.aiNavMessage || null,
    };
  });
  return out;
}

let workspaces = (() => {
  try {
    const raw = localStorage.getItem('fhud_workspaces');
    if (raw) return reviveWorkspaces(JSON.parse(raw));
  } catch (e) { console.warn('[FocusHUD] workspaces load failed', e); }
  return defaultWorkspaces();
})();

let state = (() => {
  try {
    const raw = localStorage.getItem('fhud_state');
    if (raw) {
      const merged = Object.assign(defaultState(), JSON.parse(raw));
      // 重启后这些瞬态字段重置
      merged.calOpen = false;
      merged.journalOpen = false;
      merged.pendingSuspendId = null;
      merged.pendingRestoreId = null;
      // ritualTriggered 按日期判断
      if (merged._ritualDate !== new Date().toDateString()) {
        merged.ritualTriggered = false;
        merged.ritualPostponed = false;
        merged.todayMood = null;
        merged._ritualDate = new Date().toDateString();
      }
      return merged;
    }
  } catch (e) { console.warn('[FocusHUD] state load failed', e); }
  const s = defaultState();
  s._ritualDate = new Date().toDateString();
  return s;
})();

let _persistTimer = null;
function persistAll() {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try {
      const wsSnap = JSON.stringify(snapshotWorkspaces());
      const stSnap = JSON.stringify(state);
      // 1. 写 native localStorage（保证同 session 内读取一致）
      localStorage.setItem('fhud_workspaces', wsSnap);
      localStorage.setItem('fhud_state', stSnap);
      // 2. 直接通过 electronAPI 写 electron-store（跨 session 持久化）
      if (window.electronAPI && window.electronAPI.storage) {
        window.electronAPI.storage.set('fhud_workspaces', wsSnap);
        window.electronAPI.storage.set('fhud_state', stSnap);
      }
      // 3. 触发同步推送（如果已登录）
      if (window.electronAPI && window.electronAPI.sync) {
        window.electronAPI.sync.markDirty();
      }
    } catch (e) { console.warn('[FocusHUD] persist failed', e); }
  }, 200);
}

function ws()     { return workspaces[state.activeWs]; }
function tasks()  { return ws().tasks; }

/* ============================================================
   自动折叠：空闲 IDLE_COLLAPSE_SEC 秒无操作则折叠
   ============================================================ */
const IDLE_COLLAPSE_SEC = 8;
let _idleSeconds = 0;

function _resetIdleTimer() { _idleSeconds = 0; }
function _isIdleLongEnough() { return _idleSeconds >= IDLE_COLLAPSE_SEC; }

// 用户活动时重置空闲计数
document.addEventListener('click',  _resetIdleTimer, true);
document.addEventListener('keydown', _resetIdleTimer, true);
document.addEventListener('keyup',   _resetIdleTimer, true);
document.addEventListener('mousedown',_resetIdleTimer, true);

// 每 1 秒检查一次：如果空闲超时且没有正在做的任务，自动折叠
function _tickIdle() {
  if (!state.expanded) { _idleSeconds = 0; return; }        // 已折叠，不计时
  const active = getActive(), suspended = getSuspended();
  if (active || suspended) { _idleSeconds = 0; return; }    // 有任务，不计时
  _idleSeconds++;
  if (_isIdleLongEnough()) {
    state.expanded = false;
    render();
  }
}
setInterval(_tickIdle, 1000);

function mkTask(title, type, priority) {
  return { id: uid(), title, type, status: 'todo', priority, context: '',
    suspendedAt: null, doingStartAt: null, doneAt: null,
    subtasks: [], aiHint: null, aiHintDismissed: false,
    createdAt: Date.now(), calHour: null, durationHours: 1 };
}
function uid()    { return 't'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function subUid() { return 's'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
const $ = id => document.getElementById(id);

function fmtDuration(ms) {
  if (ms<0) ms=0;
  const s=Math.floor(ms/1000);
  if (s<60) return s+'s';
  const m=Math.floor(s/60),rs=s%60;
  if (m<60) return m+'m'+(rs?' '+rs+'s':'');
  const h=Math.floor(m/60),rm=m%60;
  return h+'h'+(rm?' '+rm+'m':'');
}
function fmtTime(ts) {
  if (!ts) return '';
  const d=new Date(ts);
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function esc(s) {
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function getActive()    { return ws().tasks.find(t=>t.status==='doing')||null; }
function getSuspended() { return ws().tasks.find(t=>t.status==='suspended')||null; }
function canComplete(t) { return !t.subtasks.length||t.subtasks.every(s=>s.done); }

/* ---------- 日记持久化 ---------- */
function loadJournals() { try{return JSON.parse(localStorage.getItem('fhud_journals')||'[]');}catch{return[];} }
function saveJournals(a){
  try{
    const v = JSON.stringify(a);
    localStorage.setItem('fhud_journals', v);
    if (window.electronAPI && window.electronAPI.storage) {
      window.electronAPI.storage.set('fhud_journals', v);
    }
  }catch(e){ console.warn('[FocusHUD] saveJournals failed', e); }
}

/* ---------- AI ---------- */
const VAGUE = [/^.{0,3}$/,/搞|弄/,/看一下|看看/,/处理一下|处理下/,/那个/,/^整/];
const REWRITES = [[/搞一下|搞/,'完成'],[/弄一下|弄/,'处理'],[/看一下|看看/,'查阅'],[/处理一下|处理下/,'完成'],[/^整理一下/,'整理']];
function isVague(t) { return VAGUE.some(p=>p.test(t.trim())); }
function mockRewrite(t) {
  let r=t.trim();
  for(const [p,rep] of REWRITES){ if(p.test(r)){r=r.replace(p,rep);break;} }
  return r!==t.trim()?r:null;
}

/* ============================================================
   渲染
   ============================================================ */
function render() {
  const hud=$('hud'),dot=$('status-dot'),txt=$('status-text'),qBtn=$('quick-action');
  document.querySelectorAll('.ws-tab').forEach(b=>b.classList.toggle('active',b.dataset.ws===state.activeWs));
  hud.classList.toggle('expanded',state.expanded);
  hud.classList.remove('suspended','overdue');
  dot.classList.remove('doing','suspended','overdue');

  const suspended=getSuspended(), active=getActive();
  // 自动展开/折叠逻辑
  if ((suspended || active) && !state.expanded) {
    state.expanded = true;
    _resetIdleTimer();
  }
  if(suspended){
    const el=Date.now()-suspended.suspendedAt, ov=el>OVERDUE_MS;
    if(ov){ hud.classList.add('overdue'); dot.classList.add('overdue');
      txt.innerHTML=`<span style="color:var(--color-danger);font-weight:600;">⏸ 超时</span>：${esc(suspended.title)} <span class="meta">${fmtDuration(el)}</span>`; }
    else { hud.classList.add('suspended'); dot.classList.add('suspended');
      txt.innerHTML=`<span style="color:var(--color-warn);font-weight:600;">⏸</span> ${esc(suspended.title)} <span class="meta">${fmtDuration(el)}</span>`; }
    qBtn.style.display='flex'; qBtn.textContent='▶ 切回';
    qBtn.onclick=e=>{e.stopPropagation();openRestoreModal(suspended.id);};
  } else if(active){
    dot.classList.add('doing');
    const el=Date.now()-(active.doingStartAt||Date.now());
    txt.innerHTML=`${esc(active.title)} <span class="meta">${fmtDuration(el)}</span>`;
    qBtn.style.display='flex'; qBtn.textContent='⏸ 切出';
    qBtn.onclick=e=>{e.stopPropagation();openSuspendModal(active.id);};
  } else {
    txt.textContent='没有进行中的任务'; qBtn.style.display='none';
  }
  renderTasks(); renderAiNav();
  if(state.calOpen) renderCalendar();
  // 每次渲染后异步落盘（debounce 200ms，避免频繁写）
  if (typeof persistAll === 'function') persistAll();
}

/* ============================================================
   任务列表渲染
   ============================================================ */
let dndState={draggingId:null,overEl:null};

function renderTasks() {
  const list=$('task-list'), all=ws().tasks;
  const g={
    doing:     all.filter(t=>t.status==='doing'),
    suspended: all.filter(t=>t.status==='suspended'),
    daily:     all.filter(t=>t.status==='todo'&&t.type==='daily').sort((a,b)=>a.priority-b.priority),
    plan:      all.filter(t=>t.status==='todo'&&t.type==='plan').sort((a,b)=>a.priority-b.priority),
    temp:      all.filter(t=>t.status==='todo'&&t.type==='temp').sort((a,b)=>a.priority-b.priority),
    done:      all.filter(t=>t.status==='done').sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)),
  };
  let html='';
  const hasTodo=g.daily.length+g.plan.length+g.temp.length+g.doing.length+g.suspended.length;
  if(!hasTodo&&!g.done.length){
    html='<div class="empty-state"><span class="emoji">📝</span>还没有任务，在下方录入第一件事。</div>';
  } else {
    if(g.doing.length)     html+=renderSection('▶ 进行中',g.doing);
    if(g.suspended.length) html+=renderSection('⏸ 挂起中',g.suspended);
    if(g.daily.length)     html+=renderDailySection(g.daily);
    if(g.plan.length)      html+=renderSection('📋 计划任务',g.plan);
    if(g.temp.length)      html+=renderSection('⚡ 临时事务',g.temp);
    if(g.done.length)      html+=renderSection('✓ 今日完成',g.done.slice(0,8));
  }
  list.innerHTML=html;

  list.querySelectorAll('[data-task-id]').forEach(el=>{
    if(el.tagName==='INPUT') return;
    el.addEventListener('click',e=>{
      e.stopPropagation();
      const id=el.dataset.taskId, act=el.dataset.action, sub=el.dataset.subId;
      if(!act) return;
      sub ? handleSubAction(id,act,sub) : handleTaskAction(id,act);
    });
  });

  const rb=list.querySelector('#reset-daily-btn');
  if(rb) rb.addEventListener('click',e=>{e.stopPropagation();resetDailyTasks();});

  /* 拖拽排序 */
  list.querySelectorAll('[data-task-id-row]').forEach(el=>{
    if(!el.hasAttribute('draggable')) return;
    el.addEventListener('dragstart',e=>{
      dndState.draggingId=el.dataset.taskIdRow; e.dataTransfer.effectAllowed='move';
      setTimeout(()=>el.classList.add('dragging'),0);
    });
    el.addEventListener('dragend',()=>{
      el.classList.remove('dragging');
      list.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(x=>x.classList.remove('drag-over-top','drag-over-bottom'));
      dndState.draggingId=null; dndState.overEl=null;
    });
    el.addEventListener('dragover',e=>{
      e.preventDefault();
      const from=ws().tasks.find(t=>t.id===dndState.draggingId);
      const over=ws().tasks.find(t=>t.id===el.dataset.taskIdRow);
      if(!from||!over||from.type!==over.type) return;
      if(dndState.overEl!==el){
        list.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(x=>x.classList.remove('drag-over-top','drag-over-bottom'));
        dndState.overEl=el;
      }
      const mid=el.getBoundingClientRect().top+el.getBoundingClientRect().height/2;
      el.classList.remove('drag-over-top','drag-over-bottom');
      el.classList.add(e.clientY<mid?'drag-over-top':'drag-over-bottom');
    });
    el.addEventListener('dragleave',e=>{ if(!el.contains(e.relatedTarget)) el.classList.remove('drag-over-top','drag-over-bottom'); });
    el.addEventListener('drop',e=>{
      e.preventDefault();
      const fromId=dndState.draggingId, toId=el.dataset.taskIdRow;
      if(!fromId||fromId===toId) return;
      const from=ws().tasks.find(t=>t.id===fromId), to=ws().tasks.find(t=>t.id===toId);
      if(!from||!to||from.type!==to.type) return;
      const after=e.clientY>=el.getBoundingClientRect().top+el.getBoundingClientRect().height/2;
      const grp=ws().tasks.filter(t=>t.status==='todo'&&t.type===from.type).sort((a,b)=>a.priority-b.priority);
      grp.splice(grp.findIndex(t=>t.id===fromId),1);
      const ti=grp.findIndex(t=>t.id===toId);
      grp.splice(after?ti+1:ti,0,from);
      grp.forEach((t,i)=>{t.priority=i+1;});
      el.classList.remove('drag-over-top','drag-over-bottom'); render();
    });
  });

  list.querySelectorAll('.subtask-input').forEach(inp=>{
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){
        e.stopPropagation();
        const val=inp.value.trim();
        if(val){addSubtask(inp.dataset.taskId,val);inp.value='';}
      }
    });
  });
}

function renderSection(title,list) {
  return `<div class="section">
    <div class="section-title">${esc(title)} <span style="color:var(--text-tertiary);font-weight:400;font-size:10px;">${list.length}</span></div>
    ${list.map(renderTaskRow).join('')}
  </div>`;
}
function renderDailySection(taskList) {
  const doneDaily=ws().tasks.filter(t=>t.type==='daily'&&t.status==='done');
  const combined=[...taskList,...doneDaily].sort((a,b)=>a.priority-b.priority);
  return `<div class="section">
    <div class="section-title">🔁 每日固定
      <span style="color:var(--text-tertiary);font-weight:400;font-size:10px;">${combined.filter(t=>t.status==='done').length}/${combined.length}</span>
      ${doneDaily.length>0?`<button class="section-action" id="reset-daily-btn">↺ 重置今日</button>`:''}
    </div>
    ${combined.map(renderTaskRow).join('')}
  </div>`;
}
function renderTaskRow(task) {
  const exp=ws().expandedSubtaskIds.has(task.id);
  const sdone=task.subtasks.filter(s=>s.done).length, stotal=task.subtasks.length;
  const ok=canComplete(task), hasSub=stotal>0, drag=task.status==='todo';
  let cbC=task.status==='done'?'✓':'';
  let cbX=(task.status!=='done'&&hasSub&&!ok)?`title="还有${stotal-sdone}个子任务未完成"`:'';
  let actions='';
  if(task.status==='todo'||task.status==='done'){
    actions=`<button class="task-action-btn primary" data-task-id="${task.id}" data-action="expand-sub">${exp?'▲':'▿'}</button>
      ${task.status==='todo'?`<button class="task-action-btn primary" data-task-id="${task.id}" data-action="start">▶</button>`:''}
      <button class="task-action-btn" style="color:var(--color-danger)" data-task-id="${task.id}" data-action="delete">✕</button>`;
  } else if(task.status==='doing'){
    actions=`<button class="task-action-btn primary" data-task-id="${task.id}" data-action="expand-sub">${exp?'▲':'▿'}</button>
      <button class="task-action-btn warn" data-task-id="${task.id}" data-action="suspend">⏸</button>
      <button class="task-action-btn" style="color:var(--color-danger)" data-task-id="${task.id}" data-action="delete">✕</button>`;
  } else if(task.status==='suspended'){
    actions=`<button class="task-action-btn primary" data-task-id="${task.id}" data-action="expand-sub">${exp?'▲':'▿'}</button>
      <button class="task-action-btn primary" data-task-id="${task.id}" data-action="restore">▶</button>
      <button class="task-action-btn" style="color:var(--color-danger)" data-task-id="${task.id}" data-action="delete">✕</button>`;
  }
  const ai=(!task.aiHintDismissed&&task.aiHint)?`<div class="task-ai-hint"><span>🤖</span><span class="ai-text">${esc(task.aiHint)}</span><button class="task-ai-dismiss" data-task-id="${task.id}" data-action="dismiss-ai">✕</button></div>`:'';
  const pr=(hasSub&&task.status!=='done')?`<div class="subtask-progress">${sdone}/${stotal} 步${ok?' · 可收尾':''}</div>`:'';
  const sz=exp?renderSubtaskZone(task):'';
  const cls=['task',task.status,(ok&&hasSub&&task.status!=='done')?'can-complete':'',(hasSub&&!ok&&task.status!=='done')?'has-subtasks':''].filter(Boolean).join(' ');
  return `<div class="${cls}" data-type="${task.type}" data-task-id-row="${task.id}" ${drag?'draggable="true"':''}>
    ${drag?'<span class="drag-handle">⠿</span>':'<span style="width:12px;flex-shrink:0;display:inline-block;"></span>'}
    <button class="task-checkbox" data-task-id="${task.id}" data-action="toggle-done" ${cbX}>${cbC}</button>
    <div class="task-content"><div class="task-title">${esc(task.title)}</div>${ai}${pr}</div>
    <div class="task-actions">${actions}</div>
  </div>${sz}`;
}
function renderSubtaskZone(task) {
  const items=task.subtasks.map(s=>`<div class="subtask-item">
    <button class="subtask-cb ${s.done?'done':''}" data-task-id="${task.id}" data-action="toggle-sub" data-sub-id="${s.id}">${s.done?'✓':''}</button>
    <span class="subtask-title ${s.done?'done':''}">${esc(s.title)}</span>
    <button class="subtask-del" data-task-id="${task.id}" data-action="del-sub" data-sub-id="${s.id}">✕</button>
  </div>`).join('');
  return `<div class="subtask-zone">${items}
    <div class="subtask-input-row">
      <input class="subtask-input" data-task-id="${task.id}" placeholder="+ 添加子任务，回车确认" onclick="event.stopPropagation()" />
    </div></div>`;
}

/* ============================================================
   任务操作
   ============================================================ */
function handleTaskAction(taskId,action) {
  const task=ws().tasks.find(t=>t.id===taskId); if(!task) return;
  switch(action){
    case 'start':{
      const cur=getActive();
      if(cur&&cur.id!==taskId){cur.status='todo';cur.doingStartAt=null;}
      task.status='doing'; task.doingStartAt=Date.now(); break;
    }
    case 'suspend': openSuspendModal(taskId); return;
    case 'restore': openRestoreModal(taskId); return;
    case 'toggle-done':
      if(task.status==='done'){ task.status='todo'; task.doneAt=null; }
      else {
        if(!canComplete(task)){
          showToast({title:'还有子任务未完成',text:`完成全部${task.subtasks.filter(s=>!s.done).length}个子任务后才能收尾。`,kind:'warn'}); return;
        }
        task.status='done'; task.doneAt=Date.now(); task.doingStartAt=null; task.suspendedAt=null;
        triggerCompleteGlow(taskId);
        checkCompleteAndRemind(task);
        setTimeout(checkAllDoneAndTriggerRitual,300);
      }
      break;
    case 'delete':
      ws().tasks.splice(ws().tasks.findIndex(t=>t.id===taskId),1);
      ws().expandedSubtaskIds.delete(taskId); break;
    case 'expand-sub':
      ws().expandedSubtaskIds.has(taskId)?ws().expandedSubtaskIds.delete(taskId):ws().expandedSubtaskIds.add(taskId); break;
    case 'dismiss-ai': task.aiHintDismissed=true; break;
  }
  render();
}
function handleSubAction(taskId,action,subId) {
  const task=ws().tasks.find(t=>t.id===taskId); if(!task) return;
  if(action==='toggle-sub'){ const s=task.subtasks.find(s=>s.id===subId); if(s) s.done=!s.done; }
  else if(action==='del-sub'){ task.subtasks=task.subtasks.filter(s=>s.id!==subId); }
  render();
}
function addSubtask(taskId,title) {
  const task=ws().tasks.find(t=>t.id===taskId); if(!task) return;
  task.subtasks.push({id:subUid(),title,done:false}); render();
}
function resetDailyTasks() {
  const dd=ws().tasks.filter(t=>t.type==='daily'&&t.status==='done');
  dd.forEach(t=>{t.status='todo';t.doneAt=null;t.subtasks.forEach(s=>{s.done=false;});});
  showToast({title:'每日固定任务已重置',text:`${dd.length}个任务重新待办`,kind:'info'}); render();
}
function checkCompleteAndRemind(doneTask) {
  const s=getSuspended(); if(!s) return;
  const el=fmtDuration(Date.now()-s.suspendedAt);
  setTimeout(()=>{
    showToast({title:`「${doneTask.title}」已完成`,text:`「${s.title}」挂起了${el}，可以切回了。`,kind:'success',
      actions:[{label:'稍后',onClick:()=>{}},{label:'现在切回',onClick:()=>openRestoreModal(s.id),primary:true}],duration:0});
    showAINav(`临时事务完成！「${s.title}」还挂起着，回去继续吧。`);
  },200);
}

/* V3.3 完成光晕 */
function triggerCompleteGlow(taskId) {
  setTimeout(()=>{
    const el=document.querySelector(`[data-task-id-row="${taskId}"]`); if(!el) return;
    el.classList.add('completing'); setTimeout(()=>el.classList.remove('completing'),600);
  },40);
}

/* ============================================================
   V3.1 弹性日历
   ============================================================ */
function toggleCalendar() {
  state.calOpen=!state.calOpen;
  $('cal-panel').classList.toggle('open',state.calOpen);
  $('cal-toggle-btn').classList.toggle('active',state.calOpen);
  if(state.calOpen) renderCalendar();
}

function renderCalendar() {
  /* 合并两个 ws 的任务，注入 _wsId 标记 */
  const allTasks = [
    ...workspaces.work.tasks.map(t=>({...t, _wsId:'work'})),
    ...workspaces.life.tasks.map(t=>({...t, _wsId:'life'})),
  ];

  /* 自动分配 calHour + 默认 durationHours */
  let nextHour=9;
  allTasks.filter(t=>t.status!=='done' && t.calHour==null).forEach(t=>{
    /* 写回原 task 对象 */
    const orig=workspaces[t._wsId].tasks.find(x=>x.id===t.id);
    if(orig){ orig.calHour=Math.min(nextHour,21); t.calHour=orig.calHour; }
    nextHour++;
  });
  allTasks.forEach(t=>{
    if(t.durationHours==null){
      const orig=workspaces[t._wsId].tasks.find(x=>x.id===t.id);
      if(orig){ orig.durationHours=1; t.durationHours=1; }
    }
  });

  const now=new Date();
  const days=['日','一','二','三','四','五','六'];
  $('cal-date-label').textContent=`${now.getMonth()+1}月${now.getDate()}日 周${days[now.getDay()]}`;

  const curH=now.getHours()+now.getMinutes()/60;
  const timeline=$('cal-timeline'); timeline.innerHTML=''; timeline.style.position='relative';
  const ROW_H=52;

  CAL_HOURS.forEach((h,idx)=>{
    const row=document.createElement('div');
    row.className='cal-hour-row';

    if(h===Math.floor(curH)&&h>=8&&h<=22){
      const pct=(curH-h)*100;
      const line=document.createElement('div');
      line.className='cal-now-line';
      line.style.top=(idx*ROW_H+pct*ROW_H/100+4)+'px';
      line.style.position='absolute';
      timeline.appendChild(line);
    }

    const label=document.createElement('div');
    label.className='cal-hour-label';
    label.textContent=h+':00';

    const slot=document.createElement('div');
    slot.className='cal-hour-slot';
    slot.dataset.hour=h;

    /* 放置该小时所有未完成任务（两个 ws 合并） */
    const tasksInSlot=allTasks.filter(t=>t.calHour===h&&t.status!=='done');
    tasksInSlot.forEach(t=>{ slot.appendChild(calBlockHtml(t)); });

    /* 拖拽接收 */
    slot.addEventListener('dragover',e=>{e.preventDefault();slot.classList.add('cal-drag-over');});
    slot.addEventListener('dragleave',()=>slot.classList.remove('cal-drag-over'));
    slot.addEventListener('drop',e=>{
      e.preventDefault(); slot.classList.remove('cal-drag-over');
      const id=e.dataTransfer.getData('cal-task-id'); if(!id) return;
      /* 从两个 ws 中查找并更新 */
      let found=workspaces.work.tasks.find(t=>t.id===id);
      if(!found) found=workspaces.life.tasks.find(t=>t.id===id);
      if(found){ found.calHour=h; renderCalendar(); }
    });

    row.appendChild(label); row.appendChild(slot);
    timeline.appendChild(row);
  });

  /* 统计：显示当前 ws 的进度 */
  const wsAll=ws().tasks;
  const done=wsAll.filter(t=>t.status==='done').length;
  const total=wsAll.filter(t=>t.type!=='daily').length;
  $('cal-stat').innerHTML=`完成 <strong>${done}</strong> / ${total}`;
}

function calBlockHtml(task) {
  const el=document.createElement('div');
  const wsId=task._wsId||'work';
  el.className='cal-task-block '+task.type+' ws-'+wsId+(task.status==='doing'?' doing':task.status==='suspended'?' suspended':'');
  el.dataset.taskId=task.id;
  el.dataset.wsId=wsId;

  /* 高度根据 durationHours */
  const ROW_H=52, dur=task.durationHours||1;
  el.style.minHeight=(dur*ROW_H-8)+'px';

  /* 拖拽 token（带 wsId） */
  el.draggable=true;
  el.addEventListener('dragstart',e=>{
    if(state.calExpandedTaskId===task.id) { e.preventDefault(); return; }
    e.dataTransfer.setData('cal-task-id',task.id);
    e.dataTransfer.effectAllowed='move';
  });

  /* 子任务统计 */
  const sdone=task.subtasks.filter(s=>s.done).length;
  const stot=task.subtasks.length;
  const pct=stot?Math.round(sdone/stot*100):0;

  /* head */
  const head=document.createElement('div');
  head.className='cal-block-head';
  const wsBadge=wsId==='life'?'🏠 生活':'💼 工作';
  head.innerHTML=`
    <span class="cb-dot"></span>
    <span class="task-label">${esc(task.title)}</span>
    ${stot?`<span class="cal-mini-progress">${sdone}/${stot}<span class="cal-mini-bar"><span class="cal-mini-bar-fill" style="width:${pct}%;"></span></span></span>`:''}
    <span class="cal-ws-badge">${wsBadge}</span>
  `;
  el.appendChild(head);

  /* head 点击 = 展开/折叠（不再=完成） */
  head.addEventListener('click',e=>{
    e.stopPropagation();
    toggleCalBlockExpand(task.id);
  });

  /* 展开状态：渲染面板 */
  if(state.calExpandedTaskId===task.id){
    el.classList.add('expanded');
    el.appendChild(renderCalBlockPanel(task));
  }

  /* resize handle */
  const rh=document.createElement('div');
  rh.className='cal-block-resize';
  rh.addEventListener('mousedown',e=>startResize(e,task,el));
  el.appendChild(rh);

  return el;
}

/* 展开/折叠子任务面板 */
function toggleCalBlockExpand(taskId) {
  state.calExpandedTaskId = state.calExpandedTaskId===taskId ? null : taskId;
  renderCalendar();
}

/* 渲染 inline 子任务面板 */
function renderCalBlockPanel(task) {
  const panel=document.createElement('div');
  panel.className='cal-block-panel';

  /* 子任务列表 */
  task.subtasks.forEach(s=>{
    const item=document.createElement('div');
    item.className='cal-sub-item';
    item.innerHTML=`
      <button class="cal-sub-cb ${s.done?'done':''}">${s.done?'✓':''}</button>
      <span class="cal-sub-title ${s.done?'done':''}">${esc(s.title)}</span>
      <button class="cal-sub-del" title="删除">✕</button>
    `;
    item.querySelector('.cal-sub-cb').addEventListener('click',e=>{
      e.stopPropagation(); s.done=!s.done;
      renderCalendar(); render();
    });
    item.querySelector('.cal-sub-del').addEventListener('click',e=>{
      e.stopPropagation();
      /* 找原始 task 修改，因为 calBlockHtml 的 task 是浅拷贝 */
      const wsId=task._wsId||'work';
      const orig=workspaces[wsId].tasks.find(x=>x.id===task.id);
      if(orig) orig.subtasks=orig.subtasks.filter(x=>x.id!==s.id);
      renderCalendar(); render();
    });
    panel.appendChild(item);
  });

  /* 新增子任务输入 */
  const input=document.createElement('input');
  input.className='cal-sub-input';
  input.placeholder='+ 添加子任务，回车确认';
  input.addEventListener('click',e=>e.stopPropagation());
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      const v=input.value.trim();
      if(v){
        const wsId=task._wsId||'work';
        const orig=workspaces[wsId].tasks.find(x=>x.id===task.id);
        if(orig) orig.subtasks.push({id:subUid(),title:v,done:false});
        input.value=''; renderCalendar(); render();
      }
    }
  });
  panel.appendChild(input);

  return panel;
}

/* Resize 拖拽：0.5h 吸附 */
function startResize(e,task,el) {
  e.preventDefault(); e.stopPropagation();
  const ROW_H=52;
  const startY=e.clientY;
  const startDur=task.durationHours||1;
  el.classList.add('resizing');

  function onMove(ev){
    const dy=ev.clientY-startY;
    let newDur=startDur + dy/ROW_H;
    /* 0.5 吸附 */
    newDur=Math.round(newDur*2)/2;
    newDur=Math.max(0.5,Math.min(6,newDur));
    if(newDur!==task.durationHours){
      task.durationHours=newDur;
      el.style.minHeight=(newDur*ROW_H-8)+'px';
    }
  }
  function onUp(){
    el.classList.remove('resizing');
    window.removeEventListener('mousemove',onMove);
    window.removeEventListener('mouseup',onUp);
    renderCalendar();
  }
  window.addEventListener('mousemove',onMove);
  window.addEventListener('mouseup',onUp);
}

/* ============================================================
   V3.2 收尾仪式
   ============================================================ */
function checkAllDoneAndTriggerRitual() {
  if(state.ritualTriggered) return;
  const all=ws().tasks.filter(t=>t.type!=='daily');
  if(!all.length) return;
  const allDone=all.every(t=>t.status==='done');
  if(allDone) triggerRitual('all-done');
}
function checkRitualTime() {
  if(state.ritualTriggered) return;
  const h=new Date().getHours();
  if(h>=22) triggerRitual('time');
}

function triggerRitual(reason) {
  state.ritualTriggered=true;
  renderJournalModal(reason);
  $('modal-ritual').style.display='flex';
}

/* 反思引导问题池（每天根据日期+情况选） */
const REFLECT_QUESTIONS = {
  great:   ['今天什么事让你最有成就感？','哪一刻你觉得"对了"？','今天最想保留下来的是什么？'],
  good:    ['今天哪件事进展超出预期？','有什么值得明天继续的？','今天学到了什么？'],
  okay:    ['今天哪里卡住了？卡在哪一步？','如果重新过一次今天，你会改变什么？','此刻你最需要什么？'],
  rough:   ['今天有什么是不在你掌控之内的？','哪怕只有一件小事进展了，是什么？','现在最想对自己说什么？'],
  empty:   ['今天虽然没安排，你的注意力去哪了？','此刻你的状态怎么样？','明天想从哪件小事开始？'],
};
function pickReflectQuestion(doneCount,undoneCount){
  let bucket;
  if(doneCount===0 && undoneCount===0) bucket='empty';
  else if(doneCount===0) bucket='rough';
  else if(undoneCount===0) bucket='great';
  else if(doneCount>=undoneCount) bucket='good';
  else bucket='okay';
  const pool=REFLECT_QUESTIONS[bucket];
  /* 用日期 hash 让同一天稳定 */
  const seed=new Date().getDate()+new Date().getMonth();
  return pool[seed%pool.length];
}

/* 情境化文案（人文关怀） */
function pickPepText(doneCount,undoneCount,prevDoneCount){
  if(doneCount===0 && undoneCount===0) return '休息也是一种节奏，今天本身已经被记下了。';
  if(doneCount===0) return '今天没能完成任务，但你愿意停下来回顾，这本身就是力量。';
  if(undoneCount===0) return `今天非常完整 ✨ 完成了全部 ${doneCount} 件事。`;
  if(prevDoneCount!=null && doneCount>prevDoneCount) return `完成 ${doneCount} 件事，比昨天多 ${doneCount-prevDoneCount} 件。`;
  if(doneCount>=undoneCount) return `完成 ${doneCount} 件事，过半了，继续保持。`;
  return `做了 ${doneCount} 件事，也是前进。`;
}

/* 计算连续天数 */
function calcStreak(journals){
  if(!journals.length) return 0;
  const sorted=[...journals].sort((a,b)=>b.savedAt-a.savedAt);
  const today=new Date(); today.setHours(0,0,0,0);
  let streak=0; let cursor=new Date(today);
  for(const j of sorted){
    const jd=new Date(j.savedAt); jd.setHours(0,0,0,0);
    if(jd.getTime()===cursor.getTime()){
      streak++;
      cursor.setDate(cursor.getDate()-1);
    } else if(jd.getTime()<cursor.getTime()){
      break;
    }
  }
  return streak;
}

/* 渲染日记 modal 内容（核心） */
function renderJournalModal(reason){
  const now=new Date();
  const days=['日','一','二','三','四','五','六'];
  const done=ws().tasks.filter(t=>t.status==='done');
  const undone=ws().tasks.filter(t=>t.status==='todo'||t.status==='suspended');
  const tempN=ws().tasks.filter(t=>t.type==='temp').length;
  const suspendN=ws().tasks.filter(t=>t.status==='suspended').length;

  /* 累计专注时长（粗略：已完成的非daily任务 × duration） */
  const focusMin=done.filter(t=>t.type!=='daily').reduce((s,t)=>s+(t.durationHours||1)*60,0);

  /* 顶部 */
  $('jm-date-big').textContent=`${now.getMonth()+1}月${now.getDate()}日`;
  $('jm-date-sub').textContent=`周${days[now.getDay()]} · ${state.activeWs==='work'?'💼 工作区':'🏠 生活区'} · ${reason==='all-done'?'今日完成🎉':'晚间收尾'}`;

  /* streak */
  const journals=loadJournals();
  const streak=calcStreak(journals);
  if(streak>0){
    $('jm-streak').style.display='inline-flex';
    $('jm-streak-num').textContent=streak;
  } else { $('jm-streak').style.display='none'; }

  /* 心情 reset */
  state.todayMood=null;
  document.querySelectorAll('.jm-mood-btn').forEach(b=>b.classList.remove('selected'));

  /* 环形进度 */
  const planUndone=undone.filter(t=>t.type!=='daily').length;
  const planDone=done.filter(t=>t.type!=='daily').length;
  const total=planDone+planUndone;
  const pct=total?Math.round(planDone/total*100):0;
  const C=2*Math.PI*32; // 201.06
  $('jm-ring-fg').setAttribute('stroke-dasharray',C.toFixed(2));
  $('jm-ring-fg').setAttribute('stroke-dashoffset',(C*(1-pct/100)).toFixed(2));
  $('jm-ring-num').textContent=`${planDone}/${total}`;
  $('jm-stat-pct').textContent=total?pct+'%':'—';
  $('jm-stat-focus').textContent=focusMin?(focusMin>=60?`${Math.floor(focusMin/60)}h${focusMin%60?(' '+(focusMin%60)+'m'):''}`:focusMin+'m'):'—';
  $('jm-stat-temp').textContent=tempN?tempN+' 次':'0';
  $('jm-stat-suspend').textContent=suspendN?suspendN+' 次':'0';

  /* 情境化文案 */
  const prevEntry=journals.find(j=>j.ws===state.activeWs);
  $('jm-pep-text').textContent=pickPepText(planDone,planUndone,prevEntry?prevEntry.doneCount:null);

  /* 时间轴 */
  const tl=$('jm-timeline');
  const doneSorted=[...done].sort((a,b)=>(a.doneAt||0)-(b.doneAt||0));
  $('jm-tl-count').textContent=`完成 ${doneSorted.length} 件`;
  if(doneSorted.length){
    tl.innerHTML=doneSorted.map(t=>`<div class="jm-tl-item">
      <span class="jm-tl-time">${fmtTime(t.doneAt)}</span>
      <span class="jm-tl-title">${esc(t.title)}</span>
    </div>`).join('');
  } else {
    tl.innerHTML='<div class="jm-tl-empty">今天还没有完成任务，没关系。</div>';
  }

  /* 未完成 chips */
  if(undone.length){
    $('jm-undone-section').style.display='';
    $('jm-undone-count').textContent=`${undone.length} 件`;
    $('jm-undone-list').innerHTML=undone.map(t=>`<span class="jm-undone-chip">${esc(t.title)}</span>`).join('');
    $('jm-postpone-btn').textContent='↦ 全部延后';
    $('jm-postpone-btn').classList.remove('done-state');
    state.ritualPostponed=false;
  } else { $('jm-undone-section').style.display='none'; }

  /* 反思引导 */
  $('jm-reflect-question').textContent=pickReflectQuestion(planDone,planUndone);
  $('jm-user-note').value='';
}

function ritualPostponeAll() {
  if(state.ritualPostponed) return;
  const undone=ws().tasks.filter(t=>t.status==='todo'||t.status==='suspended');
  undone.forEach(t=>{t.status='todo';t.suspendedAt=null;t.doingStartAt=null;});
  $('jm-postpone-btn').textContent='✓ 已延后';
  $('jm-postpone-btn').classList.add('done-state');
  state.ritualPostponed=true;
  showToast({title:'已延后',text:`${undone.length}个任务移至明日待办`,kind:'info',duration:2500});
}

/* 必存：无论是否填写都归档 */
function saveRitualJournal(skipMode) {
  try {
  const now=new Date();
  const done=ws().tasks.filter(t=>t.status==='done');
  const undone=ws().tasks.filter(t=>t.status==='todo'||t.status==='suspended');
  const noteEl=$('jm-user-note');
  const note=noteEl?noteEl.value.trim():'';
  const reflectEl=$('jm-reflect-question');
  const focusMin=done.filter(t=>t.type!=='daily').reduce((s,t)=>s+(t.durationHours||1)*60,0);
  const dateStr=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  /* 同一天同一 ws 已有 → 更新；否则新增 */
  let journals=loadJournals();
  const existIdx=journals.findIndex(j=>j.date===dateStr && j.ws===state.activeWs);
  const entry={
    id: existIdx>=0 ? journals[existIdx].id : 'j'+Date.now().toString(36),
    date: dateStr,
    dateLabel:`${now.getMonth()+1}月${now.getDate()}日`,
    ws: state.activeWs,
    doneCount: done.length,
    undoneCount: undone.length,
    doneTitles: done.map(t=>t.title),
    doneTimeline: done.map(t=>({title:t.title,time:fmtTime(t.doneAt)})),
    undoneTitles: undone.map(t=>t.title),
    mood: state.todayMood||null,
    reflectQuestion: reflectEl?reflectEl.textContent:'',
    userNote: note,
    focusMin,
    savedAt: Date.now(),
  };
  if(existIdx>=0){ journals[existIdx]=entry; } else { journals.unshift(entry); }
  saveJournals(journals.slice(0,90));
  console.log('[FocusHUD] Journal saved:', entry.id, entry.date, 'doneCount='+entry.doneCount);

  $('modal-ritual').style.display='none';
  if(!skipMode){
    showToast({title:'今日已归档',text:note?'日记和反思都保存了 📔':'今日数据已保存 📔',kind:'success',duration:2800});
  } else {
    showToast({title:'今日数据已自动归档',text:'随时可在左下角📖查看',kind:'info',duration:2400});
  }
  if(state.journalOpen) renderJournalList();
  } catch(err) {
    console.error('[FocusHUD] saveRitualJournal error:', err);
    $('modal-ritual').style.display='none';
    showToast({title:'归档出错',text:String(err),kind:'warn',duration:4000});
  }
}

/* ============================================================
   日记面板（列表 + 详情）
   ============================================================ */
function toggleJournalPanel() {
  state.journalOpen=!state.journalOpen;
  console.log('[FocusHUD] toggleJournalPanel → journalOpen='+state.journalOpen);
  $('journal-panel').classList.toggle('open',state.journalOpen);
  if(state.journalOpen) renderJournalList();
}

/* 面板内所有点击不冒泡到外部 */
function initJournalPanelClickGuard() {
  $('journal-panel').addEventListener('click', e => {
    e.stopPropagation();
  });
}
function renderJournalList() {
  const j=loadJournals(), el=$('journal-entry-list');
  console.log('[FocusHUD] renderJournalList count='+j.length);
  if(!j.length){
    el.innerHTML='<div class="journal-empty">还没有日记，完成收尾仪式后会自动归档。</div>'; return;
  }
  const MOOD_EMOJI={5:'🤩',4:'😊',3:'😐',2:'😕',1:'😩'};
  el.innerHTML=j.map(e=>`<div class="journal-entry-item" data-jid="${e.id}">
    <div class="journal-entry-date">
      ${esc(e.dateLabel)}
      <span style="font-size:10px;color:var(--text-tertiary);">${e.ws==='work'?'💼':'🏠'}</span>
      ${e.mood?`<span style="font-size:14px;margin-left:4px;">${MOOD_EMOJI[e.mood]||''}</span>`:''}
    </div>
    <div class="journal-entry-meta">完成${e.doneCount}件 · 未完成${e.undoneCount}件${e.focusMin?` · 专注${e.focusMin>=60?Math.floor(e.focusMin/60)+'h'+(e.focusMin%60?(e.focusMin%60)+'m':''):e.focusMin+'m'}`:''}</div>
    ${e.userNote?`<div class="journal-entry-preview">${esc(e.userNote)}</div>`:''}
  </div>`).join('');
  /* click 由容器委托处理，此处不再逐项绑定 */
}
function openJournalDetail(jid) {
  const journals=loadJournals();
  const j=journals.find(e=>e.id===jid);
  console.log('[FocusHUD] openJournalDetail jid='+jid+' found='+(j?'YES':'NO')+' total='+journals.length);
  if(!j){ showToast({title:'找不到这条日记',text:'id: '+jid,kind:'warn',duration:3000}); return; }
  const MOOD={5:['🤩','超棒'],4:['😊','不错'],3:['😐','一般'],2:['😕','有点累'],1:['😩','很糟']};
  $('jd-title').textContent=j.dateLabel;
  $('jd-sub').textContent=`完成${j.doneCount}件 · 未完成${j.undoneCount}件 · ${j.ws==='work'?'💼 工作区':'🏠 生活区'}`;
  /* mood bar */
  const mb=$('jd-mood-bar');
  if(j.mood && MOOD[j.mood]){
    mb.style.display='flex';
    $('jd-mood-emoji').textContent=MOOD[j.mood][0];
    $('jd-mood-text').textContent=`今日心情：${MOOD[j.mood][1]}`;
  } else { mb.style.display='none'; }
  /* 时间轴 */
  if(j.doneTimeline && j.doneTimeline.length){
    $('jd-done').textContent=j.doneTimeline.map(x=>`${x.time}  ${x.title}`).join('\n');
  } else if(j.doneTitles && j.doneTitles.length){
    $('jd-done').textContent=j.doneTitles.map((t,i)=>`${i+1}. ${t}`).join('\n');
  } else {
    $('jd-done').textContent='（无）';
  }
  /* undone */
  const ud=$('jd-undone-section');
  if(j.undoneCount>0){
    ud.style.display='';
    $('jd-undone').textContent=j.undoneTitles.map((t,i)=>`${i+1}. ${t}`).join('\n');
  } else { ud.style.display='none'; }
  /* note */
  const ns=$('jd-note-section');
  if(j.userNote){
    ns.style.display='';
    const q=j.reflectQuestion?`Q: ${j.reflectQuestion}\nA: `:'';
    $('jd-note').textContent=q+j.userNote;
  } else { ns.style.display='none'; }
  $('modal-journal-detail').style.display='flex';
}

/* ============================================================
   AI 偏离检测
   ============================================================ */
function scheduleAISuggest(taskId) {
  const task=ws().tasks.find(t=>t.id===taskId); if(!task||!isVague(task.title)) return;
  setTimeout(()=>{
    const t=ws().tasks.find(t=>t.id===taskId); if(!t||t.status==='done') return;
    const s=mockRewrite(t.title); if(s){t.aiHint=s;t.aiHintDismissed=false;render();}
  },1500);
}
function checkAIDeviation() {
  const w=ws();
  if(Date.now()<w.aiNavCooldownUntil) return;
  const active=w.tasks.filter(t=>t.status!=='done');
  const tempN=active.filter(t=>t.type==='temp').length;
  const planN=active.filter(t=>t.type==='plan').length;
  const total=tempN+planN;
  if(total>=3&&tempN>=planN&&tempN>=2){
    showAINav(`临时事务已占今日${Math.round(tempN/total*100)}%，注意回到计划任务。`);
    w.aiNavCooldownUntil=Date.now()+AI_COOLDOWN; return;
  }
  const s=getSuspended();
  if(s){
    const el=Date.now()-s.suspendedAt;
    if(el>OVERDUE_MS&&!w.notifiedOverdueIds.has(s.id)){
      w.notifiedOverdueIds.add(s.id);
      showAINav(`「${s.title}」已挂起${fmtDuration(el)}，临时事务处理完了吗？`);
      showToast({title:'挂起任务提醒',text:`「${s.title}」已挂起${fmtDuration(el)}`,kind:'warn',
        actions:[{label:'继续处理',onClick:()=>{w.notifiedOverdueIds.delete(s.id);s.suspendedAt=Date.now();}},
          {label:'切回',onClick:()=>openRestoreModal(s.id),primary:true}],duration:0});
      w.aiNavCooldownUntil=Date.now()+AI_COOLDOWN;
    }
  }
}
function showAINav(text) {
  ws().aiNavMessage=text; renderAiNav();
  setTimeout(()=>{if(ws().aiNavMessage===text){ws().aiNavMessage=null;renderAiNav();}},6000);
}
function renderAiNav() {
  const bar=$('ai-nav-msg'), msg=ws().aiNavMessage;
  if(msg){bar.style.display='flex';$('ai-nav-text').textContent=msg;}
  else bar.style.display='none';
}

/* ============================================================
   模态
   ============================================================ */
function openSuspendModal(id) {
  const task=ws().tasks.find(t=>t.id===id); if(!task) return;
  state.pendingSuspendId=id;
  $('suspend-task-name').textContent=task.title;
  $('suspend-context').value='';
  $('modal-suspend').style.display='flex';
  setTimeout(()=>$('suspend-context').focus(),40);
}
function closeSuspendModal(){$('modal-suspend').style.display='none';state.pendingSuspendId=null;}
function confirmSuspend(){
  const task=ws().tasks.find(t=>t.id===state.pendingSuspendId);
  if(!task){closeSuspendModal();return;}
  const ctx=$('suspend-context').value.trim();
  if(!ctx){showToast({title:'请填写一句话',text:'这是回来时恢复注意力的关键锚点。',kind:'warn'});return;}
  task.status='suspended';task.context=ctx;task.suspendedAt=Date.now();task.doingStartAt=null;
  ws().notifiedOverdueIds.delete(task.id);
  closeSuspendModal();
  showToast({title:'现场已保存',text:'处理临时事务吧，完成后会提醒你切回。',kind:'success'});
  render();
}
function openRestoreModal(id){
  const task=ws().tasks.find(t=>t.id===id);
  if(!task||task.status!=='suspended') return;
  state.pendingRestoreId=id;
  $('restore-task-name').textContent=task.title;
  $('restore-context').textContent=task.context;
  $('restore-duration').textContent=fmtDuration(Date.now()-task.suspendedAt);
  $('modal-restore').style.display='flex';
}
function closeRestoreModal(){$('modal-restore').style.display='none';state.pendingRestoreId=null;}
function confirmRestore(){
  const task=ws().tasks.find(t=>t.id===state.pendingRestoreId);
  if(!task){closeRestoreModal();return;}
  const cur=getActive();
  if(cur){cur.status='todo';cur.doingStartAt=null;}
  task.status='doing';task.doingStartAt=Date.now();task.suspendedAt=null;
  ws().notifiedOverdueIds.delete(task.id);
  closeRestoreModal();
  showToast({title:'回到工作',text:'专注做完这件事再接受新任务。',kind:'success'});
  render();
}

/* ============================================================
   Toast
   ============================================================ */
function showToast({title,text,kind='info',actions=[],duration=3500}){
  const el=document.createElement('div');
  el.className='toast '+kind;
  el.innerHTML=`<div class="toast-title">${esc(title)}</div>
    ${text?`<div class="toast-text">${esc(text)}</div>`:''}
    ${actions.length?`<div class="toast-actions">${actions.map((a,i)=>`<button data-i="${i}" class="${a.primary?'primary':''}">${esc(a.label)}</button>`).join('')}</div>`:''}`;
  $('toast-container').appendChild(el);
  el.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click',()=>{actions[+btn.dataset.i]?.onClick?.();dismiss();});
  });
  function dismiss(){el.classList.add('fade-out');setTimeout(()=>el.remove(),230);}
  if(duration>0) setTimeout(dismiss,duration);
}

/* ============================================================
   拖动 HUD 窗口
   ============================================================ */
function setupDrag(){
  const hud=$('hud'), header=$('hud-header');
  let drag=false,sx,sy,sl,st;
  header.addEventListener('mousedown',e=>{
    if(e.target.closest('button,input')) return;
    drag=true;
    const r=hud.getBoundingClientRect();
    sx=e.clientX;sy=e.clientY;sl=r.left;st=r.top;
    hud.style.right='auto';hud.style.bottom='auto';
    hud.style.left=sl+'px';hud.style.top=st+'px';
    e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!drag) return;
    const r=hud.getBoundingClientRect();
    let nl=sl+e.clientX-sx,nt=st+e.clientY-sy;
    nl=Math.max(0,Math.min(window.innerWidth-r.width,nl));
    nt=Math.max(0,Math.min(window.innerHeight-r.height,nt));
    hud.style.left=nl+'px';hud.style.top=nt+'px';
  });
  window.addEventListener('mouseup',()=>{drag=false;});
}

/* ============================================================
   输入 & 事件初始化
   ============================================================ */
function setupInput(){
  const input=$('task-input');
  $('type-bar').addEventListener('click',e=>{
    const pill=e.target.closest('[data-type]'); if(!pill) return;
    state.inputType=pill.dataset.type;
    document.querySelectorAll('.type-pill').forEach(p=>{
      p.className='type-pill'+(p.dataset.type===state.inputType?` active-${p.dataset.type}`:'');
    });
    input.focus();
  });
  $('mic-btn').addEventListener('click',()=>{
    showToast({title:'语音输入（原型阶段）',text:'MVP 阶段用 Web Speech API 实现。',kind:'info'});
  });
  input.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    const text=input.value.trim(); if(!text) return;
    const priority=ws().tasks.filter(t=>t.type===state.inputType).length+1;
    const task=mkTask(text,state.inputType,priority);
    ws().tasks.push(task); input.value=''; render();
    scheduleAISuggest(task.id);
    if(state.inputType==='temp') setTimeout(checkAIDeviation,200);
  });
}
function setupToggle(){
  $('hud-toggle').addEventListener('click',e=>{e.stopPropagation();state.expanded=!state.expanded;render();});
  $('hud-header').addEventListener('click',e=>{if(e.target.closest('button')) return;state.expanded=!state.expanded;render();});
  $('ai-nav-close').addEventListener('click',()=>{ws().aiNavMessage=null;renderAiNav();});
  $('ws-tabs').addEventListener('click',e=>{
    const tab=e.target.closest('[data-ws]');
    if(!tab||tab.dataset.ws===state.activeWs) return;
    state.activeWs=tab.dataset.ws; render();
  });
  $('cal-toggle-btn').addEventListener('click',e=>{e.stopPropagation();toggleCalendar();});
  $('cal-close-btn').addEventListener('click',toggleCalendar);
  $('journal-btn') && $('journal-btn').addEventListener('click', toggleJournalPanel);
  $('journal-fab') && $('journal-fab').addEventListener('click', toggleJournalPanel);
  $('journal-panel-close').addEventListener('click',toggleJournalPanel);
  /* 事件委托：列表容器统一处理条目点击，不依赖每次 innerHTML 重绑 */
  $('journal-entry-list').addEventListener('click',e=>{
    e.stopPropagation();
    const item=e.target.closest('[data-jid]');
    console.log('[FocusHUD] entry-list click, target='+e.target.className+' item='+(item?item.dataset.jid:'null'));
    if(item) openJournalDetail(item.dataset.jid);
  });
}
function setupModals(){
  $('suspend-cancel').addEventListener('click',closeSuspendModal);
  $('suspend-confirm').addEventListener('click',confirmSuspend);
  $('modal-suspend').addEventListener('click',e=>{if(e.target.id==='modal-suspend') closeSuspendModal();});
  $('suspend-context').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)) confirmSuspend();});
  $('restore-cancel').addEventListener('click',closeRestoreModal);
  $('restore-confirm').addEventListener('click',confirmRestore);
  $('modal-restore').addEventListener('click',e=>{if(e.target.id==='modal-restore') closeRestoreModal();});
  /* 收尾仪式 / 日记 (v4.1 新 ID) */
  $('jm-postpone-btn').addEventListener('click',ritualPostponeAll);
  /* 稍后：自动归档客观数据（skipMode=true），不弹 toast 说"已保存日记" */
  $('jm-skip').addEventListener('click',()=>saveRitualJournal(true));
  /* 完成收尾：正式归档 */
  $('jm-save').addEventListener('click',()=>saveRitualJournal(false));
  $('modal-ritual').addEventListener('click',e=>{
    if(e.target.id==='modal-ritual') saveRitualJournal(true);
  });
  /* 心情快选 */
  document.querySelectorAll('.jm-mood-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.jm-mood-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      state.todayMood=parseInt(btn.dataset.mood);
    });
  });
  /* 日记详情 */
  $('jd-close').addEventListener('click',()=>{$('modal-journal-detail').style.display='none';});
  $('modal-journal-detail').addEventListener('click',e=>{if(e.target.id==='modal-journal-detail') $('modal-journal-detail').style.display='none';});
}

/* ============================================================
   Tick
   ============================================================ */
function tick(){
  if(getActive()||getSuspended()) render();
  checkAIDeviation();
  checkRitualTime();
  if(state.calOpen) renderCalendar();
}


document.addEventListener('DOMContentLoaded',()=>{
  setupDrag(); setupInput(); setupToggle(); setupModals();
  initJournalPanelClickGuard();
  render();
  // 首次渲染后强制落盘一次（含默认工作区数据）
  if (typeof persistAll === 'function') setTimeout(persistAll, 500);
  setInterval(tick, 60*1000);
  // 每秒刷新计时显示（活动任务的运行时间）
  setInterval(() => {
    const active = getActive(), suspended = getSuspended();
    if (active || suspended) render();
    _resetIdleTimer(); // 有任务运行的每一秒都重置空闲计时
  }, 1000);

  /* 开发调试入口：在 Console 输入 fhud.journals() / fhud.triggerRitual() */
  window.fhud = {
    journals: ()=>{ const j=loadJournals(); console.table(j.map(e=>({id:e.id,date:e.date,ws:e.ws,done:e.doneCount,undone:e.undoneCount,mood:e.mood}))); return j; },
    openDetail: (idx=0)=>{ const j=loadJournals(); if(j[idx]) openJournalDetail(j[idx].id); else console.warn('No journal at index',idx); },
    triggerRitual: ()=>triggerRitual('debug'),
    clearJournals: ()=>{ saveJournals([]); console.log('Journals cleared'); },
    checkOverlays: ()=>{
      document.querySelectorAll('.modal-overlay').forEach(el=>{
        const s=window.getComputedStyle(el);
        console.log(el.id, '| display:', s.display, '| visibility:', s.visibility, '| z-index:', s.zIndex, '| pointer-events:', s.pointerEvents);
      });
    },
    testClick: ()=>{
      // 先确保面板打开
      if(!state.journalOpen){ toggleJournalPanel(); }
      setTimeout(()=>{
        const list=$('journal-entry-list');
        console.log('[FocusHUD] journal-entry-list innerHTML length:', list.innerHTML.length);
        const items=list.querySelectorAll('[data-jid]');
        console.log('[FocusHUD] items count:', items.length);
        if(items.length){ const jid=items[0].dataset.jid; console.log('[FocusHUD] firing openJournalDetail('+jid+')'); openJournalDetail(jid); }
        else console.warn('[FocusHUD] No items - list empty or not rendered');
      }, 200);
    },
  };
  console.log('[FocusHUD v4.2] Ready. Debug: fhud.journals() | fhud.openDetail() | fhud.triggerRitual()');
});
