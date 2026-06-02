import test from 'node:test';
import assert from 'node:assert/strict';
import * as audioModule from '../scripts/tts/generate-audio.mjs';

const { assertVoiceConfig, buildManifest, outputPathsForTrack } = audioModule;

test('outputPathsForTrack 输出到音频目录和临时 wav 目录', () => {
  assert.deepEqual(outputPathsForTrack('female', 7), {
    wav: 'scripts/tts/tmp/female-7.wav',
    mp3: 'audio/female/7.mp3',
  });
});

test('assertVoiceConfig 要求 female 和 child 都存在', () => {
  assert.throws(
    () => assertVoiceConfig({ female: { label: '女声', model: 'a', config: 'b' } }),
    /missing voice config for child/
  );
});

test('buildManifest 跳过缺少 duration 的声音资源', () => {
  const manifest = buildManifest(
    [{ id: 0, title: '静夜思', author: '李白' }],
    {
      female: { label: '女声' },
      child: { label: '童声' },
    },
    {
      'female:0': 13.82,
    }
  );

  assert.deepEqual(manifest.tracks['0'].audio, {
    female: {
      src: 'audio/female/0.mp3',
      duration: 13.82,
    },
  });
  assert.equal('child' in manifest.tracks['0'].audio, false);
});

test('buildManifest 跳过非法 duration', () => {
  const manifest = buildManifest(
    [{ id: 0, title: '静夜思', author: '李白' }],
    {
      female: { label: '女声' },
      child: { label: '童声' },
    },
    {
      'female:0': Number.NaN,
      'child:0': 0,
    }
  );

  assert.deepEqual(manifest.tracks['0'].audio, {});
});

test('buildManifest 使用字符串形式的 tracks key', () => {
  const manifest = buildManifest(
    [{ id: 7, title: '咏鹅', author: '骆宾王' }],
    {
      female: { label: '女声' },
      child: { label: '童声' },
    },
    {
      'female:7': 9.12,
    }
  );

  assert.deepEqual(Object.keys(manifest.tracks), ['7']);
});

test('runOrThrow 缺命令时给出明确报错', () => {
  assert.equal(typeof audioModule.runOrThrow, 'function');

  assert.throws(
    () =>
      audioModule.runOrThrow('piper', ['--version'], {}, {
        spawnImpl: () => ({
          error: Object.assign(new Error('spawn piper ENOENT'), { code: 'ENOENT' }),
          status: null,
          stdout: '',
          stderr: '',
        }),
      }),
    /missing required command: piper/
  );
});

test('generateAllAudioWithDeps 把相对 voice 路径解析到 projectRoot', async () => {
  assert.equal(typeof audioModule.generateAllAudioWithDeps, 'function');

  const projectRoot = '/repo';
  const inputPath = '/repo/scripts/tts/poems-for-audio.json';
  const voicesPath = '/repo/scripts/tts/voices.json';
  const manifestPath = '/repo/audio/manifest.json';
  const commands = [];

  await audioModule.generateAllAudioWithDeps({
    projectRoot,
    inputPath,
    voicesPath,
    manifestPath,
    tmpDir: '/repo/scripts/tts/tmp',
    loadJson: async (filePath) => {
      if (filePath === inputPath) {
        return {
          items: [{ id: 0, title: '静夜思', author: '李白', ttsText: '《静夜思》。李白。' }],
        };
      }

      return {
        female: { label: '女声', model: '.local-tools/female.onnx', config: '.local-tools/female.json' },
        child: { label: '童声', model: 'voices/child.onnx', config: 'voices/child.json' },
      };
    },
    mkdir: async () => {},
    writeFile: async () => {},
    runCommand: (command, args) => {
      commands.push({ command, args });
      return { stdout: '', stderr: '', status: 0 };
    },
    probeDuration: () => 8.4,
    now: () => '2026-05-15T00:00:00.000Z',
  });

  const piperCalls = commands.filter(({ command }) => command === 'piper');
  assert.deepEqual(
    piperCalls.map(({ args }) => ({
      model: args[args.indexOf('--model') + 1],
      config: args[args.indexOf('--config') + 1],
    })),
    [
      {
        model: '/repo/.local-tools/female.onnx',
        config: '/repo/.local-tools/female.json',
      },
      {
        model: '/repo/voices/child.onnx',
        config: '/repo/voices/child.json',
      },
    ]
  );
});

test('generateAllAudioWithDeps 汇总单条失败但保留其他成功条目', async () => {
  assert.equal(typeof audioModule.generateAllAudioWithDeps, 'function');

  const projectRoot = '/repo';
  const inputPath = '/repo/scripts/tts/poems-for-audio.json';
  const voicesPath = '/repo/scripts/tts/voices.json';
  const manifestPath = '/repo/audio/manifest.json';
  const writes = [];

  await assert.rejects(
    () =>
      audioModule.generateAllAudioWithDeps({
        projectRoot,
        inputPath,
        voicesPath,
        manifestPath,
        tmpDir: '/repo/scripts/tts/tmp',
        loadJson: async (filePath) => {
          if (filePath === inputPath) {
            return {
              items: [
                { id: 0, title: '静夜思', author: '李白', ttsText: '《静夜思》。李白。' },
                { id: 1, title: '春晓', author: '孟浩然', ttsText: '《春晓》。孟浩然。' },
              ],
            };
          }

          return {
            female: { label: '女声', model: '.local-tools/female.onnx', config: '.local-tools/female.json' },
            child: { label: '童声', model: '.local-tools/child.onnx', config: '.local-tools/child.json' },
          };
        },
        mkdir: async () => {},
        writeFile: async (filePath, content) => {
          writes.push({ filePath, content });
        },
        runCommand: (command, args) => {
          const outputFile = args[args.indexOf('--output_file') + 1];
          if (command === 'piper' && outputFile === '/repo/scripts/tts/tmp/female-0.wav') {
            throw new Error('missing required command: piper');
          }

          return { stdout: '', stderr: '', status: 0 };
        },
        probeDuration: (mp3Path) => {
          if (mp3Path === '/repo/audio/female/1.mp3') return 9.1;
          return 7.2;
        },
        now: () => '2026-05-15T00:00:00.000Z',
      }),
    (error) => {
      assert.match(error.message, /1 audio generation failure/);
      assert.match(error.message, /female:0/);
      return true;
    }
  );

  assert.equal(writes.length, 1);
  assert.equal(writes[0].filePath, manifestPath);

  const manifest = JSON.parse(writes[0].content);
  assert.equal('female' in manifest.tracks['0'].audio, false);
  assert.deepEqual(manifest.tracks['1'].audio.female, {
    src: 'audio/female/1.mp3',
    duration: 9.1,
  });
  assert.deepEqual(manifest.tracks['0'].audio.child, {
    src: 'audio/child/0.mp3',
    duration: 7.2,
  });
});
