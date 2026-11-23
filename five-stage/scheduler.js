/* Pure, versioned MVP policy. Scores are evidence bands, not retention probabilities. */
(function (root) {
  'use strict';
  const DAY = 86400000, intervals = [0, 1, 3, 7, 14, 30];
  const date = time => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  function addDays(time, days) { const d = new Date(time); d.setDate(d.getDate()+days); return date(d); }
  const blank = () => ({ box: 0, nextReview: null, contextDue: null, contextStep: 0, needsWord: false, needsContext: false, history: [] });
  function assess(previous, event) {
    if (!event || typeof event.id !== 'string' || !Number.isFinite(event.at) || !['word','context'].includes(event.skill) || !['correct','incorrect','revealed','skipped','invalidated'].includes(event.status)) throw Error('Invalid assessment event');
    const item = JSON.parse(JSON.stringify(previous || blank()));
    item.history ||= [];
    if (item.history.some(row => row.id === event.id)) return item;
    const now = event.at, today = date(now), context = event.skill === 'context';
    const exposure = context ? item.contextExposure : item.lastExposure;
    const elapsed = exposure ? Math.max(0, now - exposure) : 0;
    const sameDay = (context ? item.contextRatedDay : item.ratedDay) === today;
    const due = context ? item.contextDue && item.contextDue <= today : item.box === 0 || item.nextReview && item.nextReview <= today;
    const independent = !exposure || elapsed >= DAY;
    const rated = !!(event.assess && due && !sameDay && independent && !event.tainted);
    const skipped = event.status === 'skipped' || event.status === 'invalidated';
    const result = { ...event, rated: rated && !skipped, score: null, from: item.box, to: item.box };
    if (!skipped) {
      // Any feedback/answer exposure is recorded, including voluntary early practice.
      item.lastExposure = now;
      item.contextExposure = now;
      if (context) {
        if (rated || !item.contextDue) {
          const good = event.status === 'correct';
          item.contextStep = good ? Math.min((item.contextStep || 0) + 1, 5) : 1;
          item.contextDue = addDays(now, good ? intervals[item.contextStep] : 1);
          item.needsContext = !good;
          if (rated) item.contextRatedDay = today;
        } else if (event.status !== 'correct') {
          item.needsContext = true;
          item.contextDue = addDays(now, 1);
        }
      } else if (rated) {
        if (event.status === 'correct') {
          const prior = item.lastCold;
          const historyPoints = prior?.correct && date(prior.at) !== today ? 20 : 0;
          const gapPoints = exposure ? (elapsed >= 7 * DAY ? 20 : elapsed >= DAY ? 10 : 0) : 0;
          result.parts = [60, historyPoints, gapPoints];
          result.score = result.parts.reduce((a,b) => a+b, 0);
          const jump = result.score === 100 ? 3 : result.score >= 80 ? 2 : 1;
          item.box = Math.min(5, item.box + jump);
          item.needsWord = false;
        } else { item.box = 1; item.needsWord = true; result.score = 0; }
        item.nextReview = addDays(now, intervals[item.box]);
        item.lastCold = { at: now, correct: event.status === 'correct' };
        item.ratedDay = today;
      } else {
        if (event.status !== 'correct') item.needsWord = true;
        // Initial learning can start box 1, but cannot fast-track or reward retries.
        if (event.enroll && item.box === 0 && event.status === 'correct') {
          item.box = 1; item.nextReview = addDays(now, 1); item.ratedDay = today;
          item.needsWord = false; result.enrolled = true;
        }
      }
    }
    result.to = item.box;
    item.history.push(result);
    return item;
  }
  function retention(items) {
    const groups={1:{tested:0,correct:0},2:{tested:0,correct:0},3:{tested:0,correct:0}};
    for(const item of items){let previous;
      for(const event of item.history||[]){
        if(!event.rated||event.skill!=='word')continue;
        const jump=previous?.status==='correct'?previous.to-previous.from:0;
        if(groups[jump]){groups[jump].tested++;if(event.status==='correct')groups[jump].correct++;}
        previous=event;
      }
    }
    return groups;
  }
  root.FiveStageScheduler = Object.freeze({ DAY, intervals, date, addDays, blank, assess, retention });
  if (typeof module !== 'undefined') module.exports = root.FiveStageScheduler;
})(typeof window !== 'undefined' ? window : globalThis);
