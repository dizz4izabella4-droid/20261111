"""Compare a mesh projection with its local reference. Blue=reference, orange=mesh.
Usage: python3 scripts/compare-hand-reference.py reference.png projection.json output.png
The wrist/forearm below y=775 is intentionally excluded.
"""
from PIL import Image, ImageDraw, ImageChops
import json,sys
ref=Image.open(sys.argv[1]).convert('L').point(lambda x:255 if x<100 else 0)
j=json.load(open(sys.argv[2])); mesh=Image.new('L',ref.size);d=ImageDraw.Draw(mesh)
for i in range(0,len(j['indices']),3):
 d.polygon([tuple(j['points'][n]) for n in j['indices'][i:i+3]], fill=255)
roi=(460,0,980,775);a,b=ref.crop(roi),mesh.crop(roi)
intersection=ImageChops.darker(a,b).histogram()[255];union=ImageChops.lighter(a,b).histogram()[255]
print(json.dumps({'region':list(roi),'silhouette_iou':round(intersection/union,5)}))
out=Image.new('RGB',ref.size,'white');out.paste((140,190,240),mask=ref);out.paste((230,130,90),mask=mesh)
out.paste((70,70,70),mask=ImageChops.darker(ref,mesh));d=ImageDraw.Draw(out)
for bone in j['bones']:
 x,y=bone['point'];d.ellipse((x-4,y-4,x+4,y+4),fill=(60,240,120))
out.crop((450,0,990,810)).save(sys.argv[3])
