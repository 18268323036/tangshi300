import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const projectRoot = '/Users/zhangxy5/小项目/tangshi-app';
const htmlPath = path.join(projectRoot, 'index.html');
const imagesDir = path.join(projectRoot, 'images');
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

function extractPoems() {
  const match = html.match(/const poems = (\[[\s\S]*?\n\]);/);
  assert.ok(match, 'poems data block should exist');
  return vm.runInNewContext(`(${match[1]})`);
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
    style: {},
    _innerHTML: '',
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value) {
      this._innerHTML = value;
    },
    closest() {
      return this;
    },
    scrollIntoView() {},
    load() {
      this.loadCalls = (this.loadCalls || 0) + 1;
    },
    ...extra,
  };
  element.classList = createClassList(element);
  return element;
}

function createAudioElement(id, overrides = {}) {
  return createElement(id, {
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
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    },
    ...overrides,
  });
}

function loadRuntime({ audioOverrides = {} } = {}) {
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(scriptMatch, 'inline script block should exist');

  const elements = new Map();
  const dots = Array.from({ length: 3 }, (_, index) =>
    createElement(`dot-${index}`, { dataset: { i: String(index) } }),
  );

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const factory = id === 'poemAudio'
          ? (elementId) => createAudioElement(elementId, audioOverrides)
          : createElement;
        elements.set(id, factory(id));
      }
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === '.carousel-dots span') return dots;
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
    window: {
      addEventListener() {},
      scrollTo() {},
    },
    document,
    console,
    alert() {},
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
  };

  vm.createContext(context);
  vm.runInContext(
    `${scriptMatch[1]}\nthis.__exports = {
      togglePlay,
      startPlay,
      stopPlay,
      syncPlaybackFrame,
      resolveAudioTrack
    };`,
    context,
  );

  document.getElementById('playBtn');
  document.getElementById('progressFill');
  document.getElementById('audioStatus');
  document.getElementById('poemAudio');
  document.getElementById('img0').className = 'active';
  document.getElementById('img1').className = 'inactive';
  document.getElementById('img2').className = 'inactive';

  return {
    context,
    elements,
    ...context.__exports,
  };
}

test('every poem character entry includes both text and pinyin', () => {
  const poems = extractPoems();

  for (const poem of poems) {
    for (const line of poem.lines) {
      for (const char of line) {
        assert.equal(typeof char.c, 'string', `missing char text in ${poem.title}`);
        assert.ok(char.c.length > 0, `empty char text in ${poem.title}`);
        assert.equal(typeof char.p, 'string', `missing pinyin in ${poem.title}`);
        assert.ok(char.p.length > 0, `empty pinyin in ${poem.title}`);
      }
    }
  }
});

test('寻隐者不遇 keeps the full final line text', () => {
  const poems = extractPoems();
  const poem = poems.find((entry) => entry.title === '寻隐者不遇');

  assert.ok(poem, '寻隐者不遇 should exist');
  assert.equal(
    poem.lines[3].map((char) => char.c).join(''),
    '云深不知处',
  );
});

test('image groups map one-to-one with poem data indexes', () => {
  const poems = extractPoems();
  const imagePrefixes = new Set(
    fs.readdirSync(imagesDir)
      .map((name) => name.match(/^(\d+)_\d+\.jpg$/))
      .filter(Boolean)
      .map((match) => Number(match[1])),
  );

  assert.equal(imagePrefixes.size, poems.length, 'poem count should match image groups');

  for (let i = 0; i < poems.length; i += 1) {
    assert.ok(imagePrefixes.has(i), `missing image group for poem index ${i}`);
  }
});

test('startPlay does not require speechSynthesis to start shared audio playback', async () => {
  const { context, startPlay, elements } = loadRuntime();

  vm.runInContext(`
    audioManifest = {
      voices: {
        female: { label: '女声' }
      },
      tracks: {
        '0': {
          audio: {
            female: { src: 'audio/female/0.mp3', duration: 13.82 }
          }
        }
      }
    };
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
  `, context);

  await startPlay();

  assert.equal(elements.get('poemAudio').playCalls, 1);
  assert.equal(elements.get('playBtn').textContent, '⏸');
});

