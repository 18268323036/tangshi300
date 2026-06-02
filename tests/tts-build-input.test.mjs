import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPoemAudioInput,
  buildTtsText,
  linesToStrings,
} from '../scripts/tts/build-input.mjs';

const samplePoem = {
  title: '静夜思',
  author: '李白',
  lines: [
    [{ c: '床' }, { c: '前' }, { c: '明' }, { c: '月' }, { c: '光' }],
    [{ c: '疑' }, { c: '是' }, { c: '地' }, { c: '上' }, { c: '霜' }],
    [{ c: '举' }, { c: '头' }, { c: '望' }, { c: '明' }, { c: '月' }],
    [{ c: '低' }, { c: '头' }, { c: '思' }, { c: '故' }, { c: '乡' }],
  ],
};

test('linesToStrings 把字数组转成正文行', () => {
  assert.deepEqual(linesToStrings(samplePoem.lines), [
    '床前明月光',
    '疑是地上霜',
    '举头望明月',
    '低头思故乡',
  ]);
});

test('buildTtsText 生成题目作者正文格式', () => {
  assert.equal(
    buildTtsText(samplePoem),
    '《静夜思》。李白。床前明月光，疑是地上霜。举头望明月，低头思故乡。'
  );
});

test('buildPoemAudioInput 保留索引和正文行', () => {
  assert.deepEqual(buildPoemAudioInput(samplePoem, 0), {
    id: 0,
    title: '静夜思',
    author: '李白',
    bodyLines: ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'],
    ttsText: '《静夜思》。李白。床前明月光，疑是地上霜。举头望明月，低头思故乡。',
  });
});
