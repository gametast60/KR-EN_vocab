import sys
import unittest
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from grid_detection import detect_grid


class GridTests(unittest.TestCase):
    def test_uneven_margins_and_spacing_follow_gutters(self):
        image=Image.new('RGB',(740,720),'white');draw=ImageDraw.Draw(image)
        starts_x=[30,167,303,442,578];starts_y=[18,151,285,419,553]
        for y in starts_y:
            for x in starts_x:
                draw.rounded_rectangle((x,y,x+125,y+125),radius=12,fill='#fff0d0',outline='#654a30',width=3)
                draw.ellipse((x+30,y+30,x+90,y+95),fill='#99764f')
        xs,ys,xok,yok=detect_grid(image,5,5)
        self.assertTrue(xok);self.assertTrue(yok)
        for i in range(1,5):
            self.assertGreater(xs[i],starts_x[i-1]+125)
            self.assertLess(xs[i],starts_x[i])
            self.assertGreater(ys[i],starts_y[i-1]+125)
            self.assertLess(ys[i],starts_y[i])
        self.assertLess(xs[0],starts_x[0]);self.assertGreater(xs[-1],starts_x[-1]+125)
        self.assertLess(xs[-1],image.width)

    def test_no_clear_gutters_falls_back_without_guessing(self):
        for color in ('white','#cc9966'):
            xs,ys,xok,yok=detect_grid(Image.new('RGB',(600,500),color),5,5)
            self.assertFalse(xok);self.assertFalse(yok)
            self.assertEqual(xs,[0,120,240,360,480,600])
            self.assertEqual(ys,[0,100,200,300,400,500])

    def test_non_square_grid_and_scaled_image(self):
        image=Image.new('RGB',(1200,700),'white');draw=ImageDraw.Draw(image)
        for y in [25,355]:
            for x in [35,270,505,740,975]:
                draw.rectangle((x,y,x+200,y+300),fill='#f5d9af',outline='#705040',width=4)
        xs,ys,xok,yok=detect_grid(image,5,2)
        self.assertTrue(xok and yok)
        self.assertEqual(len(xs),6);self.assertEqual(len(ys),3)
        self.assertTrue(325<ys[1]<355)
