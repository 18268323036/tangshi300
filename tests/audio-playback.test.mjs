import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const projectRoot = '/Users/zhangxy5/小项目/tangshi-app';
const htmlPath = path.join(projectRoot, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createClassList(target) {
  return {
    add(...tokens) {
      const set = new Set((target.className || '').split(/\s+/).filter(Boolean));
      for (const token of tokens) set.add(token);
      target.className = [...set].join(' ');
    },
    remove(...tokens) {
      const set = new Set((target.className || '').split(/\s+/).filter(Boolean));
      for (const token of tokens) set.delete(token);
      target.className = [...set].join(' ');
    },
    toggle(token, force) {
      const set = new Set((target.className || '').split(/\s+/).filter(Boolean));
      const shouldAdd = force ?? !set.has(token);
      if (shouldAdd) set.add(token);
      else set.delete(token);
      target.className = [...set].join(' ');
      return shouldAdd;
    },
    contains(token) {
      return (target.className || '').split(/\s+/).filter(Boolean).includes(token);
    },
  };
}

function createElement(id, extra = {}) {
  const element = {
    id,
    textContent: '',
    className: '',
    dataset: {},
    disabled: false,
    removeAttributeCalls: 0,
    scrollIntoViewCalls: 0,
    style: {},
    children: [],
    _innerHTML: '',
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value) {
      this._innerHTML = value;
    },
    load() {
      this.loadCalls = (this.loadCalls || 0) + 1;
    },
    removeAttribute(name) {
      if (name === 'src') {
        this.removeAttributeCalls += 1;
        this.src = '';
      }
    },
    closest() {
      return this;
    },
    scrollIntoView() {
      this.scrollIntoViewCalls += 1;
    },
    ...extra,
  };
  element.classList = createClassList(element);
  return element;
}

function createAudioElement(id, overrides = {}) {
  const element = createElement(id, {
    src: '',
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    paused: true,
    playCalls: 0,
    pauseCalls: 0,
    async play() {
      this.playCalls += 1;
      this.paused = false;
      return undefined;
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    ...overrides,
  });
  return element;
}

function buildHarness({
  manifest = {
    voices: {
      female: { label: '女声' },
      child: { label: '童声' },
    },
    tracks: {
      '0': {
        title: '静夜思',
        author: '李白',
        audio: {
          female: { src: 'audio/female/0.mp3', duration: 13.82 },
          child: { src: 'audio/child/0.mp3', duration: 12.94 },
        },
      },
    },
  },
  fetchOk = true,
  audioOverrides = {},
} = {}) {
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'inline script block should exist');

  const storage = new Map();
  const elements = new Map();
  const dots = Array.from({ length: 3 }, (_, index) =>
    createElement(`dot-${index}`, { dataset: { i: String(index) } }),
  );

  function getElement(id) {
    if (!elements.has(id)) {
      const factory = id === 'poemAudio'
        ? (elementId) => createAudioElement(elementId, audioOverrides)
        : createElement;
      elements.set(id, factory(id));
    }
    return elements.get(id);
  }

  const document = {
    getElementById: getElement,
    querySelectorAll(selector) {
      if (selector === '.carousel-dots span') {
        return dots;
      }
      if (selector === '.poem-line.reading') {
        return [...elements.values()].filter((element) =>
          (element.className || '').split(/\s+/).includes('poem-line') &&
          (element.className || '').split(/\s+/).includes('reading'),
        );
      }
      return [];
    },
  };

  const context = {
    console,
    window: {
      addEventListener() {},
      scrollTo() {},
    },
    document,
    fetch: async () => ({
      ok: fetchOk,
      status: fetchOk ? 200 : 500,
      json: async () => manifest,
    }),
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
    alert() {},
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
  };

  vm.createContext(context);
  vm.runInContext(
    `${scriptMatch[1]}\nthis.__exports = {
      loadAudioManifest,
      resolveAudioTrack,
      setVoiceMode,
      preparePoemAudio,
      togglePlay,
      startPlay,
      stopPlay,
      getActiveLineIndex,
      syncPlaybackFrame,
      changeSpeed
    };`,
    context,
  );

  getElement('playBtn');
  getElement('audioStatus');
  getElement('progressFill');
  getElement('poemAudio');
  getElement('img0').className = 'active';
  getElement('img1').className = 'inactive';
  getElement('img2').className = 'inactive';

  return {
    context,
    dots,
    elements,
    storage,
    ...context.__exports,
  };
}

