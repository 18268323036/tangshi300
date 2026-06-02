import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const inputPath = path.join(projectRoot, 'scripts', 'tts', 'poems-for-audio.json');
const voicesPath = path.join(projectRoot, 'scripts', 'tts', 'voices.json');
const manifestPath = path.join(projectRoot, 'audio', 'manifest.json');
const tmpDir = path.join(projectRoot, 'scripts', 'tts', 'tmp');
const requiredVoiceIds = ['female', 'child'];

export function outputPathsForTrack(voiceId, trackId) {
  return {
    wav: `scripts/tts/tmp/${voiceId}-${trackId}.wav`,
    mp3: `audio/${voiceId}/${trackId}.mp3`,
  };
}

export function assertVoiceConfig(voices) {
  for (const voiceId of requiredVoiceIds) {
    if (!voices[voiceId]) {
      throw new Error(`missing voice config for ${voiceId}`);
    }

    for (const field of ['label', 'model', 'config']) {
      if (!voices[voiceId][field]) {
        throw new Error(`missing ${field} for voice ${voiceId}`);
      }
    }
  }
}

export function isValidDuration(duration) {
  return Number.isFinite(duration) && duration > 0;
}

export function resolveVoicePaths(voice, rootPath = projectRoot) {
  return {
    ...voice,
    model: path.resolve(rootPath, voice.model),
    config: path.resolve(rootPath, voice.config),
  };
}

export function buildManifest(items, voices, durationsByKey, options = {}) {
  const manifest = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    voices: Object.fromEntries(
      Object.entries(voices).map(([voiceId, config]) => [voiceId, { label: config.label }])
    ),
    tracks: {},
  };

  for (const item of items) {
    const audio = {};

    for (const voiceId of Object.keys(voices)) {
      const duration = durationsByKey[`${voiceId}:${item.id}`];
      if (!isValidDuration(duration)) {
        continue;
      }

      audio[voiceId] = {
        src: outputPathsForTrack(voiceId, item.id).mp3,
        duration,
      };
    }

    manifest.tracks[String(item.id)] = {
      title: item.title,
      author: item.author,
      audio,
    };
  }

  return manifest;
}

export function runOrThrow(command, args, options = {}, dependencies = {}) {
  const spawnImpl = dependencies.spawnImpl ?? spawnSync;
  const result = spawnImpl(command, args, {
    ...options,
    encoding: 'utf8',
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`missing required command: ${command}`);
    }

    throw new Error(`failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }

  return result;
}

function defaultProbeDuration(mp3AbsolutePath, dependencies = {}) {
  const runCommand = dependencies.runCommand ?? runOrThrow;
  const result = runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    mp3AbsolutePath,
  ]);

  return Number(result.stdout.trim());
}

async function defaultLoadJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

function defaultMkdir(dirPath) {
  return fs.mkdir(dirPath, { recursive: true });
}

function defaultWriteFile(filePath, content) {
  return fs.writeFile(filePath, content, 'utf8');
}

function buildFailureSummary(failures) {
  const suffix = failures.length === 1 ? '' : 's';
  const details = failures
    .map(({ voiceId, trackId, reason }) => `${voiceId}:${trackId} ${reason}`)
    .join('; ');
  return `${failures.length} audio generation failure${suffix}: ${details}`;
}

export async function generateAllAudioWithDeps(options = {}) {
  const {
    projectRoot: rootPath = projectRoot,
    inputPath: sourceInputPath = inputPath,
    voicesPath: sourceVoicesPath = voicesPath,
    manifestPath: outputManifestPath = manifestPath,
    tmpDir: scratchDir = tmpDir,
    loadJson = defaultLoadJson,
    mkdir = defaultMkdir,
    writeFile = defaultWriteFile,
    runCommand = runOrThrow,
    probeDuration = defaultProbeDuration,
    now = () => new Date().toISOString(),
  } = options;

  const { items } = await loadJson(sourceInputPath);
  const voices = await loadJson(sourceVoicesPath);
  assertVoiceConfig(voices);

  await mkdir(path.join(rootPath, 'audio'));
  await mkdir(scratchDir);

  const durationsByKey = {};
  const failures = [];

  for (const [voiceId, voice] of Object.entries(voices)) {
    const resolvedVoice = resolveVoicePaths(voice, rootPath);
    await mkdir(path.join(rootPath, 'audio', voiceId));

    for (const item of items) {
      const trackPaths = outputPathsForTrack(voiceId, item.id);
      const wavAbsolutePath = path.join(rootPath, trackPaths.wav);
      const mp3AbsolutePath = path.join(rootPath, trackPaths.mp3);

      try {
        runCommand(
          'piper',
          [
            '--model',
            resolvedVoice.model,
            '--config',
            resolvedVoice.config,
            '--output_file',
            wavAbsolutePath,
          ],
          {
            input: item.ttsText,
          }
        );

        runCommand('ffmpeg', [
          '-y',
          '-i',
          wavAbsolutePath,
          '-codec:a',
          'libmp3lame',
          '-q:a',
          '4',
          mp3AbsolutePath,
        ]);

        const duration = probeDuration(mp3AbsolutePath, { runCommand });
        if (!isValidDuration(duration)) {
          failures.push({
            voiceId,
            trackId: item.id,
            reason: `invalid duration: ${String(duration)}`,
          });
          continue;
        }

        durationsByKey[`${voiceId}:${item.id}`] = duration;
      } catch (error) {
        failures.push({
          voiceId,
          trackId: item.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const manifest = buildManifest(items, voices, durationsByKey, {
    generatedAt: now(),
  });
  await writeFile(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (failures.length > 0) {
    const error = new Error(buildFailureSummary(failures));
    error.failures = failures;
    error.manifest = manifest;
    throw error;
  }

  return manifest;
}

export async function generateAllAudio() {
  return generateAllAudioWithDeps();
}

if (process.argv[1] === __filename) {
  const manifest = await generateAllAudio();
  console.log(`generated manifest with ${Object.keys(manifest.tracks).length} tracks`);
}
