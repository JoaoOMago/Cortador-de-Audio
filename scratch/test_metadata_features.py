import sys, os, subprocess, time, urllib.request, json, asyncio, base64

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

try:
    import websockets
except ImportError:
    subprocess.run(["pip", "install", "websockets"])
    import websockets

async def send_and_wait(ws, req_id, method, params=None):
    payload = {"id": req_id, "method": method}
    if params:
        payload["params"] = params
    await ws.send(json.dumps(payload))
    while True:
        msg = await ws.recv()
        data = json.loads(msg)
        if data.get("method") == "Runtime.consoleAPICalled":
            args = [str(a.get('value', a)) for a in data['params']['args']]
            print("[BROWSER CONSOLE]", ' '.join(args))
        elif data.get("method") == "Runtime.exceptionThrown":
            print("[BROWSER EXCEPTION]", data['params']['exceptionDetails'])
        if data.get("id") == req_id:
            return data

async def main():
    from http.server import HTTPServer, SimpleHTTPRequestHandler
    import threading
    server = HTTPServer(('127.0.0.1', 8891), SimpleHTTPRequestHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    proc = subprocess.Popen([edge, '--headless=new', '--remote-debugging-port=9336', 'http://127.0.0.1:8891/docs/index.html'])
    await asyncio.sleep(2)

    try:
        tabs = json.loads(urllib.request.urlopen('http://127.0.0.1:9336/json').read())
        ws_url = [t['webSocketDebuggerUrl'] for t in tabs if t.get('type') == 'page'][0]

        async with websockets.connect(ws_url) as ws:
            await send_and_wait(ws, 1, "Runtime.enable")

            # 1. Test opening the Metadata Configuration modal
            print("\n[TEST 1] Opening Global Metadata Config Modal via ⚙️ button...")
            res = await send_and_wait(ws, 2, "Runtime.evaluate", {
                "expression": """
                (() => {
                    const btn = document.getElementById('btn-open-metadata-config-header');
                    if (!btn) return { error: 'Button not found' };
                    btn.click();
                    const modal = document.getElementById('modal-metadata-config');
                    const isVisible = modal && !modal.classList.contains('hidden');
                    return { isVisible };
                })()
                """,
                "returnByValue": True
            })
            modal_status = res['result']['result']['value']
            print("Modal status:", modal_status)
            assert modal_status.get('isVisible') == True, "Modal should be visible after clicking ⚙️"

            # 2. Test checking "Selecionar todas as opções" and saving
            print("[TEST 2] Testing 'Selecionar todas as opções' toggle...")
            res = await send_and_wait(ws, 3, "Runtime.evaluate", {
                "expression": """
                (() => {
                    const chkAll = document.getElementById('checkbox-toggle-all-metadata');
                    chkAll.checked = true;
                    chkAll.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    const checkboxes = Array.from(document.querySelectorAll('.field-checkbox'));
                    const allChecked = checkboxes.every(c => c.checked);
                    const count = checkboxes.length;
                    
                    // Click save
                    document.getElementById('btn-save-metadata-config').click();
                    const modal = document.getElementById('modal-metadata-config');
                    const isHidden = modal && modal.classList.contains('hidden');
                    
                    return { count, allChecked, isHidden };
                })()
                """,
                "returnByValue": True
            })
            toggle_data = res['result']['result']['value']
            print("Toggle all result:", toggle_data)
            assert toggle_data['allChecked'] == True, "All field checkboxes should be checked"
            assert toggle_data['isHidden'] == True, "Modal should close on Concluir"

            # 3. Upload audio file
            print("\n[TEST 3] Uploading audio file...")
            audio_path = r'C:\Users\jpp12\.gemini\antigravity\brain\fe729641-5e57-44a4-9cc8-4d9eab9cdbe7\.user_uploaded\uploaded_media_1788544301005.mp3'
            with open(audio_path, 'rb') as f:
                b64_data = base64.b64encode(f.read()).decode('utf-8')

            js_code = f"""
            (async () => {{
                const b64 = "{b64_data}";
                const byteCharacters = atob(b64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {{
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }}
                const byteArray = new Uint8Array(byteNumbers);
                const file = new File([byteArray], "A Flock Of Seagulls - I Ran.mp3", {{ type: "audio/mpeg" }});
                
                const input = document.getElementById('audio-file-input');
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                return "uploaded";
            }})()
            """
            await send_and_wait(ws, 4, "Runtime.evaluate", {"expression": js_code, "awaitPromise": True})
            print("Audio uploaded, waiting 3s for metadata & waveform rendering...")
            await asyncio.sleep(3)

            # 4. Verify rendered fields and search buttons (🔍)
            print("\n[TEST 4] Verifying rendered fields and search buttons (🔍)...")
            res = await send_and_wait(ws, 5, "Runtime.evaluate", {
                "expression": """
                (() => {
                    const card = document.querySelector('.track-card');
                    const searchButtons = card.querySelectorAll('.btn-field-search');
                    const titleParent = card.querySelector('.input-title').closest('.form-group');
                    const artistParent = card.querySelector('.input-artist').closest('.form-group');
                    const titleHasSearch = Boolean(titleParent.querySelector('.btn-field-search'));
                    const artistHasSearch = Boolean(artistParent.querySelector('.btn-field-search'));
                    const extraFields = card.querySelectorAll('.extra-metadata-container input, .extra-metadata-container textarea');

                    return {
                        searchBtnCount: searchButtons.length,
                        titleHasSearch,
                        artistHasSearch,
                        extraFieldsCount: extraFields.length
                    };
                })()
                """,
                "returnByValue": True
            })
            fields_data = res['result']['result']['value']
            print("Rendered fields info:", fields_data)
            assert fields_data['searchBtnCount'] >= 10, "Should have search buttons on all fields except title & artist"
            assert fields_data['titleHasSearch'] == False, "Title must not have search button"
            assert fields_data['artistHasSearch'] == False, "Artist must not have search button"
            assert fields_data['extraFieldsCount'] >= 10, "All extra fields should be rendered"

            # 5. Test 🔍 search on Album to verify Google-style autocomplete dropdown
            print("\n[TEST 5] Testing 🔍 search on Álbum...")
            res = await send_and_wait(ws, 6, "Runtime.evaluate", {
                "expression": """
                (async () => {
                    const card = document.querySelector('.track-card');
                    const albumGroup = card.querySelector('.input-search-group[data-field="album"]');
                    const btn = albumGroup.querySelector('.btn-field-search');
                    btn.click();
                    return "clicked";
                })()
                """,
                "awaitPromise": True,
                "returnByValue": True
            })

            # Wait for search results in dropdown
            await asyncio.sleep(2)
            res = await send_and_wait(ws, 7, "Runtime.evaluate", {
                "expression": """
                (() => {
                    const card = document.querySelector('.track-card');
                    const albumGroup = card.querySelector('.input-search-group[data-field="album"]');
                    const dropdown = albumGroup.querySelector('.search-suggestions-dropdown');
                    const items = dropdown ? Array.from(dropdown.querySelectorAll('.suggestion-item')) : [];
                    const count = items.length;
                    let firstTitle = '';
                    if (count > 0) {
                        firstTitle = items[0].querySelector('.suggestion-main')?.textContent || '';
                        // Click first suggestion
                        items[0].click();
                    }
                    const updatedVal = card.querySelector('.input-album')?.value || '';
                    return { count, firstTitle, updatedVal };
                })()
                """,
                "returnByValue": True
            })
            album_sugg_data = res['result']['result']['value']
            print("Album suggestions result:", album_sugg_data)
            assert album_sugg_data['count'] > 0, "Should return album suggestions"
            assert album_sugg_data['updatedVal'] == album_sugg_data['firstTitle'], "Album input should update on selection"

            # 6. Test 🔍 search on BPM (calculates WebAudio PCM BPM)
            print("\n[TEST 6] Testing 🔍 search on BPM...")
            res = await send_and_wait(ws, 8, "Runtime.evaluate", {
                "expression": """
                (async () => {
                    const card = document.querySelector('.track-card');
                    const bpmGroup = card.querySelector('.input-search-group[data-field="bpm"]');
                    const btn = bpmGroup.querySelector('.btn-field-search');
                    btn.click();
                    return "clicked";
                })()
                """,
                "awaitPromise": True,
                "returnByValue": True
            })
            await asyncio.sleep(2)
            res = await send_and_wait(ws, 9, "Runtime.evaluate", {
                "expression": """
                (() => {
                    const card = document.querySelector('.track-card');
                    const bpmGroup = card.querySelector('.input-search-group[data-field="bpm"]');
                    const dropdown = bpmGroup.querySelector('.search-suggestions-dropdown');
                    const items = dropdown ? Array.from(dropdown.querySelectorAll('.suggestion-item')) : [];
                    const count = items.length;
                    let firstBpm = '';
                    if (count > 0) {
                        firstBpm = items[0].querySelector('.suggestion-main')?.textContent || '';
                        items[0].click();
                    }
                    const updatedBpm = card.querySelector('.input-bpm')?.value || '';
                    return { count, firstBpm, updatedBpm };
                })()
                """,
                "returnByValue": True
            })
            bpm_sugg_data = res['result']['result']['value']
            print("BPM suggestions result:", bpm_sugg_data)
            assert bpm_sugg_data['count'] > 0, "Should return BPM options"
            assert len(bpm_sugg_data['updatedBpm']) > 0, "BPM input should be populated"

            # 7. Test full FFmpeg processing with all extended metadata
            print("\n[TEST 7] Testing full FFmpeg export with extended metadata tags...")
            res = await send_and_wait(ws, 10, "Runtime.evaluate", {
                "expression": """
                (async () => {
                    const card = document.querySelector('.track-card');
                    const btnDownloadSingle = card.querySelector('.btn-download-single');
                    btnDownloadSingle.click();
                    return "clicked";
                })()
                """,
                "awaitPromise": True,
                "returnByValue": True
            })

            # Wait for processing
            for wait_step in range(35):
                await asyncio.sleep(1)
                check_res = await send_and_wait(ws, 100 + wait_step, "Runtime.evaluate", {
                    "expression": """
                    (() => {
                        const card = document.querySelector('.track-card');
                        const statusBadge = card.querySelector('.badge-status');
                        const status = statusBadge ? statusBadge.getAttribute('data-status') : '';
                        const statusText = statusBadge ? statusBadge.textContent : '';
                        const processMsg = card.querySelector('.process-msg')?.textContent || '';
                        return { status, statusText, processMsg };
                    })()
                    """,
                    "returnByValue": True
                })
                current_state = check_res['result']['result']['value']
                print(f"[{wait_step}s] State:", current_state)
                if current_state['status'] in ['ready', 'error']:
                    break

            assert current_state['status'] == 'ready', f"Processing failed! Final state: {current_state}"
            print("\nALL METADATA & SEARCH & FFMPEG EXPORT TESTS PASSED! Status: Ready ✓ ✅")

    finally:
        proc.kill()
        server.shutdown()

asyncio.run(main())
