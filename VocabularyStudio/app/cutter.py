import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk
from pathlib import Path
import io, zipfile, threading, queue, re, csv, json, os, subprocess, sys

class Cutter:
    def __init__(self, root, host=None, on_export=None):
        self.root=root;self.on_export=on_export
        parent=host if host is not None else root
        if host is None:root.title('Vocabulary Studio — Cutter');root.geometry('1220x790')
        self.image=None; self.photo=None; self.xs=[]; self.ys=[]; self.drag=None; self.scale=1; self.x0=0; self.y0=0
        self.busy=False;self.messages=queue.Queue();self.last_export=None
        self.progress_window=None;self.activity=None
        if host is None:root.protocol('WM_DELETE_WINDOW',self.close)
        self.settings=Path(__file__).resolve().parents[1]/'data'/'cutter_settings.json'
        self.columns=tk.IntVar(value=5);self.rows=tk.IntVar(value=5);self.size=tk.IntVar(value=256)
        self.transparent=tk.BooleanVar(value=True);self.start=tk.StringVar(value=self.load_start())
        top=ttk.Frame(parent,padding=8);top.pack(fill='x')
        ttk.Button(top,text='Open Image',command=self.open_image).pack(side='left',padx=2)
        self.clear_btn=ttk.Button(top,text='Clear Image',command=self.clear_image);self.clear_btn.pack(side='left',padx=2)
        for label,var,width in [('Columns',self.columns,3),('Rows',self.rows,3),('Size',self.size,5)]:
            ttk.Label(top,text=label).pack(side='left',padx=(10,2));ttk.Entry(top,textvariable=var,width=width).pack(side='left')
        ttk.Button(top,text='Auto Grid / Reset',command=self.auto_grid).pack(side='left',padx=12)
        ttk.Checkbutton(top,text='Transparent outside card',variable=self.transparent).pack(side='left',padx=8)
        self.export_btn=ttk.Button(top,text='Export ZIP',command=self.export);self.export_btn.pack(side='right',padx=8)
        middle=ttk.Frame(parent,padding=6);middle.pack(fill='both',expand=True)
        self.canvas=tk.Canvas(middle,bg='#42464b',highlightthickness=0);self.canvas.pack(side='left',fill='both',expand=True)
        sidebar=ttk.Frame(middle,padding=9);sidebar.pack(side='right',fill='y')
        ttk.Label(sidebar,text='START FILE NAME',font=('Arial',10,'bold')).pack(anchor='w')
        ttk.Entry(sidebar,textvariable=self.start,width=28).pack(fill='x',pady=(4,12))
        ttk.Label(sidebar,text='PASTE ORIGINAL GEMINI VOCAB LIST',font=('Arial',9,'bold')).pack(anchor='w')
        ttk.Label(sidebar,text='1. 가게 / ร้านค้า — NOUN — scene',foreground='#555').pack(anchor='w')
        row=ttk.Frame(sidebar);row.pack(fill='x',pady=5)
        ttk.Button(row,text='Paste Clipboard',command=self.paste).pack(side='left')
        ttk.Button(row,text='Clear List',command=lambda:self.words.delete('1.0','end')).pack(side='left',padx=4)
        sf=ttk.Frame(sidebar);sf.pack(fill='both',expand=True)
        self.words=tk.Text(sf,width=34,height=27,wrap='word',undo=True);self.words.pack(side='left',fill='both',expand=True)
        sb=ttk.Scrollbar(sf,command=self.words.yview);sb.pack(side='right',fill='y');self.words.configure(yscrollcommand=sb.set)
        self.status=tk.StringVar(value='Open an image, adjust green lines and paste your original list.')
        ttk.Label(parent,textvariable=self.status,padding=6).pack(fill='x')
        bottom=ttk.Frame(parent,padding=(8,2,8,10));bottom.pack(fill='x')
        self.phase=tk.StringVar(value='Ready');ttk.Label(bottom,textvariable=self.phase,width=32).pack(side='left')
        self.progress=tk.DoubleVar(value=0);ttk.Progressbar(bottom,variable=self.progress,maximum=100).pack(side='left',fill='x',expand=True,padx=8)
        self.pct=tk.StringVar(value='0%');ttk.Label(bottom,textvariable=self.pct,width=6).pack(side='left')
        self.openfolder=ttk.Button(bottom,text='Open Folder',command=self.open_folder,state='disabled');self.openfolder.pack(side='left',padx=8)
        self.canvas.bind('<Configure>',lambda _ : self.draw())
        self.canvas.bind('<ButtonPress-1>',self.on_down);self.canvas.bind('<B1-Motion>',self.on_drag);self.canvas.bind('<ButtonRelease-1>',self.on_up)
    def load_start(self):
        # Keep exported-but-not-yet-imported IDs reserved by the saved next_start.
        next_id=1;width=4
        try:
            saved=str(json.loads(self.settings.read_text(encoding='utf-8'))['next_start'])
            if re.fullmatch(r'\d{1,12}',saved):
                next_id=max(next_id,int(saved));width=max(width,len(saved))
        except (OSError,ValueError,KeyError,TypeError):pass
        # Locate the app root even if the Cutter folder is moved within the project.
        for parent in Path(__file__).resolve().parents:
            if (parent/'vocabulary-catalog.js').is_file():
                images=parent/'visual'/'images'
                if images.is_dir():
                    for path in images.iterdir():
                        if path.is_file() and path.suffix.lower() in {'.webp','.png','.jpg','.jpeg'} and re.fullmatch(r'\d{1,12}',path.stem):
                            next_id=max(next_id,int(path.stem)+1);width=max(width,len(path.stem))
                break
        return f'{next_id:0{width}d}'
    def save_start(self,val):
        try:
            tmp=self.settings.with_suffix('.tmp');tmp.write_text(json.dumps({'next_start':val}),encoding='utf-8');os.replace(tmp,self.settings)
        except Exception:pass
    def paste(self):
        try:
            data=self.root.clipboard_get();self.words.delete('1.0','end');self.words.insert('1.0',data)
        except Exception as e:messagebox.showerror('Clipboard',str(e))
    def open_image(self):
        if self.busy:return
        path=filedialog.askopenfilename(filetypes=[('Images','*.png *.jpg *.jpeg *.webp *.bmp')])
        if not path:return
        try:
            self.image=Image.open(path).convert('RGB');self.auto_grid();self.status.set('Image opened. Drag any green grid line to adjust cuts.')
        except Exception as e:messagebox.showerror('Image error',str(e))
    def clear_image(self):
        if self.busy:return
        self.image=None;self.photo=None;self.xs=[];self.ys=[];self.canvas.delete('all');self.progress.set(0);self.phase.set('Ready');self.pct.set('0%')
        self.start.set(self.load_start())
        self.status.set(f'ล้างภาพแล้ว • ตรวจ ID ล่าสุดแล้ว • ชุดถัดไปเริ่ม {self.start.get()}.webp')
    def auto_grid(self):
        if self.busy or self.image is None:return
        try:
            c=int(self.columns.get());r=int(self.rows.get())
            if not (1<=c<=30 and 1<=r<=30):raise ValueError('Grid range 1–30')
        except Exception as e:messagebox.showerror('Grid',str(e));return
        w,h=self.image.size;self.xs=[w*i/c for i in range(c+1)];self.ys=[h*i/r for i in range(r+1)];self.draw()
    def draw(self):
        self.canvas.delete('all')
        if self.image is None:return
        cw=max(1,self.canvas.winfo_width());ch=max(1,self.canvas.winfo_height())
        w,h=self.image.size;self.scale=min((cw-25)/w,(ch-25)/h,1.8);self.x0=(cw-w*self.scale)/2;self.y0=(ch-h*self.scale)/2
        preview=self.image.resize((max(1,int(w*self.scale)),max(1,int(h*self.scale))),Image.Resampling.LANCZOS)
        self.photo=ImageTk.PhotoImage(preview);self.canvas.create_image(self.x0,self.y0,anchor='nw',image=self.photo)
        for x in self.xs:
            xx=self.x0+x*self.scale;self.canvas.create_line(xx,self.y0,xx,self.y0+h*self.scale,fill='#2fff86',width=2)
        for y in self.ys:
            yy=self.y0+y*self.scale;self.canvas.create_line(self.x0,yy,self.x0+w*self.scale,yy,fill='#2fff86',width=2)
    def on_down(self,e):
        if self.busy or self.image is None:return
        options=[(abs(e.x-(self.x0+x*self.scale)),'x',i) for i,x in enumerate(self.xs)]+[(abs(e.y-(self.y0+y*self.scale)),'y',i) for i,y in enumerate(self.ys)]
        nearest=min(options,key=lambda t:t[0]);self.drag=(nearest[1],nearest[2]) if nearest[0]<14 else None
    def on_drag(self,e):
        if not self.drag or self.busy:return
        axis,i=self.drag;arr=self.xs if axis=='x' else self.ys
        p=((e.x-self.x0) if axis=='x' else (e.y-self.y0))/self.scale
        limit=self.image.width if axis=='x' else self.image.height
        lower=arr[i-1]+5 if i>0 else 0;upper=arr[i+1]-5 if i<len(arr)-1 else limit
        arr[i]=max(lower,min(upper,p));self.draw()
    def on_up(self,_):self.drag=None
    @staticmethod
    def parse_start(value):
        match=re.fullmatch(r'([A-Za-z0-9_-]*?)(\d+)(?:\.webp)?',value.strip(),re.I)
        if not match:raise ValueError('Start file must be 0001, 0031, KR_0031, etc.')
        prefix,digits=match.groups()
        if len(digits)>12:raise ValueError('Start number is too long')
        return prefix,int(digits),len(digits)
    @staticmethod
    def parse_words(value):
        result=[]
        for ln,line in enumerate(value.splitlines(),1):
            line=line.strip()
            if not line:continue
            line=re.sub(r'^(?:\d+\s*[.):]\s*|[-*]\s+)','',line).strip()
            main=re.split(r'\s+[—–]\s+|\s+-\s+',line,maxsplit=1)[0]
            parts=[p.strip() for p in re.split(r'\s*/\s*',main)]
            if len(parts)>3 or not all(parts):raise ValueError(f'Unrecognized word list on line {ln}')
            if len(parts)==3:result.append(tuple(parts))
            elif len(parts)==2:
                a,b=parts;result.append((a,'',b) if re.search('[가-힣]',a) else ('',a,b))
            else:result.append(('','',parts[0]))
        return result
    @staticmethod
    def remove_background(im):
        # Remove connected pale pixels from the card crop outer edges only.
        im=im.convert('RGBA');w,h=im.size
        if w*h>3_000_000:im.thumbnail((1400,1400),Image.Resampling.LANCZOS);w,h=im.size
        pix=im.load();corners=[pix[0,0],pix[w-1,0],pix[0,h-1],pix[w-1,h-1]]
        refs=[p for p in corners if min(p[:3])>=188 and max(p[:3])-min(p[:3])<70]
        if not refs:return im
        from collections import deque
        todo=deque();seen=set()
        for x,y in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]:
            r,g,b,a=pix[x,y]
            if any(max(abs(r-c[0]),abs(g-c[1]),abs(b-c[2]))<37 for c in refs):todo.append((x,y));seen.add((x,y))
        while todo:
            x,y=todo.popleft();r,g,b,_=pix[x,y];pix[x,y]=(r,g,b,0)
            for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if 0<=nx<w and 0<=ny<h and (nx,ny) not in seen:
                    nr,ng,nb,_=pix[nx,ny]
                    if min(nr,ng,nb)>188 and max(nr,ng,nb)-min(nr,ng,nb)<75 and any(max(abs(nr-c[0]),abs(ng-c[1]),abs(nb-c[2]))<37 for c in refs):
                        seen.add((nx,ny));todo.append((nx,ny))
        return im
    def set_busy(self,flag):
        self.busy=flag;self.export_btn.configure(state='disabled' if flag else 'normal');self.clear_btn.configure(state='disabled' if flag else 'normal')
    def close(self):
        if self.busy:
            if self.progress_window:self.progress_window.lift()
            return
        self.root.destroy()
    def show_progress(self,total):
        self.progress.set(0);self.pct.set('0%');self.phase.set(f'กำลังเตรียมภาพ 0/{total}')
        self.status.set('กำลังส่งออก — ยังไม่เสร็จ กรุณารอจนแจ้งว่าสำเร็จ')
        self.openfolder.configure(state='disabled')
        panel=tk.Toplevel(self.root);self.progress_window=panel
        panel.title('กำลังส่งออกภาพ — กรุณารอ');panel.transient(self.root);panel.resizable(False,False)
        panel.protocol('WM_DELETE_WINDOW',lambda:None)
        body=ttk.Frame(panel,padding=24);body.pack(fill='both',expand=True)
        ttk.Label(body,text='กำลังประมวลผล ยังไม่เสร็จ',font=('Tahoma',16,'bold')).pack(anchor='w')
        ttk.Label(body,text=f'ภาพทั้งหมด {total} ภาพ • กรุณาอย่าปิดโปรแกรม',padding=(0,10)).pack(anchor='w')
        ttk.Label(body,textvariable=self.phase,font=('Tahoma',11)).pack(anchor='w',pady=8)
        ttk.Progressbar(body,variable=self.progress,maximum=100,length=460).pack(fill='x',pady=8)
        ttk.Label(body,textvariable=self.pct,font=('Tahoma',16,'bold')).pack()
        self.activity=ttk.Progressbar(body,mode='indeterminate',length=460)
        self.activity.pack(fill='x',pady=(12,4));self.activity.start(25)
        ttk.Label(body,text='แถบเล็กแสดงว่าโปรแกรมยังทำงาน แม้เปอร์เซ็นต์คงที่ในบางขั้นตอน').pack()
        panel.update_idletasks()
        x=self.root.winfo_rootx()+max(0,(self.root.winfo_width()-panel.winfo_width())//2)
        y=self.root.winfo_rooty()+max(0,(self.root.winfo_height()-panel.winfo_height())//2)
        panel.geometry(f'+{x}+{y}');panel.grab_set()
    def hide_progress(self):
        if self.activity:self.activity.stop();self.activity=None
        if self.progress_window:
            self.progress_window.grab_release();self.progress_window.destroy();self.progress_window=None
    def export(self):
        if self.busy or self.image is None:return
        try:
            prefix,first,width=self.parse_start(self.start.get());entries=self.parse_words(self.words.get('1.0','end'))
            total=(len(self.xs)-1)*(len(self.ys)-1)
            if len(entries)!=total:raise ValueError(f'{len(entries)} vocabulary entries vs {total} grid cards. Paste exactly {total} words.')
            size=int(self.size.get());assert 32<=size<=2048
        except Exception as e:messagebox.showerror('Check before export',str(e));return
        file=filedialog.asksaveasfilename(defaultextension='.zip',filetypes=[('ZIP','*.zip')],initialfile='vocabulary_cards.zip')
        if not file:return
        self.set_busy(True);self.show_progress(total)
        args=(file,self.image.copy(),list(self.xs),list(self.ys),size,self.transparent.get(),prefix,first,width,entries)
        threading.Thread(target=self.worker,args=args,daemon=True).start();self.root.after(60,self.poll)
    def worker(self,file,source,xs,ys,size,transparent,prefix,first,width,entries):
        total=len(entries);names=[f'{prefix}{first+i:0{width}d}.webp' for i in range(total)]
        temp=file+'.partial'
        try:
            with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED) as z:
                for row in range(len(ys)-1):
                    for col in range(len(xs)-1):
                        idx=row*(len(xs)-1)+col;count=idx+1
                        box=tuple(round(v) for v in (xs[col],ys[row],xs[col+1],ys[row+1]))
                        self.messages.put(('progress',100*(idx*4)/(total*4+1),f'กำลังตัดภาพ {count}/{total}'))
                        crop=source.crop(box)
                        self.messages.put(('progress',100*(idx*4+1)/(total*4+1),f'กำลังลบพื้นหลัง {count}/{total}' if transparent else f'กำลังเตรียมภาพ {count}/{total}'))
                        if transparent:crop=self.remove_background(crop)
                        self.messages.put(('progress',100*(idx*4+2)/(total*4+1),f'กำลังปรับขนาด {count}/{total}'))
                        crop.thumbnail((size,size),Image.Resampling.LANCZOS)
                        out=Image.new('RGBA' if transparent else 'RGB',(size,size),(0,0,0,0) if transparent else (255,250,240))
                        out.paste(crop,((size-crop.width)//2,(size-crop.height)//2))
                        self.messages.put(('progress',100*(idx*4+3)/(total*4+1),f'กำลังบันทึกภาพ {count}/{total}'))
                        buff=io.BytesIO();out.save(buff,'WEBP',quality=88,method=6)
                        z.writestr(names[idx],buff.getvalue())
                        self.messages.put(('progress',100*(idx*4+4)/(total*4+1),f'บันทึกภาพแล้ว {count}/{total}'))
                self.messages.put(('progress',100*(total*4)/(total*4+1),'กำลังสร้างตารางคำศัพท์และจัดเก็บ ZIP'))
                def clean(s):return s.replace('|','\\|').replace('\n',' ').strip()
                lines=['# Vocabulary image map','','| Image | Korean | English | Thai |','|---|---|---|---|']
                for name,(ko,en,th) in zip(names,entries):lines.append(f'| `{name}` | {clean(ko)} | {clean(en)} | {clean(th)} |')
                z.writestr('vocabulary_map.md','\n'.join(lines)+'\n')
                sio=io.StringIO(newline='');writer=csv.writer(sio);writer.writerow(['image','korean','english','thai'])
                for name,entry in zip(names,entries):writer.writerow([name,*entry])
                z.writestr('vocabulary_map.csv',sio.getvalue().encode('utf-8-sig'))
            os.replace(temp,file)
            self.messages.put(('done',file,f'{prefix}{first+total:0{width}d}',total))
        except Exception as e:
            try:os.remove(temp)
            except OSError:pass
            self.messages.put(('error',str(e)))
    def poll(self):
        try:
            while True:
                event,*values=self.messages.get_nowait()
                if event=='progress':
                    percent,label=values;self.progress.set(min(99,percent));self.pct.set(f'{min(99,int(percent))}%');self.phase.set(label)
                elif event=='done':
                    file,next_start,total=values;self.hide_progress();self.set_busy(False);self.progress.set(100);self.pct.set('100%');self.phase.set(f'Complete: {total} images')
                    self.last_export=file;self.start.set(next_start);self.save_start(next_start);self.openfolder.configure(state='normal')
                    self.status.set(f'Saved {total} WebPs + MD + CSV to {file}')
                    if self.on_export:
                        try:self.on_export(file)
                        finally:self.open_folder()
                    elif messagebox.askyesno('Export complete',f'Exported {total} images successfully.\nOpen folder?'):self.open_folder()
                    return
                elif event=='error':
                    self.hide_progress();self.set_busy(False);self.phase.set('ส่งออกไม่สำเร็จ');self.status.set('ส่งออกไม่สำเร็จ — ตรวจข้อผิดพลาดแล้วลองใหม่')
                    self.openfolder.configure(state='normal' if self.last_export else 'disabled')
                    messagebox.showerror('Export',values[0]);return
        except queue.Empty:pass
        if self.busy:self.root.after(60,self.poll)
    def open_folder(self):
        if not self.last_export:return
        folder=str(Path(self.last_export).parent)
        try:
            if sys.platform=='win32':os.startfile(folder)
            elif sys.platform=='darwin':subprocess.Popen(['open',folder])
            else:subprocess.Popen(['xdg-open',folder])
        except Exception as e:messagebox.showerror('Folder',str(e))

if __name__=='__main__':
    root=tk.Tk();Cutter(root);root.mainloop()
