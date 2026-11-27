(function(root){
  'use strict';
  function validate(data){
    if(data.schemaVersion!==1||!Array.isArray(data.lessons)||!Array.isArray(data.sources))throw Error('คลังไวยากรณ์เวอร์ชันนี้ไม่รองรับ');
    const ids=new Set(),questionIds=new Set(),sources=new Set(data.sources.flatMap(s=>s.rows.map(r=>r.id)));
    for(const l of data.lessons){
      if(!/^[a-z][a-z0-9.-]+$/.test(l.id)||ids.has(l.id))throw Error('รหัสบทซ้ำ/ไม่ถูกต้อง: '+l.id);ids.add(l.id);
      if(!['topik1','topik2'].includes(l.track)||l.status!=='ready'||!l.title||!l.form||!Array.isArray(l.prerequisites)||!Array.isArray(l.rules)||!l.rules.length||!Array.isArray(l.examples)||!l.examples.length||!Array.isArray(l.questions)||!Array.isArray(l.sourceRefs)||l.sourceRefs.some(id=>!sources.has(id)))throw Error('บทเรียนไม่ครบ: '+l.id);
      for(const q of l.questions){
        if(questionIds.has(q.id)||!q.id.startsWith(l.id+'.')||!['use','understand'].includes(q.skill)||!['guided','checkpoint','review'].includes(q.pool)||!['type','choice'].includes(q.type)||!q.sentence||!q.prompt||!q.contextId||!q.explanation||!Array.isArray(q.accepted)||!q.accepted.length||!q.accepted.every(x=>typeof x==='string'&&x.trim())||!Array.isArray(q.choices)||!Array.isArray(q.glossary))throw Error('โจทย์ไม่ครบ/รหัสซ้ำ: '+q.id);
        if(q.skill==='use'&&q.type!=='type')throw Error('การสร้างรูปต้องไม่มีตัวเลือก');
        if(q.type==='choice'&&(new Set(q.choices).size!==q.choices.length||q.choices.length<2||!q.accepted.every(a=>q.choices.includes(a))))throw Error('ตัวเลือกไม่ถูกต้อง: '+q.id);
        questionIds.add(q.id);
      }
      for(const skill of ['use','understand'])for(const [pool,n]of [['checkpoint',10],['review',8]])if(l.questions.filter(q=>q.skill===skill&&q.pool===pool).length<n)throw Error('คลังโจทย์ไม่พอ: '+l.id+' '+pool+' '+skill);
    }
    const visit=(id,stack=new Set())=>{if(stack.has(id))throw Error('บทพื้นฐานวนซ้ำ');const l=data.lessons.find(l=>l.id===id);if(!l)throw Error('ไม่พบบทพื้นฐาน '+id);for(const p of l.prerequisites)visit(p,new Set([...stack,id]));};for(const id of ids)visit(id);
    return data;
  }
  root.GrammarCatalog=Object.freeze({validate});
  if(typeof module!=='undefined')module.exports=root.GrammarCatalog;
})(typeof window!=='undefined'?window:globalThis);
