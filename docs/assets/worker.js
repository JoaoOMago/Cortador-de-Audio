(function () {
  let e = `https://unpkg.com/@ffmpeg/core@0.12.9/dist/umd/ffmpeg-core.js`;
  var t;
  (function (e) {
    e.LOAD = `LOAD`;
    e.EXEC = `EXEC`;
    e.FFPROBE = `FFPROBE`;
    e.WRITE_FILE = `WRITE_FILE`;
    e.READ_FILE = `READ_FILE`;
    e.DELETE_FILE = `DELETE_FILE`;
    e.RENAME = `RENAME`;
    e.CREATE_DIR = `CREATE_DIR`;
    e.LIST_DIR = `LIST_DIR`;
    e.DELETE_DIR = `DELETE_DIR`;
    e.ERROR = `ERROR`;
    e.DOWNLOAD = `DOWNLOAD`;
    e.PROGRESS = `PROGRESS`;
    e.LOG = `LOG`;
    e.MOUNT = `MOUNT`;
    e.UNMOUNT = `UNMOUNT`;
  })(t ||= {});

  let n = Error(`unknown message type`);
  let r = Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
  let i = Error(`failed to import ffmpeg-core.js`);
  let a;

  let o = async ({ coreURL: n, wasmURL: r, workerURL: o }) => {
    let s = !a;
    try {
      n ||= e;
      importScripts(n);
    } catch {
      if ((!n || n === e) && (n = e.replace(`/umd/`, `/esm/`))) {
        self.createFFmpegCore = (await import(n)).default;
        if (!self.createFFmpegCore) throw i;
      }
    }

    let c = n;
    let l = r || n.replace(/.js$/g, `.wasm`);
    let u = o || n.replace(/.js$/g, `.worker.js`);

    a = await self.createFFmpegCore({
      mainScriptUrlOrBlob: `${c}#${btoa(JSON.stringify({ wasmURL: l, workerURL: u }))}`
    });

    a.setLogger((e) => self.postMessage({ type: t.LOG, data: e }));
    a.setProgress((e) => self.postMessage({ type: t.PROGRESS, data: e }));
    return s;
  };

  let s = ({ args: e, timeout: t = -1 }) => {
    a.setTimeout(t);
    a.exec(...e);
    let n = a.ret;
    a.reset();
    return n;
  };

  let c = ({ args: e, timeout: t = -1 }) => {
    a.setTimeout(t);
    a.ffprobe(...e);
    let n = a.ret;
    a.reset();
    return n;
  };

  let l = ({ path: e, data: t }) => (a.FS.writeFile(e, t), !0);
  let u = ({ path: e, encoding: t }) => a.FS.readFile(e, { encoding: t });
  let d = ({ path: e }) => (a.FS.unlink(e), !0);
  let f = ({ oldPath: e, newPath: t }) => (a.FS.rename(e, t), !0);
  let p = ({ path: e }) => (a.FS.mkdir(e), !0);

  let m = ({ path: e }) => {
    let t = a.FS.readdir(e);
    let n = [];
    for (let r of t) {
      let t = a.FS.stat(`${e}/${r}`);
      let i = a.FS.isDir(t.mode);
      n.push({ name: r, isDir: i });
    }
    return n;
  };

  let h = ({ path: e }) => (a.FS.rmdir(e), !0);

  let g = ({ fsType: e, options: t, mountPoint: n }) => {
    let r = e;
    let i = a.FS.filesystems[r];
    return i ? (a.FS.mount(i, t, n), !0) : !1;
  };

  let _ = ({ mountPoint: e }) => (a.FS.unmount(e), !0);

  self.onmessage = async ({ data: { id: e, type: i, data: v } }) => {
    let y = [];
    let b;
    try {
      if (i !== t.LOAD && !a) throw r;
      switch (i) {
        case t.LOAD:
          b = await o(v);
          break;
        case t.EXEC:
          b = s(v);
          break;
        case t.FFPROBE:
          b = c(v);
          break;
        case t.WRITE_FILE:
          b = l(v);
          break;
        case t.READ_FILE:
          b = u(v);
          break;
        case t.DELETE_FILE:
          b = d(v);
          break;
        case t.RENAME:
          b = f(v);
          break;
        case t.CREATE_DIR:
          b = p(v);
          break;
        case t.LIST_DIR:
          b = m(v);
          break;
        case t.DELETE_DIR:
          b = h(v);
          break;
        case t.MOUNT:
          b = g(v);
          break;
        case t.UNMOUNT:
          b = _(v);
          break;
        default:
          throw n;
      }
    } catch (n) {
      self.postMessage({ id: e, type: t.ERROR, data: n.toString() });
      return;
    }

    if (b instanceof Uint8Array) {
      y.push(b.buffer);
    }
    self.postMessage({ id: e, type: i, data: b }, y);
  };
})();