"""One-time/read-only source import. Author lessons separately; never infer mastery from PDF rows."""
import argparse, hashlib, json, logging, re
from pathlib import Path
from pypdf import PdfReader
logging.getLogger('pypdf').setLevel(logging.ERROR)
parser=argparse.ArgumentParser()
parser.add_argument('topik_i'); parser.add_argument('topik_ii')
args=parser.parse_args()
destination=Path(__file__).resolve().parent.parent/'grammar'/'sources'
destination.mkdir(parents=True,exist_ok=True)
for key,filename,expected in [('topik-i',args.topik_i,84),('topik-ii',args.topik_ii,148)]:
    source=Path(filename); reader=PdfReader(source); pages=[]; rows=[]
    for page_number,page in enumerate(reader.pages,1):
        text=page.extract_text(extraction_mode='layout')
        plain=not text.strip()
        if plain:text=page.extract_text()
        pages.append({'page':page_number,'text':text})
        lines=text.splitlines()
        for index,line in enumerate(lines):
            isolated=re.match(r'^\s{0,3}(\d+)\s*$',line)
            if isolated:
                continuation=next((part.strip() for part in lines[index+1:] if part.strip()),'')
                line=isolated[1]+'  '+continuation
            match=re.match(r'^\s*(\d+)\s+(\S.+)$',line)
            if not match: continue
            number=int(match[1]); parts=re.split(r'\s{2,}',match[2].strip())
            if plain:parts=[re.split(r'[A-Za-z]',match[2],maxsplit=1)[0].strip().rstrip('(').strip()]
            rows.append({'id':f'{key}:{number:03d}','number':number,'page':page_number,'form':parts[0],'rawRow':line.strip(),'status':'source-only'})
    if sorted(r['number'] for r in rows)!=list(range(1,expected+1)):raise ValueError(f'Check row extraction: {key} has {len(rows)} rows')
    result={'schemaVersion':1,'id':key,'title':f'TOPIK {"I" if key=="topik-i" else "II"} Grammar','filename':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'note':'Source inventory only. Original wording is retained, not validated lesson content. Page text preserves multi-line examples.','rows':rows,'pages':pages}
    (destination/f'{key}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'{key}: {len(rows)} rows / {len(pages)} pages')
