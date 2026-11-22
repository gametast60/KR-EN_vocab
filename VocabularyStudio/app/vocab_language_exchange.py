"""Copy/paste language work via ordinary chats; no network or API calls."""
import json
import re
import uuid
from vocab_studio_data import FILES, digest, positions

REASONS = {
    'review_image_sense': 'ผู้ใช้ยังไม่ยืนยันความหมายภาพ (อย่ายืนยันภาพแทนผู้ใช้)',
    'missing_sentence': 'ต้องแต่งประโยค',
    'missing_translation': 'ต้องแปลประโยคเป็นไทย',
    'review_sentence_answer': 'ตรวจรูปคำที่ใช้เป็นคำตอบในประโยค',
    'review_cross_language_match_or_new_word': 'หาคำคู่ต่างภาษา หรือเสนอคำใหม่พร้อมระดับ',
}


def shared_image_candidates(repo):
    rows=[]
    for (level,word),records in repo.records.items():
        if len(records)!=1 or not records[0]['data'].get('imageId'):continue
        data=records[0]['data'];meaning=data['meaning']
        opposite='english_' if level.startswith('topik') else 'topik'
        for tl,tw,tm in repo.candidates(dict(level=level,word=word,meaning=meaning)):
            if not tl.startswith(opposite):continue
            target=repo.unique(tl,tw)['data']
            if target.get('imageId')==data['imageId']:continue
            rows.append(dict(sourceKey=level+':'+word,level=level,word=word,imageId=data['imageId'],
                             meaning=meaning,targetKey=tl+':'+tw,targetMeaning=tm,conflict=target.get('imageId','')))
    return rows


def build_request(repo, limit=25, selected_matches=None, selected_keys=None, allow_new=False):
    queue=json.loads(repo.queue_bytes or b'[]');by_key={t['key']:t for t in queue}
    selection=selected_matches or {}
    keys=list(selection) if selected_matches is not None else (selected_keys if selected_keys is not None else list(by_key)[:limit])
    if not keys:raise ValueError('เลือกรายการที่ต้องการส่งไปแชทก่อน')
    if len(keys)>limit:raise ValueError(f'เลือกได้ไม่เกิน {limit} คำต้นทางต่อครั้ง')
    tasks=[];allowed={};payload=[]
    for key in keys:
        level,word=key.split(':',1);data=repo.unique(level,word)['data']
        task=by_key.get(key)
        if task is None:
            if not data.get('imageId'):raise ValueError('คำต้นทางยังไม่มีภาพ')
            task=dict(key=key,level=level,word=word,imageId=data['imageId'],imageExtension=data.get('imageExtension','webp'),
                      meaning=data['meaning'],reasons=[])
        tasks.append(task);chosen=[];allowed[key]=[]
        for target_key in selection.get(key,[]):
            tl,tw=target_key.split(':',1);target=repo.unique(tl,tw)['data']
            if tl.startswith('topik')==level.startswith('topik'):raise ValueError('เลือกคำคู่ต่างภาษาเท่านั้น')
            if target.get('imageId') and target['imageId']!=task['imageId']:raise ValueError(f'{target_key} มีภาพอื่นแล้ว ไม่ย้ายภาพอัตโนมัติ')
            allowed[key].append(target_key)
            chosen.append(dict(level=tl,word=tw,meaning=target['meaning'],sentence=target.get('sentense') or target.get('sentence') or '',translate=target.get('translate',''),sentenceAnswer=target.get('sentenceAnswer','')))
        payload.append(dict(key=key,imageId=task['imageId'],meaning=task['meaning'],sentence=data.get('sentense') or data.get('sentence') or '',translate=data.get('translate',''),sentenceAnswer=data.get('sentenceAnswer',''),selectedWords=chosen))
    request=dict(version=2,requestId=uuid.uuid4().hex,hashes={k:digest(v) for k,v in repo.original.items()},queueHash=digest(repo.queue_bytes or b'[]'),tasks=tasks,allowedMatches=allowed,allowNew=allow_new,sharingOnly=selected_matches is not None)
    example={'requestId':request['requestId'],'results':[{'key':keys[0],'matches':[]}]}
    if payload[0]['selectedWords']:
        target=payload[0]['selectedWords'][0]
        example['results'][0]['matches']=[dict(level=target['level'],word=target['word'],meaning=target['meaning'],sentence='ประโยคของคำที่เลือก',translate='คำแปลไทย',sentenceAnswer='คำตอบจริงในประโยค',sentenceOccurrence=1)]
    if selected_matches is None:example['results'][0].update(sentence='ประโยคต้นทาง',translate='คำแปลไทย',sentenceAnswer='คำตอบจริงในประโยค',sentenceOccurrence=1)
    prompt='''ช่วยจัดข้อมูลภาษาสำหรับรายการที่ผู้ใช้เลือก ไม่ต้องค้นคลัง อ่านไฟล์ หรือวิเคราะห์ภาพ
ตอบเฉพาะ JSON ตามตัวอย่าง รักษา requestId, key, level, word ตามรายการที่เลือก
งานภาพร่วม: ทำเฉพาะ selectedWords ที่ส่งให้ ห้ามค้นเพิ่มคำพ้องอื่น และไม่แก้ประโยคต้นทาง ใช้ matches สำหรับคำคู่ที่เลือก
ใช้ประโยคเดิมของคำคู่ถ้าเหมาะกับ meaning หากขาดหรือคนละความหมายให้แต่งประโยคสั้นที่ใช้จริงพร้อมคำแปลไทย
sentenceAnswer ต้องอยู่ในประโยคจริงและเป็นรูปคำที่ต้องการสอนครบ ไม่เลือกเพียงบางตัวอักษรของกริยา sentenceOccurrence เริ่มจาก 1
ไม่มั่นใจให้ใส่ note และละ field นั้น ไม่ส่ง imageId, path, ฟิลด์ยืนยัน หรือ JavaScript
'''
    if selected_matches is None:prompt+='งานประโยค: แต่งหรือตรวจ sentence, translate, sentenceAnswer ของ key ที่เลือก\n'
    prompt+=('ผู้ใช้เปิดให้เสนอคำใหม่ที่จำเป็น 1 คำต่อรายการใน matches ระดับ topik1/topik2/english_a1/english_a2/english_b1/english_b2 พร้อม note เหตุผลสั้น ๆ\n' if allow_new else 'ห้ามเสนอคำใหม่หรือคำคู่ที่ไม่ได้เลือก หากไม่มี selectedWords ให้ใช้ matches: []\n')
    prompt+='รูปแบบ (แทนข้อความตัวอย่างด้วยคำตอบจริง):\n'+json.dumps(example,ensure_ascii=False,indent=2)+'\nรายการที่เลือก:\n'+json.dumps(payload,ensure_ascii=False,indent=2)
    return request,prompt


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'JSON มีฟิลด์ซ้ำ: {key}')
        result[key] = value
    return result


