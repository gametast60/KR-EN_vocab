"""Scrollable image groups with independently selectable vocabulary rows."""
import io
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk


class ReviewCards(ttk.Frame):
    def __init__(self, parent, studio):
        super().__init__(parent)
        self.studio=studio
        self.groups={};self.rows={};self.active=()
        self.canvas=tk.Canvas(self,highlightthickness=0)
        scroll=ttk.Scrollbar(self,command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side='right',fill='y');self.canvas.pack(fill='both',expand=True)
        self.body=ttk.Frame(self.canvas)
        self.window=self.canvas.create_window(0,0,anchor='nw',window=self.body)
        self.body.bind('<Configure>',lambda e:self.canvas.configure(scrollregion=self.canvas.bbox('all')))
        self.canvas.bind('<Configure>',lambda e:self.canvas.itemconfigure(self.window,width=e.width))
        self.canvas.bind('<MouseWheel>',self.wheel)
        ttk.Style(self).configure('Review.Treeview',rowheight=32)

    def wheel(self,event):
        self.canvas.yview_scroll(-int(event.delta/120),'units')
        return 'break'

    def insert(self,parent,index,iid,values):
        image_id=values[0]
        if image_id not in self.groups:
            frame=ttk.LabelFrame(self.body,text=f'ภาพ {image_id} • คำที่ใช้ภาพร่วมกัน',padding=6)
            frame.pack(fill='x',padx=4,pady=5)
            picture=ttk.Label(frame,width=16,anchor='center');picture.pack(side='left',padx=(0,8))
            try:
                entry=self.studio.entries[int(iid)]
                name=f"visual/images/{image_id}.{entry['extension']}"
                content=self.studio.assets.get(name) or (self.studio.workspace/name).read_bytes()
                with Image.open(io.BytesIO(content)) as original:
                    im=original.convert('RGBA');im.thumbnail((104,104))
                picture.image=ImageTk.PhotoImage(im,master=self)
                picture.configure(image=picture.image,width=104)
            except (OSError,ValueError):picture.configure(text='ไม่พบภาพ')
            cols=('id','level','word','meaning','answer','state')
            tree=ttk.Treeview(frame,columns=cols,show='headings',height=2,selectmode='browse',style='Review.Treeview')
            for col,title,width in zip(cols,('ID','ระดับ','คำศัพท์','ความหมาย','คำตอบ','สถานะ'),(60,90,130,220,140,220)):
                tree.heading(col,text=title);tree.column(col,width=width,minwidth=45,stretch=True)
            tree.pack(side='left',fill='both',expand=True)
            tree.bind('<<TreeviewSelect>>',lambda e,t=tree:self.chosen(t))
            tree.bind('<MouseWheel>',self.wheel)
            picture.bind('<MouseWheel>',self.wheel)
            self.groups[image_id]=(frame,tree)
        tree=self.groups[image_id][1]
        tree.insert('','end',iid=iid,values=values)
        tree.configure(height=max(2,len(tree.get_children())))
        self.rows[iid]=tree

    def chosen(self,tree):
        selected=tree.selection()
        if not selected or selected==self.active:return
        self.selection_set(selected[0])
        self.event_generate('<<TreeviewSelect>>')

    def selection_set(self,iid):
        iid=str(iid)
        if iid not in self.rows:return
        self.active=(iid,)
        for _,tree in self.groups.values():
            if tree is not self.rows[iid]:tree.selection_remove(*tree.selection())
        self.rows[iid].selection_set(iid)

    def selection(self):return self.active
    def get_children(self):return tuple(self.rows)
    def exists(self,iid):return str(iid) in self.rows
    def item(self,iid,option=None,**kwargs):return self.rows[str(iid)].item(str(iid),option,**kwargs)
    def delete(self,*items):
        for frame,_ in self.groups.values():frame.destroy()
        self.groups.clear();self.rows.clear();self.active=()
