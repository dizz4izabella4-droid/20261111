# 音声入力の通し確認: python3 final-stop/_test/mic.py
# 擬似の SpeechRecognition を差し込み、一致 / 不一致 / 許可拒否 の3経路を確かめる
import asyncio, os
from playwright.async_api import async_playwright
URL = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'index.html'))
STUB = """
window.__recs = [];
window.SpeechRecognition = class { constructor(){ window.__recs.push(this); this.started=false; this.aborted=false; }
  start(){ this.started=true; if (window.__deny) setTimeout(()=>this.onerror && this.onerror({error:'not-allowed'}), 20); }
  abort(){ this.aborted=true; } };
window.__say = t => { const r = window.__recs[window.__recs.length-1]; r.onresult({ resultIndex:0, results:[[{transcript:t}]] }); };
try { localStorage.setItem('fs.voice','off'); if (!window.__deny) localStorage.setItem('fs.mic','on'); } catch(e){}
"""
async def to_yourturn(pg):
    await pg.evaluate("window.__core.warp('PREVIEW0')")
    await pg.wait_for_timeout(700)
    await pg.mouse.click(195, 300)               # PREVIEW でタップ → SPEAK
    for _ in range(60):
        if await pg.evaluate("window.__core.state.sub") == 'YOURTURN': return True
        await pg.wait_for_timeout(100)
    return False
async def sub(pg): return await pg.evaluate("window.__core.state.sub")
async def main():
    res = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for name in ('match', 'mismatch', 'denied'):
            pg = await b.new_page(viewport={'width': 390, 'height': 844})
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.add_init_script(("window.__deny = true;" if name == 'denied' else "") + STUB)
            await pg.goto(URL + '?debug=1&seed=1')
            await pg.wait_for_timeout(300)
            if name == 'denied':
                await pg.click('[data-b=mic]'); await pg.wait_for_timeout(300)   # ON → 許可確認 → 拒否
                res['denied_label'] = await pg.inner_text('#micbtn')
                await pg.click('[data-b=start]')
                ok = await to_yourturn(pg)
                t0 = await pg.evaluate("window.__core.state.t")
                await pg.wait_for_timeout(3300)
                res['denied_advanced_after_3s'] = (await sub(pg)) != 'YOURTURN'
                res['denied_recs_in_turn'] = await pg.evaluate("window.__recs.length")
            else:
                await pg.click('[data-b=start]')
                ok = await to_yourturn(pg)
                await pg.wait_for_timeout(300)
                res[name + '_listening'] = await pg.evaluate("window.__recs.length>0 && window.__recs[window.__recs.length-1].started")
                res[name + '_hint'] = await pg.inner_text('#cmdhint')
                if name == 'match':
                    await pg.evaluate("window.__say('police show me your hands')")
                    await pg.wait_for_timeout(300)
                    res['match_sub_after_say'] = await sub(pg)
                    res['match_hint'] = await pg.inner_text('#cmdhint')
                else:
                    await pg.evaluate("window.__say('hello world')")
                    await pg.wait_for_timeout(3500)                 # 3.0s を超えてもまだ待っている（mic で4.5s）
                    res['mismatch_still_waiting_at_3.8s'] = (await sub(pg)) == 'YOURTURN'
                    await pg.wait_for_timeout(1400)
                    res['mismatch_advanced_by_5.2s'] = (await sub(pg)) != 'YOURTURN'
                    res['mismatch_aborted'] = await pg.evaluate("window.__recs[0].aborted")
            res[name + '_errors'] = errs
            await pg.close()
        await b.close()
    for k, v in res.items(): print(k, '=', v)
asyncio.run(main())