test('togglePlay pauses shared audio without resetting progress', async () => {
  const { context, startPlay, togglePlay, elements } = loadRuntime();

  vm.runInContext(`
    audioManifest = {
      voices: {
        female: { label: '女声' }
      },
      tracks: {
        '0': {
          audio: {
            female: { src: 'audio/female/0.mp3', duration: 13.82 }
          }
        }
      }
    };
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
    poemAudio.duration = 20;
  `, context);

  await startPlay();
  elements.get('poemAudio').currentTime = 9;
  elements.get('progressFill').style.width = '45%';

  togglePlay();

  assert.equal(elements.get('poemAudio').pauseCalls, 1);
  assert.equal(elements.get('poemAudio').currentTime, 9);
  assert.equal(elements.get('progressFill').style.width, '45%');
  assert.equal(elements.get('playBtn').textContent, '▶');
});

test('stale play rejection after voice restart does not overwrite current playing UI', async () => {
  const firstPlay = createDeferred();
  const { context, startPlay, elements } = loadRuntime({
    audioOverrides: {
      play() {
        this.playCalls += 1;
        this.paused = false;
        if (this.playCalls === 1) return firstPlay.promise;
        return Promise.resolve();
      },
    },
  });

  vm.runInContext(`
    audioManifest = {
      voices: {
        female: { label: '女声' },
        child: { label: '童声' }
      },
      tracks: {
        '0': {
          audio: {
            female: { src: 'audio/female/0.mp3', duration: 13.82 },
            child: { src: 'audio/child/0.mp3', duration: 12.94 }
          }
        }
      }
    };
    currentPoemIndex = 0;
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
  `, context);

  void startPlay({ reset: true });
  vm.runInContext(`setVoiceMode('child');`, context);
  firstPlay.reject(new Error('stale reject'));
  await flushAsyncWork();

  assert.equal(elements.get('poemAudio').src, 'audio/child/0.mp3');
  assert.equal(elements.get('playBtn').textContent, '⏸');
  assert.equal(elements.get('audioStatus').textContent, '');
  assert.equal(vm.runInContext('isPlaying', context), true);
});

test('stopPlay resets the visible reading progress in audio mode', () => {
  const { context, stopPlay, elements } = loadRuntime();

  vm.runInContext(`
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
    poemAudio.duration = 20;
    poemAudio.currentTime = 12;
    isPlaying = true;
  `, context);

  elements.set('poem-line-0', createElement('poem-line-0', { className: 'poem-line reading' }));
  elements.set('poem-line-1', createElement('poem-line-1', { className: 'poem-line' }));

  stopPlay();

  assert.equal(elements.get('poemAudio').currentTime, 0);
  assert.equal(elements.get('progressFill').style.width, '0%');
  assert.equal(elements.get('img0').className, 'active');
  assert.ok(!elements.get('poem-line-0').classList.contains('reading'));
});

test('syncPlaybackFrame keeps intro segment unhighlighted before poem body begins', () => {
  const { context, syncPlaybackFrame, elements } = loadRuntime();

  elements.set('poem-line-0', createElement('poem-line-0', { className: 'poem-line' }));
  elements.set('poem-line-1', createElement('poem-line-1', { className: 'poem-line' }));
  elements.set('poem-line-2', createElement('poem-line-2', { className: 'poem-line' }));
  elements.set('poem-line-3', createElement('poem-line-3', { className: 'poem-line' }));

  vm.runInContext(`
    currentPoem = poems[0];
    poemAudio = document.getElementById('poemAudio');
    poemAudio.duration = 20;
    poemAudio.currentTime = 2;
  `, context);

  syncPlaybackFrame();

  assert.equal(elements.get('progressFill').style.width, '10%');
  assert.ok(!elements.get('poem-line-0').classList.contains('reading'));
  assert.ok(!elements.get('poem-line-1').classList.contains('reading'));
  assert.ok(!elements.get('poem-line-2').classList.contains('reading'));
  assert.ok(!elements.get('poem-line-3').classList.contains('reading'));
});

test('current reading line has a visible dedicated style selector', () => {
  assert.match(
    html,
    /\.poem-line\.reading\s*\{[\s\S]*?(background|color|box-shadow)[\s\S]*?\}/,
  );
});
