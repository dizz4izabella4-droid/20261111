"""End-to-end check of tools/voice.html with Playwright (Chromium). macOS (uses `say`).

    python3 -m http.server 8765 --bind 127.0.0.1        # in the repo root
    VENV/bin/python tools/voice-align/tests/e2e_playwright.py WORKDIR   # VENV has playwright + numpy

WORKDIR receives generated TTS audio and the downloads. The exported pack is
unpacked into tools/voice-align/.build/e2e-pack (git-ignored) so the test page
can load it from the same server. TTS audio is not a human voice.
"""
import asyncio, glob, json, os, subprocess, sys, zipfile, shutil
from playwright.async_api import async_playwright

S = os.path.abspath(sys.argv[1])
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
BASE = "http://127.0.0.1:8765/tools/"
PY = sys.executable
OUT = S + "/e2e/out"
PACKDIR = REPO + "/tools/voice-align/.build/e2e-pack"
os.makedirs(OUT, exist_ok=True)
log = []
def note(*a):
    s = " ".join(str(x) for x in a); print(s); log.append(s)

async def errors_of(pg):
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERR " + str(e)))
    pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    return errs

def prepare():
    """TTS sentence recordings s01..s16 and a fake-microphone file (あ..こ, one by one)."""
    sys.path.insert(0, os.path.join(REPO, "tools", "voice-align")); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import numpy as np
    from make_synthetic import render
    from align import write_wav16, resample
    os.makedirs(S + "/e2e/sent", exist_ok=True)
    for s in json.load(open(os.path.join(REPO, "tools", "voice-align", "sentences.json")))["sentences"]:
        subprocess.run(["say", "-v", "Kyoko", "--data-format=LEI16@48000", "-o", S + "/e2e/sent/%s.wav" % s["id"], s["kana"]], check=True)
    sr = 22050; parts = [np.zeros(int(0.5 * sr))]
    for m in "あいうえおかきくけこ":
        parts += [render(m, "Kyoko"), np.zeros(int(0.55 * sr))]
    write_wav16(S + "/e2e/fakemic.wav", resample(np.concatenate(parts), sr, 48000) * 0.8, 48000)


