"""Source-preserving, offline vocabulary editing and reversible batch commits."""
import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from vocab_prompt_builder import FILES, TOKEN, senses

KNOWN = {'word', 'meaning', 'sentense', 'sentence', 'translate', 'imageId',
         'imageExtension', 'displayWord', 'sentenceAnswer',
         'sentenceOccurrence', 'sentenceAcceptedAnswers'}
REMOVE = object()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def objects(source):
    depth = 0
    for match in TOKEN.finditer(source):
        token = match.group()
        if token == '{':
            if depth == 0:
                start = match.start()
            depth += 1
        elif token == '}':
            depth -= 1
            if depth == 0:
                yield start, match.end(), source[start:match.end()]
    if depth:
        raise ValueError('วงเล็บข้อมูลไม่ครบ')


def properties(raw):
    tokens = [m for m in TOKEN.finditer(raw) if not m.group().startswith(('//', '/*'))]
    fields, data = {}, {}
    depth, begin = 0, 1
    for i in range(1, len(tokens)):
        value = tokens[i].group()
        if depth == 0 and value in {',', '}'}:
            part = tokens[begin:i]
            if part:
                if len(part) < 3 or part[1].group() != ':':
                    raise ValueError('รูปแบบ property ไม่รองรับ')
                key = part[0].group().strip('\"\'')
                if key in fields:
                    raise ValueError(f'property ซ้ำ: {key}')
                fields[key] = (part[0].start(), part[-1].end(), part[2].start(), part[-1].end())
                if key in KNOWN:
                    literal = raw[part[2].start():part[-1].end()]
                    try:
                        data[key] = json.loads(literal)
                    except json.JSONDecodeError:
                        data[key] = ast.literal_eval(literal)
            begin = i + 1
        if value in {'[', '{', '('}:
            depth += 1
        elif value in {']', '}', ')'}:
            depth -= 1
    return fields, data


def patch_object(raw, changes):
    # Remove obsolete answer metadata when the sentence is edited but not reviewed.
    for key, value in changes.items():
        if value is not REMOVE:
            continue
        if key not in {'sentenceAnswer', 'sentenceOccurrence', 'sentenceAcceptedAnswers'}:
            raise ValueError('ไม่อนุญาตลบฟิลด์นี้')
        fields, _ = properties(raw)
        keys = list(fields)
        if key in fields:
            i = keys.index(key)
            start, end, _, _ = fields[key]
            if i + 1 < len(keys):
                end = fields[keys[i + 1]][0]
            elif i:
                start = fields[keys[i - 1]][1]
            raw = raw[:start] + raw[end:]
    fields, data = properties(raw)
    edits, extra = [], []
    for key, value in changes.items():
        if value is REMOVE:
            continue
        if key not in KNOWN:
            raise ValueError(f'ไม่อนุญาตแก้ {key}')
        if key in data and data[key] == value:
            continue
        encoded = json.dumps(value, ensure_ascii=False)
        if key in fields:
            _, _, start, end = fields[key]
            edits.append((start, end, encoded))
        else:
            extra.append(f'{key}: {encoded}')
    for start, end, value in sorted(edits, reverse=True):
        raw = raw[:start] + value + raw[end:]
    if extra:
        # Append without reformatting existing properties or dropping unknown fields.
        body = raw[:-1].rstrip()
        raw = body + ('' if body.endswith(('{', ',')) else ',') + ' ' + ', '.join(extra) + ' }'
    return raw


def positions(sentence, answer, english=False):
    if not answer:
        return []
    found = [m.start() for m in re.finditer('(?=' + re.escape(answer) + ')', sentence)]
    if english:
        found = [p for p in found if (p == 0 or not sentence[p - 1].isalnum())
                 and (p + len(answer) == len(sentence) or not sentence[p + len(answer)].isalnum())]
    return found


