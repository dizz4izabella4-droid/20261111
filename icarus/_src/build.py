#!/usr/bin/env python3
# src/*.js を番号順に連結し、three.min.js と一緒に1ファイルのHTMLにする
import glob,re,sys,os
here=os.path.dirname(os.path.abspath(__file__))
three=open(os.path.join(here,'node_modules/three/build/three.min.js'),encoding='utf-8').read()
three=re.sub(r'//# sourceMappingURL=.*','',three)
three=re.sub(r'Scripts "build/three\.js" and "build/three\.min\.js"[^\']*','',three)

parts=sorted(glob.glob(os.path.join(here,'src','[0-9]*.js')))+([os.path.join(here,'src','test-stub.js')] if os.environ.get('STUB') else [])+[os.path.join(here,'src','zz-end.js')]
game='\n'.join('/* ---- %s ---- */\n'%os.path.basename(p)+open(p,encoding='utf-8').read() for p in parts)
tpl=open(os.path.join(here,'src','template.html'),encoding='utf-8').read()
out=tpl.replace('/*@@THREE@@*/',three.replace('</script>','<\\/script>')).replace('/*@@GAME@@*/',game.replace('</script>','<\\/script>'))
dst=sys.argv[1] if len(sys.argv)>1 else os.path.join(here,'dist','index.html')
open(dst,'w',encoding='utf-8').write(out)
print(dst,len(out)//1024,'KB')

if os.environ.get('FRAG'):
    import re as _re
    t=open(dst,encoding='utf-8').read()
    t=_re.sub(r'<!doctype html>\s*','',t)
    t=_re.sub(r'<html[^>]*>\s*','',t)
    t=_re.sub(r'</?head>\s*','',t)
    t=_re.sub(r'<meta charset[^>]*>\s*','',t)
    t=_re.sub(r'<meta name="viewport"[^>]*>\s*','',t)
    t=_re.sub(r'<meta name="theme-color"[^>]*>\s*','',t)
    t=_re.sub(r'</?body>\s*','',t)
    t=_re.sub(r'</html>\s*','',t)
    open(dst,'w',encoding='utf-8').write(t)
    print('fragment',dst,len(t)//1024,'KB')
