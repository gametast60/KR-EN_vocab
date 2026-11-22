"""Local vocabulary-to-Gemini helper. No network, AI calls or source-file writes."""
import ast
import json
import re
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox

ROOT = Path(__file__).resolve().parents[2]
FILES = {
    'topik1': 'flashcard1.js', 'topik2': 'flashcard2.js',
    'english_a1': 'flashcard_en_a1.js', 'english_a2': 'flashcard_en_a2.js',
    'english_b1': 'flashcard_en_b1.js', 'english_b2': 'flashcard_en_b2.js',
}
# Tokenize strings before comments so // or braces inside sentences remain data.
TOKEN = re.compile(r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|//[^\n]*|/\*[\s\S]*?\*/|[{}]|[A-Za-z_$][\w$]*|[:]|[^\s]''')
FIELDS = {'word', 'meaning', 'sentence', 'sentense', 'translate', 'imageId'}


def parse_entries(source, strict=True):
    tokens = [m.group() for m in TOKEN.finditer(source)
              if not m.group().startswith(('//', '/*'))]
    result, block, depth = [], [], 0
    for token in tokens:
        if token == '{':
            depth += 1
            if depth == 1:
                block = []
                continue
        if token == '}':
            depth -= 1
            if depth < 0:
                raise ValueError('วงเล็บปีกกาไม่ครบ')
            if depth == 0:
                entry = {}
                for i in range(len(block) - 2):
                    key = block[i].strip('\"\'')
                    if key in FIELDS and block[i + 1] == ':':
                        value = block[i + 2]
                        if not value.startswith(('"', "'")):
                            raise ValueError(f'{key} ต้องเป็นข้อความในเครื่องหมายคำพูด')
                        if key in entry:
                            raise ValueError(f'ฟิลด์ {key} ซ้ำในรายการเดียวกัน')
                        entry[key] = json.loads(value) if value.startswith('"') else ast.literal_eval(value)
                if entry.get('word') and entry.get('meaning'):
                    result.append(entry)
                elif strict:
                    raise ValueError('ทุกรายการต้องมี word และ meaning ที่ไม่ว่าง')
                continue
        if depth:
            if depth > 1:
                raise ValueError('รองรับรายการคำศัพท์แบบ object ชั้นเดียวเท่านั้น')
            block.append(token)
    if depth:
        raise ValueError('โค้ดถูกตัดกลางรายการ: กรุณาคัดลอกให้ครบถึง }')
    if not result and strict:
        raise ValueError('ไม่พบรายการ { word: "...", meaning: "..." }')
    return result


def senses(value):
    return {re.sub(r'[\s.…]+', '', s).casefold() for s in re.split(r'[,，;/、\n]', value)
            if re.sub(r'[\s.…]+', '', s)}


def load_catalog():
    return {level: parse_entries((ROOT / name).read_text(encoding='utf-8-sig'), False)
            for level, name in FILES.items()}


def candidates(entries, catalog):
    index = {}
    for level, words in catalog.items():
        if level.startswith('english_'):
            for word in words:
                for sense in senses(word['meaning']):
                    index.setdefault(sense, []).append((level, word['word'], word['meaning']))
    lines = ['คำอังกฤษที่อาจตรงกันจากคำแปลไทย — ไม่ใช่ผลยืนยันความหมาย',
             'ไม่พบ = คำแปลไม่ตรงตัว ไม่ได้แปลว่าไม่มีคำนี้ในคลัง', '']
    for entry in entries:
        matches = sorted({hit for sense in senses(entry['meaning'])
                          for hit in index.get(sense, [])})
        lines.append(f"{entry['word']} / {entry['meaning']}")
        lines.extend(f'  {level}:{word} / {meaning}' for level, word, meaning in matches)
        if not matches:
            lines.append('  ไม่พบคำแปลไทยตรงตัว — เก็บไว้ตรวจภาษาภายหลัง')
    return '\n'.join(lines)


def make_outputs(entries):
    n = len(entries)
    if not n or n % 5:
        raise ValueError(f'มี {n} คำ: ตาราง 5 คอลัมน์ต้องใช้ 5, 10, 15, 20, 25 … คำ กรุณาปรับจำนวน ไม่เพิ่มช่องว่างหรือคำซ้ำ')
    words = [e['word'] for e in entries]
    if len(set(words)) != n:
        raise ValueError('มี word ซ้ำในชุด กรุณาแยกตรวจความหมายก่อนสร้างภาพ')
    cutter, scenes = [], []
    for i, entry in enumerate(entries, 1):
        word = entry['word'].strip()
        meaning = (entry['meaning']).strip()
        meaning = re.sub(r'\s[—–-]\s', ', ', meaning.replace('/', ', '))
        meaning = ' '.join(meaning.split())
        # Cutter uses / and spaced dashes as delimiters. Reject ambiguous inputs.
        if any(re.search(r'/|\r|\n|\s[—–-]\s', part) for part in (word, meaning)):
            raise ValueError(f'{word}: คำ/ความหมายมีตัวคั่นของ Cutter ให้ปรับข้อความก่อน')
        line = f'{i}. {word} / {meaning}'
        cutter.append(line)
        scenes.append(line)
    template = (Path(__file__).with_name('vocab_image_prompt.txt')).read_text(encoding='utf-8')
    prompt = template.replace('{N}', str(n)).replace('{ROWS}', str(n // 5)).replace('{VOCABULARY}', '\n'.join(scenes))
    return prompt, '\n'.join(cutter)


class Builder:
    def __init__(self, root):
        self.root = root
        root.title('Vocabulary Prompt Builder — เตรียมภาพชุดใหม่')
        root.geometry('1100x780')
        self.catalog = load_catalog()
        bar = ttk.Frame(root, padding=8)
        bar.pack(fill='x')
        self.level = tk.StringVar(value='topik1')
        ttk.Combobox(bar, textvariable=self.level, values=list(FILES), state='readonly', width=14).pack(side='left')
        ttk.Button(bar, text='โหลด 25 คำที่ยังไม่มีภาพ', command=self.next_batch).pack(side='left', padx=6)
        ttk.Button(bar, text='วางโค้ดจากคลิปบอร์ด', command=self.paste).pack(side='left')
        ttk.Button(bar, text='สร้างพรอมป์ต์', command=self.build).pack(side='left', padx=6)
        self.status = tk.StringVar(value='วางโค้ด หรือโหลดจากคลัง → สร้างพรอมป์ต์ → คัดลอกไป Gemini / Cutter')
        ttk.Label(root, textvariable=self.status, padding=8, wraplength=1050).pack(fill='x')
        self.tabs = ttk.Notebook(root)
        self.tabs.pack(fill='both', expand=True, padx=8, pady=8)
        self.texts = {}
        for name in ('โค้ดต้นฉบับ', 'พรอมป์ต์ Gemini', 'รายการ Cutter', 'อังกฤษที่อาจตรงกัน'):
            frame = ttk.Frame(self.tabs)
            self.tabs.add(frame, text=name)
            ttk.Button(frame, text='คัดลอกทั้งหมด', command=lambda key=name: self.copy(key)).pack(anchor='e', pady=5)
            text = tk.Text(frame, wrap='word', undo=True, font=('Tahoma', 11))
            scrollbar = ttk.Scrollbar(frame, command=text.yview)
            scrollbar.pack(side='right', fill='y')
            text.configure(yscrollcommand=scrollbar.set)
            text.pack(fill='both', expand=True)
            self.texts[name] = text
        ttk.Label(root, text='ไม่ใช้ AI/API • ไม่แก้คลังศัพท์ • คำอังกฤษเป็นตัวช่วยค้น • แนบภาพอ้างอิงสไตล์ใน Gemini ด้วย', padding=8).pack()

    def put(self, name, value):
        self.texts[name].delete('1.0', 'end')
        self.texts[name].insert('1.0', value)

    def clear_outputs(self):
        for name in list(self.texts)[1:]:
            self.put(name, '')

    def paste(self):
        try:
            self.put('โค้ดต้นฉบับ', self.root.clipboard_get())
            self.clear_outputs()
            self.tabs.select(0)
        except tk.TclError:
            messagebox.showerror('คลิปบอร์ด', 'ไม่มีข้อความในคลิปบอร์ด')

    def next_batch(self):
        try:
            self.catalog = load_catalog()
            entries = [e for e in self.catalog[self.level.get()] if not e.get('imageId')][:25]
            self.put('โค้ดต้นฉบับ', '\n'.join(json.dumps(e, ensure_ascii=False) + ',' for e in entries))
            self.clear_outputs()
            self.tabs.select(0)
            self.status.set(f'โหลด {len(entries)} คำตามลำดับคลัง — ตรวจรายการก่อนสร้าง; ทำชุดก่อนหน้าให้เสร็จก่อนโหลดชุดถัดไป')
        except Exception as exc:
            messagebox.showerror('โหลดคลังไม่ได้', str(exc))

    def build(self):
        self.clear_outputs()
        try:
            entries = parse_entries(self.texts['โค้ดต้นฉบับ'].get('1.0', 'end'))
            prompt, cutter = make_outputs(entries)
            self.catalog = load_catalog()
            self.put('พรอมป์ต์ Gemini', prompt)
            self.put('รายการ Cutter', cutter)
            self.put('อังกฤษที่อาจตรงกัน', candidates(entries, self.catalog))
            self.tabs.select(1)
            self.status.set(f'{len(entries)} ภาพ • 5 × {len(entries)//5} • คัดลอกพรอมป์ต์ไป Gemini แล้วใช้รายการ Cutter ชุดเดียวกัน')
        except Exception as exc:
            messagebox.showerror('ตรวจรายการ', str(exc))

    def copy(self, name):
        value = self.texts[name].get('1.0', 'end-1c')
        if not value.strip():
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(value)
        self.status.set('คัดลอกแล้ว: ' + name)


if __name__ == '__main__':
    app = tk.Tk()
    Builder(app)
    app.mainloop()