async def main():
    if not os.path.exists(S + "/e2e/fakemic.wav"):
        prepare()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
            "--use-file-for-fake-audio-capture=" + S + "/e2e/fakemic.wav", "--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width": 1280, "height": 800}, accept_downloads=True, permissions=["microphone"])
        pg = await ctx.new_page()
        errs = await errors_of(pg)
        await pg.goto(BASE + "voice.html")
        await pg.wait_for_function("window.__voiceReady === true")

        # ---------- A. fake microphone: record missing morae one by one -> silence split -> assigned in order
        await pg.click("#btnRecMissing")
        await pg.click("#recStart")
        await pg.wait_for_timeout(7600)
        await pg.click("#recStop")
        await pg.wait_for_function("VoiceCore.Project.get().recordings.length === 1", timeout=15000)
        r = await pg.evaluate("(() => { const r = VoiceCore.Project.get().recordings[0]; return {kind: r.kind, sec: r.length / r.sampleRate, n: r.labels.length, kana: r.labels.map(l => l.kana), exp: r.expected.slice(0, 10)}; })()")
        note("A fake-mic recording:", r["kind"], "%.2fs" % r["sec"], "segments", r["n"], "first labels", "".join(r["kana"][:10]), "expected", "".join(r["exp"]))
        okA = r["n"] >= 10 and r["kana"][:10] == r["exp"]
        note("A result:", "OK" if okA else "NG")

        # ---------- B. interrupted recording -> reload -> restore from IndexedDB chunks
        await pg.click('.sent[data-sid="s01"] button[data-act="rec"]')
        await pg.click("#recStart")
        await pg.wait_for_timeout(3300)
        await pg.reload()
        await pg.wait_for_function("window.__voiceReady === true")
        await pg.wait_for_selector("#rsYes", timeout=8000)
        n_before = await pg.evaluate("VoiceCore.Project.get().recordings.length")
        await pg.click("#rsYes")
        await pg.wait_for_function(f"VoiceCore.Project.get().recordings.length === {n_before + 1}", timeout=15000)
        rr = await pg.evaluate("(() => { const r = VoiceCore.Project.get().recordings.slice(-1)[0]; return {name: r.name, sec: r.length / r.sampleRate, sid: r.sentenceId}; })()")
        note("B restored after reload:", rr, "(autosaved project had", n_before, "recording(s))")
        okB = n_before == 1 and rr["sid"] == "s01" and rr["sec"] > 1.5
        # remove the restored test recordings so the rest uses the TTS sentences
        await pg.evaluate("VoiceCore.Project.reset('E2E')")

        # ---------- C. bulk import s01..s16 (TTS sentences, not my voice)
        async with pg.expect_file_chooser() as fc:
            await pg.click("#btnBulkImport")
        await (await fc.value).set_files(sorted(glob.glob(S + "/e2e/sent/s*.wav")))
        await pg.wait_for_function("VoiceCore.Project.get().recordings.length === 16", timeout=30000)
        note("C imported recordings:", 16)

        # ---------- D. cut request -> align.py -> labels.json -> import
        async with pg.expect_download() as dl:
            await pg.click("#btnCutReqAll")
        d = await dl.value
        req = OUT + "/" + d.suggested_filename
        await d.save_as(req)
        z = zipfile.ZipFile(req)
        note("D cut request:", d.suggested_filename, "entries", len(z.namelist()), "bytes", os.path.getsize(req))
        labels = OUT + "/labels.json"
        pr = subprocess.run([PY, REPO + "/tools/voice-align/align.py", req, "-o", labels], capture_output=True, text=True)
        note("D align.py stderr:\n" + pr.stderr.strip())
        async with pg.expect_file_chooser() as fc:
            await pg.click("#btnImportLabels1")
        await (await fc.value).set_files(labels)
        await pg.wait_for_function("VoiceCore.Project.get().recordings.every(r => r.labels.length > 0)", timeout=15000)
        cov = await pg.inner_text("#covText")
        miss = await pg.inner_text("#missingChips")
        note("D coverage after labels:", cov, "| missing:", miss.replace("\n", " "))

        # ---------- E. cut editor: drag a boundary, check it becomes manual
        await pg.click('#tabs button[data-tab="cut"]')
        await pg.select_option("#cutRec", index=0)
        await pg.wait_for_timeout(200)
        info = await pg.evaluate("""(() => { const V = VoiceCore, id = V.Editor.rec(), r = V.Project.rec(id), v = V.Editor.view();
            const c = document.getElementById('wave').getBoundingClientRect(); const l = r.labels[2];
            return {x: c.left + (l.end - v.t0) / (v.t1 - v.t0) * c.width, y: c.top + c.height / 2, end: l.end, start3: r.labels[3].start, w: c.width, dur: v.t1 - v.t0}; })()""")
        await pg.mouse.move(info["x"], info["y"]); await pg.mouse.down()
        await pg.mouse.move(info["x"] + 15, info["y"], steps=5); await pg.mouse.up()
        after = await pg.evaluate("(() => { const r = VoiceCore.Project.rec(VoiceCore.Editor.rec()); return {end: r.labels[2].end, src: r.labels[2].src, start3: r.labels[3].start}; })()")
        moved_ms = (after["end"] - info["end"]) * 1000
        note("E drag boundary: moved %.1f ms (expected %.1f), src=%s, next label start follows: %s" % (moved_ms, 15 / info["w"] * info["dur"] * 1000, after["src"], abs(after["start3"] - after["end"]) < 0.002 if abs(info["start3"] - info["end"]) < 0.002 else "n/a (gap)"))
        okE = moved_ms > 5 and after["src"] == "manual"
        # create a region by dragging on empty space is covered by unit tests of labels; keyboard select+play
        await pg.focus("#wave"); await pg.keyboard.press("ArrowRight"); await pg.keyboard.press("Space")

        # ---------- F. bank
        await pg.click('#tabs button[data-tab="bank"]')
        await pg.click('#bankGrid [data-k="か"]')
        rows = await pg.locator("#bankDetail tr").count()
        bank = await pg.evaluate("(() => { const c = VoiceCore.Bank.context(); return {ref: c.ref, kinds: c.map.size, takes: c.all.length, warn: document.querySelectorAll('#bankGrid .cell.warn').length, none: document.querySelectorAll('#bankGrid .cell.none').length}; })()")
        note("F bank:", bank, "| か takes rows", rows - 1)

        # ---------- G. speak
        await pg.click('#tabs button[data-tab="speak"]')
        await pg.fill("#speakText", "きゃくが きた。ひゃくにんの 行列{ぎょうれつ}です！ 50%")
        await pg.wait_for_timeout(300)
        reading = await pg.inner_text("#readingView")
        red = await pg.locator("#moraChips .chip.bad").count()
        await pg.click("#btnSpeak")
        await pg.wait_for_timeout(400)
        now = await pg.locator("#moraChips .chip.now").count()
        async with pg.expect_download() as dl:
            await pg.click("#btnSpeakWav")
        d = await dl.value
        spk = OUT + "/speak.wav"; await d.save_as(spk)
        dic = await pg.evaluate("VoiceCore.Project.get().dictionary")
        note("G reading:", reading, "| red chips", red, "| highlighted while playing", now, "| dictionary", dic)

        # ---------- H. ledger + phrase + export pack (ZIP path)
        await pg.click('#tabs button[data-tab="ledger"]')
        for i, t in [("greet.1", "こんにちわ。"), ("dmg.1", "50の ダメージ！"), ("boss.1", "ぎゃくに ぎょうざお たべた"), ("bad.1", "未知の漢字")]:
            await pg.fill("#lineId", i); await pg.fill("#lineText", t); await pg.click("#lineAdd")
        st = await pg.inner_text("#lineTable")
        async with pg.expect_download() as dl:
            await pg.click("#packZip")
        d = await dl.value
        pz = OUT + "/" + d.suggested_filename; await d.save_as(pz)
        shutil.rmtree(PACKDIR, ignore_errors=True)
        zipfile.ZipFile(pz).extractall(PACKDIR)
        rep = await pg.inner_text("#packReport")
        note("H ledger:\n" + st + "\nH export:", d.suggested_filename, "\n" + rep)

        # ---------- I. save (download fallback) -> new -> open (file chooser fallback)
        await pg.evaluate("delete window.showSaveFilePicker; delete window.showOpenFilePicker; window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined;")
        async with pg.expect_download() as dl:
            await pg.click("#btnSave")
        d = await dl.value
        proj = OUT + "/" + d.suggested_filename; await d.save_as(proj)
        snap = await pg.evaluate("JSON.stringify(VoiceCore.Project.get().recordings.map(r => [r.id, r.labels.map(l => [l.kana, l.start.toFixed(4), l.end.toFixed(4)])]))")
        await pg.evaluate("VoiceCore.Project.reset('empty')")
        async with pg.expect_file_chooser() as fc:
            await pg.click("#btnOpen")
        await (await fc.value).set_files(proj)
        await pg.wait_for_function("VoiceCore.Project.get().recordings.length === 16", timeout=20000)
        snap2 = await pg.evaluate("JSON.stringify(VoiceCore.Project.get().recordings.map(r => [r.id, r.labels.map(l => [l.kana, l.start.toFixed(4), l.end.toFixed(4)])]))")
        note("I project file:", os.path.basename(proj), os.path.getsize(proj), "bytes; reopened identical:", snap == snap2)

        # ---------- J. reload -> autosave restore
        await pg.wait_for_timeout(2200)
        await pg.reload(); await pg.wait_for_function("window.__voiceReady === true")
        n = await pg.evaluate("VoiceCore.Project.get().recordings.length")
        note("J after reload, recordings restored from IndexedDB:", n)
        note("console errors (1280x800 run):", errs)

        # ---------- K. phone viewport with the loaded project
        pg2 = await ctx.new_page(); await pg2.set_viewport_size({"width": 390, "height": 780})
        errs2 = await errors_of(pg2)
        await pg2.goto(BASE + "voice.html"); await pg2.wait_for_function("window.__voiceReady === true")
        for t in ["script", "cut", "bank", "speak", "ledger", "settings"]:
            await pg2.click(f'#tabs button[data-tab="{t}"]'); await pg2.wait_for_timeout(200)
            await pg2.screenshot(path=OUT + f"/m-{t}.png")
        await pg2.click('#tabs button[data-tab="cut"]'); await pg2.wait_for_timeout(200)
        box = await pg2.locator("#wave").bounding_box()
        sw = await pg2.evaluate("document.documentElement.scrollWidth")
        note("K 390x780: console errors", errs2, "scrollWidth", sw)
        await pg.set_viewport_size({"width": 1280, "height": 800})
        for t in ["script", "cut", "bank", "speak", "ledger"]:
            await pg.click(f'#tabs button[data-tab="{t}"]'); await pg.wait_for_timeout(200)
            await pg.screenshot(path=OUT + f"/d-{t}.png", full_page=False)

        # ---------- L. test page plays the exported pack
        pg3 = await ctx.new_page()
        errs3 = await errors_of(pg3)
        await pg3.goto(BASE + "voice-test.html?pack=voice-align/.build/e2e-pack/voice/")
        await pg3.wait_for_function("window.__testsDone === true", timeout=60000)
        core = await pg3.evaluate("window.__coreTests"); pack = await pg3.evaluate("window.__packTest")
        note("L test page: core", core["pass"], "/", core["total"], "| pack", json.dumps(pack, ensure_ascii=False), "| console errors", errs3)
        note("SUMMARY A(fake mic split)=%s B(restore)=%s E(drag)=%s" % (okA, okB, okE))
        await b.close()
    open(OUT + "/e2e-log.txt", "w").write("\n".join(log))

asyncio.run(main())