def parse_map(text):
    rows, seen = [], set()
    for line in text.splitlines():
        if not line.lstrip().startswith('|'):
            continue
        cells = [s.strip().replace('\\|', '|') for s in re.split(r'(?<!\\)\|', line.strip())[1:-1]]
        if not cells or not re.fullmatch(r'`?\d{4,}\.(?:webp|png)`?', cells[0]):
            continue
        if len(cells) != 4:
            raise ValueError('ตารางต้องมี Image / Korean / English / Thai')
        filename = cells[0].strip('`')
        image_id, extension = filename.rsplit('.', 1)
        if image_id in seen:
            raise ValueError(f'ID ซ้ำในตาราง: {image_id}')
        seen.add(image_id)
        if not cells[3]:
            raise ValueError(f'{image_id}: ไม่มีความหมายไทย')
        rows.append(dict(image_id=image_id, extension=extension, ko=cells[1], en=cells[2], meaning=cells[3]))
    if not rows:
        raise ValueError('ไม่พบแถวภาพในตาราง')
    return rows


class Repository:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.original = {name: (self.root / name).read_bytes() for name in FILES.values()}
        self.queue_path = 'VocabularyStudio/data/review_queue.json'
        self.queue_bytes = self.read_optional(self.queue_path)
        self.pending_bytes = self.read_optional('VocabularyStudio/data/pending_images.json')
        self.records = {}
        for level, name in FILES.items():
            source = self.original[name].decode('utf-8-sig')
            for start, end, raw in objects(source):
                fields, data = properties(raw)
                if not isinstance(data.get('word'), str) or not isinstance(data.get('meaning'), str):
                    continue
                record = dict(level=level, file=name, start=start, end=end, raw=raw, data=data)
                self.records.setdefault((level, data['word']), []).append(record)

    def read_optional(self, name):
        path = self.root / name
        return path.read_bytes() if path.exists() else None

    def unique(self, level, word):
        hits = self.records.get((level, word), [])
        if len(hits) != 1:
            raise ValueError(f'{level}:{word}: พบ {len(hits)} รายการ ต้องตรวจเอง')
        return hits[0]

    def entry_data(self, entry):
        if entry.get('is_new'):
            return {'word': entry['word'], 'meaning': entry['source_meaning']}
        return self.unique(entry['level'], entry.get('original_word', entry['word']))['data']

    def ensure_current(self):
        for name, original in self.original.items():
            if self.read_optional(name) != original:
                raise ValueError(f'{name} ถูกแก้จากภายนอก กรุณาโหลดชุดใหม่ก่อนบันทึก')
        if self.read_optional('VocabularyStudio/data/pending_images.json') != self.pending_bytes:
            raise ValueError('ชุดภาพค้างเปลี่ยนแล้ว กรุณาเปิดใหม่')
        if self.read_optional(self.queue_path) != self.queue_bytes:
            raise ValueError('คิวงานภาษาเปลี่ยนแล้ว กรุณาโหลดชุดใหม่')

    def prepare(self, maps, default_level='topik1'):
        prepared = []
        for row in maps:
            bindings = []
            for cell, prefix in ((row['ko'], 'topik'), (row['en'], 'english_')):
                for label in filter(None, (s.strip() for s in cell.split(';'))):
                    if ':' in label and label.split(':', 1)[0] in FILES:
                        level, word = label.split(':', 1)
                        self.unique(level, word)
                    else:
                        word = label
                        hits = [key for key in self.records if key[0].startswith(prefix) and key[1] == word]
                        if (default_level, word) in hits:
                            level = default_level
                        elif len(hits) == 1:
                            level = hits[0][0]
                        else:
                            raise ValueError(f'{word}: ไม่พบคำหรือพบหลายระดับ โปรดระบุ level:word ในตาราง')
                    if (level, word) not in bindings:
                        bindings.append((level, word))
            if not bindings:
                raise ValueError(f"{row['image_id']}: ไม่มีคำที่ระบุในตาราง")
            for level, word in bindings:
                entry = dict(row, level=level, word=word)
                data = self.unique(level, word)['data']
                sentence = data.get('sentense') or data.get('sentence') or ''
                answer = data.get('sentenceAnswer', '')
                confirmed = bool(answer and sentence and data.get('translate'))
                if not answer:
                    proposal = data.get('displayWord') or word
                    if len(positions(sentence, proposal, level.startswith('english'))) == 1:
                        answer = proposal
                entry.update(original_word=word, meaning=data['meaning'], sentence=sentence, translate=data.get('translate', ''), answer=answer, occurrence=data.get('sentenceOccurrence', 1),
                             confirmed=confirmed, sense_confirmed=False)
                prepared.append(entry)
        return prepared

    def candidates(self, entry):
        desired = senses(entry['meaning'])
        if not hasattr(self,'sense_index'):
            self.sense_index={}
            for (level,word),hits in self.records.items():
                if len(hits)==1:
                    for meaning in senses(hits[0]['data']['meaning']):
                        self.sense_index.setdefault(meaning,[]).append((level,word,hits[0]['data']['meaning']))
        return sorted({item for meaning in desired for item in self.sense_index.get(meaning,[]) if item[:2]!=(entry['level'],entry['word'])})

    def plan(self, entries, assets=None):
        self.ensure_current()
        assets = assets or {}
        changes, queue, bindings = {}, {}, set()
        existing_queue = json.loads(self.queue_bytes or b'[]')
        queue.update((item['key'], item) for item in existing_queue)
        per_file, additions = {}, {}
        image_senses = {}
        source_bindings=set()
        for entry in entries:
            level, word = entry['level'], entry['word'].strip()
            original_word = entry.get('original_word', word)
            identity=(level,original_word)
            if identity in source_bindings:raise ValueError('รายการต้นฉบับซ้ำในชุด')
            source_bindings.add(identity)
            if word != original_word and any(l == level and w.casefold() == word.casefold() for l, w in self.records):
                raise ValueError(f'{level}:{word}: มีคำนี้ในคลังแล้ว ไม่เขียนทับ')
            if (level, word) in bindings:
                raise ValueError(f'รายการซ้ำในชุด: {level}:{word}')
            bindings.add((level, word))
            if level not in FILES or not isinstance(word, str) or not word.strip():
                raise ValueError('ระดับ/คำศัพท์ไม่ถูกต้อง')
            is_new = bool(entry.get('is_new'))
            if is_new and (level, word) in self.records:
                raise ValueError(f'{level}:{word}: มีคำนี้แล้ว ให้ใช้รายการเดิม')
            if is_new:
                if not entry.get('sense_confirmed'):
                    raise ValueError(f'{word}: ตรวจยืนยันความหมายของคำใหม่ก่อนบันทึก หรือเอารายการนี้ออก')
                if not isinstance(entry.get('source_meaning'), str) or not entry['source_meaning'].strip():
                    raise ValueError(f'{word}: ต้องมีคำแปลของคำใหม่')
                data = self.entry_data(entry)
                record = {'file': FILES[level], 'raw': json.dumps(data, ensure_ascii=False)}
            else:
                record = self.unique(level, original_word)
                data = record['data']
            image_id, extension = entry['image_id'], entry['extension']
            if not re.fullmatch(r'\d{4,}', image_id) or extension not in {'webp', 'png'}:
                raise ValueError('ID/นามสกุลไม่ถูกต้อง')
            meaning = entry['meaning'].strip()
            if not meaning:
                raise ValueError(f'{word}: ต้องระบุความหมายภาพ')
            signature = extension
            if image_id in image_senses and image_senses[image_id] != signature:
                raise ValueError(f'{image_id}: ภาพร่วมต้องใช้นามสกุลเดียวกัน')
            image_senses[image_id] = signature
            if data.get('imageId') and data['imageId'] != image_id:
                raise ValueError(f"{word}: มี ID {data['imageId']} อยู่แล้ว ไม่เขียนทับ")
            image_name = f'visual/images/{image_id}.{extension}'
            old_image = self.read_optional(image_name)
            new_image = assets.get(image_name)
            if new_image is not None and old_image is not None and new_image != old_image:
                raise ValueError(f'{image_name}: มีภาพอื่นอยู่แล้ว ไม่เขียนทับ')
            if old_image is None and new_image is None:
                raise ValueError(f'ไม่พบไฟล์ {image_name}')
            if old_image is None:
                changes[image_name] = new_image
            update = {'imageId': image_id}
            if extension != 'webp' or 'imageExtension' in data:
                update['imageExtension'] = extension
            reasons = []
            if not entry.get('sense_confirmed'):
                reasons.append('review_image_sense')
                # Do not activate an unconfirmed sense: preserve metadata and queue it.
                update = {}
            update.update(word=word, meaning=meaning)
            if original_word != word:
                queue.pop(f'{level}:{original_word}', None)
            original_sentence = data.get('sentense') or data.get('sentence') or ''
            sentence = entry.get('sentence', original_sentence).strip()
            translation = entry.get('translate', data.get('translate', '')).strip()
            language_changed = sentence != original_sentence or translation != data.get('translate', '')
            if sentence != original_sentence:
                if 'sentense' in data and 'sentence' in data:
                    update['sentense'] = sentence
                    update['sentence'] = sentence
                else:
                    update['sentense' if 'sentense' in data else 'sentence'] = sentence
            if translation != data.get('translate', ''):
                update['translate'] = translation
            if language_changed:
                for field in ('sentenceAnswer', 'sentenceOccurrence', 'sentenceAcceptedAnswers'):
                    update[field] = REMOVE
            answer = entry.get('answer', '').strip()
            if not sentence:
                reasons.append('missing_sentence')
            if not translation:
                reasons.append('missing_translation')
            if entry.get('confirmed'):
                if not sentence or not translation or not answer:
                    raise ValueError(f'{word}: ยืนยันคำตอบได้เมื่อประโยค คำแปล และคำตอบครบ')
                places = positions(sentence, answer, level.startswith('english'))
                occurrence = int(entry.get('occurrence') or 1)
                if occurrence < 1 or occurrence > len(places):
                    raise ValueError(f'{word}: คำตอบ/ตำแหน่งไม่ตรงประโยค')
                # Catalog occurrence counts raw substrings, including embedded matches.
                raw_places = positions(sentence, answer)
                actual_occurrence = raw_places.index(places[occurrence - 1]) + 1
                update['sentenceAnswer'] = answer
                if len(raw_places) > 1 or 'sentenceOccurrence' in data:
                    update['sentenceOccurrence'] = actual_occurrence
                if data.get('sentenceAnswer') != answer:
                    update['sentenceAcceptedAnswers'] = REMOVE
            else:
                reasons.append('review_sentence_answer')
            opposite = 'english_' if level.startswith('topik') else 'topik'
            if not any(e['image_id'] == image_id and e['level'].startswith(opposite)
                       and e.get('sense_confirmed') for e in entries):
                # Previously linked counterparts count too.
                if not any(l.startswith(opposite) and r['data'].get('imageId') == image_id
                           for (l, _), rs in self.records.items() for r in rs):
                    reasons.append('review_cross_language_match_or_new_word')
            key = f'{level}:{word}'
            if reasons:
                queue[key] = dict(key=key, level=level, word=word, imageId=image_id, imageExtension=extension,
                                  meaning=meaning, reasons=reasons, sentence=sentence,
                                  translate=translation, proposedAnswer=answer)
            else:
                queue.pop(key, None)
            raw = patch_object(record['raw'], update)
            if is_new:
                additions.setdefault(record['file'], []).append(raw)
            elif raw != record['raw']:
                per_file.setdefault(record['file'], []).append((record['start'], record['end'], raw))
        for name in set(per_file) | set(additions):
            edits = per_file.get(name, [])
            original = self.original[name]
            source = original.decode('utf-8-sig')
            for start, end, raw in sorted(edits, reverse=True):
                source = source[:start] + raw + source[end:]
            if name in additions:
                tokens = [m for m in TOKEN.finditer(source) if not m.group().startswith(('//', '/*'))]
                closing = next((i for i in range(len(tokens) - 1, -1, -1) if tokens[i].group() == ']'), None)
                if closing is None:
                    raise ValueError('ไม่พบจุดเพิ่มคำในคลัง')
                end = tokens[closing].start()
                comma = '' if tokens[closing - 1].group() in {',', '['} else ','
                newline = '\r\n' if '\r\n' in source else '\n'
                source = source[:end] + comma + newline + (',' + newline).join('  ' + raw for raw in additions[name]) + newline + source[end:]
            changes[name] = (b'\xef\xbb\xbf' if original.startswith(b'\xef\xbb\xbf') else b'') + source.encode('utf-8')
        linked = {(level, r['data'].get('imageId')) for (level, _), rs in self.records.items() for r in rs if r['data'].get('imageId')}
        linked.update((e['level'], e['image_id']) for e in entries if e.get('sense_confirmed'))
        for key, item in list(queue.items()):
            opposite = 'english_' if item['level'].startswith('topik') else 'topik'
            if any(level.startswith(opposite) and image_id == item['imageId'] for level, image_id in linked):
                item['reasons'] = [reason for reason in item['reasons'] if reason != 'review_cross_language_match_or_new_word']
            if not item['reasons']:
                del queue[key]
        queue_data = (json.dumps(list(queue.values()), ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        if queue_data != self.queue_bytes:
            changes[self.queue_path] = queue_data
        return changes, list(queue.values())

    def validate(self, changes):
        node = shutil.which('node')
        if not node:
            raise ValueError('ต้องมี Node.js เพื่อเช็กข้อมูลก่อนบันทึก (ยังไม่ได้แก้ไฟล์)')
        with tempfile.TemporaryDirectory(prefix='vocab-check-') as folder:
            stage = Path(folder)
            for name in FILES.values():
                (stage / name).write_bytes(changes.get(name, self.original[name]))
            assets = [key for key in changes if key.startswith('visual/images/')]
            (stage / 'assets.json').write_text(json.dumps(assets), encoding='utf-8')
            result = subprocess.run([node, str(self.root / 'VocabularyStudio/app/validate-vocab-studio.cjs'), str(stage), str(self.root)],
                                    capture_output=True, text=True, encoding='utf-8', timeout=30,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode:
                raise ValueError(result.stderr or result.stdout)
            return result.stdout.strip()

    def commit(self, changes, kind='batch', progress=None):
        report = progress or (lambda value, message: None)
        report(5, 'ตรวจข้อมูลก่อนบันทึก')
        latest_path = self.root / 'VocabularyStudio/data/latest.json'
        if latest_path.exists():
            latest = json.loads(latest_path.read_text())['folder']
            if not re.fullmatch('[a-f0-9]{32}', latest):
                raise ValueError('ข้อมูล backup ล่าสุดไม่ถูกต้อง')
            journal = self.root / 'VocabularyStudio/data/backups' / latest / 'manifest.json'
            if json.loads(journal.read_text())['state'] == 'prepared':
                raise ValueError('พบชุดที่บันทึกถูกขัดจังหวะ กรุณากดย้อนกลับชุดล่าสุดก่อน')
        self.ensure_current()
        validation = self.validate(changes)
        self.ensure_current()
        if not changes:
            return 'ไม่มีข้อมูลเปลี่ยนแปลง', validation
        report(35, 'สำรองต้นฉบับ')
        folder = self.root / 'VocabularyStudio/data/backups' / uuid.uuid4().hex
        folder.mkdir(parents=True)
        manifest = {'state': 'prepared', 'kind': kind, 'files': []}
        for i, (name, content) in enumerate(changes.items()):
            target = safe_target(self.root, name)
            before = target.read_bytes() if target.exists() else None
            if name.startswith('visual/images/') and before is not None and before != content:
                raise ValueError(f'{name}: มีภาพเพิ่มจากภายนอกแล้ว กรุณาโหลดใหม่')
            if before is not None:
                (folder / str(i)).write_bytes(before)
            manifest['files'].append(dict(path=name, backup=str(i), before=digest(before) if before is not None else None, after=digest(content)))
        journal = folder / 'manifest.json'
        write_atomic(journal, json.dumps(manifest).encode())
        write_atomic(self.root / 'VocabularyStudio/data/latest.json', json.dumps({'folder': folder.name}).encode())
        written = []
        try:
            for index, item in enumerate(manifest['files']):
                report(50 + int(40 * index / len(manifest['files'])), 'บันทึก ' + item['path'])
                target = safe_target(self.root, item['path'])
                before = target.read_bytes() if target.exists() else None
                if (digest(before) if before is not None else None) != item['before']:
                    raise ValueError(f"ไฟล์เปลี่ยนระหว่างบันทึก: {item['path']}")
                write_atomic(target, changes[item['path']]);written.append(item)
            manifest['state'] = 'committed'
            write_atomic(journal, json.dumps(manifest).encode())
        except Exception:
            report(90, 'เกิดข้อผิดพลาด กำลังคืนข้อมูลเดิม')
            for item in reversed(written):
                restore_file(self.root, folder, item)
            manifest['state'] = 'rolled_back'
            write_atomic(journal, json.dumps(manifest).encode())
            raise
        report(95, 'บันทึกไฟล์ครบแล้ว')
        return folder.name, validation


def safe_target(root, name):
    allowed = name in FILES.values() or name in {'VocabularyStudio/data/review_queue.json', 'VocabularyStudio/data/pending_images.json'} or re.fullmatch(r'visual/images/\d{4,}\.(webp|png)', name)
    path = (root / name).resolve()
    if not allowed or not path.is_relative_to(root.resolve()):
        raise ValueError('ตำแหน่งไฟล์ไม่ปลอดภัย')
    return path


def write_atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_bytes(content)
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def restore_file(root, folder, item):
    target = safe_target(root, item['path'])
    if item['before'] is None:
        target.unlink(missing_ok=True)
    else:
        content = (folder / item['backup']).read_bytes()
        if digest(content) != item['before']:
            raise ValueError('สำเนาสำรองไม่ตรง checksum')
        write_atomic(target, content)


def undo_latest(root):
    root = Path(root).resolve()
    latest = json.loads((root / 'VocabularyStudio/data/latest.json').read_text())['folder']
    if not re.fullmatch('[a-f0-9]{32}', latest):
        raise ValueError('ข้อมูล backup ไม่ถูกต้อง')
    folder = root / 'VocabularyStudio/data/backups' / latest
    journal = folder / 'manifest.json'
    manifest = json.loads(journal.read_text())
    if manifest['state'] not in {'committed', 'prepared'}:
        raise ValueError('ชุดล่าสุดถูกย้อนกลับแล้ว')
    restore = []
    for item in manifest['files']:
        path = safe_target(root, item['path'])
        current = digest(path.read_bytes()) if path.exists() else None
        if current == item['before'] and manifest['state'] == 'prepared':
            continue
        if current != item['after']:
            raise ValueError(f"{item['path']} เปลี่ยนหลังบันทึก ไม่ย้อนทับงานใหม่")
        if item['before'] is not None:
            if not re.fullmatch(r'\d+', item['backup']) or digest((folder / item['backup']).read_bytes()) != item['before']:
                raise ValueError('สำเนาสำรองไม่ถูกต้อง')
        restore.append(item)
    for item in reversed(restore):
        restore_file(root, folder, item)
    manifest['state'] = 'undone'
    write_atomic(journal, json.dumps(manifest).encode())
