(function (root) {
  'use strict';
  const S = root.FiveStageScheduler;
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fingerprint = card => JSON.stringify([card.word,card.displayWord,card.meaning,card.file,card.exercise]);
  const shuffle = rows => { const result=rows.slice(); for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [result[i],result[j]]=[result[j],result[i]];}return result; };
  function add(session, card, stage, assess = false, attempt = 0) {
    session.tasks.push({ id: `${session.id}:${session.tasks.length}`, cardId: card.id, stage, assess, attempt, skill: stage===4||stage===5?'context':'word' });
  }
  function create(cards, items, options, now) {
    const session = { id: uid(), level: options.level, mode: options.mode, format: options.format || 'adaptive', startedAt: now, cards: cards.map(card=>({...card,fingerprint:fingerprint(card)})), tasks: [], cursor: 0, phase:'question', draft:'', events:[], before: {}, contextStarted:[], suspended: false };
    for(const card of session.cards) {
      const item = items[card.id] || S.blank(), today=S.date(now);
      const wordDue = item.box>0 && item.nextReview && item.nextReview<=today && item.ratedDay!==today && (!item.lastExposure||now-item.lastExposure>=S.DAY);
      const contextDue = card.exercise.status==='ready' && item.contextDue && item.contextDue<=today && item.contextRatedDay!==today && (!item.contextExposure||now-item.contextExposure>=S.DAY);
      if (session.format==='listen') add(session,card,6);
      else if (session.format==='sentence' || options.mode==='due' && contextDue && !wordDue) {
        if(card.exercise.status==='ready') { add(session,card,5,options.mode==='due'); session.contextStarted.push(card.id); }
      } else add(session,card,3,options.mode==='due'||options.mode==='new');
    }
    return session;
  }
  function complete(state, status, answer, now) {
    const session=state.session, task=session?.tasks[session.cursor];
    if (!task || session.phase!=='question') return;
    const card=session.cards.find(c=>c.id===task.cardId), previous=state.items[card.id] || S.blank();
    session.before ||= {};
    session.before[task.id]=JSON.parse(JSON.stringify(previous));
    if (status==='invalidated') {
      session.events.push({id:task.id,cardId:card.id,stage:task.stage,status,at:now,rated:false});
    } else if ([1,4].includes(task.stage)) {
      state.items[card.id]={...previous,lastExposure:now,contextExposure:now};
      session.events.push({id:task.id,cardId:card.id,stage:task.stage,status:'learned',at:now,rated:false});
    } else if(task.stage===2) {
      state.items[card.id]={...previous,lastExposure:now,contextExposure:now};
      session.events.push({id:task.id,cardId:card.id,stage:2,status,at:now,rated:false});
    } else {
      const event={id:task.id,cardId:card.id,stage:task.stage,skill:task.skill,status,answer,at:now,assess:task.assess,
        enroll:session.mode==='new' || session.mode==='due',tainted:task.tainted||task.stage===6};
      state.items[card.id]=S.assess(previous,event);
      session.events.push(state.items[card.id].history.at(-1));
      if (!['skipped','invalidated'].includes(status)) {
        if(status!=='correct' && task.attempt<2 && task.stage!==6) {
          if(task.stage===3) { add(session,card,1,false,task.attempt+1); add(session,card,2,false,task.attempt+1); add(session,card,3,false,task.attempt+1); }
          if(task.stage===5) { add(session,card,4,false,task.attempt+1); add(session,card,5,false,task.attempt+1); }
        }
        if(task.stage===3 && status==='correct' && session.format==='adaptive' && card.exercise.status==='ready' && !session.contextStarted.includes(card.id)) {
          session.contextStarted.push(card.id); add(session,card,4); add(session,card,5);
        }
      }
    }
    session.phase='feedback'; session.draft='';
  }
  function next(state) {
    const session=state.session;
    if(!session || session.phase!=='feedback') return;
    // Rollback is available only while the current feedback is open; do not duplicate old histories.
    session.before={};
    session.cursor++; session.phase=session.cursor>=session.tasks.length?'summary':'question'; session.draft='';
  }
  function invalidate(state, cardId) {
    const session=state.session;
    if(!session || session.phase==='summary') return;
    const current=session.tasks[session.cursor], result=session.events.find(e=>e.id===current?.id);
    // A faulty question reported while its feedback is still open must not keep a penalty/reward.
    if(current?.cardId===cardId && result?.rated && session.before?.[current.id]){
      const restored=JSON.parse(JSON.stringify(session.before[current.id]));
      const invalid={...result,status:'invalidated',rated:false,score:null,parts:undefined,to:restored.box};
      restored.history.push(invalid);state.items[cardId]=restored;
      session.events[session.events.indexOf(result)]=invalid;
    }
    for(let i=session.cursor;i<session.tasks.length;i++) if(session.tasks[i].cardId===cardId) session.tasks[i].invalidated=true;
  }
  root.FiveStageSession=Object.freeze({create,complete,next,invalidate,fingerprint,shuffle,uid});
  if(typeof module!=='undefined') module.exports=root.FiveStageSession;
})(typeof window!=='undefined'?window:globalThis);
