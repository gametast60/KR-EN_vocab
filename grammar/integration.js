/* Games may report teaching/exposure. Assessment always goes through GrammarSession. */
(function(root){
  'use strict';
  function recordExposure(grammar,{lessonId,at=Date.now(),source='game'}){
    if(!root.GrammarContent.lessons.some(l=>l.id===lessonId)||!Number.isFinite(at)||typeof source!=='string')throw Error('การฝึกไวยากรณ์ไม่ถูกต้อง');
    grammar.items[lessonId]=root.GrammarScheduler.expose(grammar.items[lessonId],at);
    if(grammar.session?.lessonId===lessonId&&grammar.session.phase==='question')grammar.session.tainted=true;
  }
  root.GrammarIntegration=Object.freeze({recordExposure});
})(typeof window!=='undefined'?window:globalThis);
