(() => {
  "use strict";
  const STORAGE_KEY = "kanaTrainerGrammarV1";
  const MINUTE = 60000, DAY = 86400000;
  const INTERVALS = [10*MINUTE,60*MINUTE,DAY,3*DAY,7*DAY,14*DAY,30*DAY,90*DAY,180*DAY,365*DAY];
  const lessons = window.KANA_GRAMMAR_LESSONS || [];
  const knownIds = new Set(lessons.map(lesson => lesson.id));
  const GROUPS = {all:"Все темы",basics:"Основы",particles:"Частицы",verbs:"Глаголы",expressions:"Выражения"};
  const INSTRUCTIONS = {
    desu:"Завершите вежливое утверждение связкой в настоящем времени.",
    wa:"Вставьте частицу темы, а не частицу выделения подлежащего.",mo:"Добавьте значение «тоже».",
    no:"Свяжите существительные частицей принадлежности или уточнения.",ka:"Завершите вежливый вопрос вопросительной частицей.",
    demonstratives:"Выберите указательное слово по расположению предмета в переводе.",wo:"Обозначьте прямой объект действия.",
    "de-place":"Обозначьте нейтральное место совершения действия.",ni:"Обозначьте точное время или место нахождения без противопоставления.",
    "to-and":"Соедините существительные как полный список: «A и B».",masu:"Впишите только вежливое окончание глагола, основа уже дана.",
    arimasu:"Впишите целый вежливый глагол наличия предмета в нейтральном описании.",
    imasu:"Впишите целый вежливый глагол нахождения человека или животного.",
    tai:"Впишите суффикс своего желания сделать действие; вежливая связка уже дана.",
    "te-kudasai":"Завершите вежливую просьбу; форма глагола перед ней уже дана.",
    mashou:"Впишите вежливое окончание совместного предложения: «давайте» без вопроса."
  };
  const ROMAJI = {
    kya:"きゃ",kyu:"きゅ",kyo:"きょ",sha:"しゃ",shu:"しゅ",sho:"しょ",cha:"ちゃ",chu:"ちゅ",cho:"ちょ",
    nya:"にゃ",nyu:"にゅ",nyo:"にょ",hya:"ひゃ",hyu:"ひゅ",hyo:"ひょ",mya:"みゃ",myu:"みゅ",myo:"みょ",
    rya:"りゃ",ryu:"りゅ",ryo:"りょ",gya:"ぎゃ",gyu:"ぎゅ",gyo:"ぎょ",bya:"びゃ",byu:"びゅ",byo:"びょ",
    pya:"ぴゃ",pyu:"ぴゅ",pyo:"ぴょ",ja:"じゃ",ju:"じゅ",jo:"じょ",shi:"し",chi:"ち",tsu:"つ",
    ka:"か",ki:"き",ku:"く",ke:"け",ko:"こ",sa:"さ",si:"し",su:"す",se:"せ",so:"そ",
    ta:"た",ti:"ち",tu:"つ",te:"て",to:"と",na:"な",ni:"に",nu:"ぬ",ne:"ね",no:"の",
    ha:"は",hi:"ひ",fu:"ふ",hu:"ふ",he:"へ",ho:"ほ",ma:"ま",mi:"み",mu:"む",me:"め",mo:"も",
    ya:"や",yu:"ゆ",yo:"よ",ra:"ら",ri:"り",ru:"る",re:"れ",ro:"ろ",wa:"わ",wo:"を",
    ga:"が",gi:"ぎ",gu:"ぐ",ge:"げ",go:"ご",za:"ざ",ji:"じ",zi:"じ",zu:"ず",ze:"ぜ",zo:"ぞ",
    da:"だ",di:"ぢ",du:"づ",de:"で",do:"ど",ba:"ば",bi:"び",bu:"ぶ",be:"べ",bo:"ぼ",
    pa:"ぱ",pi:"ぴ",pu:"ぷ",pe:"ぺ",po:"ぽ",a:"あ",i:"い",u:"う",e:"え",o:"お"
  };
  const ROMAJI_KEYS = Object.keys(ROMAJI).sort((a,b) => b.length-a.length);
  let host = null, ui = null, selectedId = lessons[0]?.id || null, group = "all", query = "", active = false;
  let progress = {}, wakeTimer = 0, audioToken = 0, session = null, currentScreen = "map", mapFilter = "all";

  function getExercises(lesson){
    return [
      ...lesson.meaningQuestions.map((question,index)=>({...question,type:"meaning",index,key:`meaning:${index}`})),
      ...lesson.questions.map((question,index)=>({...question,type:"fill",index,key:`fill:${index}`})),
      ...lesson.choiceQuestions.map((question,index)=>({...question,type:"choice",index,key:`choice:${index}`})),
      ...(lesson.combinationQuestions || []).map((question,index)=>({...question,type:"combine",index,key:`combine:${index}`}))
    ];
  }

  function getPracticePlan(lessonId,data=progress){
    const lesson=lessons.find(item=>item.id===lessonId),position=lessons.indexOf(lesson);
    if(!lesson) throw new Error("Неизвестный урок.");
    const candidates=lessons.slice(0,position).filter(item=>(data[item.id]?.seen || data[item.id]?.practiceSeen || 0)>0);
    const weakness=item=>{const p=data[item.id];return Number(p.lastPracticeResult==="wrong" || p.lastResult==="wrong")+((p.practiceLapses || 0)+(p.lapses || 0))/Math.max(1,(p.practiceSeen || 0)+(p.seen || 0))};
    const selected=[];
    const add=item=>{if(item && !selected.includes(item))selected.push(item)};
    const weakest=[...candidates].sort((a,b)=>weakness(b)-weakness(a))[0];
    if(weakest && weakness(weakest)>0)add(weakest);
    add(candidates.at(-1));
    const remaining=candidates.filter(item=>!selected.includes(item));
    const cursor=(data[lessonId]?.practiceSeen || 0)+(data[lessonId]?.questionCursor || 0);
    for(let i=0;i<remaining.length && selected.length<3;i++)add(remaining[(cursor+i)%remaining.length]);
    const exercises=getExercises(lesson),base=exercises.filter(q=>q.type!=="combine");
    const order=[0,1,7,2,3,8,4,5,6],current=order.map(i=>({lessonId,type:base[i].type,index:base[i].index,role:"new"}));
    exercises.filter(q=>q.type==="combine").forEach((q,i)=>current.splice(Math.min(current.length,4+i*5),0,{lessonId,type:q.type,index:q.index,role:"combine"}));
    const recall=selected.flatMap(item=>[
      {lessonId:item.id,type:"meaning",index:0,role:"recall"},
      {lessonId:item.id,type:"fill",index:(data[item.id].practiceSeen || data[item.id].questionCursor || 0)%item.questions.length,role:"recall"}
    ]);
    const queue=[];
    current.forEach((item,i)=>{queue.push(item);if((i+1)%2===0 && recall.length)queue.push(recall.shift())});
    queue.push(...recall);
    return {queue,previousLessonIds:selected.map(item=>item.id),newCount:base.length,combinationCount:exercises.length-base.length,recallCount:selected.length*2};
  }

  function getPracticeProgress(previous,ok,now,hintUsed=false,key=null){
    const p={...emptyProgress(0),...previous},solved=new Set(p.drillSolved || []);
    if(ok && !hintUsed && key)solved.add(key);
    return {...p,practiceSeen:(p.practiceSeen || 0)+1,practiceCorrect:(p.practiceCorrect || 0)+Number(ok && !hintUsed),
      practiceLapses:(p.practiceLapses || 0)+Number(!ok),lastPracticeAt:now,lastPracticeResult:ok ? hintUsed ? "hinted" : "correct" : "wrong",drillSolved:[...solved]};
  }

  function recordPracticeAnswer(data,lessonId,question,ok,now,hintUsed=false,slotResults=[]){
    const updated={...data};
    if(question.type==="combine"){
      [...new Set(question.slots.map(slot=>slot.lessonId))].forEach(id=>{
        const ruleOK=question.slots.every((slot,index)=>slot.lessonId!==id || slotResults[index]);
        updated[id]=getPracticeProgress(data[id],ruleOK,now,hintUsed,id===lessonId && ok ? question.key:null);
      });
    }else updated[lessonId]=getPracticeProgress(data[lessonId],ok,now,hintUsed,question.key);
    return updated;
  }

  function escape(value){return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
  function normalizeAnswer(value){
    return String(value).normalize("NFKC").toLowerCase().replace(/[\s。．.!！?？、,]/g,"")
      .replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
  }
  function romajiToKana(value){
    let result = "",rest = value;
    while(rest){
      if(/^([bcdfghjkmprstyz])\1/.test(rest)){result += "っ";rest = rest.slice(1);continue}
      if(rest[0] === "n" && (rest.length === 1 || rest[1] === "'" || !/[aiueoy]/.test(rest[1]))){
        result += "ん";rest = rest.slice(rest[1] === "'" ? 2 : 1);continue;
      }
      const match = ROMAJI_KEYS.find(key => rest.startsWith(key));
      if(!match) return null;
      result += ROMAJI[match];rest = rest.slice(match.length);
    }
    return result;
  }
  function isAnswerCorrect(value,answers){
    const input = normalizeAnswer(value);
    if(!input) return false;
    const converted = /^[a-z']+$/.test(input) ? romajiToKana(input) : input;
    return answers.some(answer => {
      const expected = normalizeAnswer(answer);
      return input === expected || converted === expected
        || (expected === "は" && input === "wa") || (expected === "を" && input === "o")
        || (expected === "へ" && input === "e");
    });
  }
  function emptyProgress(now = Date.now()){
    return {startedAt:now,lastReviewedAt:0,nextReviewAt:now,intervalMs:0,streak:0,seen:0,correct:0,lapses:0,questionCursor:0,lastResult:null};
  }
  function getNextProgress(previous,isCorrect,now,hintUsed = false){
    const next = {...emptyProgress(now),...previous};
    next.seen++;next.lastReviewedAt = now;
    if(isCorrect){
      if(!hintUsed){next.correct++;next.streak++}else next.streak = 0;
      next.lastResult = "correct";
      next.intervalMs = INTERVALS[Math.min(INTERVALS.length-1,Math.max(0,next.streak-1))];
      next.questionCursor++;
    } else {
      next.lapses++;next.streak = 0;next.lastResult = "wrong";next.intervalMs = MINUTE;
    }
    next.nextReviewAt = now + next.intervalMs;
    return next;
  }
  function getDueLessonIds(data,now = Date.now()){
    return lessons.filter(lesson => data[lesson.id]?.startedAt > 0 && data[lesson.id].nextReviewAt <= now)
      .sort((a,b) => Number(data[b.id].lastResult === "wrong") - Number(data[a.id].lastResult === "wrong")
        || data[a.id].nextReviewAt-data[b.id].nextReviewAt).map(lesson => lesson.id);
  }
  function validateProgress(data){
    if(!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Повреждён прогресс грамматики.");
    const clean = {};
    const number = (value,max,integer = false) => {
      if(!Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) throw new Error("Некорректные числа в прогрессе грамматики.");
      return value;
    };
    Object.entries(data).forEach(([id,value]) => {
      if(!knownIds.has(id)) return;
      if(!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Повреждены данные грамматической темы.");
      const item = {
        startedAt:number(value.startedAt,Date.UTC(2200,0,1)),
        lastReviewedAt:number(value.lastReviewedAt ?? 0,Date.UTC(2200,0,1)),
        nextReviewAt:number(value.nextReviewAt,Date.UTC(2200,0,1)),
        intervalMs:number(value.intervalMs ?? 0,365*DAY),
        streak:number(value.streak ?? 0,1e9,true),seen:number(value.seen ?? 0,1e9,true),
        correct:number(value.correct ?? 0,1e9,true),lapses:number(value.lapses ?? 0,1e9,true),
        questionCursor:number(value.questionCursor ?? 0,1e9,true),
        lastResult:value.lastResult === "correct" || value.lastResult === "wrong" ? value.lastResult : null,
        practiceSeen:number(value.practiceSeen ?? 0,1e9,true),practiceCorrect:number(value.practiceCorrect ?? 0,1e9,true),
        practiceLapses:number(value.practiceLapses ?? 0,1e9,true),lastPracticeResult:["correct","wrong","hinted"].includes(value.lastPracticeResult) ? value.lastPracticeResult : null,
        lastPracticeAt:number(value.lastPracticeAt ?? 0,Date.UTC(2200,0,1)),lessonCompletedAt:number(value.lessonCompletedAt ?? 0,Date.UTC(2200,0,1)),drillSolved:[]
      };
      if(item.correct + item.lapses > item.seen || item.streak > item.correct) throw new Error("Счётчики ответов грамматики не совпадают.");
      const exerciseKeys = new Set(getExercises(lessons.find(lesson=>lesson.id === id)).map(exercise=>exercise.key));
      if(value.drillSolved != null && (!Array.isArray(value.drillSolved) || value.drillSolved.some(key=>!exerciseKeys.has(key)))) throw new Error("Повреждён прогресс закрепления.");
      item.drillSolved = [...new Set(value.drillSolved || [])];
      if(item.practiceCorrect+item.practiceLapses > item.practiceSeen || item.drillSolved.length > item.practiceCorrect) throw new Error("Счётчики закрепления не совпадают.");
      clean[id] = item;
    });
    if(Object.keys(data).length && !Object.keys(clean).length) throw new Error("Не найдены знакомые грамматические темы.");
    return clean;
  }
  function load(){
    try{progress = validateProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"))}catch(_error){progress = {}}
  }
  function save(next){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));progress = next;return true}
    catch(_error){message("Не удалось сохранить грамматику. Освободите место в браузере; ответ не был записан.",true);return false}
  }
  function message(text,error = false){
    if(!ui) return;
    ui.message.textContent = text;ui.message.classList.toggle("is-error",error);
  }
  function duration(ms){
    if(ms <= 0) return "сейчас";
    if(ms < 60*MINUTE) return `${Math.max(1,Math.ceil(ms/MINUTE))} мин`;
    if(ms < DAY) return `${Math.ceil(ms/(60*MINUTE))} ч`;
    return `${Math.ceil(ms/DAY)} дн`;
  }
  function isLessonCompleted(lessonId,p=progress[lessonId]){
    const lesson=lessons.find(item=>item.id===lessonId);
    return !!lesson && (!!p?.lessonCompletedAt || getExercises(lesson).every(q=>p?.drillSolved?.includes(q.key)));
  }
  function category(p,lessonId){
    if(p?.startedAt && p.nextReviewAt <= Date.now()) return "due";
    if(p?.startedAt && p.intervalMs >= 7*DAY) return "mastered";
    if(isLessonCompleted(lessonId,p)) return "completed";
    return p?.startedAt || p?.practiceSeen ? "learning" : "new";
  }
  function getAnswerStats(p){
    const total=(p?.seen || 0)+(p?.practiceSeen || 0),correct=(p?.correct || 0)+(p?.practiceCorrect || 0),wrong=(p?.lapses || 0)+(p?.practiceLapses || 0);
    const hinted=Math.max(0,total-correct-wrong),percent=value=>total ? value/total*100 : 0;
    return {total,correct,wrong,hinted,correctPercent:percent(correct),wrongPercent:percent(wrong),hintedPercent:percent(hinted)};
  }
  function renderAnswerStats(p){
    const s=getAnswerStats(p);
    if(!s.total) return '<span class="grammar-accuracy"><span class="grammar-accuracy-title">Точность ответов · пока нет данных</span><span class="grammar-accuracy-bar is-empty" aria-hidden="true"></span></span>';
    const text=`Верно ${Math.round(s.correctPercent)}% · Ошибки ${Math.round(s.wrongPercent)}%${s.hinted ? ` · С подсказкой ${Math.round(s.hintedPercent)}%` : ""}`;
    const counts=`${s.total} ответов: ${s.correct} самостоятельно, ${s.wrong} ошибок, ${s.hinted} с подсказкой. Учитываются все попытки в уроках и повторениях.`;
    return `<span class="grammar-accuracy" title="${counts}"><span class="grammar-accuracy-title">${text}</span><span class="grammar-accuracy-bar" role="img" aria-label="${text}. ${counts}"><i class="is-correct" style="width:${s.correctPercent}%"></i><i class="is-wrong" style="width:${s.wrongPercent}%"></i><i class="is-hinted" style="width:${s.hintedPercent}%"></i></span><small>${s.total} ответов · за всё время</small></span>`;
  }
  function renderMetrics(){
    const entries = Object.values(progress).filter(p=>p.startedAt>0),seen = entries.reduce((sum,p)=>sum+p.seen,0),correct = entries.reduce((sum,p)=>sum+p.correct,0);
    const values = [[Object.values(progress).filter(p=>p.startedAt || p.practiceSeen).length,"Тем начато"],[getDueLessonIds(progress).length,"К повторению"],
      [lessons.filter(lesson=>isLessonCompleted(lesson.id)).length,"Уроков пройдено"],[seen ? `${Math.round(correct/seen*100)}%` : "—","Повторы без подсказок"]];
    ui.metrics.innerHTML = values.map(([value,label])=>`<div class="grammar-metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
    ui.review.textContent = `Повторить · ${getDueLessonIds(progress).length}`;
  }
  function renderMap(){
    const names = {new:"Новые",due:"К повторению",learning:"Изучаются",completed:"Пройдены",mastered:"Закреплены"};
    ui.mapFilters.innerHTML = "";
    [["all","Все темы"],...Object.entries(names)].forEach(([filter,title])=>{
      const button = document.createElement("button");button.type="button";button.className="grammar-group";
      const count = lessons.filter(lesson=>filter === "all" || (filter === "completed" ? isLessonCompleted(lesson.id) : category(progress[lesson.id],lesson.id) === filter)).length;
      button.textContent=`${title} · ${count}`;button.setAttribute("aria-pressed",String(filter === mapFilter));
      button.addEventListener("click",()=>{mapFilter=filter;renderMap()});ui.mapFilters.appendChild(button);
    });
    ui.mapLanes.innerHTML = "";
    Object.entries(GROUPS).filter(([key])=>key!=="all").forEach(([key,label],index)=>{
      const cards = lessons.filter(lesson=>lesson.group===key && (mapFilter==="all" || (mapFilter==="completed" ? isLessonCompleted(lesson.id) : category(progress[lesson.id],lesson.id)===mapFilter)));
      if(!cards.length) return;
      const lane=document.createElement("section");lane.className="grammar-map-lane";
      lane.innerHTML=`<h4><span>${index+1}</span>${label}<small>${cards.length} тем</small></h4>`;
      cards.forEach(lesson=>{
        const p=progress[lesson.id],status=category(p,lesson.id),total=getExercises(lesson).length,solved=p?.drillSolved?.length || 0;
        const label={new:"Новая тема",due:"Пора повторить",learning:"Изучается",completed:"Урок пройден",mastered:"Закреплена"}[status]+(isLessonCompleted(lesson.id) && status!=="completed" ? " · Урок пройден" : "");
        const button=document.createElement("button");button.type="button";button.className=`grammar-map-node ${status}`;button.dataset.lessonId=lesson.id;
        button.innerHTML=`<span class="grammar-map-node-top"><strong lang="ja">${escape(lesson.title)}</strong><i class="grammar-status-dot ${status}" aria-hidden="true"></i></span><span class="grammar-map-node-meaning">${escape(lesson.meaning)}</span><span class="grammar-map-node-status">${label}${p?.startedAt && status!=="due" ? ` · ${duration(p.nextReviewAt-Date.now())}` : ""}</span><span class="grammar-map-progress" role="progressbar" aria-label="Закрепление темы" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${solved}"><i style="width:${solved/total*100}%"></i></span><small>Закрепление ${solved}/${total} · ${lesson.examples.length} примеров</small>`;
        button.insertAdjacentHTML("afterbegin",`<span class="grammar-map-route">Урок ${lesson.routeNumber}</span>`);
        button.insertAdjacentHTML("beforeend",renderAnswerStats(p));
        button.addEventListener("click",()=>{selectedId=lesson.id;setScreen("library")});lane.appendChild(button);
      });
      ui.mapLanes.appendChild(lane);
    });
    if(!ui.mapLanes.children.length) ui.mapLanes.innerHTML='<p class="grammar-note">В этой группе пока нет тем. Выберите другой фильтр.</p>';
  }
  function setScreen(screen,updateURL = true){
    clearTimeout(wakeTimer);stopAudio();session=null;currentScreen=screen;
    ui.map.hidden=screen!=="map";ui.layout.hidden=screen!=="library";ui.practice.hidden=true;
    ui.mapTab.setAttribute("aria-pressed",String(screen==="map"));ui.lessonsTab.setAttribute("aria-pressed",String(screen==="library"));
    renderMetrics();renderMap();renderLibrary();renderLesson();
    if(updateURL){
      const hash=screen==="map" ? "#grammar-map" : `#grammar/lesson/${encodeURIComponent(selectedId)}`;
      if(window.location.hash!==hash) window.history.pushState(null,"",hash);
    }
  }
  function applyRoute(){
    const match=window.location.hash.match(/^#grammar\/lesson\/([a-z0-9-]+)$/);
    if(match && knownIds.has(match[1])){selectedId=match[1];setScreen("library",false)}
    else setScreen(window.location.hash==="#grammar-lessons" ? "library" : "map",false);
  }
  function renderLibrary(){
    renderMetrics();ui.lessons.innerHTML = "";
    const matches = lessons.filter(lesson => (group === "all" || lesson.group === group)
      && (!query || `${lesson.title} ${lesson.meaning} ${lesson.explanation}`.toLowerCase().includes(query)));
    matches.forEach(lesson => {
      const status = category(progress[lesson.id],lesson.id);
      const label = {new:"Новая тема",due:"К повторению",learning:"Изучается",completed:"Урок пройден",mastered:"Закреплена"}[status]+(isLessonCompleted(lesson.id) && status!=="completed" ? " · Урок пройден" : "");
      const button = document.createElement("button");
      button.type = "button";button.className = "grammar-lesson-button";button.dataset.lessonId = lesson.id;
      button.setAttribute("aria-pressed",String(selectedId === lesson.id));
      button.innerHTML = `<span class="grammar-lesson-number">${String(lessons.indexOf(lesson)+1).padStart(2,"0")}</span><span class="grammar-lesson-label"><strong>${escape(lesson.title)}</strong><small>${escape(lesson.meaning)} · ${label}</small></span><span class="grammar-status-dot ${status}" aria-hidden="true"></span>`;
      button.addEventListener("click",()=>{selectedId = lesson.id;setScreen("library")});
      ui.lessons.appendChild(button);
    });
    if(!matches.length) ui.lessons.innerHTML = '<p class="grammar-note">Темы не найдены. Попробуйте другое слово.</p>';
  }
  function renderLesson(){
    const lesson = lessons.find(item=>item.id === selectedId);
    if(!lesson){ui.detail.innerHTML = '<p class="grammar-note">Уроки не загрузились. Обновите страницу.</p>';return}
    const p = progress[lesson.id],started=!!p?.startedAt,due = started && getDueLessonIds(progress).includes(lesson.id);
    ui.detail.innerHTML = `<div class="grammar-detail-header"><div><h3>${escape(lesson.title)}</h3><p class="grammar-meaning">${escape(lesson.meaning)}</p></div><span class="grammar-level">${escape(lesson.level)}</span></div><p class="grammar-explanation">${escape(lesson.explanation)}</p><div class="grammar-form">${escape(lesson.form)}</div><div class="grammar-lesson-actions"><button class="grammar-secondary" id="grammarPracticeLesson" type="button">Закрепить · ${getExercises(lesson).length} заданий</button><button class="btn" id="grammarLearnLesson" type="button" ${started && !due ? "disabled" : ""}>${!started ? "Добавить к повторениям" : due ? "Повторить тему" : "Повтор пока не нужен"}</button></div><p class="grammar-note grammar-practice-note">Закрепление: выбор значения, выбор формы и ввод пропуска. Можно заниматься в любое время — расписание повторений не меняется.</p><h4 class="grammar-examples-title">Примеры в разных ситуациях · ${lesson.examples.length}</h4><div class="grammar-examples">${lesson.examples.map((example,index)=>`<div class="grammar-example"><div><strong lang="ja">${escape(example.jp)}</strong><small>${escape(example.ru)}</small></div><button class="grammar-speak" type="button" data-example="${index}" aria-label="Произнести пример ${index+1}">♪</button></div>`).join("")}</div><p class="grammar-schedule">${!started ? "Тема ещё не в расписании. Изучите примеры и добавьте её к повторениям, когда будете готовы." : `Ответов в повторениях: ${p.seen} · Без подсказок: ${p.correct} · Ошибок: ${p.lapses}<br>${due ? "Пора повторить" : `Следующий повтор через ${duration(p.nextReviewAt-Date.now())}`}`}<br>Закреплено заданий: ${p?.drillSolved?.length || 0}/${getExercises(lesson).length}. <a class="grammar-source" href="${escape(lesson.sourceUrl)}" target="_blank" rel="noopener noreferrer">Подробнее на Bunpro ↗</a></p>`;
    const plan=getPracticePlan(lesson.id),earlierRules=[...new Set((lesson.combinationQuestions || []).flatMap(q=>q.slots.map(slot=>slot.lessonId)))].filter(id=>id!==lesson.id);
    ui.detail.querySelector(".grammar-level").textContent=`Урок ${lesson.routeNumber} · N5`;
    ui.detail.querySelector(".grammar-schedule").insertAdjacentHTML("beforebegin",`<section class="grammar-answer-statistics" aria-label="Статистика ответов по теме"><h4>Как получается эта тема</h4>${renderAnswerStats(p)}<p class="grammar-note">Все попытки в уроках и повторениях, включая повторные ответы после ошибки. Зелёный — самостоятельно, красный — ошибка, золотой — с подсказкой. Прохождение урока не означает отсутствие ошибок.</p></section>`);
    if(isLessonCompleted(lesson.id)) ui.detail.querySelector(".grammar-level").insertAdjacentHTML("afterend",'<span class="grammar-completed-badge">✓ Урок пройден</span>');
    ui.detail.querySelector("#grammarPracticeLesson").textContent=`Заниматься · ${plan.queue.length} заданий`;
    ui.detail.querySelector("#grammarPracticeLesson").className="btn";
    ui.detail.querySelector("#grammarLearnLesson").className="grammar-secondary";
    ui.detail.querySelector(".grammar-lesson-actions").insertAdjacentHTML("beforebegin",`<section class="grammar-cumulative" aria-label="Накопительный урок"><h4>Новое правило + знакомые конструкции</h4><p>${plan.newCount} заданий по теме${plan.combinationCount ? ` · ${plan.combinationCount} на сочетание правил` : ""}${plan.recallCount ? ` · ${plan.recallCount} на ранее изученное` : ""}.</p>${earlierRules.length ? `<p>Соединяем с: ${earlierRules.map(id=>`<a href="#grammar/lesson/${id}" lang="ja">${escape(lessons.find(t=>t.id===id).title)}</a>`).join(" · ")}.</p>` : "<p>Первый шаг: учимся завершать вежливое утверждение. В следующем уроке добавим частицу темы は.</p>"}${plan.previousLessonIds.length ? `<p>Вспомним: ${plan.previousLessonIds.map(id=>escape(lessons.find(t=>t.id===id).title)).join(" · ")}. Сложные темы получают приоритет.</p>` : ""}</section>`);
    ui.detail.querySelectorAll("[data-example]").forEach(button=>button.addEventListener("click",()=>host?.speak(lesson.examples[Number(button.dataset.example)].jp,true)));
    ui.detail.querySelector("#grammarLearnLesson").addEventListener("click",()=>{
      if(!started && !save({...progress,[lesson.id]:{...p,...emptyProgress()}})) return;
      startReview(lesson.id);
    });
    ui.detail.querySelector("#grammarPracticeLesson").addEventListener("click",()=>startPractice(lesson.id));
  }
  function stopAudio(){audioToken++;host?.cancelSpeech()}
  function speechParts(lesson,question,revealed){
    if(question.type==="meaning") return [revealed ? lesson.examples[0].jp : lesson.title];
    if(question.type==="combine") return revealed ? [question.fragments.map((part,i)=>part+(question.slots[i]?.answers[0] || "")).join("")] : question.fragments;
    return revealed ? [question.before+(question.options ? question.options[question.correctIndex] : question.answers[0])+question.after] : [question.before,question.after];
  }
  async function speakQuestion(lesson,question){
    stopAudio();const token=audioToken,current=session?.current,button=ui.practice.querySelector("#grammarSpeakQuestion");
    if(!active || !current) return;
    button?.setAttribute("aria-busy","true");
    try{
      // Separate utterances leave the gaps unspoken: listening must not reveal the answer.
      for(const part of speechParts(lesson,question,session.locked)){
        if(token!==audioToken || !active || session?.current!==current) break;
        if(/[\p{L}\p{N}]/u.test(part)) await host?.speak(part,true);
      }
    }catch(_error){message("Не удалось озвучить предложение. Проверьте поддержку японской речи в браузере.",true)}
    finally{button?.removeAttribute("aria-busy")}
  }
  function showLibrary(){
    setScreen("library");
  }
  function startReview(lessonId){
    stopAudio();clearTimeout(wakeTimer);
    const ids = getDueLessonIds(progress),selected = lessonId ? ids.filter(id=>id === lessonId) : ids;
    const queue=selected.map(id=>({lessonId:id,type:"fill",index:progress[id].questionCursor % lessons.find(lesson=>lesson.id===id).questions.length}));
    beginSession(queue,"review");
  }
  function startPractice(lessonId){
    selectedId=lessonId;
    const plan=getPracticePlan(lessonId);
    beginSession(plan.queue,"practice");session.plan=plan;
  }
  function beginSession(queue,kind){
    stopAudio();clearTimeout(wakeTimer);currentScreen="practice";
    session = {kind,queue,current:null,locked:false,completed:0,correct:0,hintUsed:false,composing:false};
    ui.map.hidden=true;ui.layout.hidden = true;ui.practice.hidden = false;nextQuestion();
  }
  function nextQuestion(){
    stopAudio();if(!session) return;
    session.current = session.queue.shift() || null;session.locked = false;session.hintUsed = false;session.composing = false;
    if(!session.current){renderFinish();return}
    const lesson = lessons.find(item=>item.id === session.current.lessonId);
    const question=getExercises(lesson).find(item=>item.type===session.current.type && item.index===session.current.index);
    ui.practice.dataset.topic=lesson.id;ui.practice.dataset.exerciseType=question.type;ui.practice.dataset.exerciseIndex=String(question.index);ui.practice.dataset.exerciseRole=session.current.role || "review";
    const meaning=question.type==="meaning",combine=question.type==="combine",fill=question.type==="fill" || combine;
    const options=(question.options || []).map((text,index)=>({text,index}));
    for(let index=options.length-1;index>0;index--){const other=Math.floor(Math.random()*(index+1));[options[index],options[other]]=[options[other],options[index]]}
    const prompt=meaning ? question.prompt : combine ? "Заполните все пропуски, чтобы предложение соответствовало переводу." : "Заполните пропуск по переводу.";
    const controls=combine ? question.slots.map((slot,i)=>`<label class="grammar-slot-input">Пропуск ${i+1}<input ${i===0 ? 'id="grammarAnswer"' : ''} data-slot="${i}" type="text" placeholder="Ответ…" aria-label="Ответ для пропуска ${i+1}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`).join("") : '<input id="grammarAnswer" type="text" placeholder="Ответ…" aria-label="Ответ на задание по грамматике" autocomplete="off" autocapitalize="off" spellcheck="false">';
    const answerZone=fill ? `<form class="grammar-answer-form ${combine ? "grammar-combination-form" : ""}">${controls}<button class="btn" type="submit">Проверить</button></form><p class="grammar-input-note">Можно вводить японскую запись или ромадзи.</p>`
      : `<div class="grammar-choice-list" role="group" aria-label="Варианты ответа">${options.map(option=>`<button type="button" class="grammar-choice" data-option-index="${option.index}">${escape(option.text)}</button>`).join("")}</div>`;
    const sentence=meaning ? escape(lesson.title) : combine ? question.slots.map((slot,i)=>escape(question.fragments[i])+(i===question.slots.length-1 ? `<span class="grammar-sentence-ending"><span class="grammar-blank" data-slot="${i}">${i+1}</span>${escape(question.fragments.at(-1))}</span>` : `<span class="grammar-blank" data-slot="${i}">${i+1}</span>`)).join("") : `${escape(question.before)}<span class="grammar-blank">…</span>${escape(question.after)}`;
    const role=combine ? "Несколько пропусков" : "Практика в контексте";
    ui.practice.innerHTML = `<div class="grammar-practice-head"><div><p class="grammar-eyebrow">${meaning ? "Значение правила" : combine ? "Соберите предложение" : fill ? "Введите пропуск" : "Выберите форму"}</p><h3>${session.kind==="practice" ? "Закрепление" : "Проверка памяти"} · N5</h3></div><span class="grammar-counter">Осталось ${session.queue.length+1}</span></div>${session.kind==="practice" ? `<p class="grammar-recall-label">${role}</p>` : ""}<p class="grammar-note">${escape(prompt)}</p><p class="grammar-sentence" lang="ja">${sentence}</p>${meaning ? "" : `<p class="grammar-translation">${escape(question.translation)}</p>`}${answerZone}<details class="grammar-hint"><summary>Подсказка и правило</summary><p>${escape(question.hint || lesson.meaning)}</p><p><strong>${escape(lesson.title)}</strong> · ${escape(lesson.explanation)}</p></details><div class="grammar-feedback" hidden role="status" aria-live="polite"></div><div class="grammar-next-row"><button class="grammar-secondary" type="button" id="grammarBackToLessons">К урокам</button><span class="grammar-note">${session.kind==="practice" ? "Свободная практика не меняет расписание." : "После ошибки тема вернётся в этой сессии."}</span></div>`;
    const input = ui.practice.querySelector("input");
    ui.practice.querySelector(".grammar-sentence").insertAdjacentHTML("afterend",`<div class="grammar-sentence-audio"><button id="grammarSpeakQuestion" class="grammar-secondary" type="button">♪ ${meaning ? "Произнести" : "Озвучить предложение"}</button>${meaning ? "" : '<span class="grammar-note" id="grammarAudioNote">До ответа пропуски не озвучиваются.</span>'}</div>`);
    ui.practice.querySelector("#grammarSpeakQuestion").addEventListener("click",()=>speakQuestion(lesson,question));
    if(INSTRUCTIONS[lesson.id])ui.practice.querySelector(".grammar-hint").insertAdjacentHTML("beforeend",`<p>${escape(INSTRUCTIONS[lesson.id])}</p>`);
    if(combine)ui.practice.querySelector("form").style.setProperty("--grammar-slots",question.slots.length);
    if(input){
    if(active) input.focus({preventScroll:true});
    ui.practice.querySelectorAll("input").forEach(field=>{
    field.addEventListener("compositionstart",()=>{if(session) session.composing = true});
    field.addEventListener("compositionend",()=>{if(session) session.composing = false});
    field.addEventListener("keydown",event=>{
      if(event.key === "Enter" && (event.isComposing || event.keyCode === 229)) event.preventDefault();
    });});
    ui.practice.querySelector("form").addEventListener("submit",event=>{event.preventDefault();checkAnswer(lesson,question,input)});
    }else{
      ui.practice.querySelectorAll(".grammar-choice").forEach(button=>button.addEventListener("click",()=>checkAnswer(lesson,question,null,Number(button.dataset.optionIndex))));
      if(active) ui.practice.querySelector(".grammar-choice").focus({preventScroll:true});
    }
    ui.practice.querySelector("details").addEventListener("toggle",event=>{if(session && event.target.open) session.hintUsed = true});
    ui.practice.querySelector("#grammarBackToLessons").addEventListener("click",showLibrary);
  }
  function checkAnswer(lesson,question,input,choiceIndex = null){
    if(!session || session.locked || session.composing) return;
    const combine=question.type==="combine",inputs=[...ui.practice.querySelectorAll(".grammar-answer-form input")];
    const empty=inputs.find(field=>!field.value.trim());if(empty){empty.focus();return}
    const slotResults=combine ? question.slots.map((slot,i)=>isAnswerCorrect(inputs[i].value,slot.answers)) : [];
    const ok = combine ? slotResults.every(Boolean) : input ? isAnswerCorrect(input.value,question.answers) : choiceIndex===question.correctIndex;
    const usedHint = session.hintUsed || ui.practice.querySelector("details").open;
    let next,updated;
    if(session.kind==="practice"){
      updated=recordPracticeAnswer(progress,lesson.id,question,ok,Date.now(),usedHint,slotResults);next=updated[lesson.id];
      if(ok && !session.queue.length){
        updated[selectedId]={...updated[selectedId],lessonCompletedAt:Date.now()};
      }
    }else{next = getNextProgress(progress[lesson.id],ok,Date.now(),usedHint);updated={...progress,[lesson.id]:next}}
    if(!save(updated)) return;
    session.locked = true;session.completed++;
    if(ok){if(!usedHint) session.correct++}else session.queue.splice(Math.min(2,session.queue.length),0,session.current);
    if(input){inputs.forEach(field=>field.disabled=true);ui.practice.querySelector("button[type=submit]").disabled = true}
    ui.practice.querySelectorAll(".grammar-choice").forEach(button=>{
      button.disabled=true;button.classList.toggle("is-correct",Number(button.dataset.optionIndex)===question.correctIndex);
      button.classList.toggle("is-wrong",!ok && Number(button.dataset.optionIndex)===choiceIndex);
    });
    const answer=combine ? question.slots.map(slot=>slot.answers[0]).join(" · ") : question.options ? question.options[question.correctIndex] : question.answers[0];
    ui.practice.querySelectorAll(".grammar-blank").forEach((blank,i)=>{blank.textContent=combine ? question.slots[i].answers[0] : answer;blank.classList.toggle("is-correct",combine ? slotResults[i] : ok)});
    const feedback = ui.practice.querySelector(".grammar-feedback");feedback.hidden = false;feedback.classList.toggle("is-wrong",!ok);
    const schedule=session.kind==="practice" ? "Свободное закрепление: расписание повторений не изменилось." : `Следующее повторение через ${duration(next.intervalMs)}.`;
    feedback.innerHTML = `<strong>${ok ? usedHint ? "Верно с подсказкой — попробуйте позже самостоятельно" : "Верно!" : `Правильный ответ: ${escape(answer)}`}</strong><p>${escape(question.explanation)}</p><p>${ok ? schedule : "Задание вернётся после других; если других нет — сразу следующим вопросом."}</p><button class="btn" id="grammarNextQuestion" type="button">Дальше →</button>`;
    feedback.querySelector("button").addEventListener("click",nextQuestion);feedback.querySelector("button").focus({preventScroll:true});
    const audioNote=ui.practice.querySelector("#grammarAudioNote");if(audioNote)audioNote.textContent="Теперь можно прослушать полное предложение.";
    stopAudio();renderMetrics();const token = audioToken;
    const speech=speechParts(lesson,question,true)[0];
    if(host?.soundEnabled()) Promise.resolve(host.tone(ok)).then(()=>{if(active && token === audioToken) return host.speak(speech,false)}).catch(()=>{});
  }
  function renderFinish(){
    clearTimeout(wakeTimer);renderMetrics();
    if(session?.kind==="practice"){
      const lesson=lessons.find(item=>item.id===selectedId),solved=progress[selectedId]?.drillSolved?.length || 0,nextLesson=lessons[lessons.indexOf(lesson)+1];
      ui.practice.innerHTML=`<div class="grammar-empty"><div class="grammar-hero-mark" aria-hidden="true">学</div><h3>Закрепление завершено</h3><p>${session.completed} ответов · ${session.correct} верно без подсказок.<br>По теме «${escape(lesson.title)}» закреплено ${solved}/${getExercises(lesson).length} заданий.${session.plan?.recallCount ? `<br>Также повторили: ${session.plan.previousLessonIds.map(id=>escape(lessons.find(t=>t.id===id).title)).join(" · ")}.` : ""}<br>Расписание повторений не изменилось.</p><div class="grammar-finish-actions"><button class="grammar-secondary" id="grammarFinishBack" type="button">К теме</button>${nextLesson ? `<button class="btn" id="grammarNextLesson" type="button">Урок ${nextLesson.routeNumber} · ${escape(nextLesson.title)} →</button>` : ""}</div></div>`;
      ui.practice.querySelector("#grammarFinishBack").addEventListener("click",showLibrary);
      ui.practice.querySelector("#grammarNextLesson")?.addEventListener("click",()=>{selectedId=nextLesson.id;setScreen("library")});return;
    }
    const due = getDueLessonIds(progress),future = Object.values(progress).filter(p=>p.nextReviewAt>Date.now()).map(p=>p.nextReviewAt);
    const next = future.length ? Math.min(...future) : null;
    const results = session?.completed ? `${session.completed} ответов · ${session.correct} верно без подсказок. ` : "";
    ui.practice.innerHTML = `<div class="grammar-empty"><div class="grammar-hero-mark" aria-hidden="true">休</div><h3>${due.length ? "Доступны новые повторения" : "Все доступные повторения завершены"}</h3><p>${results}${due.length ? "Пора закрепить ещё несколько тем." : next ? `Приходите через ${duration(next-Date.now())}.` : "Выберите новую тему и изучите правило, чтобы начать."}</p><button class="btn" type="button">${due.length ? "Повторить сейчас" : "Выбрать урок"}</button></div>`;
    ui.practice.querySelector("button").addEventListener("click",due.length ? ()=>startReview() : showLibrary);
    if(active && next && !due.length) wakeTimer = window.setTimeout(renderFinish,Math.max(1000,Math.min(30000,next-Date.now()+50)));
  }
  function onViewChange(value){
    active = value;clearTimeout(wakeTimer);
    if(!value){stopAudio();return}
    if(!ui) return;
    if(currentScreen==="practice" && session){renderMetrics();if(!session.current) renderFinish();return}
    if(window.location.hash.startsWith("#grammar")) applyRoute();
    else setScreen("map");
  }
  function setProgress(data,options = {}){
    const clean = validateProgress(data);
    if(options.persist !== false && !save(clean)) return false;
    progress = clean;if(ui) setScreen(currentScreen==="practice" ? "map" : currentScreen,false);return true;
  }
  function reset(){
    if(!save({})) return false;clearTimeout(wakeTimer);
    if(ui){setScreen("map",active);message("Прогресс грамматики сброшен.")}return true;
  }
  function init(api){
    host = api;const id = name=>document.getElementById(name);
    ui = {metrics:id("grammarMetrics"),review:id("grammarReview"),lessons:id("grammarLessons"),detail:id("grammarLessonDetail"),
      layout:id("grammarLayout"),practice:id("grammarPractice"),message:id("grammarMessage"),groups:id("grammarGroups"),search:id("grammarSearch"),
      map:id("grammarMap"),mapFilters:id("grammarMapFilters"),mapLanes:id("grammarMapLanes"),mapTab:id("grammarMapTab"),lessonsTab:id("grammarLessonsTab")};
    load();
    Object.entries(GROUPS).forEach(([key,label])=>{
      const button = document.createElement("button");button.type = "button";button.className = "grammar-group";
      button.textContent = label;button.setAttribute("aria-pressed",String(group === key));
      button.addEventListener("click",()=>{group = key;ui.groups.querySelectorAll("button").forEach(item=>item.setAttribute("aria-pressed",String(item === button)));renderLibrary()});
      ui.groups.appendChild(button);
    });
    ui.search.addEventListener("input",()=>{query = ui.search.value.trim().toLowerCase();renderLibrary()});
    ui.mapTab.addEventListener("click",()=>setScreen("map"));
    ui.lessonsTab.addEventListener("click",()=>setScreen("library"));
    ui.review.addEventListener("click",()=>startReview());
    id("grammarExport").addEventListener("click",()=>{host.exportProgress();message("Резервная копия каны и грамматики сохранена.")});
    id("grammarImport").addEventListener("click",()=>host.importProgress());
    id("grammarReset").addEventListener("click",()=>{if(window.confirm("Сбросить только прогресс грамматики? Прогресс каны останется.")) reset()});
    const route=()=>{if(window.location.hash.startsWith("#grammar")){applyRoute();host?.openGrammar()}};
    window.addEventListener("hashchange",route);window.addEventListener("popstate",route);
    window.addEventListener("storage",event=>{
      if(event.key===STORAGE_KEY && !session){load();setScreen(currentScreen,false)}
    });
    setScreen("map",false);
    if(window.location.hash.startsWith("#grammar")) route();
  }
  window.KanaGrammar = {storageKey:STORAGE_KEY,init,onViewChange,getProgress:()=>JSON.parse(JSON.stringify(progress)),validateProgress,setProgress,reset,
    testing:{normalizeAnswer,isAnswerCorrect,getNextProgress,getDueLessonIds,getExercises,getPracticePlan,getPracticeProgress,recordPracticeAnswer,isLessonCompleted,speechParts,getAnswerStats}};
})();
