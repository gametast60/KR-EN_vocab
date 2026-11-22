"""Direct image export with a recoverable journal and resumable review batch."""
import json
import re
import uuid
from pathlib import Path
from vocab_studio_data import digest, write_atomic, safe_target, restore_file

PENDING='VocabularyStudio/data/pending_images.json'


def pending_batch(root):
    path=Path(root)/PENDING
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def occupied_ids(repo):
    ids={int(p.stem) for p in (repo.root/'visual/images').iterdir() if p.is_file() and p.stem.isdigit()}
    ids.update(int(r['data']['imageId']) for records in repo.records.values() for r in records if str(r['data'].get('imageId','')).isdigit())
    return ids


def next_range(used,count,start=1):
    first=max(start,max(used,default=0)+1)
    while any(i in used for i in range(first,first+count)):first+=1
    return first


def recover_images(root):
    root=Path(root)
    for journal in (root/'VocabularyStudio/data/image_backups').glob('*/manifest.json'):
        manifest=json.loads(journal.read_text())
        if manifest['state']!='prepared':continue
        # Check every file before restoring any file. Never overwrite external edits.
        for item in manifest['files']:
            target=safe_target(root,item['path'])
            current=digest(target.read_bytes()) if target.exists() else None
            if current not in (item['before'],item['after']):
                raise ValueError('พบงานส่งออกค้างและไฟล์ถูกแก้ภายนอก: '+item['path'])
        for item in reversed(manifest['files']):
            restore_file(root,journal.parent,item)
        manifest['state']='rolled_back'
        write_atomic(journal,json.dumps(manifest).encode())


def commit_images(root,images,entries,expected,progress=lambda value,text:None):
    root=Path(root).resolve()
    recover_images(root)
    if pending_batch(root):raise ValueError('มีชุดภาพรอตรวจอยู่ กรุณาบันทึกชุดเดิมก่อน')
    if set(images)!=set(expected):raise ValueError('รายการภาพไม่ตรงกับชุดที่ตรวจ')
    for name,content in images.items():
        if not re.fullmatch(r'visual/images/\d{4,}\.webp',name):raise ValueError('ชื่อภาพไม่ถูกต้อง')
        path=safe_target(root,name)
        current=digest(path.read_bytes()) if path.exists() else None
        if current!=expected[name]:raise ValueError('ภาพเปลี่ยนหลังตรวจ ID กรุณาตรวจใหม่: '+name)
        if any(p.is_file() and p.stem==path.stem and p!=path for p in path.parent.iterdir()):
            raise ValueError('ID มีไฟล์ชนิดอื่นแล้ว: '+path.stem)
    batch={'id':uuid.uuid4().hex,'entries':entries,'images':{name:digest(data) for name,data in images.items()}}
    changes=dict(images)
    changes[PENDING]=(json.dumps(batch,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    folder=root/'VocabularyStudio/data/image_backups'/batch['id'];folder.mkdir(parents=True)
    manifest={'state':'prepared','files':[]}
    for i,(name,content) in enumerate(changes.items()):
        path=safe_target(root,name);before=path.read_bytes() if path.exists() else None
        if name in expected and (digest(before) if before is not None else None)!=expected[name]:
            raise ValueError('ภาพเปลี่ยนระหว่างเตรียมสำรอง: '+name)
        if before is not None:(folder/str(i)).write_bytes(before)
        manifest['files'].append(dict(path=name,backup=str(i),before=digest(before) if before is not None else None,after=digest(content)))
    journal=folder/'manifest.json';write_atomic(journal,json.dumps(manifest).encode())
    try:
        for i,item in enumerate(manifest['files']):
            path=safe_target(root,item['path'])
            current=digest(path.read_bytes()) if path.exists() else None
            if current!=item['before']:raise ValueError('ไฟล์เปลี่ยนระหว่างส่งออก: '+item['path'])
            progress(75+int(24*i/len(changes)),'บันทึก '+item['path'])
            write_atomic(path,changes[item['path']])
        manifest['state']='committed';write_atomic(journal,json.dumps(manifest).encode())
    except Exception:
        progress(99,'กำลังคืนภาพก่อนเริ่มชุดนี้')
        recover_images(root)
        raise
    return batch
