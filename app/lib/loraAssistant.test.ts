import assert from 'node:assert/strict'
import JSZip from 'jszip'
import test from 'node:test'
import {
  buildLoraCaptionMessages,
  cleanLoraCaption,
  createLoraZip,
  duplicateTextFilenames,
  finalLoraText,
  textFilename
} from './loraAssistant.ts'

test('construye mensaje multimodal con instrucción de caption LoRA', () => {
  const messages = buildLoraCaptionMessages('data:image/png;base64,AAAA')
  assert.equal(messages[0]?.role, 'system')
  assert.equal(Array.isArray(messages[1]?.content), true)
  assert.deepEqual(messages[1]?.content, [
    { type: 'text', text: 'Write the caption that will be used directly in the accompanying TXT file.' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
  ])
})

test('limpia razonamiento y genera texto final con prefijo', () => {
  assert.equal(cleanLoraCaption('```text\n<think>private</think>caption: a red coat\n```'), 'a red coat')
  assert.equal(finalLoraText('char_token', 'a red coat'), 'char_token a red coat')
  assert.equal(finalLoraText('', '  a red coat  '), 'a red coat')
})

test('conserva nombres base y detecta colisiones de TXT', () => {
  assert.equal(textFilename('folder\\photo.webp'), 'photo.txt')
  const files = [new File(['a'], 'photo.webp', { type: 'image/webp' }), new File(['b'], 'photo.png', { type: 'image/png' })]
  assert.deepEqual(duplicateTextFilenames(files), ['photo.txt'])
})

test('crea ZIP solo con TXT UTF-8', async () => {
  const blob = await createLoraZip([{ filename: 'photo.txt', content: 'token café' }])
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.deepEqual(Object.keys(zip.files), ['photo.txt'])
  assert.equal(await zip.file('photo.txt')!.async('string'), 'token café')
})