test('resolveAudioTrack 从 manifest 取到指定 voice 的资源', async () => {
  const harness = buildHarness();

  await harness.loadAudioManifest();

  const track = harness.resolveAudioTrack(0, 'child');
  assert.equal(track.src, 'audio/child/0.mp3');
});

test('resolveAudioTrack 在当前 voice 缺失时返回 null', async () => {
  const harness = buildHarness({
    manifest: {
      voices: {
        female: { label: '女声' },
        child: { label: '童声' },
      },
      tracks: {
        '0': {
          title: '静夜思',
          author: '李白',
          audio: {
            female: { src: 'audio/female/0.mp3', duration: 13.82 },
          },
        },
      },
    },
  });

  await harness.loadAudioManifest();

  assert.equal(harness.resolveAudioTrack(0, 'child'), null);
});

test('setVoiceMode 会把值写入 poemVoiceMode', async () => {
  const harness = buildHarness();

  await harness.loadAudioManifest();
  harness.setVoiceMode('child');

  assert.equal(harness.storage.get('poemVoiceMode'), 'child');
});

test('preparePoemAudio 会切到 child 音频资源并应用播放速率', async () => {
  const harness = buildHarness();

  await harness.loadAudioManifest();
  vm.runInContext(`
    currentPoemIndex = 0;
    currentPoem = poems[0];
    speechRate = 1.25;
    poemAudio = document.getElementById('poemAudio');
  `, harness.context);

  const track = harness.preparePoemAudio(0);

  const poemAudio = harness.elements.get('poemAudio');
  assert.equal(track.src, 'audio/female/0.mp3');
  assert.equal(poemAudio.src, 'audio/female/0.mp3');
  assert.equal(poemAudio.playbackRate, 1.25);
  assert.equal(poemAudio.loadCalls, 1);
  assert.equal(harness.elements.get('playBtn').disabled, false);
});

test('preparePoemAudio 在缺失 voice 时禁用播放按钮并显示状态文案', async () => {
  const harness = buildHarness({
    manifest: {
      voices: {
        female: { label: '女声' },
        child: { label: '童声' },
      },
      tracks: {
        '0': {
          title: '静夜思',
          author: '李白',
          audio: {
            female: { src: 'audio/female/0.mp3', duration: 13.82 },
          },
        },
      },
    },
  });

  await harness.loadAudioManifest();
  vm.runInContext(`
    currentPoemIndex = 0;
    currentPoem = poems[0];
    voiceMode = 'child';
    poemAudio = document.getElementById('poemAudio');
    poemAudio.src = 'audio/female/0.mp3';
  `, harness.context);

  const track = harness.preparePoemAudio(0);

  const poemAudio = harness.elements.get('poemAudio');
  assert.equal(track, null);
  assert.equal(poemAudio.src, '');
  assert.equal(poemAudio.removeAttributeCalls, 1);
  assert.equal(poemAudio.loadCalls, 1);
  assert.equal(harness.elements.get('playBtn').disabled, true);
  assert.equal(harness.elements.get('audioStatus').textContent, '当前声音版本尚未生成');
});

test('getActiveLineIndex 会跳过题目和作者并落到正确诗句', () => {
  const harness = buildHarness();

  vm.runInContext(`
    currentPoem = {
      title: '静夜思',
      author: '李白',
      lines: [
        Array.from({ length: 5 }, (_, i) => ({ c: String(i), p: 'a' })),
        Array.from({ length: 5 }, (_, i) => ({ c: String(i), p: 'a' })),
        Array.from({ length: 5 }, (_, i) => ({ c: String(i), p: 'a' })),
        Array.from({ length: 5 }, (_, i) => ({ c: String(i), p: 'a' }))
      ]
    };
  `, harness.context);

  assert.equal(harness.getActiveLineIndex(0.12), -1);
  assert.equal(harness.getActiveLineIndex(0.72), 2);
});