def parse_response(text, repo, request):
    if request.get('version') not in {1,2}:
        raise ValueError('รูปแบบชุดงานไม่รองรับ กรุณาสร้างคำสั่งใหม่')
    if request['hashes'] != {k: digest(v) for k, v in repo.original.items()} or request['queueHash'] != digest(repo.queue_bytes or b'[]'):
        raise ValueError('คลังหรือคิวเปลี่ยนหลังคัดลอกคำสั่ง กรุณาสร้างคำสั่งจากคิวล่าสุด')
    text = text.strip()
    if len(text) > 2_000_000:
        raise ValueError('ผลตอบกลับใหญ่เกินไป')
    fenced = re.fullmatch(r'```(?:json)?\s*([\s\S]*?)\s*```', text, re.I)
    if fenced:
        text = fenced.group(1)
    value = json.loads(text, object_pairs_hook=strict_object)
    if not isinstance(value, dict) or set(value) != {'requestId', 'results'} or value['requestId'] != request['requestId']:
        raise ValueError('requestId/schema ไม่ตรงกับคำสั่งที่คัดลอกล่าสุด')
    if not isinstance(value['results'], list) or not value['results']:
        raise ValueError('results ต้องเป็นรายการคำตอบที่ไม่ว่าง')
    tasks = {t['key']: t for t in request['tasks']}
    seen, entries, notices, targets = set(), [], [], set()
    language_fields = {'sentence', 'translate', 'sentenceAnswer', 'sentenceOccurrence'}

    def apply_language(entry, result):
        for field in ('sentence', 'translate', 'sentenceAnswer', 'note'):
            if field in result and (not isinstance(result[field], str) or len(result[field]) > 5000):
                raise ValueError(f'{field} ต้องเป็นข้อความไม่เกิน 5000 ตัวอักษร')
        for source, target in [('sentence', 'sentence'), ('translate', 'translate'), ('sentenceAnswer', 'answer')]:
            if source in result:
                entry[target] = result[source].strip()
        if 'sentenceOccurrence' in result:
            if type(result['sentenceOccurrence']) is not int or result['sentenceOccurrence'] < 1:
                raise ValueError('sentenceOccurrence ต้องเป็นจำนวนเต็มบวก')
            entry['occurrence'] = result['sentenceOccurrence']
        if any(field in result for field in language_fields):
            entry['confirmed'] = False
            if 'sentence' in result and 'sentenceAnswer' not in result:
                entry['answer'] = ''
            if 'sentenceOccurrence' not in result:
                entry['occurrence'] = 1
            if entry.get('answer'):
                count = len(positions(entry.get('sentence', ''), entry['answer'], entry['level'].startswith('english')))
                if not count or entry.get('occurrence', 1) > count:
                    raise ValueError(f"{entry['word']}: คำตอบไม่ตรงกับประโยค/ตำแหน่ง")
        entry['import_note'] = result.get('note', '')
        return entry

    for result in value['results']:
        if not isinstance(result, dict) or set(result) - (language_fields | {'key', 'matches', 'note'}):
            raise ValueError('พบฟิลด์ที่ไม่รองรับในผลตอบกลับ')
        key = result.get('key')
        if key not in tasks or key in seen:
            raise ValueError('key ไม่อยู่ในชุดงานหรือซ้ำกัน')
        seen.add(key);task = tasks[key]
        row = dict(image_id=task['imageId'], extension=task.get('imageExtension', 'webp'), meaning=task['meaning'], ko='', en='')
        row['ko' if task['level'].startswith('topik') else 'en'] = key
        source = repo.prepare([row], task['level'])[0]
        source['sense_confirmed'] = 'review_image_sense' not in task['reasons']
        if request.get('sharingOnly'):
            for field,target in [('sentence','sentence'),('translate','translate'),('sentenceAnswer','answer'),('sentenceOccurrence','occurrence')]:
                if field in result and result[field]!=source.get(target):
                    raise ValueError('งานภาพร่วมไม่ควรแก้ประโยคต้นทาง ให้ส่งเฉพาะ matches ที่คุณเลือก')
        source = apply_language(source, result)
        target_key = (source['level'], source['word'])
        if target_key in targets:
            raise ValueError('คำเป้าหมายซ้ำระหว่าง results และ matches')
        targets.add(target_key);entries.append(source)
        matches = result.get('matches', [])
        if not isinstance(matches, list) or len(matches) > 12:
            raise ValueError('matches ต้องเป็นรายการไม่เกิน 12 คำ')
        for match in matches:
            if not isinstance(match, dict) or set(match) - (language_fields | {'level', 'word', 'meaning', 'note'}):
                raise ValueError('matches มีฟิลด์ไม่รองรับ')
            level, word = match.get('level'), match.get('word')
            if level not in FILES or not isinstance(word, str) or not word.strip() or len(word) > 200:
                raise ValueError('ระดับหรือคำใหม่ไม่ถูกต้อง')
            word = word.strip()
            if request.get('version')==2:
                allowed=request.get('allowedMatches',{}).get(key,[])
                if level+':'+word not in allowed and (allowed or not request.get('allowNew')):
                    raise ValueError(f'{level}:{word}: ไม่ใช่คำที่คุณเลือกส่งไปแชท')
            if level.startswith('topik') == task['level'].startswith('topik'):
                raise ValueError('matches ต้องเป็นคำคู่ต่างภาษา')
            identity = (level, word)
            if identity in targets:
                raise ValueError(f'{level}:{word}: คำซ้ำในผลตอบกลับ กรุณารวมให้เหลือรายการเดียว')
            targets.add(identity)
            existing = repo.records.get(identity)
            if not existing:
                # Do not introduce a duplicate at another level without review.
                elsewhere = [l for (l, w) in repo.records if w.casefold() == word.casefold()]
                if elsewhere:
                    raise ValueError(f'{word} มีในระดับ {", ".join(elsewhere)} แล้ว ให้ใช้คำเดิมตามระดับนั้น')
                meaning = match.get('meaning')
                if not isinstance(meaning, str) or not meaning.strip() or len(meaning) > 1000:
                    raise ValueError(f'{word}: คำใหม่ต้องมี meaning')
                entry = dict(row, level=level, word=word, source_meaning=meaning.strip(), is_new=True,
                             sentence='', translate='', answer='', occurrence=1, confirmed=False, sense_confirmed=False)
                notices.append(f'คำใหม่ {level}:{word} — {meaning}')
            else:
                target_row = dict(row, ko='', en='')
                target_row['ko' if level.startswith('topik') else 'en'] = level + ':' + word
                entry = repo.prepare([target_row], level)[0]
                notices.append(f'จับคู่คำเดิม {level}:{word}')
            entries.append(apply_language(entry, match))
    missing = set(tasks) - seen
    if missing:
        notices.append(f'ไม่ได้ส่งผลกลับ {len(missing)} รายการ — คงไว้ในคิว')
    return entries, notices
