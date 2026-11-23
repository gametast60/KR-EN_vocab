"""Find pale, continuous gutters; leave uncertain axes evenly divided."""
from PIL import Image


def _runs(values,threshold):
    runs=[];start=None
    for i,value in enumerate([*values,0]):
        if value>=threshold and start is None:start=i
        elif value<threshold and start is not None:
            runs.append((start,i));start=None
    return runs


def _axis(scores,count):
    length=len(scores);pitch=length/count
    fallback=[length*i/count for i in range(count+1)]
    if count<2:return fallback,False
    runs=_runs(scores,.86)
    cuts=[]
    for i in range(1,count):
        expected=length*i/count
        candidates=[(a,b) for a,b in runs if abs((a+b)/2-expected)<pitch*.36 and b-a<=pitch*.30]
        if not candidates:return fallback,False
        a,b=max(candidates,key=lambda ab:sum(scores[ab[0]:ab[1]])/(ab[1]-ab[0])-.15*abs((ab[0]+ab[1])/2-expected)/pitch)
        cuts.append((a+b)/2)
    if any(b-a<pitch*.55 or b-a>pitch*1.45 for a,b in zip(cuts,cuts[1:])):return fallback,False
    # Trim excess outer whitespace while keeping half a gutter around edge cards.
    widths=[b-a for a,b in runs if any(a<=cut<=b for cut in cuts)]
    padding=max(1,sorted(widths)[len(widths)//2]/2)
    content=[i for i,s in enumerate(scores) if s<.65]
    if not content:return fallback,False
    left=max(0,content[0]-padding);right=min(length,content[-1]+1+padding)
    if not (pitch*.55<cuts[0]-left<pitch*1.45 and pitch*.55<right-cuts[-1]<pitch*1.45):return fallback,False
    return [left,*cuts,right],True


def detect_grid(image,columns,rows):
    original=image.size
    sample=image.convert('RGBA')
    background=Image.new('RGBA',sample.size,'white');background.alpha_composite(sample)
    sample=background.convert('RGB');sample.thumbnail((900,900),Image.Resampling.BOX)
    width,height=sample.size
    # White/off-white gutters are distinct from cream cards and dark outlines.
    xs=[0]*width;ys=[0]*height
    for y in range(height):
        for x in range(width):
            r,g,b=sample.getpixel((x,y))
            pale=min(r,g,b)>=238 and max(r,g,b)-min(r,g,b)<=16
            if pale:xs[x]+=1;ys[y]+=1
    xcuts,xok=_axis([n/height for n in xs],columns)
    ycuts,yok=_axis([n/width for n in ys],rows)
    return ([x*original[0]/width for x in xcuts],
            [y*original[1]/height for y in ycuts],xok,yok)