test('syncPlaybackFrame 会按音频进度更新进度条、图片和行高亮', async () => {
  const harness = buildHarness();

  await harness.loadAudioManifest();
  harness.elements.set('poem-line-0', createElement('poem-line-0', { className: 'poem-line' }));
  harness.elements.set('poem-line-1', createElement('poem-line-1', { className: 'poem-line' }));
  harness.elements.set('poem-line-2', createElement('poem-line-2', { className: 'poem-line' }));
  harness.elements.set('poem-line-3', createElement('poem-line-3', { className: 'poem-line' }));

  vm.runInContext(`
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
    poemAudio.duration = 20;
    poemAudio.currentTime = 14.4;
  `, harness.context);

  harness.syncPlaybackFrame();

  assert.equal(harness.elements.get('progressFill').style.width, '72%');
  assert.equal(harness.elements.get('img2').className, 'active');
  assert.ok(harness.elements.get('poem-line-2').classList.contains('reading'));
});

test('startPlay 通过共享 audio 播放并在切换声音时从头重播', async () => {
  const harness = buildHarness();

  await harness.loadAudioManifest();
  vm.runInContext(`
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
    poemAudio.currentTime = 8;
  `, harness.context);

  await harness.startPlay();
  harness.elements.get('poemAudio').currentTime = 6;
  harness.setVoiceMode('child');

  const poemAudio = harness.elements.get('poemAudio');
  assert.equal(poemAudio.playCalls, 2);
  assert.equal(poemAudio.pauseCalls, 1);
  assert.equal(poemAudio.currentTime, 0);
  assert.equal(poemAudio.src, 'audio/child/0.mp3');
  assert.equal(harness.elements.get('playBtn').textContent, '⏸');
});

test('togglePlay 在播放中只暂停不重置 currentTime，再次点击会续播', async () => {
  const harness = buildHarness();

  await harness.loadAudioManifest();
  vm.runInContext(`
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
    poemAudio.duration = 20;
  `, harness.context);

  await harness.startPlay();
  harness.elements.get('poemAudio').currentTime = 6.5;
  harness.togglePlay();

  const poemAudio = harness.elements.get('poemAudio');
  assert.equal(poemAudio.pauseCalls, 1);
  assert.equal(poemAudio.currentTime, 6.5);
  assert.equal(harness.elements.get('playBtn').textContent, '▶');

  harness.togglePlay();

  assert.equal(poemAudio.playCalls, 2);
  assert.equal(poemAudio.currentTime, 6.5);
  assert.equal(harness.elements.get('playBtn').textContent, '⏸');
});

test('旧 play promise 迟到 reject 不会污染切 voice 后的新播放状态', async () => {
  const firstPlay = createDeferred();
  const harness = buildHarness({
    audioOverrides: {
      play() {
        this.playCalls += 1;
        this.paused = false;
        if (this.playCalls === 1) {
          return firstPlay.promise;
        }
        return Promise.resolve();
      },
    },
  });

  await harness.loadAudioManifest();
  vm.runInContext(`
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
  `, harness.context);

  void harness.startPlay({ reset: true });
  harness.setVoiceMode('child');
  firstPlay.reject(new Error('stale play failed'));
  await flushAsyncWork();

  const poemAudio = harness.elements.get('poemAudio');
  assert.equal(poemAudio.playCalls, 2);
  assert.equal(poemAudio.src, 'audio/child/0.mp3');
  assert.equal(harness.elements.get('playBtn').textContent, '⏸');
  assert.equal(harness.elements.get('audioStatus').textContent, '');
  assert.equal(vm.runInContext('isPlaying', harness.context), true);
});

test('changeSpeed 会同步更新共享 audio 的 playbackRate', async () => {
  const harness = buildHarness();

  await harness.loadAudioManifest();
  vm.runInContext(`
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
  `, harness.context);

  harness.preparePoemAudio(0);
  harness.changeSpeed(1);

  assert.equal(harness.elements.get('poemAudio').playbackRate, 1.25);
  assert.equal(harness.elements.get('speedLabel').textContent, '1.3x');
});

test('loadAudioManifest 失败时会重置当前音频并显示未准备好状态', async () => {
  const harness = buildHarness({ fetchOk: false });

  vm.runInContext(`
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
    poemAudio.src = 'audio/female/0.mp3';
  `, harness.context);

  await harness.loadAudioManifest();

  const poemAudio = harness.elements.get('poemAudio');
  assert.equal(poemAudio.src, '');
  assert.equal(poemAudio.removeAttributeCalls, 1);
  assert.equal(poemAudio.loadCalls, 1);
  assert.equal(harness.elements.get('audioStatus').textContent, '音频资源尚未准备好');
});
