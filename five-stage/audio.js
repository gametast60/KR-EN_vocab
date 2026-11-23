(function(root){
  'use strict';
  let generation=0;
  function stop(){generation++;root.speechSynthesis?.cancel();}
  function play(parts, done=()=>{}, failed=()=>{}) {
    stop(); const token=generation;
    if(!root.speechSynthesis || !root.SpeechSynthesisUtterance){failed();done();return;}
    let index=0;
    function next(){
      if(token!==generation)return;
      if(index>=parts.length){done();return;}
      const part=parts[index++];
      if(!part.text?.trim()){next();return;}
      const u=new root.SpeechSynthesisUtterance(part.text);u.lang=part.lang;u.rate=.9;
      let settled=false;
      const end=()=>{if(settled||token!==generation)return;settled=true;next();};
      u.onend=end;u.onerror=()=>{if(token!==generation)return;failed();end();};
      try{root.speechSynthesis.speak(u);}catch(_){u.onerror();}
    }
    next();
  }
  root.FiveStageAudio=Object.freeze({stop,play});
})(typeof window!=='undefined'?window:globalThis);
