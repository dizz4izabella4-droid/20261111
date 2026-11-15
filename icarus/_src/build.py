#!/usr/bin/env python3
# src/*.js を番号順に連結し、three.min.js と一緒に1ファイルのHTMLにする
import glob,re,sys,os
here=os.path.dirname(os.path.abspath(__file__))
three=open(os.path.join(here,'node_modules/three/build/three.min.js'),encoding='utf-8').read()
three=re.sub(r'//# sourceMappingURL=.*','',three)
parts=sorted(glob.glob(os.path.join(here,'src','[0-9]*.js')))+[os.path.join(here,'src','zz-end.js')]
game='\n'.join('/* ---- %s ---- */\n'%os.path.basename(p)+open(p,encoding='utf-8').read() for p in parts)
tpl=open(os.path.join(here,'src','template.html'),encoding='utf-8').read()
out=tpl.replace('/*@@THREE@@*/',three.replace('</script>','<\\/script>')).replace('/*@@GAME@@*/',game.replace('</script>','<\\/script>'))
dst=sys.argv[1] if len(sys.argv)>1 else os.path.join(here,'dist','index.html')
os.makedirs(os.path.dirname(os.path.abspath(dst)),exist_ok=True)
open(dst,'w',encoding='utf-8').write(out)
print(dst,len(out)//1024,'KB')
