"""One offline window: prompt, Cutter, source review, transaction and language queue."""
import importlib.util
import io
import json
import re
import zipfile
import threading
import queue
from review_cards import ReviewCards
from image_export import PENDING, pending_batch, occupied_ids, next_range, recover_images
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk
from vocab_prompt_builder import ROOT, FILES, make_outputs, parse_entries
from vocab_studio_data import Repository, parse_map, positions, undo_latest, digest, write_atomic
from vocab_language_exchange import build_request, parse_response, REASONS, shared_image_candidates
from studio_review import meaning_choices, answer_preview, saved_batches, maps_for_ids

CUTTER_PATH = ROOT / 'VocabularyStudio/app/cutter.py'
spec = importlib.util.spec_from_file_location('studio_cutter', CUTTER_PATH)
cutter_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutter_module)


class Studio:
    def __init__(self, root, workspace=ROOT):
        self.root, self.workspace = root, Path(workspace)
        recover_images(self.workspace)
        self.pending_image_id=None
        self.repo = Repository(self.workspace)
        self.entries, self.assets, self.prompt_entries = [], {}, []
        self.saving = False
        self.current = None
        root.title('Vocabulary Studio — ภาพและคลังศัพท์')
        root.geometry(f'{min(1280,root.winfo_screenwidth()-60)}x{min(880,root.winfo_screenheight()-100)}')
        self.status = tk.StringVar(value='เลือกคำ → ตัดภาพ → ตรวจตัวอย่างโจทย์ → เลือกคำที่ใช้ภาพร่วมกัน')
        ttk.Label(root, textvariable=self.status, padding=8).pack(fill='x')
        self.tabs = ttk.Notebook(root);self.tabs.pack(fill='both', expand=True)
        self.prepare_tab = ttk.Frame(self.tabs);self.cutter_tab = ttk.Frame(self.tabs)
        self.review_tab = ttk.Frame(self.tabs);self.queue_tab = ttk.Frame(self.tabs)
        for frame, label in [(self.prepare_tab,'1 เตรียมคำ / พรอมป์ต์'),(self.cutter_tab,'2 ตัดภาพ'),
                             (self.review_tab,'3 ตรวจและบันทึก'),(self.queue_tab,'4 คิวงานภาษา')]:
            self.tabs.add(frame,text=label)
        self.build_prepare()
        self.cutter = cutter_module.Cutter(root, host=self.cutter_tab, on_export=self.exported, prepare_direct=self.prepare_direct_export, on_direct=self.open_direct_batch)
        self.root.bind_class("StudioReviewScroll","<MouseWheel>",self.scroll_review)
        self.build_review()
        self.build_queue()
        self.refresh_queue()
        self.refresh_batches()
        root.bind_all('<Button-3>', self.clipboard_menu, add='+')
        root.protocol('WM_DELETE_WINDOW', self.close)
        if pending_batch(self.workspace):self.root.after_idle(lambda:self.guarded(self.resume_images))

    def guarded(self, action):
        try:
            if self.saving:raise ValueError('กำลังบันทึก กรุณารอให้เสร็จ')
            if self.cutter.busy:
                raise ValueError('กำลังตัดภาพ กรุณารอให้เสร็จ')
            action()
        except Exception as exc:
            messagebox.showerror('ตรวจข้อมูล',str(exc),parent=self.root)

    def button(self, parent, label, action):
        ttk.Button(parent,text=label,command=lambda:self.guarded(action)).pack(side='left',padx=3,pady=5)

    def build_prepare(self):
        bar=ttk.Frame(self.prepare_tab);bar.pack(fill='x')
        self.level=tk.StringVar(value='topik1')
        ttk.Combobox(bar,textvariable=self.level,values=list(FILES),state='readonly',width=14).pack(side='left',padx=5)
        self.button(bar,'โหลด 25 คำถัดไป',self.next_words)
        self.button(bar,'วางโค้ด',self.paste)
        self.button(bar,'สร้างพรอมป์ต์',self.generate)
        self.button(bar,'คัดลอกพรอมป์ต์',self.copy_prompt)
        self.button(bar,'ส่งคำไป Cutter',self.send_to_cutter)
        ttk.Label(self.prepare_tab,text='ใช้คำศัพท์และคำแปลเดิมสร้างพรอมป์ต์ • คำที่ยังไม่ผูกภาพแต่มีงานค้างจะไม่ถูกโหลดซ้ำ').pack(anchor='w',padx=8)
        panes=ttk.Panedwindow(self.prepare_tab,orient='vertical');panes.pack(fill='both',expand=True,padx=8,pady=8)
        self.code=tk.Text(panes,height=13,wrap='word',undo=True,font=('Tahoma',11))
        self.prompt=tk.Text(panes,wrap='word',font=('Tahoma',11))
        panes.add(self.code,weight=1);panes.add(self.prompt,weight=2)

    def next_words(self):
        repo=Repository(self.workspace)
        queued={x['key'] for x in json.loads(repo.queue_bytes or b'[]')}
        entries=[rs[0]['data'] for (level,word),rs in repo.records.items()
                 if level==self.level.get() and len(rs)==1 and not rs[0]['data'].get('imageId') and f'{level}:{word}' not in queued][:25]
        self.code.delete('1.0','end');self.code.insert('1.0','\n'.join(json.dumps(e,ensure_ascii=False)+',' for e in entries))
        self.prompt.delete('1.0','end');self.prompt_entries=[]
        self.status.set(f'โหลด {len(entries)} คำ • ถ้าไม่หาร 5 ลงตัว ให้จัดชุดด้วยตนเอง')

    def paste(self):
        self.code.delete('1.0','end');self.code.insert('1.0',self.root.clipboard_get())
        self.prompt.delete('1.0','end');self.prompt_entries=[]

    def generate(self):
        self.prompt_entries=parse_entries(self.code.get('1.0','end'))
        # Only existing, unique entries can be edited by this program.
        repo=Repository(self.workspace)
        for entry in self.prompt_entries:repo.unique(self.level.get(),entry['word'])
        prompt,self.cutter_list=make_outputs(self.prompt_entries)
        self.prompt.delete('1.0','end');self.prompt.insert('1.0',prompt)
        self.prompt_source=self.code.get('1.0','end');self.prompt_level=self.level.get()
        self.status.set(f'พร้อม {len(self.prompt_entries)} คำ • คัดลอกไป Gemini แล้วส่งคำชุดเดียวกันไป Cutter')

    def copy_prompt(self):
        self.generate()
        self.root.clipboard_clear();self.root.clipboard_append(self.prompt.get('1.0','end-1c'))
        self.status.set('คัดลอกพรอมป์ต์แล้ว — แนบภาพอ้างอิงสไตล์ใน Gemini ด้วย')

    def send_to_cutter(self):
        self.generate()
        self.cutter.words.delete('1.0','end');self.cutter.words.insert('1.0',self.cutter_list)
        self.cutter.columns.set(5);self.cutter.rows.set(len(self.prompt_entries)//5)
        self.cutter.start.set(self.cutter.load_start())
        self.cutter.auto_grid()
        self.cutter_entries=[dict(e) for e in self.prompt_entries];self.cutter_level=self.prompt_level
        self.tabs.select(self.cutter_tab)
        self.code.delete('1.0','end');self.prompt.delete('1.0','end')
        self.prompt_entries=[];self.cutter_list='';self.prompt_source=''
        self.level.set('topik1')

    def build_review(self):
        bar=ttk.Frame(self.review_tab);bar.pack(fill='x')
        self.button(bar,'เปิดงานภาพค้าง',self.resume_images)
        self.button(bar,'เปิดคิวค้าง',self.load_queue)
        more=ttk.Menubutton(bar,text='เพิ่มเติม ▾');more.pack(side='left',padx=5)
        menu=tk.Menu(more,tearoff=False);more.configure(menu=menu)
        for label,command in [
            ('นำเข้า ZIP เก่า',self.choose_zip),
            ('เปิดตารางนำเข้า MD',lambda:self.load_map(self.workspace/'VocabularyStudio/data/vocabulary_map.md')),
            ('เปิด MD อื่น',self.choose_map),('บันทึกแบบร่าง',self.save_draft),('เปิดแบบร่าง',self.load_draft),
            ('ดูภาพของแถวนี้',self.preview_image),('จับคู่คำในระดับอื่น',self.add_match),
            ('บันทึกแถวนี้ลงต้นฉบับ',lambda:self.save(True)),('เอาแถวนี้ออกจากชุด',self.remove_entry),
            ('ดูโค้ดก่อนบันทึก',self.code_preview),('ย้อนกลับชุดล่าสุด',self.undo)]:
            menu.add_command(label=label,command=lambda command=command:self.guarded(command))
        batchbar=ttk.Frame(self.review_tab);batchbar.pack(fill='x')
        ttk.Label(batchbar,text='ชุดที่บันทึก:').pack(side='left',padx=5)
        self.batch_var=tk.StringVar()
        self.batch_picker=ttk.Combobox(batchbar,textvariable=self.batch_var,state='readonly',width=28);self.batch_picker.pack(side='left')
        self.button(batchbar,'เปิดชุดที่เลือก',self.load_saved_batch)
        self.batch_summary=tk.StringVar(value='ยังไม่เปิดชุดงาน')
        self.batch_range=tk.StringVar(value='ยังไม่เปิดชุดงาน')
        ttk.Label(batchbar,textvariable=self.batch_range).pack(side='left',padx=10)
        badges=ttk.Frame(self.review_tab);badges.pack(fill='x',padx=8,pady=5)
        self.count_badges={}
        for key,title,bg,fg in [('missing','ยังไม่มีคำตอบ','#ffe0e0','#9b1c1c'),('waiting','รอตรวจ','#fff0bf','#775500'),('ready','คำตอบพร้อม','#dcf4e3','#17633b')]:
            label=tk.Label(badges,text=title+' 0 ข้อ',background=bg,foreground=fg,font=('Tahoma',12,'bold'),padx=14,pady=7)
            label.pack(side='left',padx=(0,8));self.count_badges[key]=label
        self.tree=ReviewCards(self.review_tab,self)
        self.tree.pack(fill='both',expand=True,padx=8)
        self.tree.bind('<<TreeviewSelect>>',self.selected)
        editor=ttk.Frame(self.review_tab,padding=8);editor.pack(fill='x')
        self.word=tk.StringVar();self.meaning=tk.StringVar();self.answer=tk.StringVar();self.occurrence=tk.StringVar(value='1')
        self.sense_ok=tk.BooleanVar();self.answer_ok=tk.BooleanVar()
        ttk.Label(editor,text='ความหมาย').grid(row=1,column=0,sticky='w')
        self.meaning_picker=ttk.Entry(editor,textvariable=self.meaning)
        self.meaning_picker.grid(row=1,column=1,sticky='ew')
        ttk.Checkbutton(editor,text='ยืนยันว่าภาพตรงกับคำนี้',variable=self.sense_ok).grid(row=1,column=2,sticky='w')
        self.sentence=tk.Text(editor,height=2,wrap='word',font=('Tahoma',12),exportselection=False,undo=True)
        self.sentence.grid(row=2,column=0,columnspan=3,sticky='ew',pady=5)
        self.translation=tk.StringVar()
        ttk.Label(editor,text='คำแปลประโยค').grid(row=3,column=0,sticky='w')
        ttk.Entry(editor,textvariable=self.translation).grid(row=3,column=1,columnspan=2,sticky='ew')
        self.loading_editor=False
        self.sentence.bind('<<Modified>>',self.sentence_modified)
        self.translation.trace_add('write',self.translation_modified)
        ttk.Label(editor,text='คำตอบในประโยค').grid(row=4,column=0,sticky='w')
        ttk.Entry(editor,textvariable=self.answer,width=40).grid(row=4,column=1,sticky='ew')
        ttk.Checkbutton(editor,text='ยืนยันคำตอบและคำแปล',variable=self.answer_ok).grid(row=4,column=2,sticky='w')
        ttk.Label(editor,text='คำตอบครั้งที่').grid(row=5,column=0,sticky='w')
        ttk.Spinbox(editor,from_=1,to=99,textvariable=self.occurrence,width=6).grid(row=5,column=1,sticky='w')
        ttk.Button(editor,text='ใช้ข้อความที่เลือกเป็นคำตอบ',command=lambda:self.guarded(self.use_selection)).grid(row=5,column=2,sticky='w')
        self.preview_text=tk.StringVar();self.answer_hint=tk.StringVar()
        ttk.Label(editor,textvariable=self.preview_text,font=('Tahoma',11),wraplength=900).grid(row=6,column=0,columnspan=3,sticky='w',pady=(5,0))
        ttk.Label(editor,textvariable=self.answer_hint,foreground='#9a4b00',wraplength=900).grid(row=7,column=0,columnspan=3,sticky='w')
        self.answer_ok.trace_add('write',lambda *args:self.update_summary() if not self.loading_editor else None)
        self.answer.trace_add('write',self.answer_changed)
        self.occurrence.trace_add('write',self.answer_changed)
        self.meaning.trace_add('write',self.meaning_changed)
        ttk.Label(editor,text='คำศัพท์').grid(row=0,column=0,sticky='w')
        ttk.Entry(editor,textvariable=self.word).grid(row=0,column=1,sticky='ew')
        self.word.trace_add('write',self.word_changed)
        editor.columnconfigure(1,weight=1)
        actions=ttk.Frame(self.review_tab);actions.pack(fill='x')
        self.button(actions,'1. ยืนยันภาพทั้งชุด',self.confirm_senses)
        self.button(actions,'2. ยืนยันคำตอบที่กรอกแล้ว',self.confirm_answers)
        self.button(actions,'3. ตรวจและบันทึกชุดนี้',self.save)
        ttk.Label(self.review_tab,text='คำตอบว่าง: ลากเลือกในประโยค → ใช้ข้อความที่เลือกเป็นคำตอบ → ยืนยันคำตอบ • คลิกขวาเพื่อคัดลอก/วาง').pack(anchor='w',padx=8,pady=5)

    def set_batch(self, maps, assets=None):
        self.pending_image_id=None
        repo=Repository(self.workspace)
        entries=repo.prepare(maps,self.level.get())
        self.repo,self.entries,self.assets=repo,entries,assets or {}
        self.current=None;self.render();self.tabs.select(self.review_tab)
        self.status.set(f'โหลด {len(entries)} รายการแล้ว • ตรวจความหมาย/คำตอบ หรือพักไว้ในคิว')

    def load_map(self,path):
        self.set_batch(parse_map(Path(path).read_text(encoding='utf-8-sig')))

    def choose_map(self):
        path=filedialog.askopenfilename(filetypes=[('Markdown','*.md')])
        if path:self.load_map(path)

    def choose_zip(self):
        path=filedialog.askopenfilename(filetypes=[('Cutter ZIP','*.zip')])
        if path:self.load_zip(path)

    def load_zip(self,path,from_cutter=False):
        with zipfile.ZipFile(path) as archive:
            names=archive.namelist()
            if len(names)!=len(set(names)):raise ValueError('ZIP มีชื่อไฟล์ซ้ำ')
            map_info=archive.getinfo('vocabulary_map.md')
            if map_info.file_size>2_000_000:raise ValueError('ตารางใหญ่เกินไป')
            maps=parse_map(archive.read(map_info).decode('utf-8-sig'))
            if from_cutter and getattr(self,'cutter_entries',None):
                expected=[e['word'] for e in self.cutter_entries]
                actual=[r['ko'] or r['en'] for r in maps]
                if actual!=expected:raise ValueError('ลำดับคำใน Cutter ไม่ตรงชุดพรอมป์ต์ กรุณานำเข้า ZIP และตรวจเอง')
                for row,entry in zip(maps,self.cutter_entries):
                    field='ko' if self.cutter_level.startswith('topik') else 'en'
                    row[field]=self.cutter_level+':'+entry['word']
            assets={}
            for row in maps:
                name=f"{row['image_id']}.{row['extension']}"
                info=archive.getinfo(name)
                if info.file_size>20_000_000:raise ValueError('ไฟล์ภาพใหญ่เกินไป')
                content=archive.read(info)
                with Image.open(io.BytesIO(content)) as im:
                    if im.format != ('WEBP' if row['extension']=='webp' else 'PNG'):raise ValueError('นามสกุลไม่ตรงชนิดภาพ')
                    im.verify()
                assets['visual/images/'+name]=content
        self.set_batch(maps,assets)

    def choose_next_step(self,count):
        panel=tk.Toplevel(self.root);panel.title('บันทึกสำเร็จ — ทำอะไรต่อ?');panel.transient(self.root)
        ttk.Label(panel,text='บันทึกและรีเซ็ตหน้า 3 เรียบร้อยแล้ว',padding=20,font=('Tahoma',12)).pack()
        def go(tab):
            self.tabs.select(tab);panel.destroy()
        row=ttk.Frame(panel,padding=15);row.pack()
        ttk.Button(row,text='เริ่มชุดใหม่ → หน้า 1',command=lambda:go(self.prepare_tab)).pack(side='left',padx=8)
        ttk.Button(row,text=f'ทำคิวงานต่อ → หน้า 4 ({count} งานค้าง)',command=lambda:go(self.queue_tab)).pack(side='left',padx=8)
        panel.update_idletasks()
        panel.geometry(f'+{self.root.winfo_rootx()+max(0,(self.root.winfo_width()-panel.winfo_width())//2)}+{self.root.winfo_rooty()+max(0,(self.root.winfo_height()-panel.winfo_height())//2)}')
        panel.grab_set()

    def check_batch_images(self,batch):
        from vocab_studio_data import safe_target
        for name,expected in batch['images'].items():
            path=safe_target(self.workspace,name)
            if not path.exists() or digest(path.read_bytes())!=expected:
                raise ValueError('ภาพของชุดงานหายหรือเปลี่ยน: '+name)

    def resume_images(self):
        batch=pending_batch(self.workspace)
        if not batch:raise ValueError('ไม่มีชุดภาพรอตรวจ')
        self.open_direct_batch(batch)

    def open_direct_batch(self,batch):
        self.check_batch_images(batch)
        repo=Repository(self.workspace)
        for entry in batch['entries']:
            current=repo.entry_data(entry)
            if entry.get('source_snapshot',current)!=current:
                raise ValueError('คำต้นฉบับเปลี่ยนหลังส่งภาพ: '+entry['word']+' กรุณาตรวจงานค้างก่อนเขียนทับ')
        self.repo=repo;self.entries=[dict(e) for e in batch['entries']];self.assets={};self.current=None
        self.pending_image_id=batch['id'];self.cutter_entries=[]
        self.render();self.tabs.select(self.review_tab)
        self.status.set(f"ภาพลงคลังแล้ว {len(batch['images'])} ภาพ • ตรวจคำศัพท์แล้วบันทึก • เปิดงานค้างต่อได้หากปิดโปรแกรม")

    def prepare_direct_export(self,words,first,width):
        if pending_batch(self.workspace):raise ValueError('มีชุดภาพรอตรวจอยู่ เปิดงานภาพค้างในหน้า 3 และบันทึกให้เสร็จก่อน')
        if self.entries:raise ValueError('หน้า 3 ยังมีชุดที่กำลังตรวจ กรุณาบันทึกให้เสร็จก่อนส่งภาพชุดใหม่')
        repo=Repository(self.workspace);used=occupied_ids(repo)
        ids=[str(first+i).zfill(max(4,width)) for i in range(len(words))]
        original_images={i:digest((self.workspace/f'visual/images/{i}.webp').read_bytes()) if (self.workspace/f'visual/images/{i}.webp').exists() else None for i in ids}
        collisions=[i for i in ids if int(i) in used]
        if collisions:
            ids=self.resolve_image_conflicts(repo,ids,collisions)
            if ids is None:return None
        maps=[dict(image_id=image_id,extension='webp',ko=ko,en=en,meaning=meaning) for image_id,(ko,en,meaning) in zip(ids,words)]
        if getattr(self,'cutter_entries',None):
            if [ko or en for ko,en,_ in words]!=[e['word'] for e in self.cutter_entries]:
                raise ValueError('รายการใน Cutter ไม่ตรงกับชุดที่ส่งจากหน้า 1')
            for row,entry in zip(maps,self.cutter_entries):
                row['ko' if self.cutter_level.startswith('topik') else 'en']=self.cutter_level+':'+entry['word']
        entries=repo.prepare(maps,self.level.get())
        seen=set()
        for entry in entries:
            key=(entry['level'],entry['word'])
            if key in seen:raise ValueError('คำซ้ำในชุด: '+entry['word'])
            seen.add(key)
            entry['source_snapshot']=repo.entry_data(entry)
            old=repo.entry_data(entry).get('imageId')
            if old and old!=entry['image_id']:raise ValueError(f"{entry['word']} ใช้ภาพ {old} อยู่แล้ว กรุณาใช้ ID เดิมเพื่อแทนที่ภาพ")
        expected={}
        for image_id in ids:
            name=f'visual/images/{image_id}.webp';path=self.workspace/name
            expected[name]=original_images.get(image_id)
        return dict(root=self.workspace,ids=ids,entries=entries,expected=expected,repo=repo)

    def resolve_image_conflicts(self,repo,ids,collisions):
        panel=tk.Toplevel(self.root);panel.title('พบ ID ซ้ำ — ตรวจภาพและคำที่ได้รับผลกระทบ');panel.transient(self.root)
        panel.geometry('850x600');choice={'ids':None};flags={};pictures=[]
        ttk.Label(panel,text='เลือกภาพที่จะทับ • ภาพที่ไม่เลือกจะใช้เลขว่างใหม่ • คำทุกคำที่ใช้ ID เดิมจะเห็นภาพใหม่',padding=10).pack()
        area=tk.Canvas(panel,highlightthickness=0);scroll=ttk.Scrollbar(panel,command=area.yview)
        scroll.pack(side='right',fill='y');area.configure(yscrollcommand=scroll.set)
        buttons=ttk.Frame(panel,padding=8);buttons.pack(side='bottom',fill='x')
        area.pack(fill='both',expand=True);body=ttk.Frame(area);body_window=area.create_window(0,0,window=body,anchor='nw')
        area.bind('<Configure>',lambda e:area.itemconfigure(body_window,width=e.width))
        body.bind('<Configure>',lambda e:area.configure(scrollregion=area.bbox('all')))
        for image_id in collisions:
            frame=ttk.LabelFrame(body,text='ID '+image_id,padding=8);frame.pack(fill='x',padx=8,pady=4)
            oldpaths=[p for p in (self.workspace/'visual/images').iterdir() if p.stem==image_id and p.is_file()]
            index=ids.index(image_id);r,c=divmod(index,len(self.cutter.xs)-1)
            new=self.cutter.image.crop(tuple(round(v) for v in (self.cutter.xs[c],self.cutter.ys[r],self.cutter.xs[c+1],self.cutter.ys[r+1])))
            for label,picture in [('เดิม',oldpaths[0] if oldpaths else None),('ใหม่',new)]:
                cell=ttk.Frame(frame);cell.pack(side='left',padx=6);ttk.Label(cell,text=label).pack()
                try:
                    if isinstance(picture,Path):
                        with Image.open(picture) as im:thumb=im.convert('RGBA')
                    elif picture is None:raise ValueError('ไม่พบภาพเดิม')
                    else:thumb=picture.copy()
                    thumb.thumbnail((88,88));photo=ImageTk.PhotoImage(thumb);pictures.append(photo)
                    ttk.Label(cell,image=photo).pack()
                except (OSError,ValueError):ttk.Label(cell,text='ไม่มีภาพ').pack()
            affected=[level+':'+word for (level,word),rs in repo.records.items() for rec in rs if rec['data'].get('imageId')==image_id]
            flag=tk.BooleanVar(value=False);flags[image_id]=flag
            check=ttk.Checkbutton(frame,text='แทนที่ภาพนี้',variable=flag);check.pack(anchor='w')
            if any(p.suffix.lower()!='.webp' for p in oldpaths):check.configure(state='disabled')
            ttk.Label(frame,text='คำที่ใช้: '+(', '.join(affected) or 'ยังไม่มีคำผูกภาพ'),wraplength=530).pack(anchor='w')
            if any(p.suffix.lower()!='.webp' for p in oldpaths):ttk.Label(frame,text='มีภาพชนิดอื่น: ใช้เลขว่างใหม่เพื่อไม่เปลี่ยนชนิดภาพเดิม').pack()
        def choose(replace=False):
            chosen={i for i,v in flags.items() if v.get()} if replace else set()
            if replace and not chosen:return
            if chosen and not messagebox.askyesno('ยืนยันแทนที่ภาพ', 'แทนที่ '+', '.join(sorted(chosen))+'?\nคำทุกคำที่ใช้ ID เหล่านี้จะเห็นภาพใหม่ โปรแกรมจะสำรองภาพเดิมก่อนเขียน',parent=panel):return
            used=occupied_ids(repo)|set(map(int,ids));first=next_range(used,len(ids))
            if not replace:choice['ids']=[str(first+i).zfill(4) for i in range(len(ids))]
            else:
                result=[]
                for image_id in ids:
                    if image_id in collisions and image_id not in chosen:
                        result.append(str(first).zfill(4));first+=1
                    else:result.append(image_id)
                choice['ids']=result
            panel.destroy()
        ttk.Button(buttons,text='ใช้เลขว่างชุดใหม่ (แนะนำ)',command=lambda:choose(False)).pack(side='left',padx=6)
        ttk.Button(buttons,text='แทนที่เฉพาะภาพที่เลือก',command=lambda:choose(True)).pack(side='left',padx=6)
        ttk.Button(buttons,text='ยกเลิก',command=panel.destroy).pack(side='right')
        def bind_wheel(widget):
            widget.bind('<MouseWheel>',lambda e:(area.yview_scroll(-int(e.delta/120),'units'),'break')[1])
            for child in widget.winfo_children():bind_wheel(child)
        bind_wheel(body)
        panel.update_idletasks()
        panel.geometry(f'+{self.root.winfo_rootx()+max(0,(self.root.winfo_width()-panel.winfo_width())//2)}+{self.root.winfo_rooty()+max(0,(self.root.winfo_height()-panel.winfo_height())//2)}')
        panel.grab_set();self.root.wait_window(panel)
        return choice['ids']

    def exported(self,path):
        self.load_zip(path,True)
        self.cutter_entries=[]
        return True

    def render(self):
        self.tree.delete(*self.tree.get_children())
        for i,e in enumerate(self.entries):
            warning=answer_preview(e)[1] if e.get('answer') else ''
            state=('คำใหม่ • ' if e.get('is_new') else '')+('ภาพ ✓' if e.get('sense_confirmed') else 'รอภาพ')+' / '+('ตรวจคำตอบ' if warning else 'ประโยค ✓' if e.get('confirmed') else 'รอประโยค')
            if e.get('dirty'):state='แก้ไขแล้ว ยังไม่บันทึก'
            elif e.get('saved'):state='บันทึกแล้ว • '+state
            elif not e.get('answer'):state='ยังไม่มีคำตอบ • '+state
            self.tree.insert('', 'end',iid=str(i),values=(e['image_id'],e['level'],e['word'],e['meaning'],e.get('answer',''),state))
        if self.entries:
            index=min(self.current or 0,len(self.entries)-1);self.tree.selection_set(str(index));self.show_entry(index)
        self.update_summary()
        self.install_review_scroll(self.root)

    def update_summary(self):
        if not self.entries:
            self.batch_range.set('ยังไม่เปิดชุดงาน')
            self.batch_summary.set('ยังไม่เปิดชุดงาน')
            for key,title in [('missing','ยังไม่มีคำตอบ'),('waiting','รอตรวจ'),('ready','คำตอบพร้อม')]:self.count_badges[key].configure(text=title+' 0 ข้อ')
            return
        ids=sorted({e['image_id'] for e in self.entries},key=int)
        self.batch_range.set(f'กำลังตรวจ {ids[0]}–{ids[-1]} • {len(self.entries)} คำ')
        checked=[dict(e) for e in self.entries]
        if self.current is not None:
            checked[self.current].update(answer=self.answer.get(),confirmed=self.answer_ok.get())
        ready=sum(bool(e.get('confirmed') and not answer_preview(e)[1]) for e in checked)
        missing=sum(not (self.answer.get() if i==self.current else e.get('answer','')).strip() for i,e in enumerate(self.entries))
        for key,title,value in [('missing','ยังไม่มีคำตอบ',missing),('waiting','รอตรวจ',len(self.entries)-ready),('ready','คำตอบพร้อม',ready)]:self.count_badges[key].configure(text=f'{title} {value} ข้อ')
        self.batch_summary.set(f"กำลังตรวจ {ids[0]}–{ids[-1]} • {len(self.entries)} คำ • ยังไม่มีคำตอบ {missing} ข้อ • คำตอบพร้อม {ready} / รอตรวจ {len(self.entries)-ready}")

    def install_review_scroll(self,widget):
        if widget.winfo_toplevel()!=self.root:return
        tags=widget.bindtags()
        if 'StudioReviewScroll' not in tags:widget.bindtags(('StudioReviewScroll',)+tags)
        for child in widget.winfo_children():self.install_review_scroll(child)

    def scroll_review(self,event):
        if self.saving or self.tabs.select()!=str(self.review_tab):return
        if event.widget.winfo_toplevel()!=self.root:return
        return self.tree.wheel(event)

    def reset_review(self):
        self.pending_image_id=None
        self.entries=[];self.assets={};self.current=None;self.loading_editor=True
        self.word.set('');self.meaning.set('');self.answer.set('');self.translation.set('')
        self.occurrence.set('1');self.sense_ok.set(False);self.answer_ok.set(False)
        self.sentence.delete('1.0','end');self.sentence.edit_modified(False)
        self.preview_text.set('');self.answer_hint.set('');self.batch_var.set('')
        self.loading_editor=False;self.render();self.tree.canvas.yview_moveto(0)

    def selected(self,event=None):
        selection=self.tree.selection()
        if selection:
            index=int(selection[0])
            if self.current is not None and index!=self.current:
                try:self.store_edit()
                except Exception as exc:
                    messagebox.showerror('ตรวจแถว',str(exc));self.tree.selection_set(str(self.current));return
            self.show_entry(index)

    def show_entry(self,index):
        self.loading_editor=True
        self.current=index;e=self.entries[index];data=self.repo.entry_data(e)
        self.word.set(e['word']);self.meaning.set(e['meaning']);self.answer.set(e.get('answer',''));self.occurrence.set(str(e.get('occurrence',1)))
        self.sense_ok.set(e.get('sense_confirmed',False));self.answer_ok.set(e.get('confirmed',False))
        self.sentence.configure(state='normal');self.sentence.delete('1.0','end')
        self.sentence.insert('1.0',e.get('sentence',data.get('sentense') or data.get('sentence') or ''))
        self.sentence.edit_modified(False)
        self.translation.set(e.get('translate',data.get('translate','')))
        self.loading_editor=False
        self.update_preview()
        if e.get('import_note'):self.status.set(e['import_note'])

    def sentence_modified(self,event=None):
        if self.sentence.edit_modified():
            if not self.loading_editor:self.answer_ok.set(False)
            self.sentence.edit_modified(False)
            if not self.loading_editor:self.sync_row()
            self.update_preview()

    def translation_modified(self,*args):
        if not self.loading_editor:
            self.answer_ok.set(False);self.sync_row()

    def answer_changed(self,*args):
        if not self.loading_editor:
            self.answer_ok.set(False)
            self.sync_row()
        self.update_preview()

    def meaning_changed(self,*args):
        if not self.loading_editor:
            self.sense_ok.set(False);self.sync_row()

    def word_changed(self,*args):
        if not self.loading_editor:
            self.answer_ok.set(False);self.sync_row()

    def sync_row(self):
        if self.loading_editor or self.current is None:return
        iid=str(self.current)
        if not self.tree.exists(iid):return
        values=list(self.tree.item(iid,'values'))
        values[2]=self.word.get();values[3]=self.meaning.get();values[4]=self.answer.get()
        values[5]='แก้ไขแล้ว ยังไม่บันทึก' if self.answer.get().strip() else 'ยังไม่มีคำตอบ • ยังไม่บันทึก'
        self.tree.item(iid,values=values)
        self.entries[self.current]['dirty']=True
        self.update_summary()

    def update_preview(self):
        if not hasattr(self,'preview_text') or self.current is None or self.loading_editor:return
        try:
            e=dict(self.entries[self.current],sentence=self.sentence.get('1.0','end-1c'),answer=self.answer.get(),occurrence=int(self.occurrence.get()))
            preview,hint,_=answer_preview(e)
            self.preview_text.set('ตัวอย่างโจทย์: '+preview)
            self.answer_hint.set(hint or ('คำตอบที่ตรวจ: '+e['answer'] if e['answer'] else ''))
        except (ValueError,IndexError):self.answer_hint.set('ตรวจตำแหน่งคำตอบ')

    def store_edit(self):
        if self.current is None:return
        e=self.entries[self.current]
        e.setdefault('original_word',e['word'])
        e.update(word=self.word.get().strip(),meaning=self.meaning.get().strip(),answer=self.answer.get().strip(),
                 sentence=self.sentence.get('1.0','end-1c').strip(),translate=self.translation.get().strip(),
                 occurrence=int(self.occurrence.get()),sense_confirmed=self.sense_ok.get(),confirmed=self.answer_ok.get())

    def apply_edit(self):
        self.store_edit();self.render()

    def confirm_senses(self):
        self.store_edit()
        if self.entries and messagebox.askyesno('ยืนยันภาพทั้งชุด','ตรวจลำดับภาพและความหมายทุกแถวแล้วใช่ไหม?\nปุ่มนี้ยืนยันเฉพาะความหมายภาพ ไม่ยืนยันคำตอบในประโยค',parent=self.root):
            for entry in self.entries:entry['sense_confirmed']=True
            self.render()
            self.status.set('ยืนยันภาพทั้งชุดแล้ว • ขั้นถัดไปยืนยันคำตอบที่กรอกแล้ว')

    def confirm_answers(self):
        self.store_edit()
        ready=[];skipped=[]
        for entry in self.entries:
            answer=entry.get('answer','').strip()
            found=positions(entry.get('sentence',''),answer,entry['level'].startswith('english')) if answer else []
            if answer and entry.get('translate','').strip() and 1<=entry.get('occurrence',1)<=len(found):
                ready.append(entry)
            else:skipped.append(entry)
        if not ready:
            self.status.set('ยังไม่มีคำตอบที่ยืนยันได้ • ลากเลือกคำตอบในประโยคก่อน');return
        if not messagebox.askyesno('ยืนยันคำตอบที่กรอกแล้ว',f'ยืนยันคำตอบและคำแปล {len(ready)} รายการ?\nข้าม {len(skipped)} รายการที่ว่างหรือข้อมูลไม่ครบ\nยังไม่บันทึกต้นฉบับจนกด “ตรวจและบันทึกชุดนี้”',parent=self.root):return
        for entry in ready:entry['confirmed']=True
        self.render()
        self.status.set(f'ยืนยันคำตอบ {len(ready)} รายการแล้ว • ข้าม {len(skipped)} รายการ • กดตรวจและบันทึกชุดนี้เมื่อพร้อม')

    def use_selection(self):
        if self.current is None:return
        try:
            text=self.sentence.get('sel.first','sel.last')
            before=self.sentence.get('1.0','sel.first')
        except tk.TclError:raise ValueError('ลากเลือกคำตอบในประโยคก่อน')
        e=self.entries[self.current]
        sentence=self.sentence.get('1.0','end-1c')
        places=positions(sentence,text,e['level'].startswith('english'))
        if len(before) not in places:raise ValueError('ข้อความที่เลือกไม่ใช่ตำแหน่งคำตอบที่ใช้ได้')
        self.answer.set(text);self.occurrence.set(str(places.index(len(before))+1))
        self.answer_ok.set(False)

    def preview_image(self):
        if self.current is None:return
        self.store_edit();e=self.entries[self.current]
        name=f"visual/images/{e['image_id']}.{e['extension']}"
        content=self.assets.get(name) or (self.workspace/name).read_bytes()
        with Image.open(io.BytesIO(content)) as original:
            im=original.copy();im.thumbnail((500,500))
        popup=tk.Toplevel(self.root);popup.title(f"{e['image_id']} — {e['word']}")
        picture=ImageTk.PhotoImage(im);label=ttk.Label(popup,image=picture);label.image=picture;label.pack(padx=12,pady=12)
        ttk.Label(popup,text=e['meaning'],wraplength=500).pack(pady=8)

    def add_match(self):
        if self.current is None:return
        self.store_edit();source=dict(self.entries[self.current])
        popup=tk.Toplevel(self.root);popup.title('เลือกคำที่ใช้ภาพและความหมายเดียวกัน');popup.geometry('680x420')
        query=tk.StringVar(value=source['meaning']);ttk.Entry(popup,textvariable=query).pack(fill='x',padx=8,pady=6)
        box=tk.Listbox(popup,exportselection=False);box.pack(fill='both',expand=True,padx=8)
        matches=[]
        def search():
            nonlocal matches
            text=query.get().casefold().strip()
            matches=[(l,w,rs[0]['data']['meaning']) for (l,w),rs in self.repo.records.items()
                     if len(rs)==1 and (text in w.casefold() or text in rs[0]['data']['meaning'].casefold())]
            box.delete(0,'end')
            for l,w,m in matches:box.insert('end',f'{l}:{w} / {m}')
        def add():
            if not box.curselection():return
            level,word,_=matches[box.curselection()[0]]
            if any(e['level']==level and e['word']==word for e in self.entries):
                messagebox.showerror('ซ้ำ','คำนี้อยู่ในชุดแล้ว',parent=popup);return
            row=dict(source,ko='',en='')
            row['ko' if level.startswith('topik') else 'en']=level+':'+word
            self.entries.extend(self.repo.prepare([row],level));self.current=len(self.entries)-1
            popup.destroy();self.render()
        ttk.Button(popup,text='ค้นคำ/ความหมาย',command=search).pack(pady=4)
        ttk.Button(popup,text='เพิ่มรายการที่เลือกให้ตรวจ (ยังไม่ผูกอัตโนมัติ)',command=add).pack(pady=4)
        matches=self.repo.candidates(source)
        for l,w,m in matches:box.insert('end',f'{l}:{w} / {m}')

    def save(self,only_current=False):
        self.store_edit()
        if not self.entries:raise ValueError('ยังไม่มีชุดงาน')
        selected=[self.entries[self.current]] if only_current else self.entries
        warnings=[e['word']+': '+answer_preview(e)[1] for e in selected if e.get('confirmed') and answer_preview(e)[1]]
        if warnings and not messagebox.askyesno('ตรวจขอบเขตคำตอบ','\n'.join(warnings)+'\n\nตรวจตัวอย่างโจทย์แล้วและต้องการบันทึกคำตอบตามที่เลือกจริงหรือไม่?',parent=self.root):return
        changes,pending=self.repo.plan(selected,self.assets)
        if self.pending_image_id:
            batch=pending_batch(self.workspace)
            if not batch or batch['id']!=self.pending_image_id:raise ValueError('ชุดภาพค้างเปลี่ยนแล้ว กรุณาเปิดใหม่')
            self.check_batch_images(batch)
            saved_keys={(e['level'],e.get('original_word',e['word'])) for e in selected}
            remaining=[e for e in batch['entries'] if (e['level'],e.get('original_word',e['word'])) not in saved_keys]
            updated=dict(batch,entries=remaining) if remaining else None
            changes[PENDING]=(json.dumps(updated,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
        ready=sum(bool(e.get('sense_confirmed')) for e in selected)
        renamed=[e.get('original_word',e['word'])+' → '+e['word'] for e in selected if e.get('original_word',e['word'])!=e['word']]
        rename_note=('\nแก้คำศัพท์: '+', '.join(renamed)+'\nประวัติทบทวนในเบราว์เซอร์ยังอยู่กับคำเดิม คำใหม่จะเริ่มประวัติใหม่') if renamed else ''
        if not messagebox.askyesno('ตรวจชุดก่อนบันทึก',f'รายการ {len(selected)} • ยืนยันความหมาย {ready}\nคิวภาษารวม {len(pending)} รายการ\nไฟล์ที่จะเปลี่ยน {len(changes)} ไฟล์\nจะบันทึกประโยค/คำแปลที่แก้กลับต้นฉบับ พร้อมสำรอง{rename_note} ยืนยันบันทึก?',parent=self.root):return
        self.saving=True
        popup=tk.Toplevel(self.root);popup.title('กำลังบันทึก');popup.transient(self.root)
        popup.geometry('470x140');popup.resizable(False,False)
        popup.protocol('WM_DELETE_WINDOW',lambda:None)
        message=tk.StringVar(value='ตรวจข้อมูลก่อนบันทึก')
        ttk.Label(popup,textvariable=message,padding=15).pack(fill='x')
        progress=ttk.Progressbar(popup,mode='determinate',maximum=100)
        progress.pack(fill='x',padx=15,pady=10)
        popup.update_idletasks()
        x=self.root.winfo_rootx()+max(0,(self.root.winfo_width()-popup.winfo_width())//2)
        y=self.root.winfo_rooty()+max(0,(self.root.winfo_height()-popup.winfo_height())//2)
        popup.geometry(f'+{x}+{y}');popup.grab_set()
        events=queue.Queue();outcome={};finished=tk.BooleanVar(value=False)
        def worker():
            try:
                result=self.repo.commit(changes,progress=lambda value,text:events.put(('progress',value,text)))
                events.put(('done',result))
            except Exception as exc:events.put(('error',exc))
        def poll():
            try:
                while True:
                    event=events.get_nowait()
                    if event[0]=='progress':
                        progress['value']=event[1];message.set(event[2])
                    else:
                        outcome[event[0]]=event[1]
                        finished.set(True);return
            except queue.Empty:pass
            self.root.after(40,poll)
        self.root.configure(cursor='watch')
        threading.Thread(target=worker,daemon=True).start()
        self.root.after(40,poll)
        try:
            self.root.wait_variable(finished)
            if 'error' in outcome:raise outcome['error']
            backup,result=outcome['done']
            message.set('บันทึกไฟล์ครบแล้ว กำลังอัปเดตหน้าจอ');progress['value']=95;self.root.update_idletasks()
            self.repo=Repository(self.workspace)
            if not pending_batch(self.workspace):self.pending_image_id=None
            for entry in selected:
                entry.pop('is_new',None);entry['original_word']=entry['word']
                entry['dirty']=False;entry['saved']=True
            self.assets={k:v for k,v in self.assets.items() if not (self.workspace/k).exists()}
            self.refresh_queue();self.refresh_batches();self.render()
            self.status.set(f'บันทึกแล้ว • {result} • ย้อนกลับได้จากเมนูเพิ่มเติม')
            progress['value']=100;message.set('บันทึกสำเร็จ');self.root.update_idletasks()
            popup.grab_release();popup.destroy()
            if not only_current:
                self.reset_review()
                self.choose_next_step(len(pending))
            else:messagebox.showinfo('บันทึกสำเร็จ',f'{result}\nคิวภาษารวม {len(pending)} รายการ',parent=self.root)
        finally:
            self.saving=False;self.root.configure(cursor='')
            if popup.winfo_exists():popup.grab_release();popup.destroy()

    def refresh_batches(self):
        self.batches=saved_batches(Repository(self.workspace))
        labels=[b['label'] for b in self.batches]
        self.batch_picker.configure(values=labels)
        if self.batch_var.get() not in labels:self.batch_var.set(labels[0] if labels else '')

    def load_saved_batch(self):
        repo=Repository(self.workspace)
        batch=next((b for b in self.batches if b['label']==self.batch_var.get()),None)
        if batch is None:raise ValueError('ยังไม่มีชุดที่บันทึก')
        self.set_batch(maps_for_ids(repo,set(batch['ids'])))
        for entry in self.entries:
            entry['sense_confirmed']=True
        self.render()

    def code_preview(self):
        self.store_edit()
        if self.current is None:return
        entry=self.entries[self.current]
        changes,_=self.repo.plan([entry],self.assets)
        name=FILES[entry['level']]
        from vocab_studio_data import objects, properties
        source=changes.get(name,self.repo.original[name]).decode('utf-8-sig')
        raw=next((raw for _,_,raw in objects(source) if properties(raw)[1].get('word')==entry['word']),'')
        popup=tk.Toplevel(self.root);popup.title('ตัวอย่างโค้ดที่จะบันทึก — '+name);popup.geometry('800x350')
        text=tk.Text(popup,wrap='word',font=('Tahoma',12));text.pack(fill='both',expand=True,padx=10,pady=10);text.insert('1.0',raw)
        ttk.Label(popup,text='ตัวอย่างจากค่าที่ตรวจในแถวนี้ ยังไม่ได้เขียนต้นฉบับ').pack(pady=6)

    def refresh_queue(self):
        repo=Repository(self.workspace)
        self.queue_items=json.loads(repo.queue_bytes or b'[]')
        candidates=shared_image_candidates(repo)
        query=self.queue_filter.get().strip().casefold()
        self.share_rows=[row for row in candidates if not query or query in ' '.join(str(v) for v in row.values()).casefold()]
        self.share_tree.delete(*self.share_tree.get_children())
        for i,row in enumerate(self.share_rows):
            self.share_tree.insert('','end',iid=str(i),values=(row['imageId'],row['sourceKey'],row['meaning'],row['targetKey'],row['targetMeaning'],('มีภาพ '+row['conflict']) if row['conflict'] else 'เลือกส่งไปแชทได้'))
        self.language_tree.delete(*self.language_tree.get_children())
        for i,item in enumerate(self.queue_items):
            self.language_tree.insert('','end',iid=str(i),values=(item['imageId'],item['key'],item['meaning'],'; '.join(REASONS.get(r,r) for r in item['reasons'])))
        self.queue_summary.set(f'พบคู่ที่อาจใช้ภาพร่วมกัน {len(candidates)} คู่ • แสดง {len(self.share_rows)} คู่ • งานค้าง {len(self.queue_items)} คำ | เลือกเองก่อนคัดลอก (Ctrl/Shift เลือกหลายแถว)')

    def build_queue(self):
        bar=ttk.Frame(self.queue_tab);bar.pack(fill='x')
        self.button(bar,'ค้นในคลังอีกครั้ง',self.refresh_queue)
        self.button(bar,'คัดลอกเฉพาะรายการที่เลือก',self.copy_language_request)
        self.button(bar,'วางผลจากแชท',self.paste_language_response)
        self.button(bar,'ดำเนินการ: ตรวจและเปิดตัวอย่าง',self.import_language_response)
        filters=ttk.Frame(self.queue_tab);filters.pack(fill='x')
        ttk.Label(filters,text='ค้นคำ/ความหมาย/ID:').pack(side='left')
        self.queue_filter=tk.StringVar();ttk.Entry(filters,textvariable=self.queue_filter,width=25).pack(side='left')
        self.button(filters,'กรองคู่ภาพ',self.refresh_queue)
        self.allow_new=tk.BooleanVar(value=False)
        ttk.Checkbutton(filters,text='อนุญาตขอคำใหม่ (เฉพาะแท็บงานภาษาอื่น)',variable=self.allow_new).pack(side='left')
        self.queue_summary=tk.StringVar();ttk.Label(self.queue_tab,textvariable=self.queue_summary,padding=6,wraplength=1100).pack(anchor='w')
        panes=ttk.Panedwindow(self.queue_tab,orient='vertical');panes.pack(fill='both',expand=True,padx=8,pady=6)
        self.queue_modes=ttk.Notebook(panes)
        sharing=ttk.Frame(self.queue_modes);other=ttk.Frame(self.queue_modes)
        self.queue_modes.add(sharing,text='คำในคลังที่อาจใช้ภาพร่วมกัน');self.queue_modes.add(other,text='งานประโยค / ขอคำใหม่ที่เลือกเอง')
        def table(parent,columns):
            tree=ttk.Treeview(parent,columns=[x[0] for x in columns],show='headings',height=9,selectmode='extended')
            for key,title,width in columns:tree.heading(key,text=title);tree.column(key,width=width,minwidth=50)
            scroll=ttk.Scrollbar(parent,command=tree.yview);scroll.pack(side='right',fill='y');tree.configure(yscrollcommand=scroll.set)
            tree.pack(fill='both',expand=True)
            return tree
        self.share_tree=table(sharing,[('id','ภาพ',60),('source','คำที่มีภาพ',150),('meaning','ความหมายภาพ',170),('target','คำที่พบในอีกภาษา',170),('targetMeaning','ความหมายในคลัง',180),('state','สถานะ',130)])
        self.language_tree=table(other,[('id','ภาพ',60),('source','คำศัพท์',180),('meaning','ความหมาย',180),('reason','สิ่งที่ค้าง',470)])
        self.ai_response=tk.Text(panes,height=12,wrap='word',font=('Tahoma',11),undo=True)
        panes.add(self.queue_modes,weight=2);panes.add(self.ai_response,weight=1)

    def copy_language_request(self):
        repo=Repository(self.workspace)
        if self.queue_modes.index('current')==0:
            selection={}
            for index in self.share_tree.selection():
                row=self.share_rows[int(index)]
                selection.setdefault(row['sourceKey'],[]).append(row['targetKey'])
            request,prompt=build_request(repo,selected_matches=selection)
        else:
            keys=[self.queue_items[int(index)]['key'] for index in self.language_tree.selection()]
            request,prompt=build_request(repo,selected_keys=keys,allow_new=self.allow_new.get())
        write_atomic(self.workspace/'VocabularyStudio/data/last_ai_request.json',json.dumps(request,ensure_ascii=False,indent=2).encode('utf-8'))
        self.root.clipboard_clear();self.root.clipboard_append(prompt)
        self.status.set(f"คัดลอกคำสั่ง {len(request['tasks'])} รายการแล้ว • วางในแชท GPT/Gemini ได้เลย")

    def paste_language_response(self):
        text=self.root.clipboard_get()
        self.ai_response.delete('1.0','end');self.ai_response.insert('1.0',text)

    def import_language_response(self):
        path=self.workspace/'VocabularyStudio/data/last_ai_request.json'
        if not path.exists():raise ValueError('กดคัดลอกคำสั่งไปแชทก่อน เพื่อผูกผลกับคิวงานที่ถูกต้อง')
        repo=Repository(self.workspace)
        entries,notices=parse_response(self.ai_response.get('1.0','end'),repo,json.loads(path.read_text(encoding='utf-8')))
        if self.entries and not messagebox.askyesno('เปิดชุดผลจากแชท','จะเปิดผลจากแชทแทนชุดที่กำลังตรวจ\nค่าที่ยังไม่บันทึกในแท็บ 3 จะหาย ต้องการเปิดต่อไหม?',parent=self.root):return
        self.pending_image_id=None
        self.repo=repo;self.entries=entries;self.assets={};self.current=None;self.render();self.tabs.select(self.review_tab)
        self.status.set(f'ตรวจรูปแบบผ่าน {len(entries)} รายการ — ยังไม่แก้ต้นฉบับ กรุณาตรวจประโยคและยืนยันก่อนบันทึก')
        if notices:messagebox.showinfo('ผลที่นำเข้า','\n'.join(notices),parent=self.root)

    def remove_entry(self):
        if self.current is None:return
        del self.entries[self.current];self.current=None;self.render()
        if not self.entries:
            self.sentence.delete('1.0','end');self.translation.set('');self.answer.set('');self.meaning.set('')

    def clipboard_menu(self,event):
        widget=event.widget
        if widget.winfo_class() not in {'Text','Entry','TEntry','Spinbox','TSpinbox','TCombobox'}:return
        widget.focus_set()
        menu=tk.Menu(self.root,tearoff=False)
        for label,virtual in [('ตัด','<<Cut>>'),('คัดลอก','<<Copy>>'),('วาง','<<Paste>>')]:
            menu.add_command(label=label,command=lambda v=virtual:widget.event_generate(v))
        def select_all():
            if widget.winfo_class()=='Text':widget.tag_add('sel','1.0','end-1c')
            else:widget.selection_range(0,'end')
        menu.add_separator();menu.add_command(label='เลือกทั้งหมด',command=select_all)
        try:menu.tk_popup(event.x_root,event.y_root)
        finally:menu.grab_release()

    def load_queue(self):
        repo=Repository(self.workspace);items=json.loads(repo.queue_bytes or b'[]')
        if not items:raise ValueError('ไม่มีคิวค้าง')
        entries=[]
        for item in items:
            data=repo.unique(item['level'],item['word'])['data']
            row=dict(image_id=item['imageId'],extension=item.get('imageExtension',data.get('imageExtension','webp')),meaning=item['meaning'],ko='',en='')
            row['ko' if item['level'].startswith('topik') else 'en']=item['key']
            entry=repo.prepare([row],item['level'])[0]
            entry['sense_confirmed']='review_image_sense' not in item['reasons']
            entries.append(entry)
        self.pending_image_id=None
        self.repo=repo;self.entries=entries;self.assets={};self.current=None;self.render();self.tabs.select(self.review_tab)

    def save_draft(self):
        self.store_edit()
        if self.assets:raise ValueError('ชุด ZIP ยังไม่บันทึก: เก็บ ZIP ไว้ แล้วนำเข้าใหม่ หรือบันทึกชุดพร้อมคิวก่อน')
        value={'entries':self.entries,'hashes':{k:digest(v) for k,v in self.repo.original.items()}}
        write_atomic(self.workspace/'VocabularyStudio/data/draft.json',json.dumps(value,ensure_ascii=False,indent=2).encode('utf-8'))
        self.status.set('เก็บแบบร่างแล้ว ยังไม่แก้คลังศัพท์')

    def load_draft(self):
        value=json.loads((self.workspace/'VocabularyStudio/data/draft.json').read_text(encoding='utf-8'))
        repo=Repository(self.workspace)
        if value['hashes']!={k:digest(v) for k,v in repo.original.items()}:raise ValueError('คลังเปลี่ยนจากแบบร่างแล้ว กรุณาโหลดตารางใหม่')
        self.pending_image_id=None
        self.repo=repo;self.entries=value['entries'];self.assets={};self.current=None;self.render()

    def undo(self):
        if messagebox.askyesno('ย้อนกลับชุดล่าสุด','คืนไฟล์คลัง คิว และภาพที่โปรแกรมเพิ่มในชุดล่าสุด? ภาพที่มีอยู่ก่อนจะคงไว้',parent=self.root):
            undo_latest(self.workspace);self.repo=Repository(self.workspace);self.entries=[];self.assets={};self.current=None
            self.render();self.refresh_queue();self.refresh_batches();self.status.set('ย้อนกลับชุดล่าสุดแล้ว')

    def close(self):
        if self.saving:return
        if self.pending_image_id:
            try:
                self.store_edit();self.repo.ensure_current()
                batch=pending_batch(self.workspace)
                if not batch or batch['id']!=self.pending_image_id:raise ValueError('ชุดงานค้างเปลี่ยนแล้ว')
                edits={(e['level'],e.get('original_word',e['word'])):e for e in self.entries}
                batch['entries']=[edits.get((e['level'],e.get('original_word',e['word'])),e) for e in batch['entries']]
                write_atomic(self.workspace/PENDING,(json.dumps(batch,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
                self.root.destroy();return
            except Exception as exc:
                messagebox.showerror('เก็บงานค้างไม่สำเร็จ',str(exc),parent=self.root);return
        if self.cutter.busy:self.cutter.close();return
        if self.entries and not messagebox.askyesno('ปิดโปรแกรม','ปิดโปรแกรม? การตรวจที่ยังไม่บันทึกหรือเก็บแบบร่างจะหาย',parent=self.root):return
        self.root.destroy()


if __name__=='__main__':
    root=tk.Tk()
    try:Studio(root)
    except Exception as exc:
        messagebox.showerror('เปิดโปรแกรมไม่ได้',str(exc));root.destroy();raise
    root.mainloop()
