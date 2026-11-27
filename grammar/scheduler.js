/* Grammar policy v1: one schedule per usage; two evidence dimensions. */
(function(root) {
  'use strict';
  const DAY=86400000, intervals=[0,1,3,7,14,30], copy=x=>JSON.parse(JSON.stringify(x));
  const date=t=>root.FiveStageScheduler.date(t);
  const blank=()=>({stage:0,dueAt:null,lastExposure:null,lastRatedAt:null,learnedAt:null,passedAt:null,needsPractice:false,history:[],seen:{},reports:[]});
  const eligibleAt=i=>Math.max(i.dueAt||0,(i.lastExposure??-DAY)+DAY,(i.lastRatedAt??-DAY)+DAY);
  const ready=(i,now)=>!!(i?.stage&&now>=eligibleAt(i));
  function expose(previous,now){const i=copy(previous||blank());i.lastExposure=Math.max(i.lastExposure||0,now);return i;}
  function assess(previous,event) {
    if(!event||typeof event.id!=='string'||!Number.isFinite(event.at)||!Number.isFinite(event.startedAt)||!['checkpoint','review','practice'].includes(event.mode)||!['completed','revealed','skipped','invalidated'].includes(event.status))throw Error('ผลไวยากรณ์ไม่ถูกต้อง');
    const i=copy(previous||blank());if(i.history.some(e=>e.id===event.id))return i;
    const e={...copy(event),policy:1,rated:false,enrolled:false,from:i.stage,to:i.stage,reason:'practice'};
    const ignore=['skipped','invalidated'].includes(e.status);
    const gap=Math.max(0,event.startedAt-(i.lastExposure??event.startedAt));
    e.gapDays=gap/DAY;
    if(!ignore){
      const complete=e.status==='completed'&&!e.assisted;
      const cpPass=complete&&!e.tainted&&e.use>=4&&e.understand>=4&&e.perSkill===5;
      if(e.mode==='checkpoint'&&cpPass&&!i.passedAt){i.passedAt=e.at;i.stage=1;i.dueAt=e.at+DAY;i.needsPractice=false;e.enrolled=true;e.reason='enrolled';}
      if(e.mode==='review'&&ready(i,e.startedAt)&&(!i.lastRatedAt||date(i.lastRatedAt)!==date(e.startedAt))&&!e.tainted&&e.perSkill===2){
        e.rated=true;i.lastRatedAt=e.at;
        const total=e.use+e.understand;
        if(complete&&total===4){
          if(gap>=intervals[i.stage]*DAY){i.stage=Math.min(5,i.stage+1);e.reason='advanced';}
          else e.reason='short-gap';
          i.needsPractice=false;
        }else if(complete&&total===3){i.stage=Math.max(1,i.stage-1);i.needsPractice=true;e.reason='repair';}
        else {i.stage=1;i.needsPractice=true;e.reason='relearn';}
        i.dueAt=e.at+intervals[i.stage]*DAY;
      }else if(e.mode==='review') e.reason='not-independent';
      if(e.mode==='checkpoint'&&!cpPass)i.needsPractice=true;
      i.lastExposure=Math.max(i.lastExposure||0,e.at);
    }else e.reason=e.status;
    e.to=i.stage;i.history.push(e);return i;
  }
  function continuous(i){const rows=(i?.history||[]).filter(e=>e.rated);return !i?.needsPractice&&rows.length>=2&&rows.slice(-2).every(e=>e.status==='completed'&&!e.assisted&&e.use===2&&e.understand===2)&&rows.at(-1).gapDays>=7;}
  function validate(g){
    const object=x=>x&&typeof x==='object'&&!Array.isArray(x), time=x=>x===null||Number.isFinite(x), str=x=>typeof x==='string';
    if(!object(g)||g.version!==1||!object(g.items)||!['topik1','topik2'].includes(g.track))throw Error('ข้อมูลคลังไวยากรณ์ไม่ถูกต้อง');
    if(g.guided!=null&&(!object(g.guided)||!str(g.guided.id)||!Number.isInteger(g.guided.cursor)||g.guided.cursor<0||g.guided.cursor>(g.guided.questionIds?.length??2)||!str(g.guided.answer)||typeof g.guided.feedback!=='boolean'||g.guided.questionIds&&(!Array.isArray(g.guided.questionIds)||g.guided.questionIds.length>10||!g.guided.questionIds.every(str))))throw Error('รอบฝึกพร้อมคำอธิบายไม่ถูกต้อง');
    for(const [id,i] of Object.entries(g.items)){
      if(!/^[a-z][a-z0-9.-]+$/.test(id)||!object(i)||!Number.isInteger(i.stage)||i.stage<0||i.stage>5||![i.dueAt,i.lastExposure,i.lastRatedAt,i.learnedAt,i.passedAt].every(time)||typeof i.needsPractice!=='boolean'||!object(i.seen)||!Object.values(i.seen).every(Number.isFinite)||!Array.isArray(i.reports)||!Array.isArray(i.history))throw Error('ประวัติไวยากรณ์ไม่ถูกต้อง');
      if(i.stage>0&&(!Number.isFinite(i.dueAt)||!Number.isFinite(i.passedAt)))throw Error('วันนัดไวยากรณ์ไม่ถูกต้อง');
      for(const e of i.history)if(!str(e.id)||!Number.isFinite(e.at)||!['checkpoint','review','practice'].includes(e.mode)||!['completed','revealed','skipped','invalidated'].includes(e.status)||typeof e.rated!=='boolean'||![e.use,e.understand,e.perSkill].every(Number.isInteger)||![2,5].includes(e.perSkill)||e.use<0||e.understand<0||e.use>e.perSkill||e.understand>e.perSkill)throw Error('ผลประเมินไวยากรณ์ไม่ถูกต้อง');
    }
    if(g.session){const s=g.session;
      if(!str(s.id)||!str(s.lessonId)||!['checkpoint','review','practice'].includes(s.mode)||!['question','result'].includes(s.phase)||!Number.isFinite(s.startedAt)||typeof s.suspended!=='boolean'||!str(s.draft)||!Array.isArray(s.questions)||![4,10].includes(s.questions.length)||!Number.isInteger(s.cursor)||s.cursor<0||s.cursor>s.questions.length||!Array.isArray(s.answers)||s.answers.length!==s.cursor||!object(s.before)||!str(s.contentVersion))throw Error('รอบไวยากรณ์ไม่ถูกต้อง');
      for(const q of s.questions)if(!str(q.id)||!['use','understand'].includes(q.skill)||!str(q.prompt)||!str(q.sentence)||!str(q.explanation)||!Array.isArray(q.accepted)||!q.accepted.length||!q.accepted.every(str)||!['type','choice'].includes(q.type)||!Array.isArray(q.choices)||!q.choices.every(str)||!Array.isArray(q.glossary))throw Error('โจทย์ไวยากรณ์ในรอบไม่ถูกต้อง');
      if(!s.answers.every(a=>object(a)&&str(a.answer)&&typeof a.correct==='boolean'))throw Error('คำตอบไวยากรณ์ไม่ถูกต้อง');
      const perSkill=s.mode==='checkpoint'?5:2;
      if(s.questions.length!==perSkill*2||s.questions.filter(q=>q.skill==='use').length!==perSkill||s.questions.filter(q=>q.skill==='understand').length!==perSkill||new Set(s.questions.map(q=>q.id)).size!==s.questions.length)throw Error('จำนวนโจทย์แต่ละด้านไม่ถูกต้อง');
      if(s.phase==='question'&&s.cursor===s.questions.length||s.phase==='result'&&(!object(s.result)||s.result.id!==s.id||!['completed','revealed','skipped','invalidated'].includes(s.result.status)||![s.result.use,s.result.understand].every(n=>Number.isInteger(n)&&n>=0&&n<=perSkill)))throw Error('ผลรอบไวยากรณ์ไม่ครบ');
      if(s.phase==='result'&&s.result.status==='completed'&&s.cursor!==s.questions.length)throw Error('รอบประเมินยังตอบไม่ครบ');
      validate({version:1,track:g.track,items:{[s.lessonId]:s.before},session:null});
    }
    return g;
  }
  const defaults=()=>({version:1,track:'topik1',items:{},session:null});
  root.GrammarScheduler=Object.freeze({DAY,intervals,blank,eligibleAt,ready,expose,assess,continuous,validate,defaults});
  if(typeof module!=='undefined')module.exports=root.GrammarScheduler;
})(typeof window!=='undefined'?window:globalThis);
