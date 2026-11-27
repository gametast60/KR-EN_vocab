(function(root){
  'use strict';
  const S=root.GrammarScheduler, clone=x=>JSON.parse(JSON.stringify(x));
  const normalize=x=>String(x).normalize('NFC').trim().replace(/\s+/g,' ').replace(/[.!?。！？]+$/u,'');
  const check=(q,a)=>q.accepted.some(x=>normalize(x)===normalize(a));
  function pick(lesson,item,mode,now){
    const pool=mode==='checkpoint'?'checkpoint':'review',n=mode==='checkpoint'?5:2,selected=[],contexts=new Set();
    for(const skill of ['use','understand']){
      const available=lesson.questions.filter(q=>q.pool===pool&&q.skill===skill).sort((a,b)=>(item.seen[a.id]||0)-(item.seen[b.id]||0)||a.id.localeCompare(b.id));
      const fresh=available.filter(q=>!contexts.has(q.contextId)&&(mode!=='review'||!item.seen[q.id]||now-item.seen[q.id]>=S.DAY));
      for(const q of fresh){if(selected.filter(x=>x.skill===skill).length>=n)break;selected.push(clone(q));contexts.add(q.contextId);}
      if(selected.filter(x=>x.skill===skill).length<n)throw Error('โจทย์ที่เว้นช่วงพอยังไม่ครบ ฝึกเพิ่มเติมหรือกลับมาภายหลังได้');
    }
    return selected;
  }
  function create(lesson,item,mode,now){
    item=item||S.blank();if(mode==='review'&&!S.ready(item,now))throw Error('ยังไม่ถึงเวลาประเมิน เลือกฝึกเพิ่มเติมได้');
    const questions=pick(lesson,item,mode,now);
    return {id:root.FiveStageSession.uid(),lessonId:lesson.id,contentVersion:lesson.fingerprint,mode,startedAt:now,phase:'question',cursor:0,draft:'',answers:[],questions,suspended:false,before:clone(item),assisted:false,tainted:false};
  }
  function finish(g,status,now){
    const s=g.session;if(!s||s.phase!=='question')return;
    const previous=g.items[s.lessonId]||S.blank();
    const perSkill=s.mode==='checkpoint'?5:2;
    const score=skill=>s.answers.filter((a,n)=>s.questions[n].skill===skill&&a.correct).length;
    // Eligibility is measured at the start; any outside exposure during a paused block taints it.
    const tainted=s.tainted||(previous.lastExposure??0)>(s.before.lastExposure??0);
    const event={id:s.id,mode:s.mode,status,at:now,startedAt:s.startedAt,perSkill,use:score('use'),understand:score('understand'),assisted:s.assisted,tainted,questionIds:s.questions.map(q=>q.id),contentVersion:s.contentVersion};
    g.items[s.lessonId]=S.assess(previous,event);
    const i=g.items[s.lessonId];
    // Feedback reveals all items, even ones skipped after requesting the answer.
    if(!['skipped','invalidated'].includes(status))for(const q of s.questions)i.seen[q.id]=now;
    s.result=clone(i.history.at(-1));s.phase='result';s.draft='';
  }
  function answer(g,value,now){const s=g.session;if(!s||s.phase!=='question')return;const q=s.questions[s.cursor];if(!q)return;if(!String(value).trim())throw Error('พิมพ์คำตอบ หรือเลือกว่ายังนึกไม่ออก');s.answers.push({answer:String(value),correct:check(q,value)});s.cursor++;s.draft='';if(s.cursor===s.questions.length)finish(g,'completed',now);}
  function invalidate(g,now){const s=g.session;if(!s)return;const current=g.items[s.lessonId]||S.blank();
    if(s.phase==='question'){finish(g,'invalidated',now);}
    else if(s.result?.status!=='invalidated'){
      // Preserve exposure and reports acquired since the block, but roll back its schedule/evidence.
      const restored=clone(s.before);restored.lastExposure=current.lastExposure;restored.seen=current.seen;restored.reports=current.reports;
      const e={...s.result,status:'invalidated',rated:false,enrolled:false,to:restored.stage,reason:'invalidated'};
      restored.history.push(e);g.items[s.lessonId]=restored;s.result=e;
    }
    g.items[s.lessonId].reports.push({at:now,sessionId:s.id,questionIds:s.questions.map(q=>q.id)});
  }
  root.GrammarSession=Object.freeze({normalize,check,pick,create,answer,finish,invalidate});
  if(typeof module!=='undefined')module.exports=root.GrammarSession;
})(typeof window!=='undefined'?window:globalThis);
