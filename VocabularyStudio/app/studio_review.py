"""Review-only hints; never infer Korean conjugations or image semantics."""
import json
import re
from vocab_studio_data import positions, objects, properties, digest


def meaning_choices(text):
    return list(dict.fromkeys(s.strip() for s in re.split(r'[,，;/、\n]',text) if s.strip()))


def answer_preview(entry):
    sentence=entry.get('sentence','');answer=entry.get('answer','')
    found=positions(sentence,answer,entry['level'].startswith('english'))
    occurrence=entry.get('occurrence',1)
    if not answer:return sentence,'ยังไม่ได้เลือกคำตอบ',''
    if not found or occurrence<1 or occurrence>len(found):return sentence,'คำตอบหรือตำแหน่งไม่ตรงประโยค',''
    start=found[occurrence-1];end=start+len(answer)
    preview=sentence[:start]+'［_____］'+sentence[end:]
    warning='';whole=''
    if entry['level'].startswith('topik') and entry['word'].endswith('다'):
        for match in re.finditer(r'[가-힣]+',sentence):
            if match.start()<=start<match.end():
                whole=match.group()
                if end<match.end() or start>match.start():
                    warning=f'เลือกเพียงส่วนของคำ: {answer} ใน {whole} — ตรวจรูปที่ต้องการสอน'
                elif end>match.end():warning='คำตอบรวมข้อความถัดจากคำกริยา — ตรวจว่าต้องการเว้นทั้งวลีหรือไม่'
                break
    return preview,warning,whole


def saved_batches(repo):
    """Recover committed batch ranges without touching the source data or old journal."""
    folder=repo.root/'VocabularyStudio/data/backups'
    manifests=[];snapshots={}
    for path in folder.glob('*/manifest.json'):
        m=json.loads(path.read_text())
        if m.get('state')!='committed':continue
        manifests.append((path.stat().st_mtime,path,m))
        for item in m['files']:
            if item['path'] in repo.original and item['before']:
                snapshots[item['before']]=path.parent/item['backup']
    result=[]
    for _,path,m in sorted(manifests,reverse=True):
        if m.get('kind')=='maintenance':continue
        keys=set()
        for item in m['files']:
            if item['path'] not in repo.original:continue
            before=(path.parent/item['backup']).read_bytes() if item['before'] else b''
            if digest(repo.original[item['path']])==item['after']:after=repo.original[item['path']]
            elif item['after'] in snapshots:after=snapshots[item['after']].read_bytes()
            else:continue
            old={d.get('word'):raw for _,_,raw in objects(before.decode('utf-8-sig')) if (d:=properties(raw)[1]).get('word')}
            for _,_,raw in objects(after.decode('utf-8-sig')):
                d=properties(raw)[1]
                if d.get('imageId') and old.get(d.get('word'))!=raw:keys.add(d['imageId'])
        if keys:
            ids=sorted(keys,key=int)
            if not any(ids==b['ids'] for b in result):result.append({'label':f"{ids[0]}–{ids[-1]} ({len(ids)} ภาพ)",'ids':ids})
    return result


def maps_for_ids(repo, ids):
    rows={}
    for (level,word),records in repo.records.items():
        if len(records)!=1:continue
        data=records[0]['data'];image_id=data.get('imageId')
        if image_id not in ids:continue
        row=rows.setdefault(image_id,dict(image_id=image_id,extension=data.get('imageExtension','webp'),meaning=data['meaning'],ko='',en=''))
        field='ko' if level.startswith('topik') else 'en'
        row[field]+=('; ' if row[field] else '')+level+':'+word
    return [rows[k] for k in sorted(rows,key=int)]
